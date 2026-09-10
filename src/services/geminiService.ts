// ============================================================================
// FRONTEND GEMINI RESILIENT CLIENT SERVICE
// Production-Ready Concurrency, Session Isolation & Error Resilience
// ============================================================================

export interface SmartNotificationResult {
  success: boolean;
  source: "gemini" | "cache" | "fallback";
  parentMessage: string;
  studentMotivationalNote: string;
  academicSummary: string;
  actionRequired: string;
  recommendedTag: string;
}

export interface AcademicAnalysisResult {
  success: boolean;
  source: "gemini" | "cache" | "fallback";
  riskLevel: "HIGH" | "MEDIUM" | "LOW" | "EXCELLENT";
  diagnosis: string;
  keyFactors: string[];
  teacherActionPlan: string[];
  parentAdvisoryNote: string;
}

// ----------------------------------------------------------------------------
// SESSION & DEVICE ID MANAGEMENT (Multi-Device Isolation)
// ----------------------------------------------------------------------------
export function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  let devId = localStorage.getItem("aiman_device_id");
  if (!devId) {
    devId = "dev_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now().toString(36);
    try {
      localStorage.setItem("aiman_device_id", devId);
    } catch {}
  }
  return devId;
}

export function getSessionId(): string {
  if (typeof window === "undefined") return "server";
  let sessId = sessionStorage.getItem("aiman_session_id");
  if (!sessId) {
    sessId = "sess_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now().toString(36);
    try {
      sessionStorage.setItem("aiman_session_id", sessId);
    } catch {}
  }
  return sessId;
}

// ----------------------------------------------------------------------------
// CLIENT-SIDE RESILIENT FETCH WITH TIMEOUT & RETRY
// ----------------------------------------------------------------------------
const CLIENT_TIMEOUT_MS = 25000;
const MAX_CLIENT_RETRIES = 2;

async function resilientFetch<T>(
  url: string,
  options: RequestInit,
  fallback: T
): Promise<T> {
  const deviceId = getDeviceId();
  const sessionId = getSessionId();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-device-id": deviceId,
    "x-session-id": sessionId,
    ...(options.headers as Record<string, string>),
  };

  for (let attempt = 0; attempt <= MAX_CLIENT_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutTimer);

      if (response.ok) {
        const json = await response.json();
        return json as T;
      }

      // If Rate-Limited (429) or Server Error (500/503), wait and retry
      if ((response.status === 429 || response.status >= 500) && attempt < MAX_CLIENT_RETRIES) {
        const backoffMs = (attempt + 1) * 1500 + Math.random() * 400;
        console.warn(`[Gemini Client] HTTP ${response.status} on ${url}. Retrying in ${backoffMs}ms...`);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }

      console.warn(`[Gemini Client] Request failed with HTTP ${response.status}. Using fallback.`);
      return fallback;
    } catch (err: any) {
      clearTimeout(timeoutTimer);
      if (err.name === "AbortError") {
        console.warn(`[Gemini Client] Request to ${url} timed out after ${CLIENT_TIMEOUT_MS}ms.`);
      } else {
        console.warn(`[Gemini Client] Network error on attempt ${attempt + 1}:`, err.message);
      }

      if (attempt < MAX_CLIENT_RETRIES) {
        const backoffMs = (attempt + 1) * 1000 + Math.random() * 300;
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      return fallback;
    }
  }

  return fallback;
}

// ----------------------------------------------------------------------------
// EXPORTED SERVICES
// ----------------------------------------------------------------------------

export async function checkGeminiStatus(): Promise<{
  status: string;
  apiKeyConfigured: boolean;
  model: string;
  concurrency: { running: number; queued: number; maxConcurrent: number };
}> {
  try {
    const res = await fetch("/api/gemini/status");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return {
      status: "offline",
      apiKeyConfigured: false,
      model: "gemini-3.8-flash",
      concurrency: { running: 0, queued: 0, maxConcurrent: 3 },
    };
  }
}

export async function requestSmartNotification(params: {
  studentName: string;
  studentBarcode: string;
  grade: string;
  attendanceStatus?: string;
  lastExamScore?: string;
  examTitle?: string;
  homeworkStatus?: string;
  notes?: string;
  tone?: "formal" | "encouraging" | "urgent";
}): Promise<SmartNotificationResult> {
  const fallback: SmartNotificationResult = {
    success: true,
    source: "fallback",
    parentMessage: `تحية طيبة من منظومة الأستاذة إيمان الدمشيتي للرياضيات 📐.\nنحيطكم علماً بأن الطالب/ة (${params.studentName}) - كود (${params.studentBarcode}) مسجل في (${params.grade}):\n• الحضور: ${params.attendanceStatus || "مسجل"}\n• آخر اختبار: ${params.lastExamScore || "تم الرصد"}\n• حالة الواجب: ${params.homeworkStatus || "منتظم"}\nشاكرين حرصكم ومتابعتكم المستمرة ✨.`,
    studentMotivationalNote: `الرياضيات تحتاج تدريب وممارسة مستمرة، استمر بالتركيز وستصل لأعلى الدرجات دائماً يا بطل!`,
    academicSummary: `مستوى الطالب منتظم ويحتاج إلى المواظبة على حل التمارين المتقدمة.`,
    actionRequired: params.attendanceStatus?.includes("غياب")
      ? "يرجى مراجعة إدارة السنتر لتعويض ما فات."
      : "حل تمارين الدرس القادم.",
    recommendedTag: params.attendanceStatus?.includes("غياب") ? "غياب" : "متابعة",
  };

  return await resilientFetch<SmartNotificationResult>(
    "/api/gemini/smart-notification",
    {
      method: "POST",
      body: JSON.stringify(params),
    },
    fallback
  );
}

export async function requestStudentAcademicAnalysis(params: {
  studentName: string;
  studentBarcode: string;
  grade: string;
  absenceRate: number;
  totalAbsentDays: number;
  examAverage: number;
  recentScores: number[];
  isUnpaid: boolean;
  behaviorNotes?: string;
}): Promise<AcademicAnalysisResult> {
  let defaultRisk: "HIGH" | "MEDIUM" | "LOW" | "EXCELLENT" = "LOW";
  if (params.absenceRate >= 30 || params.examAverage < 50) defaultRisk = "HIGH";
  else if (params.absenceRate >= 20 || params.examAverage < 65) defaultRisk = "MEDIUM";
  else if (params.examAverage >= 90) defaultRisk = "EXCELLENT";

  const fallback: AcademicAnalysisResult = {
    success: true,
    source: "fallback",
    riskLevel: defaultRisk,
    diagnosis: `وفقاً للمؤشرات الحالية، يبلغ متوسط درجات الطالب ${params.examAverage}% مع نسبة غياب ${params.absenceRate}%. يحتاج الطالب للمراجعة المستمرة والدعم في حل التمارين المتشابهة.`,
    keyFactors: [
      `نسبة الغياب: ${params.absenceRate}% (${params.totalAbsentDays} أيام غياب)`,
      `متوسط الاختبارات: ${params.examAverage}%`,
      params.isUnpaid ? "المصروفات مستحقة ولم تسدد بعد" : "المصروفات مسددة",
    ],
    teacherActionPlan: [
      "مراجعة أساسيات الجبر والهندسة في بداية كل حصة.",
      "تكليف الطالب بأسئلة تفاعلية مباشرة داخل القاعة.",
      "متابعة كشكول الواجب أسبوعياً وتصحيحه بدقة.",
    ],
    parentAdvisoryNote: `نرجو من ولي الأمر تشجيع الطالب على مراجعة دروس الرياضيات يومياً وحل المسائل يدوياً.`,
  };

  return await resilientFetch<AcademicAnalysisResult>(
    "/api/gemini/analyze-student",
    {
      method: "POST",
      body: JSON.stringify(params),
    },
    fallback
  );
}
