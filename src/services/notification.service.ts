import { Pool } from "pg";
import Redis from "ioredis";
import webpush from "web-push";

export interface PushNotificationPayload {
  targetUserIds: string[]; // List of barcodes or user identifiers
  title: string;
  body: string;
  type?: "chat" | "alert" | "revocation" | "attendance" | "payment";
  sound?: string;
  url?: string;
  data?: Record<string, any>;
  tag?: string;
}

export interface PushDispatchResult {
  totalTargeted: number;
  fcmSent: number;
  webPushSent: number;
  failedCount: number;
  cleanedTokensCount: number;
}

export interface FcmV1Message {
  token?: string;
  topic?: string;
  notification: {
    title: string;
    body: string;
  };
  data?: Record<string, string>;
  android: {
    priority: "HIGH" | "NORMAL";
    notification: {
      channelId: string;
      sound: string;
      defaultSound: boolean;
      notificationPriority: "PRIORITY_MAX" | "PRIORITY_HIGH";
      visibility: "PUBLIC" | "PRIVATE";
      clickAction?: string;
    };
  };
  apns: {
    headers: Record<string, string>;
    payload: {
      aps: {
        sound: {
          critical: number;
          name: string;
          volume: number;
        };
        badge: number;
        contentAvailable: boolean;
      };
    };
  };
  webpush: {
    headers: Record<string, string>;
    notification: {
      title?: string;
      body?: string;
      icon?: string;
      badge?: string;
      tag?: string;
      requireInteraction?: boolean;
      renotify?: boolean;
      vibrate?: number[];
      dir?: "rtl" | "ltr";
      data?: Record<string, any>;
    };
  };
}

export class NotificationService {
  private pgPool: Pool;
  private redis: Redis;
  private fcmAccessToken?: string;
  private fcmProjectId?: string;

  constructor(pgPool: Pool, redisClient: Redis) {
    this.pgPool = pgPool;
    this.redis = redisClient;
    this.fcmProjectId = process.env.FCM_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;

    // Configure Web Push VAPID credentials if set
    const vapidPublic = process.env.VAPID_PUBLIC_KEY || "BNoYf8n1aN0bW8o2zJ8w6j_1zN9x3m4k5L6p7q8r9s0t1u2v3w4x5y6z";
    const vapidPrivate = process.env.VAPID_PRIVATE_KEY || "dummy_private_key_production_environment_2026";
    const vapidEmail = process.env.VAPID_SUBJECT || "mailto:admin@eman-system.com";

    try {
      webpush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate);
    } catch {
      // Handled gracefully in development or if keys are initialized dynamically
    }
  }

  /**
   * Build Enterprise FCM v1 Compliant Payload with Native Sound & Channel Settings
   */
  public buildFcmV1Payload(
    targetToken: string,
    title: string,
    body: string,
    payloadData: Record<string, any> = {}
  ): FcmV1Message {
    const stringData: Record<string, string> = {};
    Object.entries(payloadData).forEach(([k, v]) => {
      stringData[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
    });

    return {
      token: targetToken,
      notification: {
        title,
        body,
      },
      data: stringData,
      android: {
        priority: "HIGH",
        notification: {
          channelId: "high_importance_channel", // Native Android Channel ID configured on device
          sound: "loud_alarm",                  // Native sound resource packaged in res/raw/loud_alarm.mp3
          defaultSound: false,
          notificationPriority: "PRIORITY_MAX",
          visibility: "PUBLIC",
          clickAction: "FLUTTER_NOTIFICATION_CLICK",
        },
      },
      apns: {
        headers: {
          "apns-priority": "10",
          "apns-push-type": "alert",
        },
        payload: {
          aps: {
            sound: {
              critical: 1,
              name: "loud_alarm.caf",           // Native iOS bundled sound
              volume: 1.0,
            },
            badge: 1,
            contentAvailable: true,
          },
        },
      },
      webpush: {
        headers: {
          Urgency: "high",
          Priority: "u=1, i",
        },
        notification: {
          title,
          body,
          icon: "/icon.svg",
          badge: "/icon.svg",
          tag: payloadData.tag || `eman-${Date.now()}`,
          requireInteraction: true,
          renotify: true,
          vibrate: [500, 100, 500, 100, 500],
          dir: "rtl",
          data: {
            url: payloadData.url || "/",
            sound: payloadData.sound || "/notification.wav",
            timestamp: Date.now(),
          },
        },
      },
    };
  }

  /**
   * Dispatches High-Priority Native Notifications to target users
   */
  public async sendHighPriorityPush(payload: PushNotificationPayload): Promise<PushDispatchResult> {
    const { targetUserIds, title, body, type = "alert", sound = "/notification.wav", url = "/" } = payload;
    const result: PushDispatchResult = {
      totalTargeted: targetUserIds.length,
      fcmSent: 0,
      webPushSent: 0,
      failedCount: 0,
      cleanedTokensCount: 0,
    };

    if (targetUserIds.length === 0) return result;

    // 1. Fetch active push tokens from PostgreSQL push_tokens table
    const { rows: tokenRows } = await this.pgPool.query(
      `SELECT id, user_id, token, platform 
       FROM push_tokens 
       WHERE user_id = ANY($1::text[]) AND is_active = TRUE`,
      [targetUserIds]
    );

    if (tokenRows.length === 0) return result;

    const tokensToDelete: string[] = [];

    for (const row of tokenRows) {
      const { id, token, platform, user_id } = row;

      try {
        if (platform === "web" && (token.startsWith("http") || token.startsWith("{"))) {
          // Web Push API (Standard VAPID JSON subscription)
          const subscription = typeof token === "string" && token.startsWith("{") ? JSON.parse(token) : { endpoint: token };

          const webPushPayload = JSON.stringify({
            title,
            body,
            icon: "/icon.svg",
            badge: "/icon.svg",
            tag: payload.tag || `${type}-${Date.now()}`,
            url,
            sound,
            type,
            timestamp: Date.now(),
          });

          await webpush.sendNotification(subscription, webPushPayload, {
            urgency: "high",
            TTL: 86400,
          });

          result.webPushSent++;
        } else {
          // FCM v1 Push Delivery
          const fcmMessage = this.buildFcmV1Payload(token, title, body, {
            type,
            url,
            sound,
            tag: payload.tag,
            timestamp: Date.now(),
          });

          await this.dispatchFcmV1Message(fcmMessage);
          result.fcmSent++;
        }
      } catch (err: any) {
        result.failedCount++;
        const statusCode = err.statusCode || err.status;
        const errStr = `${err.message || ""} ${err.rawError || ""} ${err.errorCode || ""}`.toLowerCase();

        // Catch Firebase messaging errors & WebPush 410/404 errors
        const isDeadToken =
          statusCode === 410 ||
          statusCode === 404 ||
          errStr.includes("registration-token-not-registered") ||
          errStr.includes("invalid-registration-token") ||
          errStr.includes("messaging/registration-token-not-registered") ||
          errStr.includes("messaging/invalid-registration-token") ||
          errStr.includes("unregistered") ||
          errStr.includes("notregistered") ||
          errStr.includes("invalid_argument") ||
          errStr.includes("requested entity was not found");

        if (isDeadToken) {
          tokensToDelete.push(id);
          // Automatically delete bad token immediately to protect FCM quota & prevent redundant network calls
          await this.pgPool
            .query(`DELETE FROM push_tokens WHERE id = $1`, [id])
            .then(() => {
              result.cleanedTokensCount++;
              console.info(`[NotificationService] Immediately purged dead push token ${id} (Reason: ${errStr})`);
            })
            .catch((delErr) =>
              console.warn(`[NotificationService] Failed immediate deletion of token ${id}:`, delErr.message)
            );

          // Clean token cache in Redis if present
          await this.redis.del(`push:tokens:${user_id}`).catch(() => {});
        }
      }
    }

    return result;
  }

  /**
   * Batch deletes dead or invalid push tokens from database
   */
  public async deleteDeadTokens(tokenIds: string[]): Promise<number> {
    if (!tokenIds || tokenIds.length === 0) return 0;
    try {
      const res = await this.pgPool.query(`DELETE FROM push_tokens WHERE id = ANY($1::uuid[])`, [tokenIds]);
      return res.rowCount || 0;
    } catch (err: any) {
      console.error("[NotificationService] deleteDeadTokens error:", err.message);
      return 0;
    }
  }

  /**
   * Deletes a push token by its string value
   */
  public async deleteTokenByValue(token: string): Promise<number> {
    if (!token) return 0;
    try {
      const res = await this.pgPool.query(`DELETE FROM push_tokens WHERE token = $1`, [token]);
      return res.rowCount || 0;
    } catch (err: any) {
      console.error("[NotificationService] deleteTokenByValue error:", err.message);
      return 0;
    }
  }

  /**
   * Internal FCM v1 HTTP API Dispatcher
   */
  private async dispatchFcmV1Message(fcmMessage: FcmV1Message): Promise<void> {
    const projectId = this.fcmProjectId || "ai-studio-310a44ff-94b7-4761-a048-94281283abc2";
    const endpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

    const token = await this.getValidGoogleAuthToken();
    if (!token) {
      // If server doesn't have OAuth credentials configured, log and return gracefully
      return;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message: fcmMessage }),
    });

    if (!response.ok) {
      const errText = await response.text();
      let parsedError: any = {};
      try {
        parsedError = JSON.parse(errText);
      } catch {}

      const errorCode =
        parsedError.error?.details?.[0]?.errorCode ||
        parsedError.error?.status ||
        parsedError.error?.message ||
        "";

      const err = new Error(`FCM v1 error (${response.status}): ${errText}`);
      (err as any).statusCode = response.status;
      (err as any).errorCode = errorCode;
      (err as any).rawError = errText;
      throw err;
    }
  }

  /**
   * Retrieves Google OAuth2 access token for FCM v1 authentication
   */
  private async getValidGoogleAuthToken(): Promise<string | null> {
    const cached = await this.redis.get("fcm:oauth:token");
    if (cached) return cached;

    // Check if process environment provides service account credentials
    const serviceAccountKey = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (!serviceAccountKey) {
      return null;
    }

    try {
      const sa = JSON.parse(serviceAccountKey);
      const now = Math.floor(Date.now() / 1000);
      const jwtHeader = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
      const jwtClaimSet = Buffer.from(
        JSON.stringify({
          iss: sa.client_email,
          scope: "https://www.googleapis.com/auth/firebase.messaging",
          aud: "https://oauth2.googleapis.com/token",
          exp: now + 3600,
          iat: now,
        })
      ).toString("base64url");

      const crypto = await import("crypto");
      const sign = crypto.createSign("RSA-SHA256");
      sign.update(`${jwtHeader}.${jwtClaimSet}`);
      const signature = sign.sign(sa.private_key, "base64url");
      const assertion = `${jwtHeader}.${jwtClaimSet}.${signature}`;

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${assertion}`,
      });

      if (tokenRes.ok) {
        const json = await tokenRes.json();
        await this.redis.set("fcm:oauth:token", json.access_token, "EX", 3300);
        return json.access_token;
      }
    } catch (e: any) {
      console.warn("[NotificationService] OAuth Token Fetch Warning:", e.message);
    }

    return null;
  }
}
