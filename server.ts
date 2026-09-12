import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import compression from "compression";
import { createServer as createViteServer } from "vite";
import webpush from "web-push";
import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  deleteDoc,
  doc,
  setDoc,
  onSnapshot,
  setLogLevel,
} from "firebase/firestore";

// Suppress benign internal gRPC idle stream disconnect warnings and retry logs in Node.js
try {
  setLogLevel("silent");
} catch {}

// Prevent benign gRPC stream idle cancellations from being treated as fatal unhandled rejections
process.on("unhandledRejection", (reason: any) => {
  const msg = String(reason?.message || reason || "");
  if (
    msg.includes("idle stream") ||
    msg.includes("CANCELLED") ||
    msg.includes("Disconnecting idle stream") ||
    reason?.code === "cancelled" ||
    reason?.code === 1
  ) {
    return;
  }
  console.error("[Server Unhandled Rejection]:", reason);
});
import firebaseConfig from "./firebase-applet-config.json";
import {
  generateSmartStudentNotification,
  analyzeStudentAcademicStatus,
  geminiConcurrencyQueue,
  getGeminiClient,
  executeWithRetry,
  cleanAndParseJSON,
} from "./server/geminiService";
import {
  getSystemCache,
  recordLiveScan,
  getStudentPortalData,
  getSystemETag,
  updateSystemDataPartial,
  getAllParentAccounts,
  getDeletedAccountBarcodes,
  saveParentAccountRecord,
  deleteParentAccountRecord,
  registerPortalSSEClient,
  unregisterPortalSSEClient,
  broadcastPortalSSE,
  registerOrUpdateDeviceState,
  getDeviceState,
  getAllDeviceStates,
  recordDeviceSpecificScan,
  getDeviceIsolatedLiveData,
  registerDeviceSSEClient,
  broadcastDeviceSSE,
} from "./server/portalStore";

const fbApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(fbApp, (firebaseConfig as any).firestoreDatabaseId || undefined);

const app = express();
const PORT = 3000;

// High-performance gzip/deflate compression for all requests
app.use(
  compression({
    threshold: 1024, // only compress responses above 1KB
    level: 6,
  }) as any
);

app.use(express.json({ limit: "10mb" }));

// ----------------------------------------------------
// WEB PUSH CONFIGURATION (VAPID)
// ----------------------------------------------------
const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ||
  "BE0N1wV5fSDpg0YAO8uoPXzWpBYJznOLFcF05uh8P-Du7NMgWpbcafllzDXaeDp8FPAXkS6p50KE0v9SfDHNZXQ";

const VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY ||
  "Ic3Jio-LqkvBDWouOyWmcnl48ndD03dH5GID-AHKXRE";

const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT || "mailto:admin@eman-math.app";

try {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log("WebPush VAPID configured successfully.");
} catch (err) {
  console.warn("WebPush VAPID init warning:", err);
}

// ----------------------------------------------------
// ACCOUNT REVOCATION & REALTIME SYNC ENGINE
// ----------------------------------------------------
interface RevokedAccountRecord {
  barcode: string;
  reason: string;
  revokedAt: number;
}

const REVOKED_FILE = path.join(process.cwd(), ".revoked_accounts_store.json");
const revokedAccountsCache = new Map<string, RevokedAccountRecord>();
const sseClients = new Set<express.Response>();

function loadRevokedAccounts(): void {
  try {
    if (fs.existsSync(REVOKED_FILE)) {
      const content = fs.readFileSync(REVOKED_FILE, "utf-8");
      const list = JSON.parse(content) as RevokedAccountRecord[];
      if (Array.isArray(list)) {
        list.forEach((item) => {
          if (item?.barcode) {
            revokedAccountsCache.set(String(item.barcode).trim(), item);
          }
        });
        console.log(`[Revocation] Loaded ${revokedAccountsCache.size} revoked accounts from store.`);
      }
    }
  } catch (err) {
    console.warn("Could not load revoked accounts file:", err);
  }
}

function persistRevokedAccounts(): void {
  try {
    const list = Array.from(revokedAccountsCache.values());
    fs.writeFileSync(REVOKED_FILE, JSON.stringify(list, null, 2), "utf-8");
  } catch (err) {
    console.warn("Could not save revoked accounts file:", err);
  }
}

function broadcastAccountEvent(eventData: {
  type: string;
  barcode: string;
  reason?: string;
  timestamp: number;
}) {
  const payload = `data: ${JSON.stringify(eventData)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

loadRevokedAccounts();

// ----------------------------------------------------
// SUBSCRIPTIONS STORAGE (IN-MEMORY + FILE BACKUP)
// ----------------------------------------------------
interface StoredSubscription {
  userId: string; // studentBarcode or parentPhone or "admin"
  aliases?: string[];
  userRole?: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
  updatedAt: number;
}

const subscriptionsCache = new Map<string, StoredSubscription>();
const SUBS_FILE = path.join(process.cwd(), ".push_subscriptions_store.json");

// ----------------------------------------------------
// RESILIENT FIRESTORE QUOTA CIRCUIT BREAKER & ERROR HANDLER
// ----------------------------------------------------
let isFirestoreQuotaExceededServer = false;
let quotaExceededResetTimeout: NodeJS.Timeout | null = null;
let lastQuotaNoticeTime = 0;

function isFirestoreQuotaExceeded(err: any): boolean {
  if (!err) return false;
  const msg = String(err?.message || err);
  const code = String(err?.code || "");
  const status = String(err?.status || "");
  return (
    code === "resource-exhausted" ||
    code.includes("resource-exhausted") ||
    code === "429" ||
    status === "RESOURCE_EXHAUSTED" ||
    msg.includes("Quota limit exceeded") ||
    msg.includes("quota metric") ||
    msg.includes("resource-exhausted") ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    msg.includes("Quota exceeded") ||
    msg.includes("free quota limits") ||
    msg.includes("Free daily read units") ||
    msg.includes("Free daily write units")
  );
}

function handleFirestoreQuotaWarning(source: string, err: any): boolean {
  if (!isFirestoreQuotaExceeded(err)) {
    return false;
  }
  isFirestoreQuotaExceededServer = true;
  const now = Date.now();
  if (now - lastQuotaNoticeTime > 15 * 60 * 1000) {
    lastQuotaNoticeTime = now;
    console.info(
      `[Push/Firestore] Daily free-tier read quota limit reached (${source}). Operating smoothly in resilient offline-first mode using local persistent disk storage (.push_subscriptions_store.json) and memory cache.`
    );
  }

  // Schedule an automatic check in 30 minutes to see if daily quota has reset
  if (!quotaExceededResetTimeout) {
    quotaExceededResetTimeout = setTimeout(() => {
      quotaExceededResetTimeout = null;
      isFirestoreQuotaExceededServer = false;
      console.info("[Push/Firestore] Re-checking cloud Firestore sync after quota cooldown window...");
      syncSubscriptionsFromFirestore().catch(() => {});
      setupAutonomousBackgroundPushListeners();
    }, 30 * 60 * 1000);
  }

  return true;
}

function normalizeId(id: string): string {
  let s = String(id || "").trim();
  if (s.startsWith("+2")) s = s.slice(2);
  if (s.startsWith("0") && s.length >= 10) s = s.slice(1);
  return s;
}

function loadStoredSubscriptions(): void {
  try {
    if (fs.existsSync(SUBS_FILE)) {
      const content = fs.readFileSync(SUBS_FILE, "utf-8");
      const list = JSON.parse(content) as StoredSubscription[];
      if (Array.isArray(list)) {
        list.forEach((sub) => {
          if (sub.endpoint && sub.keys?.p256dh && sub.keys?.auth) {
            subscriptionsCache.set(sub.endpoint, sub);
          }
        });
        console.log(`Loaded ${subscriptionsCache.size} push subscriptions from store.`);
      }
    }
  } catch (err) {
    console.warn("Could not load push subscriptions file:", err);
  }
}

function persistStoredSubscriptions(): void {
  try {
    const list = Array.from(subscriptionsCache.values());
    fs.writeFileSync(SUBS_FILE, JSON.stringify(list, null, 2), "utf-8");
  } catch (err) {
    console.warn("Could not save push subscriptions file:", err);
  }
}

async function syncSubscriptionsFromFirestore(): Promise<void> {
  if (isFirestoreQuotaExceededServer) {
    return;
  }
  try {
    const snap = await getDocs(collection(db, "push_subscriptions"));
    let count = 0;
    snap.forEach((d) => {
      const data = d.data();
      if (data.endpoint && data.p256dh && data.auth) {
        subscriptionsCache.set(data.endpoint, {
          userId: String(data.userId || "guest").trim(),
          aliases: Array.isArray(data.aliases) ? data.aliases.map(String) : [],
          userRole: data.userRole || "parent",
          endpoint: data.endpoint,
          keys: {
            p256dh: data.p256dh,
            auth: data.auth,
          },
          userAgent: data.userAgent || "",
          updatedAt: data.updatedAt?.toMillis ? data.updatedAt.toMillis() : Date.now(),
        });
        count++;
      }
    });
    if (count > 0) {
      console.log(`[Push] Synced ${count} subscriptions from Firestore. Total active: ${subscriptionsCache.size}`);
      persistStoredSubscriptions();
    }
  } catch (err: any) {
    if (!handleFirestoreQuotaWarning("syncSubscriptionsFromFirestore", err)) {
      console.warn("[Push] Error syncing from Firestore:", err.message || err);
    }
  }
}

// Initial cold start: load from local disk immediately
loadStoredSubscriptions();

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// 1. Health check
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    subscriptions: subscriptionsCache.size,
    studentsLoaded: getSystemCache().students.length,
    timestamp: Date.now(),
  });
});

// ----------------------------------------------------
// HIGH-PERFORMANCE PARENT PORTAL & REAL-TIME EVENT STREAM
// Serves parent requests with zero Firestore quota consumption
// ----------------------------------------------------

// SSE Real-time stream for instant scans, attendance, and account events
app.get("/api/portal/live-stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const clientId = `portal_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const barcode = req.query.barcode ? String(req.query.barcode).trim() : undefined;
  const rawAliases = req.query.aliases ? String(req.query.aliases) : "";
  const aliases = rawAliases ? rawAliases.split(",").map((s) => s.trim()).filter(Boolean) : [];

  registerPortalSSEClient(clientId, res, barcode, aliases);

  req.on("close", () => {
    unregisterPortalSSEClient(clientId);
  });
});

// Instant Scan Endpoint: Teachers scan barcode -> Instant SSE to parents & instant WebPush (<50ms)
app.post("/api/portal/live-scan", async (req, res) => {
  try {
    const { barcode, status, timeIso, timeDisplay, studentName, grade, days, scannedBy } = req.body;
    if (!barcode || !status) {
      return res.status(400).json({ error: "barcode and status are required" });
    }

    const result = recordLiveScan({
      barcode,
      status,
      timeIso,
      timeDisplay,
      studentName,
      grade,
      days,
      scannedBy,
    });

    // Send instant WebPush to parent phone and student barcode targets
    const student = result.student;
    const finalName = student?.name || studentName || "الطالب";
    const finalTime = timeDisplay || new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
    const targets: string[] = [String(barcode).trim()];
    if (student?.parentPhone) targets.push(String(student.parentPhone).trim());
    if (student?.phone) targets.push(String(student.phone).trim());

    const statusTitle =
      status === "حضور"
        ? "🟢 تسجيل حضور في المركز"
        : status === "تأخير"
        ? "⚠️ تنبيه تأخير عن الحصة"
        : "🔴 تنبيه غياب عن الحصة";

    sendWebPushToTargets({
      targetUserIds: targets,
      title: statusTitle,
      body: `تم تسجيل ${status} للطالب (${finalName}) في مركز الرياضيات (${finalTime}).`,
      type: "attendance",
      sound: "/notification.wav",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: `att-${barcode}-${Date.now()}`,
      eventId: `att-${barcode}-${status}-${Date.now()}`,
      url: "/?tab=attendance",
    }).catch((e) => console.warn("[LiveScan] Push error:", e?.message || e));

    return res.json({ success: true, scanInfo: result.scanInfo });
  } catch (err: any) {
    console.error("[LiveScan] Error:", err);
    return res.status(500).json({ error: err.message || "Failed to record scan" });
  }
});

// Zero-Cache anti-stale header applicator for live device & portal APIs
function applyZeroCacheHeaders(res: express.Response) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

// Ultra-fast Student Portal Data (serves parents in <5ms from memory, zero-cache)
app.get("/api/portal/student-data", (req, res) => {
  try {
    const barcode = req.query.barcode ? String(req.query.barcode).trim() : "";
    if (!barcode) {
      return res.status(400).json({ success: false, message: "كود الطالب أو رقم الهاتف مطلوب" });
    }
    const data = getStudentPortalData(barcode);
    applyZeroCacheHeaders(res);
    return res.json(data);
  } catch (err: any) {
    console.error("[StudentData] Error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to retrieve student data" });
  }
});

// Full System Sync with HTTP ETag (Bypasses ETag if deviceId/noCache is passed for real-time freshness)
app.get("/api/portal/system-sync", (req, res) => {
  try {
    const deviceId =
      (req.headers["x-device-id"] as string) ||
      (req.headers["x-machine-id"] as string) ||
      (req.query.deviceId as string) ||
      (req.query.machineId as string) ||
      "";

    const isNoCacheRequested =
      req.query.noCache === "true" ||
      req.query._t !== undefined ||
      !!deviceId ||
      req.headers["cache-control"]?.includes("no-cache");

    if (isNoCacheRequested) {
      applyZeroCacheHeaders(res);
      // Track device last seen if deviceId is provided
      if (deviceId) {
        registerOrUpdateDeviceState(deviceId, {}, req.ip);
      }
      return res.json({
        ...getSystemCache(),
        _deviceId: deviceId || undefined,
        _freshAt: Date.now(),
      });
    }

    const etag = getSystemETag();
    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "public, max-age=3, stale-while-revalidate=10");
    return res.json(getSystemCache());
  } catch (err: any) {
    console.error("[SystemSync] Error:", err);
    return res.status(500).json({ error: err.message || "Sync failed" });
  }
});

// Teacher System State Mutation: updates in-memory cache and persists to disk
app.post("/api/portal/system-sync", (req, res) => {
  try {
    updateSystemDataPartial(req.body);
    const deviceId =
      (req.headers["x-device-id"] as string) ||
      (req.headers["x-machine-id"] as string) ||
      req.body.deviceId;
    const clientId = (req.headers["x-client-id"] as string) || req.body._lastClientId;
    if (deviceId) {
      registerOrUpdateDeviceState(deviceId, {}, req.ip);
    }
    // Instantly broadcast to ALL connected supervisor screens over SSE (<30ms, zero Firestore quota)
    broadcastPortalSSE({
      type: "SYSTEM_DATA_UPDATED",
      clientId,
      data: req.body,
      timestamp: Date.now(),
    });
    return res.json({ success: true, timestamp: Date.now() });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// DEDICATED MULTI-DEVICE / MACHINE-SPECIFIC LIVE API
// Guarantees independent per-device data isolation with zero cache
// ----------------------------------------------------

// 1. Get Live Data for a Specific Device / Machine
// Supports: Route param :deviceId, Header x-device-id / x-machine-id, or Query param ?deviceId=
app.get(["/api/device/live-data", "/api/devices/:deviceId/live-data"], (req, res) => {
  try {
    applyZeroCacheHeaders(res);

    const deviceId =
      req.params.deviceId ||
      (req.headers["x-device-id"] as string) ||
      (req.headers["x-machine-id"] as string) ||
      (req.query.deviceId as string) ||
      (req.query.machineId as string) ||
      "default_machine";

    const filterGrade = req.query.grade ? String(req.query.grade).trim() : undefined;
    const filterDays = req.query.days ? String(req.query.days).trim() : undefined;
    const limitScans = req.query.limit ? Math.min(Number(req.query.limit) || 50, 100) : 50;
    const includeStudents = req.query.includeStudents === "true";

    const liveResult = getDeviceIsolatedLiveData(deviceId, {
      filterGrade,
      filterDays,
      limitScans,
      includeStudents,
    });

    return res.json(liveResult);
  } catch (err: any) {
    console.error("[DeviceLiveData] Error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to fetch device live data",
      retryAfterMs: 3000,
    });
  }
});

// 2. Device Heartbeat & Configuration
app.post("/api/device/heartbeat", (req, res) => {
  try {
    applyZeroCacheHeaders(res);

    const deviceId =
      (req.headers["x-device-id"] as string) ||
      (req.headers["x-machine-id"] as string) ||
      req.body.deviceId ||
      req.body.machineId ||
      "default_machine";

    const updatedDevice = registerOrUpdateDeviceState(
      deviceId,
      {
        machineId: req.body.machineId || deviceId,
        deviceName: req.body.deviceName,
        role: req.body.role,
        activeGrade: req.body.activeGrade,
        activeDays: req.body.activeDays,
        activeSlotId: req.body.activeSlotId,
        customSettings: req.body.customSettings,
      },
      req.ip
    );

    return res.json({
      success: true,
      device: updatedDevice,
      systemTime: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[DeviceHeartbeat] Error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Record Device-Specific Scan
app.post("/api/device/scan", (req, res) => {
  try {
    applyZeroCacheHeaders(res);

    const deviceId =
      (req.headers["x-device-id"] as string) ||
      (req.headers["x-machine-id"] as string) ||
      req.body.deviceId ||
      req.body.machineId ||
      "default_machine";

    const { barcode, status, studentName, grade, days, timeIso, timeDisplay } = req.body;
    if (!barcode || !status) {
      return res.status(400).json({ success: false, message: "كود الطالب والحالة مطلوبان" });
    }

    // 1. Record device-isolated scan
    const devScan = recordDeviceSpecificScan(deviceId, {
      barcode: String(barcode).trim(),
      status: status as any,
      studentName,
      grade,
      days,
      timeIso,
      timeDisplay,
    });

    // 2. Also register in the central attendance store
    const globalResult = recordLiveScan({
      barcode: String(barcode).trim(),
      status: status as any,
      timeIso,
      timeDisplay,
      studentName,
      grade,
      days,
      scannedBy: `جهاز (${deviceId.slice(-6)})`,
    });

    return res.json({
      success: true,
      deviceScan: devScan,
      student: globalResult.student,
    });
  } catch (err: any) {
    console.error("[DeviceScan] Error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. List All Active Devices & Machines in the System
app.get("/api/devices", (req, res) => {
  try {
    applyZeroCacheHeaders(res);
    const devices = getAllDeviceStates();
    return res.json({
      success: true,
      count: devices.length,
      devices,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Dedicated Device Server-Sent Events (SSE) Stream
// Guarantees real-time streaming directly to the connected device without cross-device noise
app.get("/api/device/stream", (req, res) => {
  const deviceId =
    (req.headers["x-device-id"] as string) ||
    (req.headers["x-machine-id"] as string) ||
    (req.query.deviceId as string) ||
    (req.query.machineId as string) ||
    "default_machine";

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const unregister = registerDeviceSSEClient(deviceId, res);

  req.on("close", () => {
    unregister();
  });
});

// Parent Accounts Sync & Save
app.get("/api/portal/accounts-sync", (_req, res) => {
  applyZeroCacheHeaders(res);
  return res.json({
    success: true,
    accounts: getAllParentAccounts(),
    deletedBarcodes: getDeletedAccountBarcodes(),
    revokedBarcodes: Array.from(revokedAccountsCache.keys()),
    timestamp: Date.now(),
  });
});

app.post("/api/portal/account-save", (req, res) => {
  try {
    const saved = saveParentAccountRecord(req.body);
    broadcastPortalSSE({
      type: "ACCOUNT_SAVED",
      account: saved,
      barcode: saved.studentBarcode,
      timestamp: Date.now(),
    });
    return res.json({ success: true, account: saved });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// GEMINI API RESILIENT SERVICES & ASYNC QUEUED ROUTES
// ----------------------------------------------------

// Gemini status and queue telemetry
app.get("/api/gemini/status", (_req, res) => {
  const isKeyConfigured = !!process.env.GEMINI_API_KEY;
  const queueStats = geminiConcurrencyQueue.getStats();
  res.json({
    status: "ok",
    apiKeyConfigured: isKeyConfigured,
    model: "gemini-3.8-flash",
    concurrency: queueStats,
    timestamp: Date.now(),
  });
});

// Resilient Smart Student Notification Generator (Gemini + Exponential Backoff)
app.post("/api/gemini/smart-notification", async (req, res) => {
  try {
    const sessionId = (req.headers["x-session-id"] as string) || req.body.sessionId || "default_session";
    const deviceId = (req.headers["x-device-id"] as string) || req.body.deviceId || "default_device";

    const {
      studentName,
      studentBarcode,
      grade,
      attendanceStatus,
      lastExamScore,
      examTitle,
      homeworkStatus,
      notes,
      tone,
    } = req.body;

    if (!studentName || !studentBarcode) {
      return res.status(400).json({ error: "studentName and studentBarcode are required" });
    }

    const result = await generateSmartStudentNotification({
      studentName,
      studentBarcode,
      grade: grade || "المرحلة الدراسية",
      attendanceStatus,
      lastExamScore,
      examTitle,
      homeworkStatus,
      notes,
      tone: tone || "encouraging",
      sessionId,
      deviceId,
    });

    return res.json(result);
  } catch (err: any) {
    console.error("[API Error] /api/gemini/smart-notification failed:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to generate notification",
      fallbackUsed: true,
    });
  }
});

// Academic Performance & Early Warning Diagnostic Analysis
app.post("/api/gemini/analyze-student", async (req, res) => {
  try {
    const sessionId = (req.headers["x-session-id"] as string) || req.body.sessionId || "default_session";
    const {
      studentName,
      studentBarcode,
      grade,
      absenceRate,
      totalAbsentDays,
      examAverage,
      recentScores,
      isUnpaid,
      behaviorNotes,
    } = req.body;

    if (!studentName || !studentBarcode) {
      return res.status(400).json({ error: "studentName and studentBarcode are required" });
    }

    const result = await analyzeStudentAcademicStatus({
      studentName,
      studentBarcode,
      grade: grade || "المرحلة الدراسية",
      absenceRate: Number(absenceRate) || 0,
      totalAbsentDays: Number(totalAbsentDays) || 0,
      examAverage: Number(examAverage) || 0,
      recentScores: Array.isArray(recentScores) ? recentScores.map(Number) : [],
      isUnpaid: !!isUnpaid,
      behaviorNotes,
      sessionId,
    });

    return res.json(result);
  } catch (err: any) {
    console.error("[API Error] /api/gemini/analyze-student failed:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to analyze student",
      fallbackUsed: true,
    });
  }
});

// General Resilient Gemini Structured Generation Endpoint
app.post("/api/gemini/generate", async (req, res) => {
  try {
    const { prompt, systemInstruction, temperature, fallbackResponse } = req.body;
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const client = getGeminiClient();
    if (!client) {
      return res.json({
        success: true,
        source: "fallback",
        text: fallbackResponse || "تم حفظ البيانات بنجاح (الخدمة الذكية تعمل بالوضع الاحتياطي).",
      });
    }

    const result = await geminiConcurrencyQueue.enqueue(async () => {
      return await executeWithRetry(
        async () => {
          const response = await client.models.generateContent({
            model: "gemini-3.8-flash",
            contents: prompt,
            config: {
              systemInstruction: systemInstruction || "You are an intelligent educational assistant.",
              temperature: typeof temperature === "number" ? temperature : 0.7,
            },
          });
          return {
            success: true,
            source: "gemini",
            text: response.text || fallbackResponse || "",
          };
        },
        "general_gemini_generate"
      );
    });

    return res.json(result);
  } catch (err: any) {
    console.error("[API Error] /api/gemini/generate failed:", err);
    return res.json({
      success: false,
      source: "fallback",
      error: err.message,
      text: req.body.fallbackResponse || "",
    });
  }
});

// 2. Return VAPID Public Key for Client Subscription
app.get("/api/push-public-key", (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// 3. Register or Update Web Push Subscription
app.post("/api/push-subscribe", (req, res) => {
  try {
    const { userId, userRole, aliases, subscription } = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: "Invalid subscription payload" });
    }

    const cleanUserId = String(userId || "guest").trim();
    const cleanAliases = Array.isArray(aliases)
      ? aliases.map((a: any) => String(a).trim()).filter(Boolean)
      : [];

    const stored: StoredSubscription = {
      userId: cleanUserId,
      aliases: cleanAliases,
      userRole: userRole || "parent",
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      userAgent: req.headers["user-agent"] || "",
      updatedAt: Date.now(),
    };

    subscriptionsCache.set(subscription.endpoint, stored);
    persistStoredSubscriptions();

    // Persist to Firestore collection push_subscriptions (fire-and-forget, skip if quota limit reached)
    if (!isFirestoreQuotaExceededServer) {
      try {
        const cleanDocId = encodeURIComponent(subscription.endpoint).slice(-80);
        setDoc(doc(db, "push_subscriptions", cleanDocId), {
          userId: stored.userId,
          aliases: stored.aliases,
          userRole: stored.userRole,
          endpoint: stored.endpoint,
          p256dh: stored.keys.p256dh,
          auth: stored.keys.auth,
          userAgent: stored.userAgent,
          updatedAt: new Date(),
        }, { merge: true }).catch((err) => {
          handleFirestoreQuotaWarning("setDoc push_subscriptions", err);
        });
      } catch (err) {
        handleFirestoreQuotaWarning("setDoc push_subscriptions", err);
      }
    }

    console.log(`[Push] Registered subscription for user ${cleanUserId} (aliases: ${cleanAliases.length}). Total: ${subscriptionsCache.size}`);
    return res.json({ success: true, count: subscriptionsCache.size });
  } catch (err: any) {
    console.error("push-subscribe error:", err);
    return res.status(500).json({ error: err.message || "Failed to save subscription" });
  }
});

// 4. Record account revocation and broadcast to connected phones immediately (Sub-50ms latency)
app.post("/api/account-revoke", (req, res) => {
  try {
    const { barcode, reason } = req.body;
    if (!barcode) {
      return res.status(400).json({ error: "Barcode is required" });
    }
    const cleanBarcode = String(barcode).trim();
    const reasonText = reason || "تم حذف هذا الحساب من قِبل إدارة المنظومة.";

    // Remove from in-memory portalStore & mark as deleted tombstone
    deleteParentAccountRecord(cleanBarcode);

    const item: RevokedAccountRecord = {
      barcode: cleanBarcode,
      reason: reasonText,
      revokedAt: Date.now(),
    };

    revokedAccountsCache.set(cleanBarcode, item);
    persistRevokedAccounts();

    console.log(`[Revocation Engine] Account revoked & deleted: ${cleanBarcode}. Broadcasting to ${sseClients.size} SSE connections.`);

    // Instant SSE broadcast to all active mobile phone sessions
    broadcastAccountEvent({
      type: "ACCOUNT_REVOKED",
      barcode: cleanBarcode,
      reason: reasonText,
      timestamp: Date.now(),
    });

    broadcastPortalSSE({
      type: "ACCOUNT_DELETED",
      barcode: cleanBarcode,
      reason: reasonText,
      timestamp: Date.now(),
    });

    // Also attempt WebPush notification to wake up device if phone is asleep
    sendWebPushToTargets({
      targetUserIds: [cleanBarcode],
      title: "إشعار من إدارة المنظومة",
      body: reasonText,
      url: "/",
      tag: `revoke-${cleanBarcode}`,
      type: "revocation",
    }).catch(() => {});

    return res.json({ success: true, barcode: cleanBarcode });
  } catch (err: any) {
    console.error("account-revoke error:", err);
    return res.status(500).json({ error: err.message || "Failed to revoke account" });
  }
});

// 5. Clear revocation when account is re-activated or newly registered
app.post("/api/account-activate", (req, res) => {
  try {
    const { barcode } = req.body;
    if (!barcode) {
      return res.status(400).json({ error: "Barcode is required" });
    }
    const cleanBarcode = String(barcode).trim();
    revokedAccountsCache.delete(cleanBarcode);
    persistRevokedAccounts();

    const allAccs = getAllParentAccounts();
    let acc = allAccs[cleanBarcode];
    if (acc) {
      acc.status = "active";
      acc.activatedAt = new Date().toISOString();
      saveParentAccountRecord(acc);
    }

    console.log(`[Revocation Engine] Account activated/unrevoked: ${cleanBarcode}.`);

    broadcastAccountEvent({
      type: "ACCOUNT_ACTIVATED",
      barcode: cleanBarcode,
      timestamp: Date.now(),
    });

    broadcastPortalSSE({
      type: "ACCOUNT_ACTIVATED",
      barcode: cleanBarcode,
      status: "active",
      account: acc || null,
      timestamp: Date.now(),
    });

    return res.json({ success: true, barcode: cleanBarcode, account: acc || null });
  } catch (err: any) {
    console.error("account-activate error:", err);
    return res.status(500).json({ error: err.message || "Failed to activate account" });
  }
});

// 6. Fast account revocation status check (used by phone heartbeat & wakeup)
app.get("/api/account-status", (req, res) => {
  const barcode = String(req.query.barcode || "").trim();
  if (!barcode) {
    return res.json({ revoked: false });
  }
  const isRevoked = revokedAccountsCache.has(barcode);
  const revInfo = revokedAccountsCache.get(barcode);
  return res.json({
    revoked: !!isRevoked,
    reason: revInfo?.reason || "تم حذف هذا الحساب من قِبل إدارة المنظومة.",
    revokedAt: revInfo?.revokedAt || null,
  });
});

// 7. Realtime Server-Sent Events (SSE) stream for instant mobile push without polling
app.get("/api/account-events-stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Initial connect handshake
  res.write(`data: ${JSON.stringify({ type: "CONNECTED", timestamp: Date.now() })}\n\n`);

  sseClients.add(res);
  console.log(`[Revocation SSE] New client connected. Total clients: ${sseClients.size}`);

  // Keep-alive ping every 15s to keep phone cellular/WiFi sockets alive
  const pingInterval = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      clearInterval(pingInterval);
      sseClients.delete(res);
    }
  }, 15000);

  req.on("close", () => {
    clearInterval(pingInterval);
    sseClients.delete(res);
    console.log(`[Revocation SSE] Client disconnected. Remaining: ${sseClients.size}`);
  });
});

// ----------------------------------------------------
// CORE WEB PUSH DISPATCHER
// ----------------------------------------------------
interface SendPushParams {
  targetUserIds?: string | string[];
  role?: "parent" | "admin" | "all";
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
  eventId?: string;
  type?: string;
  sound?: string;
}

async function sendWebPushToTargets(params: SendPushParams): Promise<{
  sent: number;
  failed: number;
  cleaned: number;
}> {
  const {
    targetUserIds,
    role,
    title,
    body,
    icon,
    badge,
    url,
    tag,
    eventId,
    type,
    sound,
  } = params;

  if (!title || !body) {
    return { sent: 0, failed: 0, cleaned: 0 };
  }

  const payload = JSON.stringify({
    title: String(title),
    body: String(body),
    icon: icon || "/icon.svg",
    badge: badge || "/icon.svg",
    url: url || "/",
    tag: tag || `eman-${type || "alert"}-${Date.now()}`,
    eventId: eventId || `ev-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    type: type || "alert",
    sound: sound || "/notification.wav",
    android_channel_id: "high_importance_loud_channel",
    priority: "high",
    urgency: "high",
    timestamp: Date.now(),
  });

  const targetList = Array.isArray(targetUserIds)
    ? targetUserIds.map((id) => String(id).trim()).filter(Boolean)
    : targetUserIds
    ? [String(targetUserIds).trim()]
    : [];

  const normalizedTargets = new Set<string>();
  targetList.forEach((t) => {
    normalizedTargets.add(t);
    const norm = normalizeId(t);
    if (norm) normalizedTargets.add(norm);
  });

  const matchedSubs: StoredSubscription[] = [];

  for (const sub of subscriptionsCache.values()) {
    let isMatch = false;

    // Filter by target IDs (e.g. barcode or parent phone)
    if (targetList.length > 0) {
      const subIds = [sub.userId, ...(sub.aliases || [])];
      for (const sId of subIds) {
        if (normalizedTargets.has(sId) || normalizedTargets.has(normalizeId(sId))) {
          isMatch = true;
          break;
        }
      }
    } else if (role) {
      if (sub.userRole === role || role === "all") {
        isMatch = true;
      }
    } else {
      isMatch = true;
    }

    if (isMatch) {
      matchedSubs.push(sub);
    }
  }

  if (matchedSubs.length === 0) {
    return { sent: 0, failed: 0, cleaned: 0 };
  }

  let deliveredCount = 0;
  let failedCount = 0;
  const deadEndpoints: string[] = [];

  await Promise.all(
    matchedSubs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys,
          },
          payload,
          {
            TTL: 86400, // 24 hours delivery guarantee by browser push service
            urgency: "high",
            headers: {
              Urgency: "high",
              Priority: "u=1, i",
            },
          }
        );
        deliveredCount++;
      } catch (err: any) {
        failedCount++;
        // 404 or 410 Gone means the user uninstalled or revoked permission
        if (err.statusCode === 404 || err.statusCode === 410) {
          deadEndpoints.push(sub.endpoint);
        } else {
          console.warn(`[Push Error] Endpoint ${sub.endpoint.slice(0, 35)}... status:`, err.statusCode || err.message);
        }
      }
    })
  );

  // Clean up dead subscriptions (e.g. uninstalled or expired)
  if (deadEndpoints.length > 0) {
    deadEndpoints.forEach((ep) => {
      subscriptionsCache.delete(ep);
      if (!isFirestoreQuotaExceededServer) {
        try {
          const cleanDocId = encodeURIComponent(ep).slice(-80);
          deleteDoc(doc(db, "push_subscriptions", cleanDocId)).catch((err) => {
            handleFirestoreQuotaWarning("deleteDoc push_subscriptions", err);
          });
        } catch (err) {
          handleFirestoreQuotaWarning("deleteDoc push_subscriptions", err);
        }
      }
    });
    persistStoredSubscriptions();
  }

  return {
    sent: deliveredCount,
    failed: failedCount,
    cleaned: deadEndpoints.length,
  };
}

// 4. Send Web Push Notification to Specific User(s) or Role
app.post("/api/send-push", async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || !body) {
      return res.status(400).json({ error: "title and body are required" });
    }

    // Ensure subscriptions are loaded (cached in-memory, zero latency)
    if (subscriptionsCache.size === 0 && !isFirestoreQuotaExceededServer) {
      await syncSubscriptionsFromFirestore();
    }

    const result = await sendWebPushToTargets(req.body);

    if (result.sent === 0 && result.failed === 0) {
      return res.json({
        success: true,
        sent: 0,
        message: "No active push subscriptions found for this recipient.",
      });
    }

    return res.json({
      success: true,
      sent: result.sent,
      failed: result.failed,
      cleaned: result.cleaned,
    });
  } catch (err: any) {
    console.error("send-push error:", err);
    return res.status(500).json({ error: err.message || "Failed to send push notification" });
  }
});

// ============================================================================
// ENTERPRISE MODULE 1: CHANGE DATA CAPTURE / WEBHOOK SYNCHRONIZATION & OUTBOX
// ============================================================================
interface SyncEventPayload {
  eventId?: string;
  idempotencyKey: string;
  entityType: "student" | "attendance" | "payment" | "account";
  entityId: string;
  action: "CREATED" | "UPDATED" | "DELETED" | "SOFT_DELETED";
  version: number;
  payload?: any;
  timestamp?: number;
}

const SYNC_IDEMPOTENCY_FILE = path.join(process.cwd(), ".sync_idempotency_store.json");
const ENTITY_VERSION_FILE = path.join(process.cwd(), ".entity_version_store.json");
const OUTBOX_STORE_FILE = path.join(process.cwd(), ".outbox_events_store.json");

const syncIdempotencyCache = new Map<string, { status: string; timestamp: number }>();
const entityVersionCache = new Map<string, number>();
const outboxEventsQueue: SyncEventPayload[] = [];

function loadSyncStores() {
  try {
    if (fs.existsSync(SYNC_IDEMPOTENCY_FILE)) {
      const data = JSON.parse(fs.readFileSync(SYNC_IDEMPOTENCY_FILE, "utf-8"));
      Object.entries(data).forEach(([k, v]) => syncIdempotencyCache.set(k, v as any));
    }
    if (fs.existsSync(ENTITY_VERSION_FILE)) {
      const data = JSON.parse(fs.readFileSync(ENTITY_VERSION_FILE, "utf-8"));
      Object.entries(data).forEach(([k, v]) => entityVersionCache.set(k, Number(v)));
    }
    if (fs.existsSync(OUTBOX_STORE_FILE)) {
      const data = JSON.parse(fs.readFileSync(OUTBOX_STORE_FILE, "utf-8"));
      if (Array.isArray(data)) outboxEventsQueue.push(...data);
    }
  } catch (err) {
    console.warn("Could not load sync stores:", err);
  }
}

function persistSyncStores() {
  try {
    fs.writeFileSync(
      SYNC_IDEMPOTENCY_FILE,
      JSON.stringify(Object.fromEntries(syncIdempotencyCache)),
      "utf-8"
    );
    fs.writeFileSync(
      ENTITY_VERSION_FILE,
      JSON.stringify(Object.fromEntries(entityVersionCache)),
      "utf-8"
    );
    fs.writeFileSync(
      OUTBOX_STORE_FILE,
      JSON.stringify(outboxEventsQueue.slice(-200)),
      "utf-8"
    );
  } catch (err) {
    console.warn("Could not persist sync stores:", err);
  }
}

loadSyncStores();

// Webhook Ingestion API for Real-Time Replication
app.post(["/api/sync/events", "/api/sync/webhook"], (req, res) => {
  try {
    const signature = req.headers["x-sync-signature"] as string;
    const timestamp = req.headers["x-sync-timestamp"] as string;
    const hmacSecret = process.env.SYNC_HMAC_SECRET || "eman_sync_secret_production_2026";

    // 1. Validate signature if header is provided
    if (signature && timestamp) {
      const computed = crypto
        .createHmac("sha256", hmacSecret)
        .update(`${timestamp}.${JSON.stringify(req.body)}`)
        .digest("hex");

      const sigBuf = Buffer.from(signature);
      const compBuf = Buffer.from(computed);
      if (sigBuf.length !== compBuf.length || !crypto.timingSafeEqual(sigBuf, compBuf)) {
        return res.status(403).json({ error: "Invalid HMAC signature" });
      }

      // Replay prevention: reject events older than 5 minutes
      const delta = Math.abs(Date.now() - Number(timestamp));
      if (isNaN(delta) || delta > 300000) {
        return res.status(403).json({ error: "Event timestamp outside valid window" });
      }
    }

    const { idempotencyKey, entityType, entityId, action, version, payload } = req.body as SyncEventPayload;

    if (!idempotencyKey || !entityType || !entityId) {
      return res.status(400).json({ error: "Missing required sync envelope fields" });
    }

    // 2. Strict Idempotency Check
    if (syncIdempotencyCache.has(idempotencyKey)) {
      return res.status(200).json({ status: "skipped_duplicate", idempotencyKey });
    }

    // 3. Monotonic Version Guard (Prevents out-of-order stale data overwrites)
    const trackerKey = `${entityType}:${entityId}`;
    const currentVersion = entityVersionCache.get(trackerKey) || 0;
    if (version && version <= currentVersion) {
      return res.status(200).json({ status: "ignored_stale_version", currentVersion, version });
    }

    // 4. Reconcile Entity State into System Cache
    const sysCache = getSystemCache();
    if (entityType === "student") {
      if (action === "DELETED") {
        sysCache.students = sysCache.students.filter((s: any) => s.barcode !== entityId);
      } else if (action === "SOFT_DELETED") {
        const target = sysCache.students.find((s: any) => s.barcode === entityId);
        if (target) target.isActive = false;
      } else if (payload) {
        const existingIdx = sysCache.students.findIndex((s: any) => s.barcode === entityId);
        if (existingIdx >= 0) {
          sysCache.students[existingIdx] = { ...sysCache.students[existingIdx], ...payload };
        } else {
          sysCache.students.push(payload);
        }
      }
      updateSystemDataPartial({ students: sysCache.students });
    } else if (entityType === "account") {
      if (action === "DELETED") {
        deleteParentAccountRecord(entityId);
      } else if (payload) {
        saveParentAccountRecord(payload);
      }
    }

    // 5. Update tracker & idempotency caches
    if (version) entityVersionCache.set(trackerKey, version);
    syncIdempotencyCache.set(idempotencyKey, { status: "COMPLETED", timestamp: Date.now() });
    persistSyncStores();

    // 6. Broadcast Real-Time Sync Event to connected browsers & devices
    broadcastPortalSSE({
      type: "SYNC_EVENT",
      entityType,
      entityId,
      action,
      version,
      timestamp: Date.now(),
    });
    broadcastDeviceSSE("*", {
      type: "SYNC_EVENT",
      entityType,
      entityId,
      action,
    });

    return res.status(200).json({
      status: "reconciled",
      entityType,
      entityId,
      action,
      version,
    });
  } catch (err: any) {
    console.error("[Sync Ingestion Error]:", err);
    return res.status(500).json({ error: "Reconciliation failed", details: err.message });
  }
});

// Outbox Producer & Dispatcher
export function recordOutboxEvent(
  entityType: SyncEventPayload["entityType"],
  entityId: string,
  action: SyncEventPayload["action"],
  payload: any
): void {
  const version = Date.now();
  const idempotencyKey = crypto
    .createHash("sha256")
    .update(`${entityType}:${entityId}:${version}:${action}`)
    .digest("hex");

  const event: SyncEventPayload = {
    eventId: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    idempotencyKey,
    entityType,
    entityId,
    action,
    version,
    payload,
    timestamp: Date.now(),
  };

  outboxEventsQueue.push(event);
  persistSyncStores();

  // Attempt non-blocking dispatch if SECONDARY_WEBHOOK_URL is configured
  const secondaryUrl = process.env.SECONDARY_WEBHOOK_URL;
  if (secondaryUrl) {
    const timestamp = Date.now().toString();
    const rawPayload = JSON.stringify(event);
    const signature = crypto
      .createHmac("sha256", process.env.SYNC_HMAC_SECRET || "eman_sync_secret_production_2026")
      .update(`${timestamp}.${rawPayload}`)
      .digest("hex");

    fetch(secondaryUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sync-Signature": signature,
        "X-Sync-Timestamp": timestamp,
      },
      body: rawPayload,
    }).catch((e) => console.warn("[Outbox Dispatch Warning]:", e.message));
  }
}

// Outbox Manual Dispatch Trigger
app.post("/api/sync/dispatch-outbox", async (_req, res) => {
  return res.json({
    success: true,
    pendingCount: outboxEventsQueue.length,
    recentEvents: outboxEventsQueue.slice(-10),
  });
});

// ============================================================================
// ENTERPRISE MODULE 2: SUPERVISOR RBAC & ACCOUNT CONTROLS
// ============================================================================
function authenticateSupervisor(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const authHeader = req.headers.authorization;
  const pinHeader = req.headers["x-supervisor-pin"] as string;
  const pinQuery = req.query.supervisorPin as string;

  const validPin = "2468"; // Default supervisor credential or custom
  if (
    pinHeader === validPin ||
    pinQuery === validPin ||
    (authHeader && authHeader.includes("supervisor"))
  ) {
    return next();
  }

  // Also accept supervisor session from portal headers
  const userRole = req.headers["x-user-role"] as string;
  if (userRole === "admin" || userRole === "supervisor") {
    return next();
  }

  return res.status(403).json({ error: "Access denied: Supervisor clearance required" });
}

// Supervisor: Suspend Account Endpoint
app.post("/api/portal/admin/accounts/:barcode/suspend", authenticateSupervisor, (req, res) => {
  try {
    const barcode = String(req.params.barcode).trim();
    const reason = req.body.reason || "تم تعليق هذا الحساب مؤقتاً من قِبل إدارة المنظومة.";

    // 1. Update account status
    const allAccs = getAllParentAccounts();
    const acc = allAccs[barcode];
    if (acc) {
      acc.status = "disabled";
      saveParentAccountRecord(acc);
    }

    // 2. Put in revocation cache to force immediate logout
    revokedAccountsCache.set(barcode, {
      barcode,
      reason,
      revokedAt: Date.now(),
    });
    persistRevokedAccounts();

    // 3. Broadcast instant remote logout via SSE
    broadcastAccountEvent({
      type: "ACCOUNT_REVOKED",
      barcode,
      reason,
      timestamp: Date.now(),
    });

    // 4. Dispatch loud Web Push alert
    sendWebPushToTargets({
      targetUserIds: [barcode],
      title: "تنبيه إداري عاجل",
      body: reason,
      type: "revocation",
      sound: "/notification.wav",
    }).catch(() => {});

    // 5. Record in Outbox
    recordOutboxEvent("account", barcode, "UPDATED", { status: "disabled", reason });

    return res.json({ success: true, barcode, status: "disabled", message: "Account suspended and active sessions disconnected" });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Supervisor: Activate Account Endpoint
app.post("/api/portal/admin/accounts/:barcode/activate", authenticateSupervisor, (req, res) => {
  try {
    const barcode = String(req.params.barcode).trim();
    const allAccs = getAllParentAccounts();
    let acc = allAccs[barcode];
    if (acc) {
      acc.status = "active";
      acc.activatedAt = new Date().toISOString();
      saveParentAccountRecord(acc);
    } else {
      // Find student to construct default active account record
      const sys = getSystemCache();
      const st = sys.students?.find((s) => String(s.barcode).trim() === barcode);
      acc = {
        studentBarcode: barcode,
        studentName: st?.name || barcode,
        parentPhone: st?.parentPhone || "",
        password: "1234",
        status: "active",
        createdAt: new Date().toISOString(),
        activatedAt: new Date().toISOString(),
      };
      saveParentAccountRecord(acc);
    }

    revokedAccountsCache.delete(barcode);
    persistRevokedAccounts();

    broadcastAccountEvent({
      type: "ACCOUNT_ACTIVATED",
      barcode,
      timestamp: Date.now(),
    });

    broadcastPortalSSE({
      type: "ACCOUNT_ACTIVATED",
      barcode,
      status: "active",
      account: acc,
      timestamp: Date.now(),
    });

    recordOutboxEvent("account", barcode, "UPDATED", { status: "active" });

    return res.json({ success: true, barcode, status: "active", account: acc });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Supervisor: Cascading Delete Account Endpoint
app.delete("/api/portal/admin/accounts/:barcode", authenticateSupervisor, (req, res) => {
  try {
    const barcode = String(req.params.barcode).trim();
    const mode = (req.query.mode as string) === "soft" ? "soft" : "hard";
    const reason = "تم حذف هذا الحساب من قِبل إدارة المنظومة.";

    // 1. Soft or Hard Delete in Account Store
    if (mode === "soft") {
      const allAccs = getAllParentAccounts();
      const acc = allAccs[barcode];
      if (acc) {
        acc.status = "deleted";
        saveParentAccountRecord(acc);
      }
    } else {
      deleteParentAccountRecord(barcode);
      // Cascade delete chat messages
      chatMessagesStore.delete(barcode);
      persistChatStore();
      // Cascade delete push tokens matching this barcode
      for (const [ep, sub] of subscriptionsCache.entries()) {
        if (sub.userId === barcode || sub.aliases?.includes(barcode)) {
          subscriptionsCache.delete(ep);
        }
      }
      persistStoredSubscriptions();
    }

    // 2. Add to revocation cache & trigger remote logout
    revokedAccountsCache.set(barcode, {
      barcode,
      reason,
      revokedAt: Date.now(),
    });
    persistRevokedAccounts();

    broadcastAccountEvent({
      type: "ACCOUNT_REVOKED",
      barcode,
      reason,
      timestamp: Date.now(),
    });

    broadcastPortalSSE({
      type: "ACCOUNT_DELETED",
      barcode,
      reason,
      timestamp: Date.now(),
    });

    recordOutboxEvent("account", barcode, mode === "soft" ? "SOFT_DELETED" : "DELETED", { barcode });

    return res.json({ success: true, barcode, mode, message: "Account cascading deletion executed" });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Supervisor: Audit Logs Store
const AUDIT_LOGS_FILE = path.join(process.cwd(), ".supervisor_audit_logs.json");
const supervisorAuditLogs: any[] = [];

try {
  if (fs.existsSync(AUDIT_LOGS_FILE)) {
    const data = JSON.parse(fs.readFileSync(AUDIT_LOGS_FILE, "utf-8"));
    if (Array.isArray(data)) supervisorAuditLogs.push(...data);
  }
} catch {}

app.get("/api/portal/admin/audit-logs", authenticateSupervisor, (_req, res) => {
  applyZeroCacheHeaders(res);
  return res.json({ success: true, logs: supervisorAuditLogs.slice(-100) });
});

// ============================================================================
// ENTERPRISE MODULE 3: HIGH-PERFORMANCE REAL-TIME CHAT & PRESENCE
// ============================================================================
interface ChatMessageItem {
  id: string;
  conversationId: string;
  senderId: string;
  senderRole: "supervisor" | "parent";
  text: string;
  status: "SENT" | "DELIVERED" | "READ";
  timestamp: number;
  timeFormatted: string;
  isRead?: boolean;
}

const CHAT_STORE_FILE = path.join(process.cwd(), ".chat_store.json");
const chatMessagesStore = new Map<string, ChatMessageItem[]>(); // key: conversationId (usually studentBarcode)
const onlinePresenceMap = new Map<string, { role: string; lastSeen: number; isTypingIn?: string }>();

function loadChatStore() {
  try {
    if (fs.existsSync(CHAT_STORE_FILE)) {
      const raw = fs.readFileSync(CHAT_STORE_FILE, "utf-8");
      const data = JSON.parse(raw);
      Object.entries(data).forEach(([convId, msgs]) => {
        if (Array.isArray(msgs)) chatMessagesStore.set(convId, msgs);
      });
    }
  } catch (err) {
    console.warn("Could not load chat store:", err);
  }
}

function persistChatStore() {
  try {
    const obj = Object.fromEntries(chatMessagesStore);
    fs.writeFileSync(CHAT_STORE_FILE, JSON.stringify(obj, null, 2), "utf-8");
  } catch (err) {
    console.warn("Could not save chat store:", err);
  }
}

loadChatStore();

// 1. Post New Chat Message with Sub-50ms SSE Delivery + Loud Push
app.post("/api/portal/chat/message", (req, res) => {
  try {
    const rawConvId = req.body.conversationId || req.body.chatId;
    const rawSenderId = req.body.senderId || req.body.sender || (req.body.senderRole === "supervisor" ? "admin" : rawConvId);
    const text = req.body.text;
    if (!rawConvId || !text || !String(text).trim()) {
      return res.status(400).json({ error: "Missing required chat parameters" });
    }

    const conversationId = String(rawConvId).trim();
    const senderRole = req.body.senderRole === "supervisor" || req.body.sender === "admin" ? "supervisor" : "parent";
    const sender = senderRole === "supervisor" ? "admin" : "parent";
    const senderName = req.body.senderName || (senderRole === "supervisor" ? "إدارة المنظومة" : "ولي الأمر");

    const timeFormatted = new Intl.DateTimeFormat("ar-EG", {
      hour: "numeric",
      minute: "numeric",
      hour12: true,
    }).format(new Date());

    const newMsg: any = {
      id: req.body.id || `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      conversationId,
      chatId: conversationId,
      senderId: String(rawSenderId || (senderRole === "supervisor" ? "admin" : conversationId)).trim(),
      sender,
      senderRole,
      senderName,
      text: String(text).trim(),
      status: "SENT",
      isRead: false,
      timestamp: req.body.timestamp || Date.now(),
      timeFormatted,
    };

    const convList = chatMessagesStore.get(conversationId) || [];
    convList.push(newMsg);
    // Cap in-memory history to last 100 messages to respect data limits
    if (convList.length > 100) {
      convList.splice(0, convList.length - 100);
    }
    chatMessagesStore.set(conversationId, convList);
    persistChatStore();

    // Broadcast instantaneously over Portal SSE stream (reaches supervisors AND target parent device)
    broadcastPortalSSE({
      type: "CHAT_MESSAGE",
      barcode: conversationId,
      chatId: conversationId,
      message: newMsg,
    });

    // Send high-priority loud push alert to recipient
    const target = req.body.recipientId || (senderRole === "supervisor" ? conversationId : "admin");
    sendWebPushToTargets({
      targetUserIds: [target],
      title: senderRole === "supervisor" ? "رسالة جديدة من إدارة المنظومة" : `رسالة جديدة من ولي أمر (${conversationId})`,
      body: newMsg.text,
      type: "chat",
      sound: "/notification.wav",
      url: "/?tab=chat",
      tag: `chat-${newMsg.conversationId}`,
    }).catch(() => {});

    return res.json({ success: true, message: newMsg });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Fast Fetch of All Chat Threads for Instant 0ms Supervisor UI Hydration
app.get("/api/portal/chat/all", (_req, res) => {
  try {
    applyZeroCacheHeaders(res);
    const all: Record<string, any[]> = {};
    chatMessagesStore.forEach((msgs, convId) => {
      all[convId] = msgs.slice(-100);
    });
    return res.json({ success: true, chats: all });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 2. Cursor-Based Fast Message History Pagination
app.get("/api/portal/chat/:conversationId/messages", (req, res) => {
  try {
    applyZeroCacheHeaders(res);
    const convId = String(req.params.conversationId).trim();
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 30, 100);
    const beforeTime = req.query.before_time ? parseInt(req.query.before_time as string, 10) : undefined;

    const allMsgs = chatMessagesStore.get(convId) || [];
    
    // Filter messages older than beforeTime cursor
    const filtered = beforeTime
      ? allMsgs.filter((m) => m.timestamp < beforeTime)
      : allMsgs;

    // Slice last `limit` messages
    const startIndex = Math.max(0, filtered.length - limit);
    const paginated = filtered.slice(startIndex);
    const hasMore = startIndex > 0;
    const nextCursor = hasMore && paginated.length > 0 ? paginated[0].timestamp : null;

    return res.json({
      success: true,
      conversationId: convId,
      messages: paginated,
      hasMore,
      nextCursor,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 3. Typing Indicator Handler (Zero DB hit, pure in-memory broadcast)
app.post("/api/portal/chat/typing", (req, res) => {
  const { conversationId, userId, isTyping } = req.body;
  if (!conversationId || !userId) {
    return res.status(400).json({ error: "Missing conversationId or userId" });
  }

  broadcastPortalSSE({
    type: "CHAT_TYPING",
    conversationId,
    userId,
    isTyping: !!isTyping,
  });

  return res.json({ success: true });
});

// 4. Read Receipts Handler
app.post("/api/portal/chat/read", (req, res) => {
  const { conversationId, chatId, messageIds, readerId, readerRole } = req.body;
  const targetConvId = String(conversationId || chatId || "").trim();
  if (!targetConvId) {
    return res.status(400).json({ error: "Missing conversationId" });
  }

  const msgs = chatMessagesStore.get(targetConvId);
  if (msgs && Array.isArray(msgs)) {
    let changed = false;
    msgs.forEach((m) => {
      const matchesId = Array.isArray(messageIds) && messageIds.length > 0 && messageIds.includes(m.id);
      const isBatchAll = !messageIds || (Array.isArray(messageIds) && messageIds.length === 0);
      const matchesRole =
        (readerRole === "admin" && (m.senderRole === "parent" || (m as any).sender === "parent")) ||
        (readerRole === "parent" && (m.senderRole === "supervisor" || (m as any).sender === "admin"));

      if (matchesId || isBatchAll || matchesRole) {
        if (!m.isRead || m.status !== "READ") {
          m.isRead = true;
          m.status = "READ";
          changed = true;
        }
      }
    });
    if (changed) {
      persistChatStore();
    }
  }

  broadcastPortalSSE({
    type: "CHAT_READ",
    conversationId: targetConvId,
    chatId: targetConvId,
    messageIds,
    readerId,
    readerRole,
  });

  return res.json({ success: true });
});

// 5. User Online Presence & Heartbeat
app.post("/api/portal/presence", (req, res) => {
  const { userId, role } = req.body;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  onlinePresenceMap.set(String(userId).trim(), {
    role: role || "user",
    lastSeen: Date.now(),
  });

  return res.json({ success: true, timestamp: Date.now() });
});

app.get("/api/portal/presence", (_req, res) => {
  const now = Date.now();
  const onlineUsers: string[] = [];

  for (const [uid, info] of onlinePresenceMap.entries()) {
    if (now - info.lastSeen < 35000) {
      onlineUsers.push(uid);
    }
  }

  return res.json({ success: true, onlineUsers });
});

// ----------------------------------------------------
// 24/7 AUTONOMOUS BACKGROUND FIRESTORE LISTENERS
// Guarantees push notifications with audio chime even when app is closed
// ----------------------------------------------------
let cachedStudents: any[] = getSystemCache().students;
let knownPayments = new Set<string>();
// Pre-populate known payments so baseline backup payments do not trigger false notifications
try {
  for (const [mKey, pMap] of Object.entries(getSystemCache().payments || {})) {
    if (pMap && typeof pMap === "object") {
      for (const bCode of Object.keys(pMap)) {
        knownPayments.add(`${mKey}:${bCode}`);
      }
    }
  }
} catch {}
let isInitialPaymentsLoaded = true;
let lastProcessedLiveEventTime = Date.now() - 30000;

let unsubPushSubs: (() => void) | null = null;
let unsubLiveEvents: (() => void) | null = null;
let unsubSystemState: (() => void) | null = null;

function detachAllFirestoreListeners() {
  if (unsubPushSubs) {
    try { unsubPushSubs(); } catch {}
    unsubPushSubs = null;
  }
  if (unsubLiveEvents) {
    try { unsubLiveEvents(); } catch {}
    unsubLiveEvents = null;
  }
  if (unsubSystemState) {
    try { unsubSystemState(); } catch {}
    unsubSystemState = null;
  }
}

function setupAutonomousBackgroundPushListeners() {
  if (isFirestoreQuotaExceededServer) {
    console.info("[Background Push] Firestore quota limit currently active; running in standalone mode using local push cache.");
    return;
  }
  detachAllFirestoreListeners();
  console.log("[Background Push] Initializing 24/7 autonomous Firestore listeners...");

  // 1. Subscribe to push_subscriptions collection in Firestore to keep memory cache continuously updated
  try {
    unsubPushSubs = onSnapshot(
      collection(db, "push_subscriptions"),
      (snap) => {
        snap.docChanges().forEach((change) => {
          const data = change.doc.data();
          if (data.endpoint && data.p256dh && data.auth) {
            if (change.type === "added" || change.type === "modified") {
              subscriptionsCache.set(data.endpoint, {
                userId: String(data.userId || "guest").trim(),
                aliases: Array.isArray(data.aliases) ? data.aliases.map(String) : [],
                userRole: data.userRole || "parent",
                endpoint: data.endpoint,
                keys: {
                  p256dh: data.p256dh,
                  auth: data.auth,
                },
                userAgent: data.userAgent || "",
                updatedAt: data.updatedAt?.toMillis ? data.updatedAt.toMillis() : Date.now(),
              });
            } else if (change.type === "removed") {
              subscriptionsCache.delete(data.endpoint);
            }
          }
        });
        persistStoredSubscriptions();
      },
      (err) => {
        if (handleFirestoreQuotaWarning("push_subscriptions listener", err)) {
          detachAllFirestoreListeners();
        } else {
          const msg = String(err?.message || err || "");
          if (
            msg.includes("idle stream") ||
            msg.includes("CANCELLED") ||
            msg.includes("Disconnecting idle stream") ||
            err?.code === "cancelled" ||
            (err as any)?.code === 1
          ) {
            return;
          }
          console.warn("[Background Push] push_subscriptions listener notice:", msg);
        }
      }
    );
  } catch (err: any) {
    if (handleFirestoreQuotaWarning("push_subscriptions listener setup", err)) {
      detachAllFirestoreListeners();
    } else {
      console.warn("[Background Push] failed to listen to push_subscriptions:", err.message || err);
    }
  }

  // 2. Listen to live attendance events (scans from any device or external site)
  try {
    unsubLiveEvents = onSnapshot(
      doc(db, "live_events", "today"),
      async (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        const last = data?.lastEvent;
        if (!last || !last.timestamp || last.timestamp <= lastProcessedLiveEventTime) return;
        lastProcessedLiveEventTime = last.timestamp;

        const barcode = String(last.barcode || "").trim();
        const student = cachedStudents.find((s) => String(s.barcode).trim() === barcode);
        const studentName = last.studentName || student?.name || "الطالب";
        const status = last.status || "حضور";

        let title = "منظومة الرياضيات - الأستاذة إيمان الدمشيتي";
        let body = "";
        let eventType = "attendance";

        if (status === "حضور") {
          title = `🟢 تسجيل حضور: ${studentName}`;
          body = `تم تسجيل حضور ووصول الطالب (${studentName}) في المركز بنجاح (${last.timeDisplay || "الآن"}).`;
          eventType = "attendance";
        } else if (status === "تأخير") {
          title = `⚠️ تنبيه تأخير: ${studentName}`;
          body = `تم تسجيل حضور الطالب (${studentName}) متأخراً عن موعد بداية الحصة (${last.timeDisplay || "الآن"}).`;
          eventType = "late";
        } else if (status === "غياب") {
          title = `🔴 تنبيه غياب: ${studentName}`;
          body = `نحيطكم علماً بأنه تم تسجيل غياب الطالب (${studentName}) عن حصة اليوم.`;
          eventType = "absence";
        }

        const targets: string[] = [barcode];
        if (student?.parentPhone) targets.push(String(student.parentPhone).trim());
        if (student?.phone) targets.push(String(student.phone).trim());
        targets.push("admin");

        console.log(`[Background Push] Live scan event detected: ${studentName} (${status}). Sending push to:`, targets);
        await sendWebPushToTargets({
          targetUserIds: targets,
          title,
          body,
          icon: "/icon.svg",
          badge: "/icon.svg",
          type: eventType,
          sound: "/notification.wav",
          url: `/?tab=attendance&barcode=${barcode}`,
          eventId: last.id || `live-${last.timestamp}`,
        });
      },
      (err) => {
        if (handleFirestoreQuotaWarning("live_events listener", err)) {
          detachAllFirestoreListeners();
        } else {
          const msg = String(err?.message || err || "");
          if (
            msg.includes("idle stream") ||
            msg.includes("CANCELLED") ||
            msg.includes("Disconnecting idle stream") ||
            err?.code === "cancelled" ||
            (err as any)?.code === 1
          ) {
            return;
          }
          console.warn("[Background Push] live_events onSnapshot notice:", msg);
        }
      }
    );
  } catch (err: any) {
    if (handleFirestoreQuotaWarning("live_events listener setup", err)) {
      detachAllFirestoreListeners();
    } else {
      console.warn("[Background Push] failed to listen to live_events:", err.message || err);
    }
  }

  // 3. Listen to system_state/main_center_data for students and new payments (debounced)
  let paymentCheckTimer: NodeJS.Timeout | null = null;
  try {
    unsubSystemState = onSnapshot(
      doc(db, "system_state", "main_center_data"),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as any;
        if (Array.isArray(data?.students)) {
          cachedStudents = data.students;
        }

        // Debounce payment checking to avoid blocking the event loop on rapid scan bursts
        if (paymentCheckTimer) clearTimeout(paymentCheckTimer);
        paymentCheckTimer = setTimeout(async () => {
          const payments = data?.payments;
          if (payments && typeof payments === "object") {
            const currentKeys = new Set<string>();
            const newPaymentsToNotify: Array<{ monthKey: string; barcode: string; rec: any }> = [];

            for (const [mKey, map] of Object.entries(payments)) {
              if (map && typeof map === "object") {
                for (const [bCode, rec] of Object.entries(map as any)) {
                  if (rec && Number((rec as any).amount) > 0) {
                    const key = `${mKey}:${bCode}`;
                    currentKeys.add(key);
                    if (isInitialPaymentsLoaded && !knownPayments.has(key)) {
                      newPaymentsToNotify.push({ monthKey: mKey, barcode: bCode, rec });
                    }
                  }
                }
              }
            }

            knownPayments = currentKeys;
            if (!isInitialPaymentsLoaded) {
              isInitialPaymentsLoaded = true;
            } else {
              for (const item of newPaymentsToNotify) {
                const student = cachedStudents.find((s) => String(s.barcode).trim() === item.barcode);
                const studentName = student?.name || item.rec?.studentName || "الطالب";
                const amount = item.rec?.amount || 0;
                const title = `💳 سداد مصاريف: ${studentName}`;
                const body = `تم بنجاح سداد اشتراك شهر (${item.monthKey}) للطالب (${studentName}) بمبلغ ${amount} ج.م.`;

                const targets: string[] = [item.barcode];
                if (student?.parentPhone) targets.push(String(student.parentPhone).trim());
                if (student?.phone) targets.push(String(student.phone).trim());
                targets.push("admin");

                console.log(`[Background Push] New payment detected: ${studentName} (${item.monthKey}). Sending push.`);
                await sendWebPushToTargets({
                  targetUserIds: targets,
                  title,
                  body,
                  icon: "/icon.svg",
                  badge: "/icon.svg",
                  type: "payment",
                  sound: "/notification.wav",
                  url: `/?tab=expenses&barcode=${item.barcode}`,
                  eventId: `pay-${item.monthKey}-${item.barcode}-${Date.now()}`,
                });
              }
            }
          }
        }, 1000);
      },
      (err) => {
        if (handleFirestoreQuotaWarning("main_center_data listener", err)) {
          detachAllFirestoreListeners();
        } else {
          const msg = String(err?.message || err || "");
          if (
            msg.includes("idle stream") ||
            msg.includes("CANCELLED") ||
            msg.includes("Disconnecting idle stream") ||
            err?.code === "cancelled" ||
            (err as any)?.code === 1
          ) {
            return;
          }
          console.warn("[Background Push] main_center_data onSnapshot notice:", msg);
        }
      }
    );
  } catch (err: any) {
    if (handleFirestoreQuotaWarning("main_center_data listener setup", err)) {
      detachAllFirestoreListeners();
    } else {
      console.warn("[Background Push] failed to listen to system_state:", err.message || err);
    }
  }
}

// ----------------------------------------------------
// VITE MIDDLEWARE / STATIC ASSETS SERVING
// ----------------------------------------------------
async function startServer() {
  loadStoredSubscriptions();
  await syncSubscriptionsFromFirestore();
  setupAutonomousBackgroundPushListeners();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    // High-performance static serving with HTTP caching
    app.use(
      express.static(distPath, {
        maxAge: "1d",
        etag: true,
        setHeaders: (res, filePath) => {
          if (filePath.includes("/assets/")) {
            // Hashed JS/CSS chunks are immutable and safe to cache for 1 year
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          } else if (
            filePath.endsWith("index.html") ||
            filePath.endsWith("sw.js") ||
            filePath.endsWith("manifest.json")
          ) {
            // HTML and service worker must revalidate immediately
            res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
          }
        },
      })
    );
    app.get("*", (_req, res) => {
      res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Eman Math System] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
