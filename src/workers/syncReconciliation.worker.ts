import cron, { ScheduledTask } from "node-cron";
import { Pool, PoolClient } from "pg";
import Redis from "ioredis";
import crypto from "crypto";

export interface ReconciliationReport {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  totalChecked: number;
  missingInSecondary: number;
  versionDriftsRepaired: number;
  orphanedPurged: number;
  errorsCount: number;
  discrepancies: Array<{
    entityType: string;
    entityId: string;
    issue: "MISSING_IN_SECONDARY" | "VERSION_DRIFT" | "ORPHAN_IN_SECONDARY";
    primaryVersion?: number;
    secondaryVersion?: number;
    actionTaken: string;
  }>;
}

export interface ReconciliationWorkerConfig {
  cronSchedule?: string; // Default: every 15 minutes '*/15 * * * *'
  lockTtlSeconds?: number;
  batchSize?: number;
  autoRepair?: boolean;
  gracePeriodMinutes?: number; // Mandatory grace period threshold (default: 30 minutes)
}

export class SyncReconciliationWorker {
  private primaryPool: Pool;
  private secondaryPool: Pool;
  private redis: Redis;
  private config: Required<ReconciliationWorkerConfig>;
  private cronJob: ScheduledTask | null = null;
  private isReconciling: boolean = false;

  constructor(
    primaryPool: Pool,
    secondaryPool: Pool,
    redisClient: Redis,
    config?: ReconciliationWorkerConfig
  ) {
    this.primaryPool = primaryPool;
    this.secondaryPool = secondaryPool;
    this.redis = redisClient;
    this.config = {
      cronSchedule: config?.cronSchedule || "*/15 * * * *",
      lockTtlSeconds: config?.lockTtlSeconds || 600, // 10 minutes max lock duration
      batchSize: config?.batchSize || 200,
      autoRepair: config?.autoRepair ?? true,
      gracePeriodMinutes: config?.gracePeriodMinutes ?? 30, // 30-minute mandatory grace period
    };
  }

  /**
   * Start scheduled cron task
   */
  public start(): void {
    if (this.cronJob) return;
    console.info(`[SyncReconciliationWorker] Scheduling periodic reconciliation: ${this.config.cronSchedule}`);

    this.cronJob = cron.schedule(this.config.cronSchedule, async () => {
      try {
        await this.runReconciliationCycle();
      } catch (err: any) {
        console.error("[SyncReconciliationWorker] Critical cycle failure:", err.message);
      }
    });
  }

  public stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    console.info("[SyncReconciliationWorker] Cron task stopped.");
  }

  /**
   * Run a single reconciliation cycle protected by a Redis distributed lock
   */
  public async runReconciliationCycle(): Promise<ReconciliationReport | null> {
    if (this.isReconciling) {
      console.warn("[SyncReconciliationWorker] Cycle already in progress locally. Skipping.");
      return null;
    }

    const lockKey = "lock:reconciliation:cron";
    const acquired = await this.redis.set(lockKey, "1", "EX", this.config.lockTtlSeconds, "NX");
    if (!acquired) {
      console.info("[SyncReconciliationWorker] Another cluster replica holds the reconciliation lock.");
      return null;
    }

    this.isReconciling = true;
    const startTime = Date.now();
    console.info("[SyncReconciliationWorker] === Starting Self-Healing Reconciliation Cycle ===");

    const report: ReconciliationReport = {
      startedAt: new Date(startTime).toISOString(),
      completedAt: "",
      durationMs: 0,
      totalChecked: 0,
      missingInSecondary: 0,
      versionDriftsRepaired: 0,
      orphanedPurged: 0,
      errorsCount: 0,
      discrepancies: [],
    };

    let pClient: PoolClient | null = null;
    let sClient: PoolClient | null = null;

    try {
      pClient = await this.primaryPool.connect();
      sClient = await this.secondaryPool.connect();

      // 1. Reconcile User Accounts
      await this.reconcileAccounts(pClient, sClient, report);

      report.completedAt = new Date().toISOString();
      report.durationMs = Date.now() - startTime;

      console.info(
        `[SyncReconciliationWorker] Cycle Completed in ${report.durationMs}ms: Checked=${report.totalChecked}, MissingRepaired=${report.missingInSecondary}, DriftsRepaired=${report.versionDriftsRepaired}, OrphansPurged=${report.orphanedPurged}`
      );

      // Store latest reconciliation report in Redis for Admin Dashboard Telemetry
      await this.redis.set("telemetry:reconciliation:latest", JSON.stringify(report), "EX", 604800);

      return report;
    } catch (err: any) {
      report.errorsCount++;
      console.error("[SyncReconciliationWorker] Error during reconciliation execution:", err);
      throw err;
    } finally {
      this.isReconciling = false;
      if (pClient) pClient.release();
      if (sClient) sClient.release();
      await this.redis.del(lockKey).catch(() => {});
    }
  }

  /**
   * Compares accounts between Primary Master and Secondary Consumer
   * Incorporates mandatory 30-minute grace period threshold to prevent race conditions with in-flight webhooks
   */
  private async reconcileAccounts(
    primary: PoolClient,
    secondary: PoolClient,
    report: ReconciliationReport
  ): Promise<void> {
    const graceMinutes = this.config.gracePeriodMinutes;

    // 1. Fetch active accounts from Primary that exceed the mandatory 30-minute grace period
    // Ensures in-flight transactional outbox events and webhook retries have completed
    const pResult = await primary.query(
      `SELECT barcode, status, is_deleted, parent_phone, student_name, grade, 
              role, EXTRACT(EPOCH FROM updated_at) * 1000 AS version, updated_at, created_at
       FROM user_accounts
       WHERE is_deleted = FALSE 
         AND created_at < NOW() - ($1 || ' minutes')::interval 
         AND updated_at < NOW() - ($1 || ' minutes')::interval`,
      [graceMinutes]
    );

    // 2. Fetch all existing Primary barcodes (including fresh ones) to guard against false-positive orphan detection
    const allPrimaryRes = await primary.query(
      `SELECT barcode FROM user_accounts WHERE is_deleted = FALSE`
    );
    const allExistingPrimaryBarcodes = new Set<string>(allPrimaryRes.rows.map((r) => r.barcode));

    // 3. Fetch Secondary tracking state filtered by grace period to avoid fighting recent webhook receipts
    const sResult = await secondary.query(
      `SELECT entity_id AS barcode, version, checksum, status, last_synced_at
       FROM entity_sync_tracker
       WHERE entity_type = 'account'
         AND last_synced_at < NOW() - ($1 || ' minutes')::interval`,
      [graceMinutes]
    );

    const secondaryMap = new Map<string, { version: number; checksum: string; status: string; lastSyncedAt: Date }>();
    sResult.rows.forEach((r) => {
      secondaryMap.set(r.barcode, {
        version: Number(r.version),
        checksum: r.checksum,
        status: r.status,
        lastSyncedAt: new Date(r.last_synced_at),
      });
    });

    for (const pRow of pResult.rows) {
      const barcode = pRow.barcode;
      report.totalChecked++;

      const pVersion = Math.floor(Number(pRow.version));
      const sState = secondaryMap.get(barcode);

      if (!sState) {
        // Issue 1: MISSING_IN_SECONDARY (Outside grace period, record truly missing)
        report.missingInSecondary++;
        report.discrepancies.push({
          entityType: "account",
          entityId: barcode,
          issue: "MISSING_IN_SECONDARY",
          primaryVersion: pVersion,
          actionTaken: this.config.autoRepair ? "PUSHED_TO_OUTBOX" : "REPORTED",
        });

        if (this.config.autoRepair) {
          await this.enqueueOutboxRepair(primary, "account", barcode, "CREATED", pVersion, pRow);
        }
      } else if (pVersion > sState.version) {
        // Issue 2: VERSION_DRIFT (Secondary missed webhook or dropped update outside grace window)
        report.versionDriftsRepaired++;
        report.discrepancies.push({
          entityType: "account",
          entityId: barcode,
          issue: "VERSION_DRIFT",
          primaryVersion: pVersion,
          secondaryVersion: sState.version,
          actionTaken: this.config.autoRepair ? "ENQUEUED_LATEST_STATE" : "REPORTED",
        });

        if (this.config.autoRepair) {
          await this.enqueueOutboxRepair(primary, "account", barcode, "UPDATED", pVersion, pRow);
        }
      }
    }

    // Issue 3: ORPHAN_IN_SECONDARY (Purged from Primary > 30 mins ago, but lingering in Secondary)
    for (const [barcode, sState] of secondaryMap.entries()) {
      if (!allExistingPrimaryBarcodes.has(barcode)) {
        report.orphanedPurged++;
        report.discrepancies.push({
          entityType: "account",
          entityId: barcode,
          issue: "ORPHAN_IN_SECONDARY",
          secondaryVersion: sState.version,
          actionTaken: this.config.autoRepair ? "ENQUEUED_CASCADE_DELETE" : "REPORTED",
        });

        if (this.config.autoRepair) {
          await this.enqueueOutboxRepair(primary, "account", barcode, "DELETED", Date.now(), { barcode });
        }
      }
    }
  }

  /**
   * Enqueues an urgent repair event into Primary sync_outbox
   */
  private async enqueueOutboxRepair(
    primary: PoolClient,
    entityType: string,
    entityId: string,
    eventType: string,
    version: number,
    payload: any
  ): Promise<void> {
    const rawPayload = JSON.stringify(payload);
    const checksum = crypto.createHash("sha256").update(rawPayload).digest("hex");
    const eventId = `repair-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const idempotencyKey = crypto
      .createHash("sha256")
      .update(`repair:${entityType}:${entityId}:${version}:${eventType}`)
      .digest("hex");

    await primary.query(
      `INSERT INTO sync_outbox (
         event_id, idempotency_key, aggregate_type, aggregate_id, 
         event_type, version, payload, checksum, status, 
         retry_count, max_retries, next_retry_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', 0, 5, CURRENT_TIMESTAMP)
       ON CONFLICT (idempotency_key) DO UPDATE 
         SET status = 'PENDING', next_retry_at = CURRENT_TIMESTAMP`,
      [eventId, idempotencyKey, entityType, entityId, eventType, version, rawPayload, checksum]
    );
  }
}
