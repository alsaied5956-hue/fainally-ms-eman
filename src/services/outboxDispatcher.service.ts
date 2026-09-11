import crypto from "crypto";
import { Pool, PoolClient } from "pg";
import Redis from "ioredis";

export interface OutboxEvent {
  id?: string;
  eventId: string;
  idempotencyKey: string;
  aggregateType: string;
  aggregateId: string;
  eventType: "CREATED" | "UPDATED" | "DELETED" | "SOFT_DELETED";
  version: number;
  payload: Record<string, any>;
  checksum?: string;
  status?: "PENDING" | "PROCESSING" | "PROCESSED" | "FAILED" | "DEAD_LETTER";
  retryCount?: number;
  maxRetries?: number;
  nextRetryAt?: Date;
  errorMessage?: string;
  createdAt?: Date;
}

export interface DispatcherConfig {
  webhookUrl: string;
  hmacSecret: string;
  batchSize?: number;
  pollIntervalMs?: number;
  lockTtlSeconds?: number;
  requestTimeoutMs?: number;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  purgeIntervalMs?: number;
  retentionDays?: number;
}

export class OutboxDispatcherService {
  private pgPool: Pool;
  private redis: Redis;
  private config: Required<DispatcherConfig>;
  private isRunning: boolean = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private purgeTimer: NodeJS.Timeout | null = null;

  constructor(pgPool: Pool, redisClient: Redis, config: DispatcherConfig) {
    this.pgPool = pgPool;
    this.redis = redisClient;
    this.config = {
      webhookUrl: config.webhookUrl || process.env.SECONDARY_WEBHOOK_URL || "http://localhost:3000/api/sync/events",
      hmacSecret: config.hmacSecret || process.env.SYNC_HMAC_SECRET || "eman_sync_secret_production_2026",
      batchSize: config.batchSize || 50,
      pollIntervalMs: config.pollIntervalMs || 2000,
      lockTtlSeconds: config.lockTtlSeconds || 15,
      requestTimeoutMs: config.requestTimeoutMs || 8000,
      baseRetryDelayMs: config.baseRetryDelayMs || 1000,
      maxRetryDelayMs: config.maxRetryDelayMs || 60000,
      purgeIntervalMs: config.purgeIntervalMs || 3600000, // Every 1 hour
      retentionDays: config.retentionDays || 7, // 7 days retention
    };
  }

  /**
   * Records a domain event atomically inside an existing database transaction client
   */
  public async recordTransactionalEvent(
    client: PoolClient,
    event: Omit<OutboxEvent, "id" | "status" | "retryCount" | "createdAt" | "checksum">
  ): Promise<string> {
    const payloadString = JSON.stringify(event.payload);
    const checksum = crypto.createHash("sha256").update(payloadString).digest("hex");
    const eventId = event.eventId || `evt-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const idempotencyKey =
      event.idempotencyKey ||
      crypto.createHash("sha256").update(`${event.aggregateType}:${event.aggregateId}:${event.version}:${event.eventType}`).digest("hex");

    const query = `
      INSERT INTO sync_outbox (
        event_id, idempotency_key, aggregate_type, aggregate_id, 
        event_type, version, payload, checksum, status, 
        retry_count, max_retries, next_retry_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', 0, 10, CURRENT_TIMESTAMP)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id;
    `;

    const result = await client.query(query, [
      eventId,
      idempotencyKey,
      event.aggregateType,
      event.aggregateId,
      event.eventType,
      event.version,
      payloadString,
      checksum,
    ]);

    return result.rows[0]?.id || "";
  }

  /**
   * Start distributed polling worker with Redis distributed lock
   */
  public startPolling(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.info(`[OutboxDispatcher] Started polling worker targeting ${this.config.webhookUrl}`);

    const runLoop = async () => {
      if (!this.isRunning) return;
      try {
        await this.processOutboxBatch();
      } catch (err: any) {
        console.error("[OutboxDispatcher] Error processing outbox batch:", err.message);
      } finally {
        if (this.isRunning) {
          this.pollTimer = setTimeout(runLoop, this.config.pollIntervalMs);
        }
      }
    };

    runLoop();

    // Trigger immediate outbox purge check and schedule periodic maintenance
    const runPurgeLoop = async () => {
      if (!this.isRunning) return;
      try {
        await this.purgeProcessedEvents();
      } catch (err: any) {
        console.error("[OutboxDispatcher] Error running outbox table purge:", err.message);
      } finally {
        if (this.isRunning) {
          this.purgeTimer = setTimeout(runPurgeLoop, this.config.purgeIntervalMs);
        }
      }
    };

    runPurgeLoop();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.purgeTimer) {
      clearTimeout(this.purgeTimer);
      this.purgeTimer = null;
    }
    console.info("[OutboxDispatcher] Polling and purge workers stopped.");
  }

  /**
   * Automated cleanup query: deletes processed and dead-letter events older than retention period (default: 7 days)
   * Prevents database table bloat and eliminates lock contention on SKIP LOCKED worker queries
   */
  public async purgeProcessedEvents(retentionDays: number = this.config.retentionDays): Promise<number> {
    const lockKey = "lock:outbox:purge";
    const lockAcquired = await this.redis.set(lockKey, "1", "EX", 300, "NX");

    if (!lockAcquired) {
      return 0; // Another cluster worker is executing the purge cycle
    }

    try {
      const query = `
        DELETE FROM sync_outbox 
        WHERE status = 'PROCESSED' 
          AND created_at < NOW() - ($1 || ' days')::interval;
      `;

      const result = await this.pgPool.query(query, [retentionDays]);
      const deletedCount = result.rowCount || 0;

      if (deletedCount > 0) {
        console.info(
          `[OutboxDispatcher] Purge job successfully deleted ${deletedCount} processed outbox events older than ${retentionDays} days.`
        );
      }

      return deletedCount;
    } catch (err: any) {
      console.error("[OutboxDispatcher] Failed to execute outbox purge query:", err.message);
      return 0;
    } finally {
      await this.redis.del(lockKey).catch(() => {});
    }
  }

  /**
   * Acquire distributed lock and process pending outbox events
   */
  public async processOutboxBatch(): Promise<number> {
    const lockKey = "lock:outbox:dispatcher";
    const lockAcquired = await this.redis.set(lockKey, "1", "EX", this.config.lockTtlSeconds, "NX");

    if (!lockAcquired) {
      // Another replica in the cluster is already dispatching
      return 0;
    }

    const client = await this.pgPool.connect();
    let processedCount = 0;

    try {
      // 1. Fetch pending or retryable failed events with row locking (SKIP LOCKED prevents competing workers)
      const selectQuery = `
        SELECT id, event_id, idempotency_key, aggregate_type, aggregate_id,
               event_type, version, payload, checksum, retry_count, max_retries
        FROM sync_outbox
        WHERE status IN ('PENDING', 'FAILED')
          AND next_retry_at <= CURRENT_TIMESTAMP
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED;
      `;

      const { rows } = await client.query(selectQuery, [this.config.batchSize]);
      if (rows.length === 0) {
        return 0;
      }

      // Mark batch as PROCESSING
      const ids = rows.map((r) => r.id);
      await client.query(`UPDATE sync_outbox SET status = 'PROCESSING', last_attempt_at = CURRENT_TIMESTAMP WHERE id = ANY($1::uuid[])`, [ids]);

      for (const row of rows) {
        await this.dispatchSingleEvent(client, row);
        processedCount++;
      }

      return processedCount;
    } finally {
      client.release();
      // Release distributed lock
      await this.redis.del(lockKey).catch(() => {});
    }
  }

  /**
   * Dispatch single event to secondary system via HTTP Webhook with HMAC-SHA256 signature
   */
  private async dispatchSingleEvent(client: PoolClient, row: any): Promise<void> {
    const timestamp = Date.now().toString();
    const eventPayload = {
      eventId: row.event_id,
      idempotencyKey: row.idempotency_key,
      entityType: row.aggregate_type,
      entityId: row.aggregate_id,
      action: row.event_type,
      version: Number(row.version),
      checksum: row.checksum,
      payload: row.payload,
      timestamp: Number(timestamp),
    };

    const rawBody = JSON.stringify(eventPayload);
    const signature = crypto
      .createHmac("sha256", this.config.hmacSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

      const response = await fetch(this.config.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sync-Signature": signature,
          "X-Sync-Timestamp": timestamp,
          "X-Sync-Event-Id": row.event_id,
          "User-Agent": "PrimaryMaster-OutboxDispatcher/2.0",
        },
        body: rawBody,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        // Successfully delivered & acknowledged by secondary system
        await client.query(
          `UPDATE sync_outbox 
           SET status = 'PROCESSED', processed_at = CURRENT_TIMESTAMP, error_message = NULL 
           WHERE id = $1`,
          [row.id]
        );
      } else {
        const errorText = await response.text().catch(() => `HTTP ${response.status}`);
        await this.handleDispatchFailure(client, row, `Status ${response.status}: ${errorText}`);
      }
    } catch (err: any) {
      await this.handleDispatchFailure(client, row, err.message || "Network delivery error");
    }
  }

  /**
   * Handle webhook failure with exponential backoff + jitter
   */
  private async handleDispatchFailure(client: PoolClient, row: any, errorMessage: string): Promise<void> {
    const nextRetryCount = row.retry_count + 1;
    const isExhausted = nextRetryCount >= row.max_retries;

    if (isExhausted) {
      await client.query(
        `UPDATE sync_outbox 
         SET status = 'DEAD_LETTER', retry_count = $1, error_message = $2, last_attempt_at = CURRENT_TIMESTAMP 
         WHERE id = $3`,
        [nextRetryCount, errorMessage, row.id]
      );
      console.error(`[OutboxDispatcher] Event ${row.event_id} reached max retries (${row.max_retries}). Moved to DEAD_LETTER.`);
    } else {
      // Exponential backoff: base * 2^(retries) + jitter
      const exponentialDelay = this.config.baseRetryDelayMs * Math.pow(2, row.retry_count);
      const jitter = Math.floor(Math.random() * 1000);
      const delayMs = Math.min(exponentialDelay + jitter, this.config.maxRetryDelayMs);

      await client.query(
        `UPDATE sync_outbox 
         SET status = 'FAILED', 
             retry_count = $1, 
             next_retry_at = CURRENT_TIMESTAMP + ($2 || ' milliseconds')::interval, 
             error_message = $3,
             last_attempt_at = CURRENT_TIMESTAMP 
         WHERE id = $4`,
        [nextRetryCount, `${delayMs}`, errorMessage, row.id]
      );
      console.warn(`[OutboxDispatcher] Event ${row.event_id} failed (attempt ${nextRetryCount}). Retrying in ${delayMs}ms.`);
    }
  }
}
