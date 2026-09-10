import express from "express";
import path from "path";
import fs from "fs";
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
} from "firebase/firestore";
import firebaseConfig from "./firebase-applet-config.json";
import {
  generateSmartStudentNotification,
  analyzeStudentAcademicStatus,
  geminiConcurrencyQueue,
  getGeminiClient,
  executeWithRetry,
  cleanAndParseJSON,
} from "./server/geminiService";

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
  } catch (err) {
    console.warn("[Push] Error syncing from Firestore:", err);
  }
}

loadStoredSubscriptions();
syncSubscriptionsFromFirestore().catch(() => {});

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// 1. Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", subscriptions: subscriptionsCache.size, timestamp: Date.now() });
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

    // Persist to Firestore collection push_subscriptions
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
      }, { merge: true }).catch(() => {});
    } catch {}

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
    const item: RevokedAccountRecord = {
      barcode: cleanBarcode,
      reason: reasonText,
      revokedAt: Date.now(),
    };

    revokedAccountsCache.set(cleanBarcode, item);
    persistRevokedAccounts();

    console.log(`[Revocation Engine] Account revoked: ${cleanBarcode}. Broadcasting to ${sseClients.size} SSE connections.`);

    // Instant SSE broadcast to all active mobile phone sessions
    broadcastAccountEvent({
      type: "ACCOUNT_REVOKED",
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

    console.log(`[Revocation Engine] Account activated/unrevoked: ${cleanBarcode}.`);

    broadcastAccountEvent({
      type: "ACCOUNT_ACTIVATED",
      barcode: cleanBarcode,
      timestamp: Date.now(),
    });

    return res.json({ success: true, barcode: cleanBarcode });
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
      try {
        const cleanDocId = encodeURIComponent(ep).slice(-80);
        deleteDoc(doc(db, "push_subscriptions", cleanDocId)).catch(() => {});
      } catch {}
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
    if (subscriptionsCache.size === 0) {
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

// ----------------------------------------------------
// 24/7 AUTONOMOUS BACKGROUND FIRESTORE LISTENERS
// Guarantees push notifications with audio chime even when app is closed
// ----------------------------------------------------
let cachedStudents: any[] = [];
let knownPayments = new Set<string>();
let isInitialPaymentsLoaded = false;
let lastProcessedLiveEventTime = Date.now() - 30000;

function setupAutonomousBackgroundPushListeners() {
  console.log("[Background Push] Initializing 24/7 autonomous Firestore listeners...");

  // 1. Subscribe to push_subscriptions collection in Firestore to keep memory cache continuously updated
  try {
    onSnapshot(collection(db, "push_subscriptions"), (snap) => {
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
    }, (err) => {
      console.warn("[Background Push] push_subscriptions listener error:", err.message);
    });
  } catch (err: any) {
    console.warn("[Background Push] failed to listen to push_subscriptions:", err.message);
  }

  // 2. Listen to live attendance events (scans from any device or external site)
  try {
    onSnapshot(doc(db, "live_events", "today"), async (snap) => {
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
    }, (err) => {
      console.warn("[Background Push] live_events onSnapshot warning:", err.message);
    });
  } catch (err: any) {
    console.warn("[Background Push] failed to listen to live_events:", err.message);
  }

  // 3. Listen to system_state/main_center_data for students and new payments (debounced)
  let paymentCheckTimer: NodeJS.Timeout | null = null;
  try {
    onSnapshot(doc(db, "system_state", "main_center_data"), (snap) => {
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
    }, (err) => {
      console.warn("[Background Push] main_center_data onSnapshot warning:", err.message);
    });
  } catch (err: any) {
    console.warn("[Background Push] failed to listen to system_state:", err.message);
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
      server: { middlewareMode: true },
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
