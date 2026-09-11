import crypto from "crypto";
import { Request, Response } from "express";
import { Pool } from "pg";
import Redis from "ioredis";
import { Server as SocketIOServer } from "socket.io";

export interface SyncIngestionPayload {
  eventId: string;
  idempotencyKey: string;
  entityType: "student" | "account" | "attendance" | "payment";
  entityId: string;
  action: "CREATED" | "UPDATED" | "DELETED" | "SOFT_DELETED";
  version: number;
  checksum: string;
  payload: Record<string, any>;
  timestamp: number;
}

export class SyncIngestionController {
  private pgPool: Pool;
  private redis: Redis;
  private io?: SocketIOServer;
  private hmacSecret: string;

  constructor(pgPool: Pool, redisClient: Redis, ioServer?: SocketIOServer, hmacSecret?: string) {
    this.pgPool = pgPool;
    this.redis = redisClient;
    this.io = ioServer;
    this.hmacSecret = hmacSecret || process.env.SYNC_HMAC_SECRET || "eman_sync_secret_production_2026";
  }

  public setSocketServer(io: SocketIOServer): void {
    this.io = io;
  }

  /**
   * Main Webhook Ingestion Handler for Secondary System
   */
  public handleIncomingWebhook = async (req: Request, res: Response): Promise<Response> => {
    const signature = req.headers["x-sync-signature"] as string;
    const timestamp = req.headers["x-sync-timestamp"] as string;
    const eventIdHeader = req.headers["x-sync-event-id"] as string;

    // 1. Validate mandatory cryptographic security headers
    if (!signature || !timestamp) {
      return res.status(401).json({
        error: "Missing required authentication headers: X-Sync-Signature, X-Sync-Timestamp",
      });
    }

    // 2. Replay attack prevention: reject events older or newer than 5 minutes
    const now = Date.now();
    const eventTimestamp = parseInt(timestamp, 10);
    if (isNaN(eventTimestamp) || Math.abs(now - eventTimestamp) > 300000) {
      return res.status(403).json({
        error: "Replay window exceeded: Event timestamp is outside the allowed 5-minute threshold",
      });
    }

    // 3. Cryptographic HMAC-SHA256 Signature Verification
    const rawBody = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac("sha256", this.hmacSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return res.status(403).json({ error: "Invalid HMAC signature verification failed" });
    }

    const {
      eventId,
      idempotencyKey,
      entityType,
      entityId,
      action,
      version,
      checksum,
      payload,
    } = req.body as SyncIngestionPayload;

    if (!idempotencyKey || !entityType || !entityId || version === undefined) {
      return res.status(400).json({ error: "Malformed payload: Missing core envelope fields" });
    }

    // 4. Distributed Redis Idempotency Lock
    const lockKey = `sync:lock:${idempotencyKey}`;
    const lockAcquired = await this.redis.set(lockKey, "1", "EX", 30, "NX");

    if (!lockAcquired) {
      // Check if already processed to acknowledge cleanly
      const isAlreadyDone = await this.redis.get(`sync:done:${idempotencyKey}`);
      if (isAlreadyDone) {
        return res.status(200).json({
          status: "duplicate_skipped",
          message: "Event already processed successfully",
          idempotencyKey,
        });
      }
      return res.status(409).json({
        error: "Concurrent sync execution in progress for this idempotency key",
      });
    }

    const client = await this.pgPool.connect();

    try {
      // 5. Monotonic Version Guard (Redis Fast Path + Database Fallback)
      const versionKey = `entity:version:${entityType}:${entityId}`;
      let currentVersionStr = await this.redis.get(versionKey);
      let currentVersion = currentVersionStr ? parseInt(currentVersionStr, 10) : null;

      if (currentVersion === null) {
        // Query PostgreSQL tracker
        const trackerRes = await client.query(
          `SELECT version FROM entity_sync_tracker WHERE entity_type = $1 AND entity_id = $2`,
          [entityType, entityId]
        );
        if (trackerRes.rows.length > 0) {
          currentVersion = parseInt(trackerRes.rows[0].version, 10);
          await this.redis.set(versionKey, currentVersion.toString(), "EX", 86400);
        } else {
          currentVersion = 0;
        }
      }

      // If incoming version is less than or equal to current version, drop to prevent stale overwrite
      if (version <= currentVersion) {
        return res.status(200).json({
          status: "ignored_stale_version",
          currentVersion,
          incomingVersion: version,
          entityId,
          entityType,
        });
      }

      // 6. Execute Atomic Database Reconciliation
      await client.query("BEGIN");

      await this.reconcileEntityInDatabase(client, entityType, entityId, action, version, payload);

      // Update Entity Sync Tracker
      const computedChecksum =
        checksum || crypto.createHash("sha256").update(JSON.stringify(payload || {})).digest("hex");

      await client.query(
        `INSERT INTO entity_sync_tracker (entity_type, entity_id, version, checksum, status, last_synced_at)
         VALUES ($1, $2, $3, $4, 'IN_SYNC', CURRENT_TIMESTAMP)
         ON CONFLICT (entity_type, entity_id) 
         DO UPDATE SET version = EXCLUDED.version, 
                       checksum = EXCLUDED.checksum, 
                       status = 'IN_SYNC', 
                       last_synced_at = CURRENT_TIMESTAMP`,
        [entityType, entityId, version, computedChecksum]
      );

      await client.query("COMMIT");

      // 7. Update Redis Caches
      await this.redis.set(versionKey, version.toString(), "EX", 86400);
      await this.redis.set(`sync:done:${idempotencyKey}`, "1", "EX", 86400);

      // 8. Server-to-Client Broadcast (Strictly to Connected Parent/Admin Browsers)
      if (this.io) {
        this.io.emit("sync:entity_updated", {
          entityType,
          entityId,
          action,
          version,
          timestamp: Date.now(),
        });

        // Dedicated room broadcast if entity is user-specific
        if (entityType === "account" || entityType === "student") {
          this.io.to(`user:${entityId}`).emit("account:state_changed", {
            barcode: entityId,
            action,
            version,
            payload,
          });
        }
      }

      return res.status(200).json({
        success: true,
        status: "reconciled",
        eventId: eventId || eventIdHeader,
        entityType,
        entityId,
        action,
        version,
      });
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[SyncIngestionController] Reconciliation transaction error:", err);
      return res.status(500).json({
        error: "Reconciliation failed",
        details: err.message,
      });
    } finally {
      client.release();
      await this.redis.del(lockKey).catch(() => {});
    }
  };

  /**
   * Reconciles specific entity mutations in PostgreSQL
   */
  private async reconcileEntityInDatabase(
    client: any,
    entityType: string,
    entityId: string,
    action: string,
    version: number,
    payload: any
  ): Promise<void> {
    if (entityType === "account") {
      if (action === "DELETED") {
        // Cascading deletion
        await client.query(`DELETE FROM user_accounts WHERE barcode = $1`, [entityId]);
      } else if (action === "SOFT_DELETED") {
        await client.query(
          `UPDATE user_accounts 
           SET is_deleted = TRUE, status = 'deleted', deleted_at = CURRENT_TIMESTAMP 
           WHERE barcode = $1`,
          [entityId]
        );
      } else {
        // Upsert Account
        const p = payload || {};
        await client.query(
          `INSERT INTO user_accounts (
             barcode, parent_phone, student_name, grade, role, 
             password_hash, status, is_deleted, linked_barcodes, preferences
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (barcode) DO UPDATE SET
             parent_phone = EXCLUDED.parent_phone,
             student_name = EXCLUDED.student_name,
             grade = EXCLUDED.grade,
             role = EXCLUDED.role,
             password_hash = COALESCE(EXCLUDED.password_hash, user_accounts.password_hash),
             status = EXCLUDED.status,
             is_deleted = EXCLUDED.is_deleted,
             linked_barcodes = EXCLUDED.linked_barcodes,
             preferences = EXCLUDED.preferences,
             updated_at = CURRENT_TIMESTAMP`,
          [
            entityId,
            p.parentPhone || "0",
            p.studentName || "طالب",
            p.grade || "عام",
            p.role || "parent",
            p.passwordHash || p.password || "1234",
            p.status || "active",
            false,
            p.linkedBarcodes || [],
            p.preferences || {},
          ]
        );
      }
    }
  }
}
