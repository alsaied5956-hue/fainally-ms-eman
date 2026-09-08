import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import webpush from "web-push";

// VAPID Configuration for Web Push
const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ||
  "BD_lWLiEajdLu3oPaxC7ZZLu24QMzOHp6MjYkOx5fpm82UdO1GrL6skaYCYmSZYGeXc530kFZrGcxbh7Su2DEGs";
const VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY || "gsPOR4xTnVbp3RAkrP1xODC9iS1JGCOE8b9TcYvLaZI";
const VAPID_SUBJECT = "mailto:eman.math.center@gmail.com";

try {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log("✅ WebPush VAPID details successfully configured.");
} catch (err) {
  console.warn("⚠️ WebPush VAPID setup warning:", err);
}

interface StoredSubscription {
  id: string;
  userId: string;
  userRole: "parent" | "admin" | "student" | string;
  barcodes: string[];
  phone: string;
  subscription: {
    endpoint: string;
    expirationTime?: number | null;
    keys: {
      p256dh: string;
      auth: string;
    };
  };
  userAgent?: string;
  updatedAt: number;
}

// Persistent / in-memory store for push subscriptions
const SUBSCRIPTIONS_FILE = path.join(process.cwd(), ".push_subscriptions_store.json");
let activeSubscriptions: Map<string, StoredSubscription> = new Map();

// Load stored subscriptions from disk if available
try {
  if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
    const raw = fs.readFileSync(SUBSCRIPTIONS_FILE, "utf-8");
    const arr: StoredSubscription[] = JSON.parse(raw);
    arr.forEach((item) => {
      if (item.subscription?.endpoint) {
        activeSubscriptions.set(item.subscription.endpoint, item);
      }
    });
    console.log(`📦 Loaded ${activeSubscriptions.size} background push subscriptions from cache.`);
  }
} catch (err) {
  console.warn("Could not load push subscriptions from disk cache:", err);
}

function saveSubscriptionsToDisk() {
  try {
    const list = Array.from(activeSubscriptions.values());
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(list, null, 2), "utf-8");
  } catch (err) {
    console.warn("Could not save push subscriptions to disk cache:", err);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "5mb" }));

  // CORS for local development
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  // 1. Health check
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      activeSubscriptions: activeSubscriptions.size,
      time: new Date().toISOString(),
    });
  });

  // 2. VAPID Public Key for clients
  app.get("/api/vapid-public-key", (req, res) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY });
  });

  // 3. Register or update push subscription
  app.post("/api/push-subscription", (req, res) => {
    try {
      const { userId, userRole, barcodes = [], phone = "", subscription, userAgent } = req.body;

      if (!subscription || !subscription.endpoint || !subscription.keys) {
        return res.status(400).json({ error: "Invalid subscription payload" });
      }

      const endpoint = subscription.endpoint;
      const combinedBarcodes = Array.from(
        new Set([
          ...(Array.isArray(barcodes) ? barcodes : []),
          ...(userId ? [String(userId)] : []),
        ])
      );

      const record: StoredSubscription = {
        id: encodeURIComponent(endpoint).slice(-80),
        userId: String(userId || ""),
        userRole: userRole || "parent",
        barcodes: combinedBarcodes,
        phone: String(phone || ""),
        subscription,
        userAgent: userAgent || "",
        updatedAt: Date.now(),
      };

      activeSubscriptions.set(endpoint, record);
      saveSubscriptionsToDisk();

      console.log(
        `📱 Registered push subscription for user [${record.userId}] role [${record.userRole}] barcodes [${record.barcodes.join(",")}]`
      );

      return res.json({ success: true, total: activeSubscriptions.size });
    } catch (err: any) {
      console.error("Error registering subscription:", err);
      return res.status(500).json({ error: err.message || "Failed to register subscription" });
    }
  });

  // 4. Send Push Notification to devices (even when app is closed)
  app.post("/api/send-push", async (req, res) => {
    try {
      const {
        targetBarcodes,
        targetPhone,
        targetRole,
        title = "منظومة الأستاذة إيمان الدمشيتي",
        body = "",
        url = "/",
        type = "alert",
        icon = "/icon.svg",
        badge = "/icon.svg",
        data = {},
      } = req.body;

      const payload = JSON.stringify({
        title,
        body,
        icon,
        badge,
        url,
        type,
        timestamp: Date.now(),
        data,
      });

      const targetBarcodeList = Array.isArray(targetBarcodes)
        ? targetBarcodes.map(String)
        : targetBarcodes
        ? [String(targetBarcodes)]
        : [];

      const targetPhoneStr = targetPhone ? String(targetPhone).replace(/\D/g, "") : "";

      // Filter matched subscriptions
      const matchedSubs: StoredSubscription[] = [];

      for (const item of activeSubscriptions.values()) {
        let isMatch = false;

        // Role match
        if (targetRole === "all") {
          isMatch = true;
        } else if (targetRole === "admin" && item.userRole === "admin") {
          isMatch = true;
        }

        // Barcode match (e.g. child student barcode)
        if (
          targetBarcodeList.length > 0 &&
          (targetBarcodeList.includes(item.userId) ||
            item.barcodes.some((b) => targetBarcodeList.includes(b)))
        ) {
          isMatch = true;
        }

        // Phone match
        if (targetPhoneStr && item.phone) {
          const itemPhoneClean = item.phone.replace(/\D/g, "");
          if (itemPhoneClean.includes(targetPhoneStr) || targetPhoneStr.includes(itemPhoneClean)) {
            isMatch = true;
          }
        }

        if (isMatch) {
          matchedSubs.push(item);
        }
      }

      console.log(
        `🚀 Dispatching push to ${matchedSubs.length} device(s) [Title: "${title}"]`
      );

      let successCount = 0;
      let failureCount = 0;
      const expiredEndpoints: string[] = [];

      const sendPromises = matchedSubs.map(async (item) => {
        try {
          await webpush.sendNotification(item.subscription, payload, {
            TTL: 86400, // Retain for 24 hours on push servers
            urgency: "high",
          });
          successCount++;
        } catch (err: any) {
          failureCount++;
          // If status is 410 (Gone) or 404 (Not Found), subscription expired or unsubscribed
          if (err.statusCode === 410 || err.statusCode === 404) {
            expiredEndpoints.push(item.subscription.endpoint);
          } else {
            console.warn(`Push dispatch warning for user [${item.userId}]:`, err.message || err);
          }
        }
      });

      await Promise.all(sendPromises);

      // Clean expired
      if (expiredEndpoints.length > 0) {
        expiredEndpoints.forEach((ep) => activeSubscriptions.delete(ep));
        saveSubscriptionsToDisk();
      }

      return res.json({
        success: true,
        delivered: successCount,
        failed: failureCount,
        totalMatched: matchedSubs.length,
      });
    } catch (err: any) {
      console.error("Error in /api/send-push:", err);
      return res.status(500).json({ error: err.message || "Failed to dispatch push notifications" });
    }
  });

  // 5. Test Delayed Push (Allows user to lock phone or close app and verify receipt)
  app.post("/api/test-push", (req, res) => {
    try {
      const {
        subscription,
        delaySeconds = 5,
        title = "🔔 اختبار إشعار المنظومة والتطبيق مقفول",
        body = "ممتاز! تم استلام هذا الإشعار بنجاح أثناء قفل الهاتف أو إغلاق التطبيق.",
      } = req.body;

      if (!subscription || !subscription.endpoint) {
        return res.status(400).json({ error: "Missing subscription for test" });
      }

      const payload = JSON.stringify({
        title,
        body,
        icon: "/icon.svg",
        badge: "/icon.svg",
        url: "/",
        type: "alert",
        timestamp: Date.now(),
      });

      console.log(`⏱️ Scheduling test push in ${delaySeconds}s for device...`);

      // Respond immediately to client so user can close app
      res.json({
        success: true,
        message: `تم جدولة الإشعار بعد ${delaySeconds} ثوانٍ. يمكنك الآن قفل الشاشة أو إغلاق التطبيق للتأكد من وصوله!`,
        delaySeconds,
      });

      // Send after delay
      setTimeout(async () => {
        try {
          await webpush.sendNotification(subscription, payload, {
            TTL: 3600,
            urgency: "high",
          });
          console.log("✅ Scheduled test push sent successfully to device.");
        } catch (err: any) {
          console.warn("⚠️ Scheduled test push failed:", err.message || err);
        }
      }, Math.max(1, delaySeconds) * 1000);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to schedule test push" });
    }
  });

  // Vite middleware setup (Development vs Production)
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Full-stack server running on http://localhost:${PORT}`);
  });
}

startServer();
