import { GoogleGenAI, Type } from "@google/genai";

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================
const MODEL_NAME = "gemini-3.8-flash";
const MAX_CONCURRENT_REQUESTS = 3;
const REQUEST_TIMEOUT_MS = 25000;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 8000;
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes cache to shield from duplicate requests

// ============================================================================
// GEMINI CLIENT INITIALIZATION (Lazy Singleton)
// ============================================================================
let genAIClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!genAIClient) {
    try {
      genAIClient = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
      console.log("[Gemini Service] Initialized GoogleGenAI client with model:", MODEL_NAME);
    } catch (err: any) {
      console.error("[Gemini Service] Failed to initialize GoogleGenAI client:", err.message);
      return null;
    }
  }
  return genAIClient;
}

// ============================================================================
// ASYNC CONCURRENCY QUEUE (Non-Blocking Concurrency Limiter)
// Prevents API Rate Limits (429) and socket pool exhaustion when multiple
// devices trigger requests concurrently.
// ============================================================================
interface QueuedTask<T> {
  task: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
  queuedAt: number;
  timeoutTimer: NodeJS.Timeout;
}

class AsyncConcurrencyQueue {
  private running = 0;
  private queue: QueuedTask<any>[] = [];
  private readonly maxConcurrent: number;

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  public enqueue<T>(task: () => Promise<T>, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        // Remove from queue if still waiting
        const idx = this.queue.findIndex((q) => q.timeoutTimer === timeoutTimer);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
          reject(new Error("REQUEST_QUEUE_TIMEOUT: تم تجاوز وقت الانتظار في طابور المعالجة"));
        }
      }, timeoutMs);

      this.queue.push({
        task,
        resolve,
        reject,
        queuedAt: Date.now(),
        timeoutTimer,
      });

      this.processNext();
    });
  }

  private processNext(): void {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    clearTimeout(item.timeoutTimer);
    this.running++;

    item
      .task()
      .then((res) => {
        item.resolve(res);
      })
      .catch((err) => {
        item.reject(err);
      })
      .finally(() => {
        this.running--;
        this.processNext();
      });
  }

  public getStats() {
    return {
      running: this.running,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
    };
  }
}

export const geminiConcurrencyQueue = new AsyncConcurrencyQueue(MAX_CONCURRENT_REQUESTS);

// ============================================================================
// EXPONENTIAL BACKOFF WITH FULL JITTER
// Gracefully handles Rate Limits (HTTP 429) & Transient Server Errors (HTTP 5xx)
// ============================================================================
function isRetryableError(error: any): boolean {
  if (!error) return false;
  const status = error.status || error.statusCode || error.response?.status;
  const message = String(error.message || "").toLowerCase();

  // Rate Limit / Quota Exceeded
  if (status === 429 || message.includes("429") || message.includes("resource_exhausted") || message.includes("quota")) {
    return true;
  }
  // Transient server-side errors
  if (status >= 500 && status <= 599) {
    return true;
  }
  if (
    message.includes("unavailable") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("fetch failed") ||
    message.includes("network error")
  ) {
    return true;
  }
  return false;
}

export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  contextName: string = "gemini_call",
  maxRetries: number = MAX_RETRIES
): Promise<T> {
  let lastError: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err: any) {
      lastError = err;
      const isRetryable = isRetryableError(err);
      const isLastAttempt = attempt === maxRetries;

      console.warn(
        `[Gemini Retry] [${contextName}] Attempt ${attempt + 1}/${maxRetries + 1} failed: ${err.message}. Retryable: ${isRetryable}`
      );

      if (!isRetryable || isLastAttempt) {
        break;
      }

      // Exponential backoff with random jitter: (base * 2^attempt) + jitter
      const exponential = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 500);
      const delay = Math.min(MAX_RETRY_DELAY_MS, exponential + jitter);

      console.log(`[Gemini Retry] [${contextName}] Waiting ${delay}ms before attempt ${attempt + 2}...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// ============================================================================
// SESSION & MULTI-DEVICE STATE ISOLATION
// Ensures device sessions have dedicated caches and isolated rate buckets
// ============================================================================
interface CachedResponse {
  data: any;
  timestamp: number;
}

const memoryResponseCache = new Map<string, CachedResponse>();
const sessionRequestCounters = new Map<string, { count: number; resetAt: number }>();

// Simple sliding window rate limit per session (e.g., 20 requests per minute per device)
export function checkSessionRateLimit(sessionId: string, maxPerMin: number = 20): boolean {
  const cleanId = String(sessionId || "default_session").trim();
  const now = Date.now();
  const record = sessionRequestCounters.get(cleanId);

  if (!record || now > record.resetAt) {
    sessionRequestCounters.set(cleanId, { count: 1, resetAt: now + 60000 });
    return true;
  }

  if (record.count >= maxPerMin) {
    return false;
  }

  record.count++;
  return true;
}

export function getCachedResponse(cacheKey: string): any | null {
  const cached = memoryResponseCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    memoryResponseCache.delete(cacheKey);
    return null;
  }
  return cached.data;
}

export function setCachedResponse(cacheKey: string, data: any): void {
  memoryResponseCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
  });

  // Keep cache size bounded
  if (memoryResponseCache.size > 200) {
    const oldestKey = memoryResponseCache.keys().next().value;
    if (oldestKey) memoryResponseCache.delete(oldestKey);
  }
}

// ============================================================================
// STRUCTURED PARSING & FALLBACK RESILIENCE
// ============================================================================
export function cleanAndParseJSON<T>(rawText: string, fallback: T): T {
  if (!rawText || typeof rawText !== "string") {
    return fallback;
  }

  try {
    // 1. Direct JSON parse
    return JSON.parse(rawText.trim()) as T;
  } catch {
    // 2. Remove Markdown code blocks ```json ... ```
    try {
      let cleaned = rawText.trim();
      if (cleaned.startsWith("```json")) {
        cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
      } else if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```\s*/i, "").replace(/\s*```$/, "");
      }
      return JSON.parse(cleaned.trim()) as T;
    } catch {
      // 3. Regex match first object { ... } or array [ ... ]
      try {
        const objMatch = rawText.match(/\{[\s\S]*\}/);
        if (objMatch) {
          return JSON.parse(objMatch[0]) as T;
        }
        const arrMatch = rawText.match(/\[[\s\S]*\]/);
        if (arrMatch) {
          return JSON.parse(arrMatch[0]) as T;
        }
      } catch (e) {
        console.warn("[Gemini Parser] Fallback triggered due to JSON parse error:", e);
      }
    }
  }

  return fallback;
}

// ============================================================================
// DOMAIN-SPECIFIC GENERATORS FOR EMAN MATH SYSTEM
// ============================================================================

export interface SmartNotificationRequest {
  studentName: string;
  studentBarcode: string;
  grade: string;
  attendanceStatus?: string;
  lastExamScore?: string;
  examTitle?: string;
  homeworkStatus?: string;
  notes?: string;
  tone?: "formal" | "encouraging" | "urgent";
  sessionId?: string;
  deviceId?: string;
}

export interface SmartNotificationResponse {
  success: boolean;
  source: "gemini" | "cache" | "fallback";
  parentMessage: string;
  studentMotivationalNote: string;
  academicSummary: string;
  actionRequired: string;
  recommendedTag: string;
}

export async function generateSmartStudentNotification(
  req: SmartNotificationRequest
): Promise<SmartNotificationResponse> {
  const sessionId = req.sessionId || req.deviceId || "global_session";
  const cacheKey = `notif_${req.studentBarcode}_${req.attendanceStatus || ""}_${req.lastExamScore || ""}_${req.tone || "formal"}`;

  // Check cache first
  const cached = getCachedResponse(cacheKey);
  if (cached) {
    return { ...cached, source: "cache" };
  }

  // Fallback defaults in case API is unavailable or rate-limited
  const fallback: SmartNotificationResponse = {
    success: true,
    source: "fallback",
    parentMessage: `تحية طيبة من منظومة الأستاذة إيمان الدمشيتي للرياضيات 📐.\nنحيطكم علماً بمستوى الطالب/ة (${req.studentName}) المقيد في (${req.grade}):\n• الحضور: ${req.attendanceStatus || "مسجل"}\n• آخر اختبار (${req.examTitle || "الاختبار الدوري"}): ${req.lastExamScore || "تم الرصد"}\n• الواجب: ${req.homeworkStatus || "منتظم"}\nشاكرين حرصكم المستمر على التفوق الرياضي ✨.`,
    studentMotivationalNote: `استمر في بذل الجهد والتركيز يا بطل، الرياضيات تحتاج مثابرة وحل مستمر وستصل لأعلى الدرجات دائماً بإذن الله!`,
    academicSummary: `حالة الطالب مستقرة ويحتاج للاستمرار في أداء التمارين بانتظام.`,
    actionRequired: req.attendanceStatus?.includes("غياب")
      ? "التواصل مع إدارة السنتر لتعويض الحصة وحل الواجب."
      : "متابعة حل تمارين الدرس القادم.",
    recommendedTag: req.attendanceStatus?.includes("غياب") ? "غياب" : "متابعة",
  };

  const client = getGeminiClient();
  if (!client) {
    console.warn("[Gemini Service] GEMINI_API_KEY is not configured. Returning structured fallback.");
    return fallback;
  }

  // Check session rate limit (max 20 requests/minute per device)
  if (!checkSessionRateLimit(sessionId, 20)) {
    console.warn(`[Gemini Service] Rate limit exceeded for session: ${sessionId}. Returning structured fallback.`);
    return { ...fallback, source: "fallback" };
  }

  // Enqueue task in the async concurrency queue with retry & backoff
  try {
    const result = await geminiConcurrencyQueue.enqueue(async () => {
      return await executeWithRetry(
        async () => {
          const prompt = `
أنت المساعد الذكي للأستاذة إيمان الدمشيتي، خبيرة تدريس مادة الرياضيات للمراحل الإعدادية والثانوية في مصر.
المطلوب صياغة رسالة تربوية ذكية موجهة لولي أمر الطالب ورسالة تشجيعية للطالب بأسلوب مصري راقٍ ومحترم جداً.

بيانات الطالب:
- اسم الطالب: ${req.studentName}
- الكود: ${req.studentBarcode}
- المرحلة / الصف: ${req.grade}
- حالة الحضور اليوم: ${req.attendanceStatus || "حاضر في الموعد"}
- نتيجة آخر اختبار: ${req.lastExamScore || "غير متوفر"} (${req.examTitle || "الاختبار الدوري"})
- موقف الواجب المنزلي: ${req.homeworkStatus || "مسلم بالكامل"}
- ملاحظات المعلمة: ${req.notes || "لا توجد ملاحظات سلبية"}
- النبرة المطلوبة: ${req.tone || "encouraging"}

قم بالرد بصيغة JSON حصراً بالمفاتيح التالية:
{
  "parentMessage": "نص الرسالة الرسمية الكاملة لولي الأمر باللغة العربية مع إيموجي راقية",
  "studentMotivationalNote": "كلمة تشجيعية قصيرة موجهة للطالب لرفع شغفه بالرياضيات",
  "academicSummary": "ملخص تربوي من سطرين لمستوى الطالب",
  "actionRequired": "المطلوب من ولي الأمر أو الطالب عمله الآن",
  "recommendedTag": "وسم مناسب مثل (متميز / تنبيه غياب / تفوق / يحتاج متابعة)"
}
`;

          const response = await client.models.generateContent({
            model: MODEL_NAME,
            contents: prompt,
            config: {
              systemInstruction: "You are an expert pedagogical assistant for Ms. Eman El-Damsheety's Mathematics Educational Center in Egypt. Always output valid structured JSON.",
              responseMimeType: "application/json",
              temperature: 0.7,
            },
          });

          const rawText = response.text || "";
          const parsed = cleanAndParseJSON<typeof fallback>(rawText, fallback);
          return {
            success: true,
            source: "gemini" as const,
            parentMessage: parsed.parentMessage || fallback.parentMessage,
            studentMotivationalNote: parsed.studentMotivationalNote || fallback.studentMotivationalNote,
            academicSummary: parsed.academicSummary || fallback.academicSummary,
            actionRequired: parsed.actionRequired || fallback.actionRequired,
            recommendedTag: parsed.recommendedTag || fallback.recommendedTag,
          };
        },
        `smart_notification_${req.studentBarcode}`
      );
    });

    if (result && result.source === "gemini") {
      setCachedResponse(cacheKey, result);
    }
    return result;
  } catch (err: any) {
    console.error("[Gemini Service] Error generating smart notification:", err.message);
    return fallback;
  }
}

// ----------------------------------------------------------------------------
// STUDENT ACADEMIC DIAGNOSTICS & EARLY WARNING
// ----------------------------------------------------------------------------
export interface AcademicAnalysisRequest {
  studentName: string;
  studentBarcode: string;
  grade: string;
  absenceRate: number;
  totalAbsentDays: number;
  examAverage: number;
  recentScores: number[];
  isUnpaid: boolean;
  behaviorNotes?: string;
  sessionId?: string;
}

export interface AcademicAnalysisResponse {
  success: boolean;
  source: "gemini" | "cache" | "fallback";
  riskLevel: "HIGH" | "MEDIUM" | "LOW" | "EXCELLENT";
  diagnosis: string;
  keyFactors: string[];
  teacherActionPlan: string[];
  parentAdvisoryNote: string;
}

export async function analyzeStudentAcademicStatus(
  req: AcademicAnalysisRequest
): Promise<AcademicAnalysisResponse> {
  const sessionId = req.sessionId || "global_session";
  const cacheKey = `analysis_${req.studentBarcode}_${req.absenceRate}_${req.examAverage}`;

  const cached = getCachedResponse(cacheKey);
  if (cached) {
    return { ...cached, source: "cache" };
  }

  // Fallback defaults
  let defaultRisk: "HIGH" | "MEDIUM" | "LOW" | "EXCELLENT" = "LOW";
  if (req.absenceRate >= 30 || req.examAverage < 50) defaultRisk = "HIGH";
  else if (req.absenceRate >= 20 || req.examAverage < 65) defaultRisk = "MEDIUM";
  else if (req.examAverage >= 90) defaultRisk = "EXCELLENT";

  const fallback: AcademicAnalysisResponse = {
    success: true,
    source: "fallback",
    riskLevel: defaultRisk,
    diagnosis: `بناءً على السجلات الحالية، يبلغ متوسط الدرجات ${req.examAverage}% مع نسبة غياب ${req.absenceRate}%. الحالة تستدعي المتابعة المعتادة للواجبات والتركيز في حل المسائل التطبيقية.`,
    keyFactors: [
      `نسبة الغياب المسجلة: ${req.absenceRate}% (${req.totalAbsentDays} حصص)`,
      `متوسط درجات الاختبارات: ${req.examAverage}%`,
      req.isUnpaid ? "المصروفات الشهرية غير مسددة" : "المصروفات منتظمة ومسددة",
    ],
    teacherActionPlan: [
      "مراجعة نقاط الضعف في الدروس السابقة أثناء الحصة.",
      "تكليف الطالب بتمارين إضافية متدرجة الصعوبة.",
      "التأكيد على تسليم كشكول الواجب في بداية كل محاضرة.",
    ],
    parentAdvisoryNote: `نرجو التكرم بمتابعة الطالب/ة (${req.studentName}) في مراجعة مادة الرياضيات أولاً بأول وحل التمارين اليومية لتثبيت المفاهيم.`,
  };

  const client = getGeminiClient();
  if (!client) {
    return fallback;
  }

  if (!checkSessionRateLimit(sessionId, 15)) {
    return { ...fallback, source: "fallback" };
  }

  try {
    const result = await geminiConcurrencyQueue.enqueue(async () => {
      return await executeWithRetry(
        async () => {
          const prompt = `
قم بتحليل أداء الطالب في مادة الرياضيات بدقة تربوية كأخصائي تقييم تعليمي للأستاذة إيمان الدمشيتي:
- الاسم: ${req.studentName} (كود: ${req.studentBarcode})
- الصف: ${req.grade}
- نسبة الغياب: ${req.absenceRate}% (عدد أيام الغياب: ${req.totalAbsentDays})
- متوسط درجات الامتحانات: ${req.examAverage}%
- درجات الاختبارات الأخيرة: [${(req.recentScores || []).join(", ")}]
- موقف السداد: ${req.isUnpaid ? "غير مسدد" : "مسدد"}
- ملاحظات إضافية: ${req.behaviorNotes || "لا توجد"}

أخرج تحليلاً بصيغة JSON حصراً:
{
  "riskLevel": "HIGH" | "MEDIUM" | "LOW" | "EXCELLENT",
  "diagnosis": "تشخيص تحليلي دقيق لوضع الطالب في الرياضيات ونقاط القوة والضعف",
  "keyFactors": ["سبب أو عامل 1", "سبب أو عامل 2", "سبب أو عامل 3"],
  "teacherActionPlan": ["إجراء مقترح للمعلمة 1", "إجراء مقترح للمعلمة 2", "إجراء مقترح للمعلمة 3"],
  "parentAdvisoryNote": "نصيحة إرشادية مختصرة لولي الأمر لدعم الطالب بالمنزل"
}
`;

          const response = await client.models.generateContent({
            model: MODEL_NAME,
            contents: prompt,
            config: {
              systemInstruction: "You are a senior academic advisor and math pedagogy specialist for Ms. Eman's Mathematics Academy. Respond with valid JSON only.",
              responseMimeType: "application/json",
              temperature: 0.6,
            },
          });

          const rawText = response.text || "";
          const parsed = cleanAndParseJSON<typeof fallback>(rawText, fallback);
          return {
            success: true,
            source: "gemini" as const,
            riskLevel: parsed.riskLevel || fallback.riskLevel,
            diagnosis: parsed.diagnosis || fallback.diagnosis,
            keyFactors: Array.isArray(parsed.keyFactors) && parsed.keyFactors.length > 0 ? parsed.keyFactors : fallback.keyFactors,
            teacherActionPlan: Array.isArray(parsed.teacherActionPlan) && parsed.teacherActionPlan.length > 0 ? parsed.teacherActionPlan : fallback.teacherActionPlan,
            parentAdvisoryNote: parsed.parentAdvisoryNote || fallback.parentAdvisoryNote,
          };
        },
        `academic_analysis_${req.studentBarcode}`
      );
    });

    if (result && result.source === "gemini") {
      setCachedResponse(cacheKey, result);
    }
    return result;
  } catch (err: any) {
    console.error("[Gemini Service] Error analyzing academic status:", err.message);
    return fallback;
  }
}
