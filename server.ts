import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import webpush from "web-push";

const app = express();
const PORT = 3000;

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
// SUBSCRIPTIONS STORAGE (IN-MEMORY + FILE BACKUP)
// ----------------------------------------------------
interface StoredSubscription {
  userId: string; // studentBarcode or parentPhone or "admin"
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

loadStoredSubscriptions();

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// 1. Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", subscriptions: subscriptionsCache.size, timestamp: Date.now() });
});

// 2. Return VAPID Public Key for Client Subscription
app.get("/api/push-public-key", (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// 3. Register or Update Web Push Subscription
app.post("/api/push-subscribe", (req, res) => {
  try {
    const { userId, userRole, subscription } = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: "Invalid subscription payload" });
    }

    const cleanUserId = String(userId || "guest").trim();
    const stored: StoredSubscription = {
      userId: cleanUserId,
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

    console.log(`[Push] Registered subscription for user ${cleanUserId} (${userRole || "parent"}). Total: ${subscriptionsCache.size}`);
    return res.json({ success: true, count: subscriptionsCache.size });
  } catch (err: any) {
    console.error("push-subscribe error:", err);
    return res.status(500).json({ error: err.message || "Failed to save subscription" });
  }
});

// 4. Send Web Push Notification to Specific User(s) or Role
app.post("/api/send-push", async (req, res) => {
  try {
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
    } = req.body;

    if (!title || !body) {
      return res.status(400).json({ error: "title and body are required" });
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
      timestamp: Date.now(),
    });

    const targetList = Array.isArray(targetUserIds)
      ? targetUserIds.map((id) => String(id).trim())
      : targetUserIds
      ? [String(targetUserIds).trim()]
      : [];

    const matchedSubs: StoredSubscription[] = [];

    for (const sub of subscriptionsCache.values()) {
      let isMatch = false;

      // Filter by target IDs (e.g. barcode or parent phone)
      if (targetList.length > 0) {
        if (targetList.includes(sub.userId)) {
          isMatch = true;
        }
      } else if (role) {
        // Filter by role (e.g. all parents or all admins)
        if (sub.userRole === role || (role === "all")) {
          isMatch = true;
        }
      } else {
        // No filter: broadcast to all
        isMatch = true;
      }

      if (isMatch) {
        matchedSubs.push(sub);
      }
    }

    if (matchedSubs.length === 0) {
      return res.json({
        success: true,
        sent: 0,
        message: "No active push subscriptions found for this recipient.",
      });
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
              TTL: 86400, // 24 hours delivery guarantee by push service
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

    // Clean up dead subscriptions
    if (deadEndpoints.length > 0) {
      deadEndpoints.forEach((ep) => subscriptionsCache.delete(ep));
      persistStoredSubscriptions();
    }

    return res.json({
      success: true,
      sent: deliveredCount,
      failed: failedCount,
      cleaned: deadEndpoints.length,
    });
  } catch (err: any) {
    console.error("send-push error:", err);
    return res.status(500).json({ error: err.message || "Failed to send push notification" });
  }
});

// ----------------------------------------------------
// VITE MIDDLEWARE / STATIC ASSETS SERVING
// ----------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Eman Math System] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
