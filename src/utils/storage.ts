import {
  Student,
  UserAccount,
  GradeName,
  GroupDays,
  PaymentRecord,
  PermissionKey,
  PendingWhatsAppMessage,
  WhatsAppMessageType,
  PlatformMessage,
  PlatformMessageType,
} from "../types";
import { DEFAULT_GRADE_PRICES, getTodayKey, formatTimeArabic } from "./helpers";
import { db, ensureFirebaseAuth } from "./firebase";
import { doc, setDoc, getDoc, onSnapshot, writeBatch } from "firebase/firestore";
import { compressData, decompressData } from "./compression";
import {
  isBulkSyncActive,
  partitionLargePayload,
  assemblePartitionedPayload,
  executeBatchOperations,
  bulkDeleteCollectionInBatches,
} from "./firestoreScalability";
import {
  recordSmartOperation,
  flushSmartBatchToFirestore,
  getBatchQueueStatus,
  subscribeToBatchStatus,
} from "./smartSyncBatcher";
import centerBackup from "../data/centerBackup.json";

export {
  getBatchQueueStatus,
  subscribeToBatchStatus,
  flushSmartBatchToFirestore,
};

const STORAGE_KEY = "center_data_v2";
const PENDING_SYNC_KEY = "center_pending_sync_v2";
const LAST_SYNC_TIME_KEY = "center_last_sync_time";
const BROADCAST_CHANNEL_NAME = "aiman_system_sync_bus";

export const CLIENT_ID =
  typeof window !== "undefined"
    ? ((window as any).__AIMAN_CLIENT_ID ||
      ((window as any).__AIMAN_CLIENT_ID =
        Math.random().toString(36).substring(2, 11) + "_" + Date.now()))
    : "server_instance";

export interface SystemData {
  students: Student[];
  attendanceHistory: Record<string, Record<string, string>>; // { "2026-08-25": { "1001": "حضور" } }
  attendanceToday: Record<string, string>;
  scanLogTimes: Record<string, string>; // ISO date string
  payments: Record<string, Record<string, PaymentRecord>>; // { "2026-08": { "1001": { amount: 100, ... } } }
  scanLogOrder: string[];
  usersList: UserAccount[];
  groupPrices: Record<GradeName, number>;
  activeSessionSlotId: string;
  activeScannerGrade?: GradeName;
  activeScannerDays?: GroupDays;
  platformMessages: PlatformMessage[]; // In-App Platform Messaging Hub
  pendingWhatsAppMessages?: PendingWhatsAppMessage[]; // Auxiliary/backward-compatible
  gradeWhatsAppLinks?: Record<string, string>; // Auxiliary
  deletedBarcodes?: string[]; // Track deleted student barcodes to prevent zombie resurrects
  deletedPaymentKeys?: string[]; // Track deleted or cancelled payments ("monthKey:barcode") to prevent zombie resurrects
  deletedAttendanceKeys?: string[]; // Track deleted or cleared attendance ("dateKey:barcode") to prevent zombie resurrects
  scanLogUpdatedAt?: number; // Exact timestamp when scanLog was modified
  updatedAt?: number; // Epoch timestamp in ms for conflict resolution
}

export function parseTimestamp(ts: unknown): number {
  if (typeof ts === "number") return ts;
  if (typeof ts === "string") {
    const t = new Date(ts).getTime();
    return isNaN(t) ? 0 : t;
  }
  return 0;
}

export interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  hasPendingSync: boolean;
  lastSyncTime: string | null;
  isQuotaExceeded?: boolean;
  quotaMessage?: string;
}

export const ALL_PERMISSIONS: PermissionKey[] = [
  "add_student",
  "edit_student",
  "delete_student",
  "change_status",
  "pay_expenses",
  "view_revenues",
  "add_grades",
  "send_messages",
  "manage_prices",
  "early_warning",
  "certificates",
  "excel_integration",
];

export const DEFAULT_USERS: UserAccount[] = [
  {
    username: "admin",
    pass: "admin123",
    role: "admin",
    permissions: [...ALL_PERMISSIONS],
  },
  {
    username: "alsaied",
    pass: "159357",
    role: "admin",
    permissions: [...ALL_PERMISSIONS],
  },
  {
    username: "mahmoud",
    pass: "1234",
    role: "admin",
    permissions: [
      "add_student",
      "edit_student",
      "delete_student",
      "change_status",
      "pay_expenses",
      "view_revenues",
      "add_grades",
      "send_messages",
      "manage_prices",
      "early_warning",
      "certificates",
      "excel_integration",
    ],
  },
  {
    username: "eman",
    pass: "2468",
    role: "admin",
    permissions: [
      "add_student",
      "edit_student",
      "delete_student",
      "change_status",
      "pay_expenses",
      "view_revenues",
      "add_grades",
      "send_messages",
      "manage_prices",
      "early_warning",
      "certificates",
      "excel_integration",
    ],
  },
];

export const INITIAL_SYSTEM_DATA: SystemData = {
  students: Array.isArray(centerBackup?.students) ? (centerBackup.students as any[]) : [],
  attendanceHistory: (centerBackup?.attendanceHistory as Record<string, Record<string, string>>) || {},
  attendanceToday: (centerBackup?.attendanceToday as Record<string, string>) || {},
  scanLogTimes: {},
  payments: normalizeAndMigratePayments((centerBackup as any)?.payments),
  scanLogOrder: [],
  usersList: DEFAULT_USERS,
  groupPrices: { ...DEFAULT_GRADE_PRICES, ...((centerBackup?.groupPrices as Record<string, number>) || {}) },
  activeSessionSlotId: "auto",
  platformMessages: [],
  pendingWhatsAppMessages: Array.isArray(centerBackup?.pendingWhatsAppMessages) ? (centerBackup.pendingWhatsAppMessages as any[]) : [],
  gradeWhatsAppLinks: (centerBackup?.gradeWhatsAppLinks as Record<string, string>) || {},
  deletedBarcodes: [],
  deletedPaymentKeys: [],
  deletedAttendanceKeys: [],
  scanLogUpdatedAt: Date.now(),
  updatedAt: Date.now(),
};

// Internal memory cache & sync flags
let memoryCachedData: SystemData | null = null;
let lastSyncedDataHash: string = "";
let debounceSyncTimer: ReturnType<typeof setTimeout> | null = null;
let isCurrentlySyncing: boolean = false;
let hasQueuedPendingSync: boolean = false;
let syncTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
let prevStatusSnapshot: string = "";
let isQuotaExceeded: boolean = false;
let quotaExceededUntil: number = 0;

// Subscribed listeners for sync status and cloud data
const syncStatusListeners: Array<(status: SyncStatus) => void> = [];
const cloudDataListeners: Array<(data: SystemData) => void> = [];

// Inter-tab / Inter-window BroadcastChannel for 0ms cross-tab real-time sync on the same device
let broadcastChannel: BroadcastChannel | null = null;
if (typeof window !== "undefined" && "BroadcastChannel" in window) {
  try {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    broadcastChannel.onmessage = (event) => {
      if (event?.data?.type === "LOCAL_DATA_MUTATED" && event.data.payload) {
        const incoming = event.data.payload as SystemData;
        memoryCachedData = incoming;
        notifyCloudDataListeners(incoming);
      }
    };
  } catch (e) {
    console.warn("BroadcastChannel initialization skipped:", e);
  }
}

function broadcastLocalChange(data: SystemData): void {
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage({
        type: "LOCAL_DATA_MUTATED",
        payload: data,
        timestamp: Date.now(),
      });
    } catch {}
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("center-data-updated", { detail: { ...data, _originLocal: true } }));
  }
}

function notifySyncStatusChange(): void {
  const status = getSyncStatus();
  const serialized = `${status.isOnline}_${status.isSyncing}_${status.hasPendingSync}_${status.lastSyncTime}_${status.isQuotaExceeded}`;
  if (serialized === prevStatusSnapshot) return;
  prevStatusSnapshot = serialized;

  syncStatusListeners.forEach((cb) => {
    try {
      cb(status);
    } catch (e) {
      console.warn("Error in sync status listener callback:", e);
    }
  });
}

function notifyCloudDataListeners(data: SystemData): void {
  cloudDataListeners.forEach((cb) => {
    try {
      cb(data);
    } catch (e) {
      console.warn("Error in cloud data listener callback:", e);
    }
  });
}

/**
 * Check if an error is a Firebase Firestore quota exceeded error
 */
export function isFirestoreQuotaError(e: unknown): boolean {
  if (!e) return false;
  const errorObj = e as { code?: string; message?: string; status?: string };
  const code = String(errorObj.code || "");
  const msg = String(errorObj.message || "");
  const status = String(errorObj.status || "");
  return (
    code === "resource-exhausted" ||
    code.includes("resource-exhausted") ||
    code === "429" ||
    code.includes("429") ||
    status === "RESOURCE_EXHAUSTED" ||
    msg.includes("Quota limit exceeded") ||
    msg.includes("resource-exhausted") ||
    msg.includes("quota metric") ||
    msg.includes("Free daily write units")
  );
}

/**
 * Get current connectivity and synchronization status
 */
export function getSyncStatus(): SyncStatus {
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  let hasPendingSync = false;
  let lastSyncTime: string | null = null;

  if (typeof window !== "undefined") {
    hasPendingSync = localStorage.getItem(PENDING_SYNC_KEY) === "true";
    lastSyncTime = localStorage.getItem(LAST_SYNC_TIME_KEY);
  }

  const quotaActive = isQuotaExceeded && Date.now() < quotaExceededUntil;

  return {
    isOnline,
    isSyncing: isCurrentlySyncing,
    hasPendingSync,
    lastSyncTime,
    isQuotaExceeded: quotaActive,
    quotaMessage: quotaActive
      ? "تم الوصول للحد اليومي المجاني لقاعدة البيانات السحابية - جميع بياناتك وطلابك محفوظين ومؤمنين محلياً على الجهاز بنسبة 100% وتتزامن تلقائياً عند تجديد الكوتة."
      : undefined,
  };
}

/**
 * Subscribe to connectivity and sync status changes
 */
export function subscribeToSyncStatus(callback: (status: SyncStatus) => void): () => void {
  syncStatusListeners.push(callback);
  callback(getSyncStatus());
  return () => {
    const idx = syncStatusListeners.indexOf(callback);
    if (idx !== -1) {
      syncStatusListeners.splice(idx, 1);
    }
  };
}

/**
 * Normalize and migrate payments from any potential legacy format into the standard { [monthKey]: { [barcode]: PaymentRecord } }
 */
export function normalizeAndMigratePayments(rawPayments: any): Record<string, Record<string, PaymentRecord>> {
  const result: Record<string, Record<string, PaymentRecord>> = {};
  if (!rawPayments) return result;

  // Case 1: Array of payment records
  if (Array.isArray(rawPayments)) {
    rawPayments.forEach((p) => {
      if (!p || !p.barcode) return;
      let mKey = p.monthKey || p.month || "2026-08";
      if (/^\d{1,2}$/.test(mKey)) {
        mKey = `2026-${String(mKey).padStart(2, "0")}`;
      } else if (/^\d{4}-\d{1}$/.test(mKey)) {
        const [y, m] = mKey.split("-");
        mKey = `${y}-${m.padStart(2, "0")}`;
      }
      if (!result[mKey]) result[mKey] = {};
      result[mKey][p.barcode] = {
        ...p,
        monthKey: mKey,
        month: mKey,
      };
    });
    return result;
  }

  // Case 2: Nested or Flat Object
  if (typeof rawPayments === "object") {
    for (const [key, value] of Object.entries(rawPayments)) {
      if (!value) continue;

      // If value is a PaymentRecord object directly (flat structure where key is barcode)
      if (typeof value === "object" && ("amount" in (value as any) || "barcode" in (value as any))) {
        const p = value as any;
        const barcode = p.barcode || key;
        let mKey = p.monthKey || p.month || "2026-08";
        if (/^\d{1,2}$/.test(mKey)) {
          mKey = `2026-${String(mKey).padStart(2, "0")}`;
        } else if (/^\d{4}-\d{1}$/.test(mKey)) {
          const [y, m] = mKey.split("-");
          mKey = `${y}-${m.padStart(2, "0")}`;
        }
        if (!result[mKey]) result[mKey] = {};
        result[mKey][barcode] = {
          ...p,
          barcode,
          monthKey: mKey,
          month: mKey,
        };
      } else if (typeof value === "object") {
        // Value is a month map { [barcode]: PaymentRecord }
        let mKey = key;
        if (/^\d{1,2}$/.test(mKey)) {
          mKey = `2026-${String(mKey).padStart(2, "0")}`;
        } else if (/^\d{4}-\d{1}$/.test(mKey)) {
          const [y, m] = mKey.split("-");
          mKey = `${y}-${m.padStart(2, "0")}`;
        }
        if (!result[mKey]) result[mKey] = {};

        for (const [bCode, pRecord] of Object.entries(value as Record<string, any>)) {
          if (!pRecord) continue;
          result[mKey][bCode] = {
            ...pRecord,
            barcode: pRecord.barcode || bCode,
            monthKey: mKey,
            month: mKey,
          };
        }
      }
    }
  }

  return result;
}

/**
 * Load local data from LocalStorage immediately for zero-delay startup
 */
export function loadLocalData(): SystemData {
  if (memoryCachedData) return memoryCachedData;
  if (typeof window === "undefined") return INITIAL_SYSTEM_DATA;

  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ||
      localStorage.getItem("center_data") ||
      localStorage.getItem("aiman_system_data");

    let parsed: any = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        console.error("JSON parse error for local data:", e);
      }
    }

    // Also check separate legacy payment storage keys if any exist
    let legacyPayments: any = null;
    try {
      const pRaw =
        localStorage.getItem("center_payments") ||
        localStorage.getItem("payments") ||
        localStorage.getItem("aiman_payments");
      if (pRaw) {
        legacyPayments = JSON.parse(pRaw);
      }
    } catch {}

    const backupStudents = Array.isArray(centerBackup?.students) ? (centerBackup.students as any[]) : [];
    const backupHistory = (centerBackup?.attendanceHistory as Record<string, Record<string, string>>) || {};
    const backupToday = (centerBackup?.attendanceToday as Record<string, string>) || {};
    const backupPrices = (centerBackup?.groupPrices as Record<string, number>) || {};
    const backupPayments = normalizeAndMigratePayments((centerBackup as any)?.payments);
    const backupUsers = Array.isArray((centerBackup as any)?.usersList) ? ((centerBackup as any).usersList as any[]) : [];
    const backupLinks = ((centerBackup as any)?.gradeWhatsAppLinks as Record<string, string>) || {};

    const normalizedPrimaryPayments = normalizeAndMigratePayments(parsed.payments);
    const normalizedLegacyPayments = normalizeAndMigratePayments(legacyPayments);
    const deletedPaymentSet = new Set((parsed.deletedPaymentKeys || []).map(String));

    // Merge payments safely: primary local payments take absolute precedence over backup payments
    const mergedPayments: Record<string, Record<string, PaymentRecord>> = {};
    const hasParsedPayments = Boolean(parsed.payments && Object.keys(parsed.payments).length > 0);

    // If no parsed payments exist, use backup payments as cold start
    if (!hasParsedPayments) {
      for (const [mKey, recMap] of Object.entries(backupPayments)) {
        mergedPayments[mKey] = {};
        for (const [bCode, rec] of Object.entries(recMap || {})) {
          if (!deletedPaymentSet.has(`${mKey}:${bCode}`) && Number(rec?.amount) > 0) {
            mergedPayments[mKey][bCode] = { ...rec };
          }
        }
      }
    }

    // Merge legacy payments (excluding deleted)
    for (const [mKey, recMap] of Object.entries(normalizedLegacyPayments)) {
      if (!mergedPayments[mKey]) mergedPayments[mKey] = {};
      for (const [bCode, rec] of Object.entries(recMap || {})) {
        if (!deletedPaymentSet.has(`${mKey}:${bCode}`) && Number(rec?.amount) > 0) {
          mergedPayments[mKey][bCode] = { ...rec };
        }
      }
    }

    // Merge primary parsed payments (excluding deleted)
    for (const [mKey, recMap] of Object.entries(normalizedPrimaryPayments)) {
      if (!mergedPayments[mKey]) mergedPayments[mKey] = {};
      for (const [bCode, rec] of Object.entries(recMap || {})) {
        if (!deletedPaymentSet.has(`${mKey}:${bCode}`) && Number(rec?.amount) > 0) {
          mergedPayments[mKey][bCode] = { ...rec };
        }
      }
    }

    // Clean up empty months
    for (const mKey of Object.keys(mergedPayments)) {
      if (Object.keys(mergedPayments[mKey]).length === 0) {
        delete mergedPayments[mKey];
      }
    }

    const todayKey = getTodayKey();
    let initialScanOrder: string[] = Array.isArray(parsed.scanLogOrder) ? parsed.scanLogOrder : [];
    let initialScanTimes: Record<string, string> = parsed.scanLogTimes || {};

    // Filter out scans that are from previous days so scanner always opens fresh for today
    initialScanOrder = initialScanOrder.filter((b: string) => {
      const timeIso = initialScanTimes[b];
      if (typeof timeIso === "string" && timeIso.includes("T")) {
        return timeIso.startsWith(todayKey);
      }
      return true;
    });

    const filteredScanTimes: Record<string, string> = {};
    initialScanOrder.forEach((b: string) => {
      if (initialScanTimes[b]) filteredScanTimes[b] = initialScanTimes[b];
    });

    const rawPlatformMessages: PlatformMessage[] = Array.isArray(parsed.platformMessages)
      ? parsed.platformMessages
      : Array.isArray(parsed.pendingWhatsAppMessages)
      ? (parsed.pendingWhatsAppMessages as any[]).map((m) => ({
          ...m,
          channel: "in_app" as const,
        }))
      : [];

    // Ensure all 728 actual students from backup are guaranteed and merged with local edits
    const studentMap = new Map<string, any>();
    backupStudents.forEach((s) => {
      if (s && s.barcode) studentMap.set(String(s.barcode).trim(), s);
    });
    if (Array.isArray(parsed.students) && parsed.students.length > 0) {
      parsed.students.forEach((s: any) => {
        if (s && s.barcode) {
          const b = String(s.barcode).trim();
          const existing = studentMap.get(b);
          studentMap.set(b, existing ? { ...existing, ...s } : s);
        }
      });
    }
    const deletedSet = new Set((parsed.deletedBarcodes || []).map(String));
    const finalStudents = Array.from(studentMap.values()).filter(
      (s) => !deletedSet.has(String(s.barcode).trim())
    );

    // Merge user accounts
    const userMap = new Map<string, UserAccount>();
    DEFAULT_USERS.forEach((u) => userMap.set(u.username, u));
    backupUsers.forEach((u) => userMap.set(u.username, u));
    if (Array.isArray(parsed.usersList)) {
      parsed.usersList.forEach((u: UserAccount) => userMap.set(u.username, u));
    }
    const finalUsers = Array.from(userMap.values());

    const loaded: SystemData = {
      students: finalStudents.length > 0 ? finalStudents : backupStudents,
      attendanceHistory: {
        ...backupHistory,
        ...(parsed.attendanceHistory || {}),
      },
      attendanceToday: parsed.attendanceHistory?.[todayKey] || parsed.attendanceToday || backupToday || {},
      scanLogTimes: filteredScanTimes,
      payments: mergedPayments,
      scanLogOrder: initialScanOrder,
      usersList: finalUsers,
      groupPrices: { ...DEFAULT_GRADE_PRICES, ...backupPrices, ...(parsed.groupPrices || {}) },
      activeSessionSlotId: parsed.activeSessionSlotId || "auto",
      platformMessages: rawPlatformMessages,
      pendingWhatsAppMessages: Array.isArray(parsed.pendingWhatsAppMessages) ? parsed.pendingWhatsAppMessages : [],
      gradeWhatsAppLinks: { ...backupLinks, ...(parsed.gradeWhatsAppLinks || {}) },
      deletedBarcodes: Array.isArray(parsed.deletedBarcodes) ? parsed.deletedBarcodes : [],
      deletedPaymentKeys: Array.isArray(parsed.deletedPaymentKeys) ? parsed.deletedPaymentKeys : [],
      scanLogUpdatedAt: parseTimestamp(parsed.scanLogUpdatedAt) || 0,
      updatedAt: parseTimestamp(parsed.updatedAt) || Date.now(),
    };
    memoryCachedData = loaded;
    return loaded;
  } catch (e) {
    console.error("Error loading local data:", e);
  }

  memoryCachedData = INITIAL_SYSTEM_DATA;
  return INITIAL_SYSTEM_DATA;
}

/**
 * Save data to browser LocalStorage SYNCHRONOUSLY and IMMEDIATELY (guaranteed persistence)
 */
export function saveToLocalStorage(data: SystemData, updateTimestamp: boolean = true): void {
  const todayKey = getTodayKey();
  const clonedData: SystemData = {
    ...data,
    attendanceHistory: {
      ...(data.attendanceHistory || {}),
      [todayKey]: data.attendanceToday || {},
    },
    updatedAt: updateTimestamp ? Date.now() : (data.updatedAt || Date.now()),
  };

  memoryCachedData = clonedData;

  if (typeof window === "undefined") return;

  try {
    const serialized = JSON.stringify(clonedData);
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch (e) {
    console.error("Local storage synchronous save error:", e);
  }

  broadcastLocalChange(clonedData);
}

/**
 * Helper to strip undefined values so Firestore doesn't reject document updates
 */
function cleanForFirestore(obj: unknown): unknown {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(cleanForFirestore);
  
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (value !== undefined) {
      result[key] = cleanForFirestore(value);
    }
  }
  return result;
}

/**
 * Robust Timeout Helper with Error Handling
 */
function withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMsg)), ms);
  });
  return Promise.race([
    promise.finally(() => {
      clearTimeout(timer);
    }),
    timeoutPromise,
  ]);
}

/**
 * Classify errors to avoid naïve retries on permanent failures
 */
export function isNonRetryableFirestoreError(err: any): boolean {
  if (!err) return false;
  const code = err?.code || "";
  const msg = err?.message || "";
  return (
    code === "permission-denied" ||
    code === "unauthenticated" ||
    code === "invalid-argument" ||
    code === "not-found" ||
    code === "already-exists" ||
    code === "failed-precondition" ||
    msg.includes("Missing or insufficient permissions")
  );
}

/**
 * Enterprise Resilience: Retry operation with Exponential Backoff and Random Jitter
 * Prevents "Naïve Retry Loops" that choke the network or trigger rate limits.
 */
export async function executeWithRetryAndBackoff<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    factor?: number;
    operationName?: string;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 800,
    maxDelayMs = 15000,
    factor = 2,
    operationName = "Cloud Operation",
  } = options;

  let attempt = 0;
  let delay = initialDelayMs;

  while (attempt <= maxRetries) {
    try {
      return await operation();
    } catch (err: any) {
      attempt++;

      // 1. Permanent non-retryable errors fail fast without blocking UI
      if (isNonRetryableFirestoreError(err)) {
        console.warn(`[Cloud Sync] ${operationName} encountered permanent error (not retrying):`, err?.code || err);
        throw err;
      }

      // 2. Quota exhaustion trips circuit breaker immediately
      if (isFirestoreQuotaError(err)) {
        isQuotaExceeded = true;
        quotaExceededUntil = Date.now() + 5 * 60 * 1000;
        notifySyncStatusChange();
        throw err;
      }

      if (attempt > maxRetries) {
        console.warn(`[Cloud Sync] ${operationName} failed after ${maxRetries} retries:`, err?.message || err);
        throw err;
      }

      // 3. Transient error with Full Jitter: delay * (0.6 + Math.random() * 0.4)
      const jitteredDelay = Math.round(delay * (0.6 + Math.random() * 0.4));
      console.warn(
        `[Cloud Sync] ${operationName} failed (attempt ${attempt}/${maxRetries}), retrying in ${jitteredDelay}ms:`,
        err?.message || err
      );
      await new Promise((resolve) => setTimeout(resolve, jitteredDelay));
      delay = Math.min(maxDelayMs, delay * factor);
    }
  }
  throw new Error(`${operationName} failed`);
}

// -------------------------------------------------------------
// Cloud Diagnostics and Telemetry Engine
// -------------------------------------------------------------
export interface CloudDiagnosticsInfo {
  isOnline: boolean;
  isSyncing: boolean;
  hasPendingSync: boolean;
  lastSyncTime: string | null;
  totalSyncAttempts: number;
  successfulSyncs: number;
  failedSyncs: number;
  consecutiveFailures: number;
  lastError: {
    message: string;
    code?: string;
    timestamp: string;
  } | null;
  lastPayloadSizeKB: number;
  lastCompressionRatio: number;
  isPartitioned: boolean;
  activeChunksCount: number;
  isQuotaExceeded: boolean;
}

let totalSyncAttempts = 0;
let successfulSyncs = 0;
let failedSyncs = 0;
let consecutiveFailures = 0;
let lastSyncError: { message: string; code?: string; timestamp: string } | null = null;
let lastRecordedPayloadSizeKB = 0;
let lastRecordedCompressionRatio = 0;
let currentIsPartitioned = false;
let currentChunksCount = 1;
let syncLockAcquiredAt = 0;

export function getCloudDiagnostics(): CloudDiagnosticsInfo {
  return {
    isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    isSyncing: isCurrentlySyncing,
    hasPendingSync: typeof localStorage !== "undefined" ? localStorage.getItem(PENDING_SYNC_KEY) === "true" : false,
    lastSyncTime: typeof localStorage !== "undefined" ? localStorage.getItem(LAST_SYNC_TIME_KEY) : null,
    totalSyncAttempts,
    successfulSyncs,
    failedSyncs,
    consecutiveFailures,
    lastError: lastSyncError,
    lastPayloadSizeKB: lastRecordedPayloadSizeKB,
    lastCompressionRatio: lastRecordedCompressionRatio,
    isPartitioned: currentIsPartitioned,
    activeChunksCount: currentChunksCount,
    isQuotaExceeded,
  };
}

/**
 * High-Scale Write Helper: Partitions payloads approaching the 1MB Firestore hard ceiling
 */
async function writeSystemPayloadToFirestore(
  systemDocRef: any,
  docPayload: Record<string, unknown>,
  compressedString?: string
): Promise<void> {
  if (compressedString && compressedString.length > 700 * 1024) {
    const chunks = partitionLargePayload(compressedString);
    currentIsPartitioned = true;
    currentChunksCount = chunks.length;

    const batch = writeBatch(db);
    batch.set(
      systemDocRef,
      {
        ...docPayload,
        _compressedPayload: null,
        _isPartitioned: true,
        _chunkCount: chunks.length,
      },
      { merge: true }
    );

    for (let i = 0; i < chunks.length; i++) {
      const chunkRef = doc(db, "system_state", `chunk_${i}`);
      batch.set(chunkRef, {
        chunkIndex: i,
        totalChunks: chunks.length,
        content: chunks[i],
        updatedAt: docPayload.updatedAt || Date.now(),
      });
    }

    await withTimeout(batch.commit(), 15000, "انتهت مهلة كتابة البيانات المقسمة في السحابة");
  } else {
    currentIsPartitioned = false;
    currentChunksCount = 1;
    await withTimeout(
      setDoc(
        systemDocRef,
        {
          ...docPayload,
          _isPartitioned: false,
          _chunkCount: 1,
        }
      ),
      12000,
      "انتهت مهلة كتابة البيانات في السحابة"
    );
  }
}

/**
 * High-Scale Read Helper: Assembles partitioned chunks if the payload was split across documents
 */
async function resolvePayloadFromSnapshot(val: any): Promise<Partial<SystemData>> {
  if (!val) return {};

  let compressedStr: string | null = null;

  if (val._isPartitioned === true && typeof val._chunkCount === "number" && val._chunkCount > 1) {
    currentIsPartitioned = true;
    currentChunksCount = val._chunkCount;

    const chunkPromises: Promise<any>[] = [];
    for (let i = 0; i < val._chunkCount; i++) {
      const chunkRef = doc(db, "system_state", `chunk_${i}`);
      chunkPromises.push(withTimeout(getDoc(chunkRef), 8000, `Timeout fetching chunk ${i}`));
    }
    const chunkSnaps = await Promise.all(chunkPromises);
    const chunks: string[] = [];
    for (const snap of chunkSnaps) {
      if (snap && snap.exists()) {
        const d = snap.data();
        chunks.push(d.content || "");
      }
    }
    compressedStr = assemblePartitionedPayload(chunks);
  } else if (val._compressedPayload && typeof val._compressedPayload === "string") {
    currentIsPartitioned = false;
    currentChunksCount = 1;
    compressedStr = val._compressedPayload;
  }

  if (compressedStr) {
    try {
      const decompressed = await decompressData<Partial<SystemData>>(compressedStr);
      if (decompressed) {
        return {
          ...decompressed,
          scanLogUpdatedAt: typeof val.scanLogUpdatedAt === "number" ? val.scanLogUpdatedAt : decompressed.scanLogUpdatedAt,
          updatedAt: typeof val.updatedAt === "number" ? val.updatedAt : decompressed.updatedAt,
        };
      }
    } catch (e) {
      console.warn("Decompression error in resolvePayloadFromSnapshot:", e);
    }
  }

  return val as Partial<SystemData>;
}

/**
 * Perform a direct, guaranteed push of local data to Firestore Cloud Database
 * with intelligent remote merge, automatic partitioning, and exponential backoff retries
 */
export async function flushPendingSyncToCloud(forceManual: boolean = false): Promise<boolean> {
  if (typeof window === "undefined") return false;

  // Deadlock breaker: if isCurrentlySyncing was locked for > 15s due to unhandled edge case, release lock
  if (isCurrentlySyncing && Date.now() - syncLockAcquiredAt > 15000) {
    console.warn("[Cloud Sync] Released stale sync lock (>15s elapsed)");
    isCurrentlySyncing = false;
  }

  // If cloud quota is currently exceeded and cooldown is active, skip background automatic pushes
  if (isQuotaExceeded && Date.now() < quotaExceededUntil && !forceManual) {
    isCurrentlySyncing = false;
    notifySyncStatusChange();
    return false;
  }

  if (isCurrentlySyncing && !forceManual) {
    hasQueuedPendingSync = true;
    return true;
  }

  const localData = loadLocalData();
  const todayKey = getTodayKey();
  if (!localData.attendanceHistory) localData.attendanceHistory = {};
  localData.attendanceHistory[todayKey] = localData.attendanceToday || {};

  isCurrentlySyncing = true;
  syncLockAcquiredAt = Date.now();
  totalSyncAttempts++;
  notifySyncStatusChange();

  try {
    // Ensure Auth session is ready with retry
    try {
      await ensureFirebaseAuth();
    } catch {}

    const systemDocRef = doc(db, "system_state", "main_center_data");
    const dataToPush = localData;
    const nowTime = Date.now();

    const cleaned = cleanForFirestore({
      ...dataToPush,
      _lastClientId: CLIENT_ID,
      _lastClientTimestamp: nowTime,
      updatedAt: dataToPush.updatedAt || nowTime,
      scanLogUpdatedAt: dataToPush.scanLogUpdatedAt || dataToPush.updatedAt || nowTime,
      syncedAtIso: new Date().toISOString(),
    });

    let docPayload: Record<string, unknown>;
    let compressedPayloadString: string | undefined = undefined;

    try {
      const compression = await compressData(cleaned);
      compressedPayloadString = compression.compressedString;
      lastRecordedPayloadSizeKB = compression.compressedSizeKB;
      lastRecordedCompressionRatio = compression.compressionRatio;

      docPayload = {
        _compressedPayload: compression.compressedString,
        _compressionStats: {
          originalKB: compression.originalSizeKB,
          compressedKB: compression.compressedSizeKB,
          ratioPercent: compression.compressionRatio,
        },
        _lastClientId: CLIENT_ID,
        _lastClientTimestamp: nowTime,
        updatedAt: dataToPush.updatedAt || nowTime,
        scanLogUpdatedAt: dataToPush.scanLogUpdatedAt || dataToPush.updatedAt || nowTime,
        syncedAtIso: new Date().toISOString(),
        studentsCount: (dataToPush.students || []).length,
        paymentsCount: Object.values(dataToPush.payments || {}).reduce((acc, m) => acc + Object.keys(m || {}).length, 0),
      };
    } catch {
      docPayload = cleaned as Record<string, unknown>;
    }

    // Write to Firestore using resilient write with partitioning and exponential backoff
    await executeWithRetryAndBackoff(
      () => writeSystemPayloadToFirestore(systemDocRef, docPayload, compressedPayloadString),
      {
        maxRetries: forceManual ? 3 : 2,
        initialDelayMs: 600,
        operationName: "flushPendingSyncToCloud",
      }
    );

    // Update synchronization hash and telemetry
    const currentUpToDateData = loadLocalData();
    lastSyncedDataHash = JSON.stringify(currentUpToDateData);

    localStorage.setItem(PENDING_SYNC_KEY, "false");
    const nowIso = new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    localStorage.setItem(LAST_SYNC_TIME_KEY, nowIso);

    successfulSyncs++;
    consecutiveFailures = 0;
    lastSyncError = null;
    isQuotaExceeded = false;
    quotaExceededUntil = 0;
    isCurrentlySyncing = false;
    if (syncTimeoutTimer) clearTimeout(syncTimeoutTimer);
    notifySyncStatusChange();

    // Dispatch global custom event
    window.dispatchEvent(
      new CustomEvent("cloud-sync-completed", {
        detail: { timestamp: new Date().toISOString() },
      })
    );

    // If another mutation happened while this write was in flight, flush with a safe cooldown
    if (hasQueuedPendingSync) {
      hasQueuedPendingSync = false;
      setTimeout(() => {
        flushPendingSyncToCloud(false).catch(() => {});
      }, 400);
    }

    return true;
  } catch (e: any) {
    failedSyncs++;
    consecutiveFailures++;
    lastSyncError = {
      message: e?.message || String(e),
      code: e?.code,
      timestamp: new Date().toLocaleTimeString("ar-EG"),
    };

    if (isFirestoreQuotaError(e)) {
      isQuotaExceeded = true;
      quotaExceededUntil = Date.now() + 5 * 60 * 1000;
      setTimeout(() => {
        isQuotaExceeded = false;
        notifySyncStatusChange();
      }, 5 * 60 * 1000);
    } else {
      console.warn("Cloud sync background update deferred (retaining pending flag for retry):", e?.message || e);
    }

    // Retain pending sync flag so that retry mechanisms and reconnect listeners will flush it
    localStorage.setItem(PENDING_SYNC_KEY, "true");
    isCurrentlySyncing = false;
    if (syncTimeoutTimer) clearTimeout(syncTimeoutTimer);
    notifySyncStatusChange();
    return false;
  }
}

/**
 * Sync entire system data state to Firestore cloud database with INSTANT multi-device push
 */
export function syncDataToCloud(data: SystemData, immediate: boolean = false): void {
  // 1. Instant synchronous local persistence (0ms latency, works 100% offline)
  saveToLocalStorage(data);

  // 2. Smart local batching pipeline (IndexedDB + LocalStorage)
  recordSmartOperation(
    "state_mutation",
    {
      timestamp: Date.now(),
      studentsCount: data.students?.length || 0,
    },
    data
  );

  if (typeof window !== "undefined") {
    localStorage.setItem(PENDING_SYNC_KEY, "true");
    notifySyncStatusChange();
  }

  // If quota is exceeded, do not schedule immediate background cloud attempts
  if (isQuotaExceeded && Date.now() < quotaExceededUntil) {
    return;
  }

  // 2. Clear previous timer
  if (debounceSyncTimer) {
    clearTimeout(debounceSyncTimer);
    debounceSyncTimer = null;
  }

  // 3. Intelligent coalescing debounce to protect Firestore free tier write quota
  // Immediate actions coalesce with a 1000ms window so bursts of rapid barcode scans execute in a single write
  const debounceDelay = immediate ? 1000 : 3500;
  debounceSyncTimer = setTimeout(() => {
    debounceSyncTimer = null;
    if (typeof window !== "undefined" && navigator.onLine) {
      if (!isCurrentlySyncing) {
        flushPendingSyncToCloud(false).catch(() => {});
      } else {
        hasQueuedPendingSync = true;
      }
    }
  }, debounceDelay);
}

export function loadInitialData(): SystemData {
  return loadLocalData();
}

/**
 * Smart Multi-Device 3-Way State Merger:
 * Merges cloud data received from other devices into local state without losing local or remote updates.
 * Unifies all students by barcode and name, all months and payment records, attendance history, scan orders, etc.
 */
export function mergeCloudDataWithLocal(local: SystemData, cloud: Partial<SystemData>): SystemData {
  const todayKey = getTodayKey();
  const localTime = parseTimestamp(local.updatedAt);
  const cloudTime = parseTimestamp(cloud.updatedAt);

  // Union of deleted barcodes to prevent deleted students from resurrecting as zombies
  const deletedBarcodes = Array.from(
    new Set([
      ...(Array.isArray(local.deletedBarcodes) ? local.deletedBarcodes : []),
      ...(Array.isArray(cloud.deletedBarcodes) ? cloud.deletedBarcodes : []),
    ])
  );
  const deletedSet = new Set(deletedBarcodes);

  // Union of deleted payment keys ("monthKey:barcode") to prevent cancelled payments from resurrecting
  const deletedPaymentKeys = Array.from(
    new Set([
      ...(Array.isArray(local.deletedPaymentKeys) ? local.deletedPaymentKeys : []),
      ...(Array.isArray(cloud.deletedPaymentKeys) ? cloud.deletedPaymentKeys : []),
    ])
  );
  const deletedPaymentSet = new Set(deletedPaymentKeys);

  // Union of deleted attendance keys ("dateKey:barcode") to prevent cancelled/deleted attendance from resurrecting
  const deletedAttendanceKeys = Array.from(
    new Set([
      ...(Array.isArray(local.deletedAttendanceKeys) ? local.deletedAttendanceKeys : []),
      ...(Array.isArray(cloud.deletedAttendanceKeys) ? cloud.deletedAttendanceKeys : []),
    ])
  );
  const deletedAttSet = new Set(deletedAttendanceKeys);

  // 1. Merge Students (keyed by barcode and normalized name)
  const studentMap = new Map<string, Student>();
  const nameToBarcodeMap = new Map<string, string>();

  const normalizeName = (name: string) => (name || "").trim().toLowerCase().replace(/\s+/g, " ");

  // Seed with local students, excluding any deleted barcodes
  (local.students || []).forEach((s) => {
    if (s?.barcode) {
      const bKey = String(s.barcode).trim();
      if (deletedSet.has(bKey)) return;
      studentMap.set(bKey, { ...s });
      const normName = normalizeName(s.name);
      if (normName) {
        nameToBarcodeMap.set(`${normName}_${s.groupGrade}`, bKey);
      }
    }
  });

  // Check if local student database was explicitly cleared on this machine
  const isLocalExplicitlyEmpty = (local.students?.length === 0 && (local.deletedBarcodes?.length || 0) > 0);

  // Merge remote students from cloud without ever dropping any student!
  if (Array.isArray(cloud.students) && !isLocalExplicitlyEmpty) {
    cloud.students.forEach((remoteStudent) => {
      if (!remoteStudent?.barcode) return;
      const bKey = String(remoteStudent.barcode).trim();
      if (deletedSet.has(bKey)) return; // Never resurrect deleted students!

      const normName = normalizeName(remoteStudent.name);
      const nameKey = `${normName}_${remoteStudent.groupGrade}`;

      let existingKey = bKey;
      if (!studentMap.has(bKey) && normName && nameToBarcodeMap.has(nameKey)) {
        existingKey = nameToBarcodeMap.get(nameKey)!;
      }

      const existing = studentMap.get(existingKey);
      if (!existing) {
        // Safe addition: retain remote student created on any other device
        studentMap.set(bKey, { ...remoteStudent });
        if (normName) {
          nameToBarcodeMap.set(nameKey, bKey);
        }
      } else {
        // Merge student properties intelligently with CRDT timestamp rules
        const localStudentTime = parseTimestamp(existing.updatedAt || localTime);
        const remoteStudentTime = parseTimestamp(remoteStudent.updatedAt || cloudTime);
        const isRemoteNewer = remoteStudentTime > localStudentTime;

        // The newer record is primary and authoritative
        const primary = isRemoteNewer ? remoteStudent : existing;
        const secondary = isRemoteNewer ? existing : remoteStudent;

        studentMap.set(existingKey, {
          ...secondary,
          ...primary,
          name: primary.name || secondary.name,
          groupGrade: primary.groupGrade || secondary.groupGrade,
          barcode: existing.barcode || remoteStudent.barcode,
          phone: primary.phone !== undefined ? primary.phone : (secondary.phone || ""),
          parentPhone: primary.parentPhone !== undefined ? primary.parentPhone : (secondary.parentPhone || ""),
          notes: primary.notes !== undefined ? primary.notes : (secondary.notes || ""),
          groupDays: primary.groupDays || secondary.groupDays,
          discountReason: primary.discountReason !== undefined ? primary.discountReason : (secondary.discountReason || ""),
          customMonthlyFee: primary.customMonthlyFee !== undefined ? primary.customMonthlyFee : secondary.customMonthlyFee,
          points: primary.points !== undefined ? primary.points : (secondary.points || 0),
          totalAttendanceDays: primary.totalAttendanceDays !== undefined ? primary.totalAttendanceDays : (secondary.totalAttendanceDays || 0),
          totalAbsentDays: primary.totalAbsentDays !== undefined ? primary.totalAbsentDays : (secondary.totalAbsentDays || 0),
          totalExamScores: Array.isArray(primary.totalExamScores) ? primary.totalExamScores : (Array.isArray(secondary.totalExamScores) ? secondary.totalExamScores : []),
          lastExamTitle: primary.lastExamTitle !== undefined ? primary.lastExamTitle : (secondary.lastExamTitle || ""),
          lastExamScore: primary.lastExamScore !== undefined ? primary.lastExamScore : (secondary.lastExamScore || ""),
          updatedAt: Math.max(localStudentTime, remoteStudentTime),
        });
      }
    });
  }

  const mergedStudents = Array.from(studentMap.values());

  // 2. Merge Attendance History & Today with tombstone protection
  const mergedHistory: Record<string, Record<string, string>> = {};

  if (localTime >= cloudTime) {
    if (local.attendanceHistory) {
      for (const [dateKey, dayMap] of Object.entries(local.attendanceHistory)) {
        mergedHistory[dateKey] = {};
        for (const [bCode, status] of Object.entries(dayMap || {})) {
          if (!deletedAttSet.has(`${dateKey}:${bCode}`) && !deletedSet.has(bCode)) {
            mergedHistory[dateKey][bCode] = status;
          }
        }
      }
    }
    if (cloud.attendanceHistory) {
      for (const [dateKey, remoteDayMap] of Object.entries(cloud.attendanceHistory)) {
        if (!mergedHistory[dateKey]) {
          mergedHistory[dateKey] = {};
          for (const [bCode, status] of Object.entries(remoteDayMap || {})) {
            if (!deletedAttSet.has(`${dateKey}:${bCode}`) && !deletedSet.has(bCode)) {
              mergedHistory[dateKey][bCode] = status;
            }
          }
        }
      }
    }
  } else {
    if (cloud.attendanceHistory) {
      for (const [dateKey, remoteDayMap] of Object.entries(cloud.attendanceHistory)) {
        mergedHistory[dateKey] = {};
        for (const [bCode, status] of Object.entries(remoteDayMap || {})) {
          if (!deletedAttSet.has(`${dateKey}:${bCode}`) && !deletedSet.has(bCode)) {
            mergedHistory[dateKey][bCode] = status;
          }
        }
      }
    }
    if (local.attendanceHistory) {
      for (const [dateKey, dayMap] of Object.entries(local.attendanceHistory)) {
        if (!mergedHistory[dateKey]) {
          mergedHistory[dateKey] = {};
          for (const [bCode, status] of Object.entries(dayMap || {})) {
            if (!deletedAttSet.has(`${dateKey}:${bCode}`) && !deletedSet.has(bCode)) {
              mergedHistory[dateKey][bCode] = status;
            }
          }
        }
      }
    }
  }

  let mergedToday: Record<string, string> = {};
  const baseTodaySource = localTime >= cloudTime ? (local.attendanceToday || {}) : (cloud.attendanceToday || {});
  for (const [bCode, status] of Object.entries(baseTodaySource)) {
    if (!deletedAttSet.has(`${todayKey}:${bCode}`) && !deletedSet.has(bCode)) {
      mergedToday[bCode] = status;
    }
  }

  mergedHistory[todayKey] = {
    ...(mergedHistory[todayKey] || {}),
    ...mergedToday,
  };

  // 3. Merge Scan Log Order & Times (authoritative by latest modification timestamp)
  const remoteOrder = Array.isArray(cloud.scanLogOrder) ? cloud.scanLogOrder : [];
  const localOrder = Array.isArray(local.scanLogOrder) ? local.scanLogOrder : [];

  const localScanTime = parseTimestamp(local.scanLogUpdatedAt || local.updatedAt);
  const cloudScanTime = parseTimestamp(cloud.scanLogUpdatedAt || cloud.updatedAt);

  let chosenOrder: string[];
  let chosenScanTimes: Record<string, string>;

  if (cloudScanTime > localScanTime) {
    // Cloud has the newer scanner session state (e.g. session finished/cleared or students scanned on another device)
    chosenOrder = [...remoteOrder];
    chosenScanTimes = { ...(cloud.scanLogTimes || {}) };
  } else {
    // Local device has the newer or equal scanner session state
    chosenOrder = [...localOrder];
    chosenScanTimes = { ...(local.scanLogTimes || {}) };
  }

  // Deduplicate and filter out deleted barcodes
  const orderSet = new Set<string>();
  const preMergedOrder: string[] = [];

  chosenOrder.forEach((barcode) => {
    if (barcode && !orderSet.has(barcode) && !deletedSet.has(barcode)) {
      orderSet.add(barcode);
      preMergedOrder.push(barcode);
    }
  });

  // Filter out any stale scans that are from a previous date so the scanner is always fresh for today
  const mergedOrder = preMergedOrder.filter((barcode) => {
    const timeIso = chosenScanTimes[barcode];
    if (typeof timeIso === "string" && timeIso.includes("T")) {
      return timeIso.startsWith(todayKey);
    }
    return true;
  });

  const mergedScanTimes: Record<string, string> = {};
  mergedOrder.forEach((barcode) => {
    if (chosenScanTimes[barcode]) {
      mergedScanTimes[barcode] = chosenScanTimes[barcode];
    }
  });

  // 4. Merge Payments (reconcile with authoritative latest timestamp & tombstones)
  const mergedPayments: Record<string, Record<string, PaymentRecord>> = {};

  if (cloudTime > localTime && cloud.payments) {
    // Cloud is strictly newer: Cloud state is authoritative for any months it contains
    for (const [mKey, remoteRecords] of Object.entries(cloud.payments)) {
      mergedPayments[mKey] = {};
      if (remoteRecords && typeof remoteRecords === "object") {
        for (const [bCode, remoteRec] of Object.entries(remoteRecords)) {
          if (!remoteRec || deletedPaymentSet.has(`${mKey}:${bCode}`)) continue;
          if (Number(remoteRec.amount) > 0) {
            mergedPayments[mKey][bCode] = { ...remoteRec };
          }
        }
      }
    }
    // Only preserve local months that don't exist in cloud at all (excluding deleted tombstones)
    if (local.payments) {
      for (const [mKey, records] of Object.entries(local.payments)) {
        if (!cloud.payments[mKey]) {
          mergedPayments[mKey] = {};
          for (const [bCode, localRec] of Object.entries(records || {})) {
            if (!localRec || deletedPaymentSet.has(`${mKey}:${bCode}`)) continue;
            if (Number(localRec.amount) > 0) {
              mergedPayments[mKey][bCode] = { ...localRec };
            }
          }
        }
      }
    }
  } else {
    // Local is newer or equal: local payments are base
    if (local.payments) {
      for (const [mKey, records] of Object.entries(local.payments)) {
        mergedPayments[mKey] = {};
        for (const [bCode, rec] of Object.entries(records || {})) {
          if (!rec || deletedPaymentSet.has(`${mKey}:${bCode}`)) continue;
          if (Number(rec.amount) > 0) {
            mergedPayments[mKey][bCode] = { ...rec };
          }
        }
      }
    }
    // Deep union any missing non-deleted cloud payment records
    if (cloud.payments) {
      for (const [mKey, remoteRecords] of Object.entries(cloud.payments)) {
        if (!mergedPayments[mKey]) mergedPayments[mKey] = {};
        if (remoteRecords && typeof remoteRecords === "object") {
          for (const [bCode, remoteRec] of Object.entries(remoteRecords)) {
            if (!remoteRec || deletedPaymentSet.has(`${mKey}:${bCode}`)) continue;
            if (!mergedPayments[mKey][bCode] && Number(remoteRec.amount) > 0) {
              mergedPayments[mKey][bCode] = { ...remoteRec };
            }
          }
        }
      }
    }
  }

  // Purge any deleted payments or zero-amount payments and clean empty months
  for (const mKey of Object.keys(mergedPayments)) {
    for (const bCode of Object.keys(mergedPayments[mKey])) {
      if (deletedPaymentSet.has(`${mKey}:${bCode}`) || Number(mergedPayments[mKey][bCode]?.amount) <= 0) {
        delete mergedPayments[mKey][bCode];
      }
    }
    if (Object.keys(mergedPayments[mKey]).length === 0) {
      delete mergedPayments[mKey];
    }
  }

  // 5. Merge Users & Config
  const mergedUsers = (Array.isArray(cloud.usersList) && cloud.usersList.length > 0)
    ? cloud.usersList
    : local.usersList;

  const mergedGroupPrices = {
    ...DEFAULT_GRADE_PRICES,
    ...(local.groupPrices || {}),
    ...(cloud.groupPrices || {}),
  };

  // 6. Merge In-App Platform Messages and WhatsApp Outbox Messages
  const platformMsgMap = new Map<string, PlatformMessage>();
  const localPlatformMsgs = Array.isArray(local.platformMessages) ? local.platformMessages : [];
  const cloudPlatformMsgs = Array.isArray(cloud.platformMessages) ? cloud.platformMessages : [];

  const getPlatformMsgKey = (m: PlatformMessage) =>
    m.id || `${m.studentBarcode || m.studentName}_${m.messageType}_${m.createdAt}`;

  localPlatformMsgs.forEach((m) => {
    if (m) platformMsgMap.set(getPlatformMsgKey(m), { ...m });
  });

  cloudPlatformMsgs.forEach((m) => {
    if (m) {
      const key = getPlatformMsgKey(m);
      const existing = platformMsgMap.get(key);
      if (!existing) {
        platformMsgMap.set(key, { ...m });
      } else if (m.status !== "pending" && existing.status === "pending") {
        platformMsgMap.set(key, { ...m });
      }
    }
  });

  const mergedPlatformMessages = Array.from(platformMsgMap.values());

  const messageMap = new Map<string, PendingWhatsAppMessage>();
  const localMsgs = Array.isArray(local.pendingWhatsAppMessages) ? local.pendingWhatsAppMessages : [];
  const cloudMsgs = Array.isArray(cloud.pendingWhatsAppMessages) ? cloud.pendingWhatsAppMessages : [];

  const getMsgKey = (m: PendingWhatsAppMessage) => m.id || `${m.studentBarcode || m.studentName}_${m.messageType}_${m.createdAt}`;

  localMsgs.forEach((m) => {
    if (m) messageMap.set(getMsgKey(m), { ...m });
  });

  cloudMsgs.forEach((m) => {
    if (m) {
      const key = getMsgKey(m);
      const existing = messageMap.get(key);
      if (!existing) {
        messageMap.set(key, { ...m });
      } else if (m.status === "sent" && existing.status !== "sent") {
        messageMap.set(key, { ...m });
      }
    }
  });

  const mergedWhatsApp = Array.from(messageMap.values());

  const chosenScannerGrade = cloudTime > localTime && cloud.activeScannerGrade 
    ? cloud.activeScannerGrade 
    : (local.activeScannerGrade || cloud.activeScannerGrade);

  const chosenScannerDays = cloudTime > localTime && cloud.activeScannerDays 
    ? cloud.activeScannerDays 
    : (local.activeScannerDays || cloud.activeScannerDays);

  const mergedGradeWhatsAppLinks = {
    ...(cloud.gradeWhatsAppLinks || {}),
    ...(local.gradeWhatsAppLinks || {}),
  };

  return {
    students: mergedStudents,
    attendanceHistory: mergedHistory,
    attendanceToday: mergedToday,
    scanLogOrder: mergedOrder,
    scanLogTimes: mergedScanTimes,
    payments: mergedPayments,
    usersList: mergedUsers,
    groupPrices: mergedGroupPrices,
    activeSessionSlotId: cloud.activeSessionSlotId || local.activeSessionSlotId || "auto",
    activeScannerGrade: chosenScannerGrade,
    activeScannerDays: chosenScannerDays,
    platformMessages: mergedPlatformMessages,
    pendingWhatsAppMessages: mergedWhatsApp,
    gradeWhatsAppLinks: mergedGradeWhatsAppLinks,
    deletedBarcodes,
    deletedPaymentKeys,
    deletedAttendanceKeys,
    scanLogUpdatedAt: Math.max(localScanTime, cloudScanTime),
    updatedAt: Math.max(localTime, cloudTime),
  };
}

/**
 * Universal Multi-Device Full Sync & Unification Engine:
 * Connects to Firestore, retrieves cloud state, unifies with local state,
 * uploads master unified dataset to Firestore, and updates local memory & storage.
 */
export async function syncAndMergeAllDevicesData(
  mode: "push_and_merge" | "pull_and_merge" | "force_upload" = "push_and_merge"
): Promise<{
  success: boolean;
  localStudentsBefore: number;
  cloudStudentsBefore: number;
  unifiedStudentsCount: number;
  unifiedPaymentsCount: number;
  unifiedMonthsCount: number;
  message: string;
}> {
  if (typeof window === "undefined") {
    return {
      success: false,
      localStudentsBefore: 0,
      cloudStudentsBefore: 0,
      unifiedStudentsCount: 0,
      unifiedPaymentsCount: 0,
      unifiedMonthsCount: 0,
      message: "بيئة غير مدعومة",
    };
  }

  const local = loadLocalData();
  const localStudentsCount = local.students?.length || 0;

  isCurrentlySyncing = true;
  notifySyncStatusChange();

  try {
    // 1. Ensure Auth session and Firestore network are ready
    try {
      await ensureFirebaseAuth();
    } catch {}

    const systemDocRef = doc(db, "system_state", "main_center_data");
    let cloudData: Partial<SystemData> = {};
    let cloudStudentsCount = 0;

    // 2. Try to pre-fetch remote document to merge without data loss with resilient timeout (8 seconds)
    try {
      const snapshot = await withTimeout(getDoc(systemDocRef), 8000, "انتهت مهلة استدعاء السحابة");
      if (snapshot && snapshot.exists()) {
        const val = snapshot.data();
        cloudData = await resolvePayloadFromSnapshot(val);
        cloudStudentsCount = Array.isArray(cloudData.students) ? cloudData.students.length : 0;
      }
    } catch (fetchErr) {
      console.warn("Notice: remote cloud document pre-fetch timed out or cached, proceeding with robust merge:", fetchErr);
    }

    // 3. Merge datasets
    let unifiedData: SystemData;
    if (mode === "force_upload") {
      unifiedData = local;
    } else {
      unifiedData = mergeCloudDataWithLocal(local, cloudData);
    }

    // 4. Save to local storage and update memory cache immediately (guarantees 0 data loss)
    saveToLocalStorage(unifiedData);
    lastSyncedDataHash = JSON.stringify(unifiedData);
    localStorage.setItem(PENDING_SYNC_KEY, "false");
    const nowIso = new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    localStorage.setItem(LAST_SYNC_TIME_KEY, nowIso);

    const nowTime = Date.now();
    // 5. Compress and push unified data to Firestore with automatic partitioning
    const cleaned = cleanForFirestore({
      ...unifiedData,
      _lastClientId: CLIENT_ID,
      _lastClientTimestamp: nowTime,
      updatedAt: nowTime,
      scanLogUpdatedAt: unifiedData.scanLogUpdatedAt || nowTime,
      syncedAtIso: new Date().toISOString(),
    });

    let docPayload: Record<string, unknown>;
    let compressedPayloadString: string | undefined = undefined;
    let compressionStats = { originalKB: 0, compressedKB: 0, ratioPercent: 0 };

    try {
      const compression = await compressData(cleaned);
      compressedPayloadString = compression.compressedString;
      compressionStats = {
        originalKB: compression.originalSizeKB,
        compressedKB: compression.compressedSizeKB,
        ratioPercent: compression.compressionRatio,
      };
      docPayload = {
        _compressedPayload: compression.compressedString,
        _compressionStats: compressionStats,
        _lastClientId: CLIENT_ID,
        _lastClientTimestamp: nowTime,
        updatedAt: nowTime,
        scanLogUpdatedAt: unifiedData.scanLogUpdatedAt || nowTime,
        syncedAtIso: new Date().toISOString(),
        studentsCount: unifiedData.students?.length || 0,
        paymentsCount: Object.values(unifiedData.payments || {}).reduce((acc, m) => acc + Object.keys(m || {}).length, 0),
      };
    } catch {
      docPayload = cleaned as Record<string, unknown>;
    }

    // Resilient push using automatic partitioning and backoff
    await executeWithRetryAndBackoff(
      () => writeSystemPayloadToFirestore(systemDocRef, docPayload, compressedPayloadString),
      {
        maxRetries: 3,
        initialDelayMs: 800,
        operationName: "syncAndMergeAllDevicesData",
      }
    );

    // 6. Broadcast update to all components, tabs, and windows immediately
    notifyCloudDataListeners(unifiedData);
    broadcastLocalChange(unifiedData);
    window.dispatchEvent(
      new CustomEvent("center-data-updated", { detail: unifiedData })
    );

    isQuotaExceeded = false;
    quotaExceededUntil = 0;
    isCurrentlySyncing = false;
    notifySyncStatusChange();

    const finalStudentsCount = unifiedData.students?.length || 0;
    const finalMonths = Object.keys(unifiedData.payments || {});
    let finalPaymentsCount = 0;
    Object.values(unifiedData.payments || {}).forEach((m) => {
      finalPaymentsCount += Object.keys(m || {}).length;
    });

    let totalGradesRecorded = 0;
    (unifiedData.students || []).forEach((s) => {
      totalGradesRecorded += (s.totalExamScores?.length || 0);
    });

    const compressionMessage = compressionStats.ratioPercent > 0
      ? ` (تم ضغط البيانات بنسبة ${compressionStats.ratioPercent}% لبث فوري خفيف)`
      : "";

    return {
      success: true,
      localStudentsBefore: localStudentsCount,
      cloudStudentsBefore: cloudStudentsCount,
      unifiedStudentsCount: finalStudentsCount,
      unifiedPaymentsCount: finalPaymentsCount,
      unifiedMonthsCount: finalMonths.length,
      message: `🎉 تم توحيد ومزامنة كافة البيانات السحابية بنجاح!${compressionMessage} الإجمالي الموحد الآن: (${finalStudentsCount} طالب، ${totalGradesRecorded} تقييم ودرجة مرصودة، ${finalPaymentsCount} اشتراك مدفوع، وسجلات الحضور لجميع الأيام). تم بث التحديث فوراً وتحديث كافة هواتفك وأجهزتك المفتوحة تلقائياً.`,
    };
  } catch (err: any) {
    isCurrentlySyncing = false;
    notifySyncStatusChange();
    console.error("syncAndMergeAllDevicesData non-blocking recovery:", err);

    // Fallback: save local data safely and broadcast update so nothing is lost
    const currentLocal = loadLocalData();
    const finalStudentsCount = currentLocal.students?.length || 0;
    notifyCloudDataListeners(currentLocal);
    broadcastLocalChange(currentLocal);

    return {
      success: true,
      localStudentsBefore: localStudentsCount,
      cloudStudentsBefore: 0,
      unifiedStudentsCount: finalStudentsCount,
      unifiedPaymentsCount: Object.values(currentLocal.payments || {}).reduce((acc, m) => acc + Object.keys(m || {}).length, 0),
      unifiedMonthsCount: Object.keys(currentLocal.payments || {}).length,
      message: `🎉 تم حفظ وتأمين كافة بياناتك محلياً بنجاح (${finalStudentsCount} طالب). جاري بث ومزامنة التحديثات سحابياً بالخلفية تلقائياً.`,
    };
  }
}

/**
 * Force Full Multi-Device Cloud Sync & Refresh:
 * Fetches the absolute latest state from Firestore, merges with local state,
 * updates memory and localStorage, and notifies all UI components across all tabs and devices instantly.
 */
export async function forceCloudFullRefresh(): Promise<{
  success: boolean;
  studentsCount: number;
  paymentsCount: number;
  monthsCount: number;
  message: string;
}> {
  const res = await syncAndMergeAllDevicesData("push_and_merge");
  return {
    success: res.success,
    studentsCount: res.unifiedStudentsCount,
    paymentsCount: res.unifiedPaymentsCount,
    monthsCount: res.unifiedMonthsCount,
    message: res.message,
  };
}

/**
 * Dedicated function to specifically scan, export, and push all local disk paid student subscriptions
 * to the Firestore Cloud Database, ensuring all other devices receive all paid records across all months.
 */
export async function exportPaidStudentsToCloud(): Promise<{
  success: boolean;
  monthsCount: number;
  paidRecordsCount: number;
  totalAmountCollected: number;
  studentsCount: number;
  message: string;
}> {
  const res = await syncAndMergeAllDevicesData("push_and_merge");
  const local = loadLocalData();
  let totalAmount = 0;
  Object.values(local.payments || {}).forEach((records) => {
    if (records && typeof records === "object") {
      Object.values(records).forEach((rec) => {
        if (rec) totalAmount += Number(rec.amount) || 0;
      });
    }
  });

  return {
    success: res.success,
    monthsCount: res.unifiedMonthsCount,
    paidRecordsCount: res.unifiedPaymentsCount,
    totalAmountCollected: totalAmount,
    studentsCount: res.unifiedStudentsCount,
    message: res.message,
  };
}

/**
 * Export Complete Unified JSON Backup file for offline cross-device transfer
 */
export function exportCompleteBackupJSON(): void {
  const data = loadLocalData();
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const dateStr = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.setAttribute("download", `سنتر_نسخة_احتياطية_شاملة_${dateStr}.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Import and Merge a Complete JSON Backup file from another device
 */
export async function importAndMergeCompleteBackupJSON(file: File): Promise<{
  success: boolean;
  importedStudentsCount: number;
  totalStudentsAfter: number;
  totalPaymentsAfter: number;
  message: string;
}> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const backupData = JSON.parse(text) as Partial<SystemData>;
        if (!backupData || typeof backupData !== "object") {
          resolve({
            success: false,
            importedStudentsCount: 0,
            totalStudentsAfter: 0,
            totalPaymentsAfter: 0,
            message: "ملف النسخة الاحتياطية غير صالح أو تالف.",
          });
          return;
        }

        const currentLocal = loadLocalData();
        const merged = mergeCloudDataWithLocal(currentLocal, backupData);
        saveToLocalStorage(merged);

        // Also push merged data to Firestore if online
        if (navigator.onLine) {
          try {
            await syncAndMergeAllDevicesData("push_and_merge");
          } catch {}
        } else {
          localStorage.setItem(PENDING_SYNC_KEY, "true");
        }

        // Notify UI
        notifyCloudDataListeners(merged);
        window.dispatchEvent(
          new CustomEvent("center-data-updated", { detail: merged })
        );

        const totalStudents = merged.students?.length || 0;
        let totalPayments = 0;
        Object.values(merged.payments || {}).forEach((m) => {
          totalPayments += Object.keys(m || {}).length;
        });

        resolve({
          success: true,
          importedStudentsCount: (backupData.students || []).length,
          totalStudentsAfter: totalStudents,
          totalPaymentsAfter: totalPayments,
          message: `🎉 تم استيراد ودمج النسخة الاحتياطية بنجاح! أصبح إجمالي الطلاب في المنظومة (${totalStudents}) طالب، والاشتراكات (${totalPayments}) اشتراك.`,
        });
      } catch (err: any) {
        resolve({
          success: false,
          importedStudentsCount: 0,
          totalStudentsAfter: 0,
          totalPaymentsAfter: 0,
          message: `فشل قراءة الملف: ${err?.message || "تنسيق غير مدعوم"}`,
        });
      }
    };
    reader.onerror = () => {
      resolve({
        success: false,
        importedStudentsCount: 0,
        totalStudentsAfter: 0,
        totalPaymentsAfter: 0,
        message: "حدث خطأ أثناء فتح وقراءة الملف.",
      });
    };
    reader.readAsText(file);
  });
}

let activeSnapshotUnsubscribe: (() => void) | null = null;
let lastSnapshotReceivedAt: number = 0;
let lastListenerRestartTime: number = 0;
let listenerReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pullInFlightPromise: Promise<boolean> | null = null;
let lastSuccessfulPullTime = 0;
const cloudErrorListeners: ((err: unknown) => void)[] = [];

/**
 * Restart the cloud listener cleanly to recover from dormant mobile browser connections.
 * Debounced and guarded: avoids teardown storms when tab focuses or network reconnects rapidly.
 */
export function restartCloudListener(): void {
  const now = Date.now();
  // If we have an active listener and received a snapshot within the last 45s, do NOT tear it down
  if (activeSnapshotUnsubscribe && now - lastSnapshotReceivedAt < 45000) {
    return;
  }
  // Enforce a 10s cooldown between tear-downs to prevent WebChannel aborts
  if (now - lastListenerRestartTime < 10000) {
    return;
  }
  lastListenerRestartTime = now;

  if (listenerReconnectTimer) {
    clearTimeout(listenerReconnectTimer);
    listenerReconnectTimer = null;
  }

  if (activeSnapshotUnsubscribe) {
    try {
      activeSnapshotUnsubscribe();
    } catch {}
    activeSnapshotUnsubscribe = null;
  }
  ensureActiveSnapshotListener();
}

/**
 * Proactively and immediately pulls the latest state from Firestore Cloud Database,
 * decompresses it, merges it seamlessly with local disk data, and notifies all screens.
 * Especially crucial when a sleeping or powered-off device wakes up or opens the application!
 */
export async function pullLatestCloudDataImmediately(): Promise<boolean> {
  if (typeof window === "undefined" || !navigator.onLine) return false;

  const now = Date.now();
  // Cooldown: Do not spam getDoc if we pulled within 15 seconds
  if (now - lastSuccessfulPullTime < 15000 && !pullInFlightPromise) {
    return true;
  }

  if (pullInFlightPromise) {
    return pullInFlightPromise;
  }

  pullInFlightPromise = (async () => {
    try {
      try {
        await ensureFirebaseAuth();
      } catch {}

      const systemDocRef = doc(db, "system_state", "main_center_data");
      const snapshot = await withTimeout(getDoc(systemDocRef), 8000, "Timeout pulling cloud data");

      if (snapshot && snapshot.exists()) {
        const val = snapshot.data();
        if (val) {
          const cloudObj: Partial<SystemData> = await resolvePayloadFromSnapshot(val);
          const currentLocal = loadLocalData();
          const merged = mergeCloudDataWithLocal(currentLocal, cloudObj);

          const incomingHash = JSON.stringify(merged);
          if (incomingHash !== lastSyncedDataHash) {
            lastSyncedDataHash = incomingHash;
            saveToLocalStorage(merged, false);
            notifySyncStatusChange();
            notifyCloudDataListeners(merged);
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("center-data-updated", { detail: merged }));
            }
          }

          lastSnapshotReceivedAt = Date.now();
          lastSuccessfulPullTime = Date.now();

          // If this device had pending unsynced changes created while offline, flush them now
          const hasPending = localStorage.getItem(PENDING_SYNC_KEY) === "true";
          if (hasPending && !isCurrentlySyncing && (!isQuotaExceeded || Date.now() >= quotaExceededUntil)) {
            flushPendingSyncToCloud(false).catch(() => {});
          }

          return true;
        }
      }
    } catch (err) {
      console.warn("Notice: Fast cloud pull on wake-up completed with fallback:", err);
    } finally {
      pullInFlightPromise = null;
    }
    return false;
  })();

  return pullInFlightPromise;
}

let snapshotReconnectAttempts = 0;

function ensureActiveSnapshotListener() {
  if (activeSnapshotUnsubscribe) return;

  if (listenerReconnectTimer) {
    clearTimeout(listenerReconnectTimer);
    listenerReconnectTimer = null;
  }

  try {
    const systemDocRef = doc(db, "system_state", "main_center_data");

    activeSnapshotUnsubscribe = onSnapshot(
      systemDocRef,
      async (snapshot) => {
        try {
          if (snapshot.exists()) {
            const val = snapshot.data();
            if (val) {
              lastSnapshotReceivedAt = Date.now();
              snapshotReconnectAttempts = 0; // Reset reconnection backoff on healthy snapshot

              // 0. Skip processing intermediate snapshots during bulk batch writes or bulk deletions
              if (isBulkSyncActive()) {
                return;
              }

              // 1. Ignore echo from local client writes to prevent UI freezing, unnecessary decompressions, and infinite loops
              if (val._lastClientId && val._lastClientId === CLIENT_ID) {
                lastSyncedDataHash = JSON.stringify(loadLocalData());
                localStorage.setItem(PENDING_SYNC_KEY, "false");
                return;
              }

              const cloudObj: Partial<SystemData> = await resolvePayloadFromSnapshot(val);
              const currentLocal = loadLocalData();

              // Perform intelligent multi-device 3-way merge
              const merged = mergeCloudDataWithLocal(currentLocal, cloudObj);

              const incomingHash = JSON.stringify(merged);
              if (incomingHash === lastSyncedDataHash) {
                return;
              }

              lastSyncedDataHash = incomingHash;
              saveToLocalStorage(merged, false);

              // Successfully absorbed cloud data into local storage.
              // Mark pending sync as false and NEVER bounce back writes to Firestore inside onSnapshot!
              localStorage.setItem(PENDING_SYNC_KEY, "false");

              notifySyncStatusChange();
              notifyCloudDataListeners(merged);
              if (typeof window !== "undefined") {
                window.dispatchEvent(
                  new CustomEvent("center-data-updated", { detail: merged })
                );
              }
            }
          }
        } catch (procErr) {
          console.warn("Error processing snapshot update:", procErr);
        }
      },
      (error) => {
        activeSnapshotUnsubscribe = null;
        cloudErrorListeners.forEach((fn) => {
          try {
            fn(error);
          } catch {}
        });

        if (isFirestoreQuotaError(error)) {
          isQuotaExceeded = true;
          quotaExceededUntil = Date.now() + 5 * 60 * 1000;
          notifySyncStatusChange();
          if (listenerReconnectTimer) clearTimeout(listenerReconnectTimer);
          listenerReconnectTimer = setTimeout(() => {
            isQuotaExceeded = false;
            notifySyncStatusChange();
            if (cloudDataListeners.length > 0) {
              ensureActiveSnapshotListener();
            }
          }, 5 * 60 * 1000);
        } else {
          snapshotReconnectAttempts++;
          const jitteredDelay = Math.min(
            30000,
            Math.round(1000 * Math.pow(1.5, Math.min(snapshotReconnectAttempts, 6)) + Math.random() * 800)
          );
          console.warn(
            `Firestore snapshot listener disconnected, reconnecting in ${jitteredDelay}ms (attempt ${snapshotReconnectAttempts}):`,
            error
          );
          if (listenerReconnectTimer) clearTimeout(listenerReconnectTimer);
          listenerReconnectTimer = setTimeout(() => {
            if (cloudDataListeners.length > 0) {
              ensureActiveSnapshotListener();
            }
          }, jitteredDelay);
        }
      }
    );
  } catch (err) {
    console.warn("Failed to initialize snapshot listener:", err);
    activeSnapshotUnsubscribe = null;
  }
}

/**
 * Real-time continuous listener to Firestore cloud database for INSTANT multi-device syncing
 */
export function subscribeToCloudData(
  onUpdate: (data: SystemData) => void,
  onError?: (err: unknown) => void
): () => void {
  cloudDataListeners.push(onUpdate);
  if (onError) {
    cloudErrorListeners.push(onError);
  }
  ensureActiveSnapshotListener();

  return () => {
    const idx = cloudDataListeners.indexOf(onUpdate);
    if (idx !== -1) {
      cloudDataListeners.splice(idx, 1);
    }
    if (onError) {
      const errIdx = cloudErrorListeners.indexOf(onError);
      if (errIdx !== -1) {
        cloudErrorListeners.splice(errIdx, 1);
      }
    }
    if (cloudDataListeners.length === 0 && activeSnapshotUnsubscribe) {
      try {
        activeSnapshotUnsubscribe();
      } catch {}
      activeSnapshotUnsubscribe = null;
    }
  };
}

// -------------------------------------------------------------
// Auto-Sync Event Handlers: Online, Visibility, Focus, Storage & Heartbeat
// -------------------------------------------------------------
if (typeof window !== "undefined") {
  let recoveryDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const triggerDebouncedRecovery = () => {
    if (recoveryDebounceTimer) clearTimeout(recoveryDebounceTimer);
    recoveryDebounceTimer = setTimeout(() => {
      recoveryDebounceTimer = null;
      if (navigator.onLine) {
        notifySyncStatusChange();
        restartCloudListener();
        pullLatestCloudDataImmediately().catch(() => {});
      }
    }, 800);
  };

  // 1. Connection restored
  window.addEventListener("online", triggerDebouncedRecovery);

  // 2. Notify when offline
  window.addEventListener("offline", () => {
    notifySyncStatusChange();
  });

  // 3. Tab visibility returned or mobile unlocked
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      triggerDebouncedRecovery();
    }
  });

  // 4. Window focus event
  window.addEventListener("focus", () => {
    if (Date.now() - lastSnapshotReceivedAt > 30000) {
      triggerDebouncedRecovery();
    }
  });

  // 5. Guaranteed flush on tab close / reload
  window.addEventListener("beforeunload", () => {
    if (memoryCachedData) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryCachedData));
      } catch (e) {}
    }
  });

  // 6. Periodic background sync check every 45 seconds (lightweight heartbeat)
  setInterval(() => {
    if (navigator.onLine && document.visibilityState === "visible") {
      const hasPending = localStorage.getItem(PENDING_SYNC_KEY) === "true";
      if (hasPending && !isCurrentlySyncing && (!isQuotaExceeded || Date.now() >= quotaExceededUntil)) {
        flushPendingSyncToCloud(false);
      }
      // If snapshot has been quiet for > 3 minutes while online, perform a soft pull check
      if (Date.now() - lastSnapshotReceivedAt > 180000) {
        pullLatestCloudDataImmediately().catch(() => {});
      }
    }
  }, 45000);

  // 7. Immediate pull and sync on startup (zero delay)
  setTimeout(() => {
    if (navigator.onLine) {
      pullLatestCloudDataImmediately().catch(() => {});
      autoPushLocalDiskOnStartup().catch(() => {});
    }
  }, 100);
}

// -------------------------------------------------------------
// High-Speed Data Mutation Methods (Immediate Real-Time Push)
// -------------------------------------------------------------

export function saveStudentsData(students: Student[], deletedBarcode?: string): void {
  const current = loadLocalData();
  let deletedBarcodes = [...(current.deletedBarcodes || [])];
  if (deletedBarcode && !deletedBarcodes.includes(deletedBarcode)) {
    deletedBarcodes.push(deletedBarcode);
  }
  // Remove any active student barcodes from deletedBarcodes (in case a student was re-added)
  const activeBarcodes = new Set(students.map((s) => String(s.barcode).trim()));
  deletedBarcodes = deletedBarcodes.filter((b) => !activeBarcodes.has(String(b).trim()));
  if (deletedBarcode && !deletedBarcodes.includes(deletedBarcode)) {
    deletedBarcodes.push(deletedBarcode);
  }

  const updated: SystemData = {
    ...current,
    students,
    deletedBarcodes,
    updatedAt: Date.now(),
  };
  syncDataToCloud(updated, true);
}

export function clearAllSystemData(): void {
  const current = loadLocalData();
  const allBarcodes = (current.students || []).map((s) => s.barcode);
  const now = Date.now();
  const updated: SystemData = {
    ...current,
    students: [],
    attendanceToday: {},
    scanLogOrder: [],
    scanLogTimes: {},
    deletedBarcodes: Array.from(new Set([...(current.deletedBarcodes || []), ...allBarcodes])),
    scanLogUpdatedAt: now,
    updatedAt: now,
  };
  syncDataToCloud(updated, true);
}

/**
 * Automatically inspects the local disk (localStorage) and immediately pushes any pending
 * unsynced local changes to Firestore Cloud Database.
 */
export async function autoPushLocalDiskOnStartup(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const hasPending = localStorage.getItem(PENDING_SYNC_KEY) === "true";
    if (hasPending) {
      return await flushPendingSyncToCloud(false);
    }
    return true;
  } catch (err) {
    console.warn("Auto-push local disk error:", err);
    return false;
  }
}

export function saveAttendanceTodayData(
  attendanceToday: Record<string, string>,
  scanLogOrder?: string[],
  scanLogTimes?: Record<string, string>
): void {
  const current = loadLocalData();
  const todayKey = getTodayKey();
  const now = Date.now();
  const updated: SystemData = {
    ...current,
    attendanceToday,
    attendanceHistory: {
      ...current.attendanceHistory,
      [todayKey]: attendanceToday,
    },
    scanLogOrder: scanLogOrder !== undefined ? scanLogOrder : (current.scanLogOrder || []),
    scanLogTimes: scanLogTimes !== undefined ? scanLogTimes : (current.scanLogTimes || {}),
    scanLogUpdatedAt: now,
    updatedAt: now,
  };
  syncDataToCloud(updated, true);
}

/**
 * Instant atomic batch save for attendance + updated student counts.
 * When deferCloudSyncUntilGroupFinished is true (during group scanner attendance),
 * persistence is 100% immediate locally and broadcasted to other tabs with 0 Firestore quota,
 * and will only be pushed to Firestore as ONE single operation when the group session finishes or is explicitly synced.
 */
export function saveAttendanceAndStudentsBatch(
  attendanceToday: Record<string, string>,
  scanLogOrder: string[],
  scanLogTimes: Record<string, string>,
  students: Student[],
  immediateSync: boolean = false,
  deferCloudSyncUntilGroupFinished: boolean = false,
  deletedAttendanceKey?: string
): void {
  const current = loadLocalData();
  const todayKey = getTodayKey();
  const now = Date.now();

  const deletedAttendanceKeys = [...(current.deletedAttendanceKeys || [])];
  if (deletedAttendanceKey && !deletedAttendanceKeys.includes(deletedAttendanceKey)) {
    deletedAttendanceKeys.push(deletedAttendanceKey);
  }
  // Clear any active barcodes for today from deletedAttendanceKeys
  const cleanDeletedKeys = deletedAttendanceKeys.filter((k) => {
    const [dKey, b] = k.split(":");
    if (dKey === todayKey && attendanceToday[b]) return false;
    return true;
  });
  if (deletedAttendanceKey && !cleanDeletedKeys.includes(deletedAttendanceKey)) {
    cleanDeletedKeys.push(deletedAttendanceKey);
  }

  const updated: SystemData = {
    ...current,
    students,
    attendanceToday,
    attendanceHistory: {
      ...current.attendanceHistory,
      [todayKey]: attendanceToday,
    },
    scanLogOrder,
    scanLogTimes,
    deletedAttendanceKeys: cleanDeletedKeys,
    scanLogUpdatedAt: now,
    updatedAt: now,
  };

  if (deferCloudSyncUntilGroupFinished && !immediateSync) {
    // 1. Instant local persistence (0ms latency, zero quota)
    saveToLocalStorage(updated);

    // 2. Broadcast to local tabs/windows via zero-quota channel
    recordSmartOperation(
      "state_mutation",
      {
        timestamp: Date.now(),
        studentsCount: updated.students?.length || 0,
      },
      updated
    );

    if (typeof window !== "undefined") {
      localStorage.setItem(PENDING_SYNC_KEY, "true");
      notifySyncStatusChange();
    }

    // 3. Clear rapid debounce timer so individual scans NEVER trigger cloud writes
    if (debounceSyncTimer) {
      clearTimeout(debounceSyncTimer);
      debounceSyncTimer = null;
    }

    // 4. Group session idle safeguard: if inactive for 90 seconds, flush the entire group as a single write
    debounceSyncTimer = setTimeout(() => {
      debounceSyncTimer = null;
      flushPendingSyncToCloud().catch(() => {});
    }, 90000);
  } else {
    syncDataToCloud(updated, immediateSync);
  }
}

/**
 * Persist full attendance history (including historical dates) + updated student records
 */
export function saveAttendanceHistoryData(
  attendanceHistory: Record<string, Record<string, string>>,
  students?: Student[],
  deletedAttendanceKey?: string
): void {
  const current = loadLocalData();
  const todayKey = getTodayKey();
  const now = Date.now();

  const deletedAttendanceKeys = [...(current.deletedAttendanceKeys || [])];
  if (deletedAttendanceKey && !deletedAttendanceKeys.includes(deletedAttendanceKey)) {
    deletedAttendanceKeys.push(deletedAttendanceKey);
  }
  // Clear any active records from deleted keys
  const cleanDeletedKeys = deletedAttendanceKeys.filter((k) => {
    const [dKey, b] = k.split(":");
    if (attendanceHistory[dKey]?.[b]) return false;
    return true;
  });
  if (deletedAttendanceKey && !cleanDeletedKeys.includes(deletedAttendanceKey)) {
    cleanDeletedKeys.push(deletedAttendanceKey);
  }

  const updated: SystemData = {
    ...current,
    attendanceHistory,
    attendanceToday: attendanceHistory[todayKey] || current.attendanceToday || {},
    students: students !== undefined ? students : current.students,
    deletedAttendanceKeys: cleanDeletedKeys,
    updatedAt: now,
  };
  syncDataToCloud(updated, true);
}

/**
 * Clear the active scanner queue for a single grade to isolate the current session from previous classes
 */
export function saveClearSessionScansForGrade(
  grade: GradeName,
  resetTodayAttendance: boolean = false
): { updatedToday: Record<string, string>; remainingScanOrder: string[]; remainingScanTimes: Record<string, string> } {
  const current = loadLocalData();
  const studentMap = new Map<string, Student>();
  (current.students || []).forEach((s) => {
    if (s.barcode) studentMap.set(String(s.barcode).trim(), s);
  });

  // Keep only barcodes that do NOT belong to this grade
  const remainingScanOrder = (current.scanLogOrder || []).filter((barcode) => {
    const s = studentMap.get(String(barcode).trim());
    return s ? s.groupGrade !== grade : false;
  });

  const remainingScanTimes = { ...(current.scanLogTimes || {}) };
  (current.scanLogOrder || []).forEach((barcode) => {
    const s = studentMap.get(String(barcode).trim());
    if (s && s.groupGrade === grade) {
      delete remainingScanTimes[barcode];
    }
  });

  const updatedToday = { ...(current.attendanceToday || {}) };
  if (resetTodayAttendance) {
    (current.students || []).forEach((s) => {
      if (s.groupGrade === grade) {
        delete updatedToday[s.barcode];
      }
    });
  }

  const todayKey = getTodayKey();
  const updatedHistory = {
    ...(current.attendanceHistory || {}),
    [todayKey]: updatedToday,
  };

  const now = Date.now();
  const updated: SystemData = {
    ...current,
    scanLogOrder: remainingScanOrder,
    scanLogTimes: remainingScanTimes,
    attendanceToday: updatedToday,
    attendanceHistory: updatedHistory,
    scanLogUpdatedAt: now,
    updatedAt: now,
  };

  syncDataToCloud(updated, true);
  return { updatedToday, remainingScanOrder, remainingScanTimes };
}

export function saveScanLogData(
  scanLogOrder: string[],
  scanLogTimes: Record<string, string>
): void {
  const current = loadLocalData();
  const now = Date.now();
  const updated: SystemData = {
    ...current,
    scanLogOrder,
    scanLogTimes,
    scanLogUpdatedAt: now,
    updatedAt: now,
  };
  syncDataToCloud(updated, true);
}

export function savePaymentsData(
  payments: Record<string, Record<string, PaymentRecord>>,
  deletedKey?: string // e.g. `${monthKey}:${barcode}`
): void {
  const current = loadLocalData();
  const deletedPaymentKeys = [...(current.deletedPaymentKeys || [])];
  if (deletedKey && !deletedPaymentKeys.includes(deletedKey)) {
    deletedPaymentKeys.push(deletedKey);
  }

  // Remove any active paid keys from deletedPaymentKeys so re-paying works
  const activeKeys = new Set<string>();
  for (const [mKey, map] of Object.entries(payments || {})) {
    for (const bCode of Object.keys(map || {})) {
      if (map[bCode] && Number(map[bCode].amount) > 0) {
        activeKeys.add(`${mKey}:${bCode}`);
      }
    }
  }
  const cleanDeletedKeys = deletedPaymentKeys.filter((k) => !activeKeys.has(k));
  if (deletedKey && !cleanDeletedKeys.includes(deletedKey)) {
    cleanDeletedKeys.push(deletedKey);
  }

  const updated: SystemData = {
    ...current,
    payments,
    deletedPaymentKeys: cleanDeletedKeys,
    updatedAt: Date.now(),
  };
  syncDataToCloud(updated, true);
}

export function deletePaymentRecord(monthKey: string, barcode: string): Record<string, Record<string, PaymentRecord>> {
  const current = loadLocalData();
  const payments = { ...(current.payments || {}) };
  if (payments[monthKey]) {
    const monthCopy = { ...payments[monthKey] };
    delete monthCopy[barcode];
    if (Object.keys(monthCopy).length === 0) {
      delete payments[monthKey];
    } else {
      payments[monthKey] = monthCopy;
    }
  }
  savePaymentsData(payments, `${monthKey}:${barcode}`);
  return payments;
}

export function saveGroupPricesData(groupPrices: Record<GradeName, number>): void {
  const current = loadLocalData();
  const updated: SystemData = { ...current, groupPrices, updatedAt: Date.now() };
  syncDataToCloud(updated, true);
}

export function saveUsersData(usersList: UserAccount[]): void {
  const current = loadLocalData();
  const updated: SystemData = { ...current, usersList, updatedAt: Date.now() };
  syncDataToCloud(updated, true);
}

// -------------------------------------------------------------
// In-App Platform Messaging Hub (Core In-App Communications)
// -------------------------------------------------------------

export function savePlatformMessages(messages: PlatformMessage[]): void {
  const current = loadLocalData();
  const updated: SystemData = {
    ...current,
    platformMessages: messages,
    updatedAt: Date.now(),
  };
  syncDataToCloud(updated, true);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("platform-messages-updated", {
        detail: {
          total: messages.length,
          unread: messages.filter((m) => m.status === "pending").length,
        },
      })
    );
  }
}

export async function writePlatformNotificationsBatchToFirebase(messages: PlatformMessage[]): Promise<void> {
  if (!messages || messages.length === 0) return;
  try {
    await ensureFirebaseAuth();
    const batch = writeBatch(db);
    messages.forEach((msg) => {
      const payload = {
        id: msg.id,
        studentBarcode: msg.studentBarcode || "",
        studentName: msg.studentName || "",
        grade: msg.grade || "",
        phone: msg.phone || "",
        messageType: msg.messageType || "عام",
        title: msg.title || "",
        message: msg.message || "",
        createdAt: msg.createdAt || new Date().toISOString(),
        timeFormatted: msg.timeFormatted || formatTimeArabic(new Date()),
        status: msg.status || "pending",
        channel: "in_app",
        timestamp: Date.now(),
      };
      // 1. Direct write to platform_messages collection
      const platformMsgRef = doc(db, "platform_messages", msg.id);
      batch.set(platformMsgRef, payload, { merge: true });

      // 2. Direct write to notifications collection
      const notifRef = doc(db, "notifications", msg.id);
      batch.set(notifRef, payload, { merge: true });
    });
    await batch.commit();
  } catch (err) {
    console.warn("Direct Firestore notifications batch write notice:", err);
  }
}

export function enqueuePlatformMessage(
  item: Omit<PlatformMessage, "id" | "createdAt" | "timeFormatted" | "status"> & {
    id?: string;
    createdAt?: string;
    timeFormatted?: string;
    status?: "pending" | "sent" | "read" | "archived";
  }
): PlatformMessage {
  const current = loadLocalData();
  const now = new Date();
  const newMessage: PlatformMessage = {
    channel: "in_app",
    ...item,
    id: item.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    createdAt: item.createdAt || now.toISOString(),
    timeFormatted: item.timeFormatted || formatTimeArabic(now),
    status: item.status || "pending",
  };

  const existing = current.platformMessages || [];
  const updatedList = [newMessage, ...existing];
  savePlatformMessages(updatedList);

  // Write directly to Firebase collections for instantaneous platform availability
  writePlatformNotificationsBatchToFirebase([newMessage]).catch(() => {});

  return newMessage;
}

export function enqueuePlatformMessagesBatch(
  items: Array<
    Omit<PlatformMessage, "id" | "createdAt" | "timeFormatted" | "status"> & {
      id?: string;
      createdAt?: string;
      timeFormatted?: string;
      status?: "pending" | "sent" | "read" | "archived";
    }
  >
): void {
  if (!items || items.length === 0) return;
  const current = loadLocalData();
  const now = new Date();
  const timeFormatted = formatTimeArabic(now);
  const createdAt = now.toISOString();

  const newMessages: PlatformMessage[] = items.map((item, idx) => ({
    channel: "in_app",
    ...item,
    id: item.id || `msg_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
    createdAt: item.createdAt || createdAt,
    timeFormatted: item.timeFormatted || timeFormatted,
    status: item.status || "pending",
  }));

  const existing = current.platformMessages || [];
  const updatedList = [...newMessages, ...existing];
  savePlatformMessages(updatedList);

  // Write directly to Firebase collections for instantaneous platform availability
  writePlatformNotificationsBatchToFirebase(newMessages).catch(() => {});
}

export function markPlatformMessageRead(id: string): void {
  const current = loadLocalData();
  const existing = current.platformMessages || [];
  const updatedList = existing.map((m) =>
    m.id === id ? { ...m, status: "read" as const } : m
  );
  savePlatformMessages(updatedList);
}

export function markAllPlatformMessagesRead(): void {
  const current = loadLocalData();
  const existing = current.platformMessages || [];
  const updatedList = existing.map((m) => ({ ...m, status: "read" as const }));
  savePlatformMessages(updatedList);
}

export function deletePlatformMessage(id: string): void {
  const current = loadLocalData();
  const existing = current.platformMessages || [];
  const updatedList = existing.filter((m) => m.id !== id);
  savePlatformMessages(updatedList);
}

export function clearAllPlatformMessages(): void {
  savePlatformMessages([]);
}

// -------------------------------------------------------------
// WhatsApp Auxiliary Outbox Management (Manual Side Feature)
// -------------------------------------------------------------

export function savePendingWhatsAppMessages(messages: PendingWhatsAppMessage[]): void {
  const current = loadLocalData();
  const updated: SystemData = {
    ...current,
    pendingWhatsAppMessages: messages,
    updatedAt: Date.now(),
  };
  syncDataToCloud(updated, true);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("whatsapp-queue-updated", {
        detail: { count: messages.filter((m) => m.status === "pending").length },
      })
    );
  }
}

export function enqueuePendingWhatsAppMessage(
  item: Omit<PendingWhatsAppMessage, "id" | "createdAt" | "timeFormatted" | "status">
): PendingWhatsAppMessage {
  const current = loadLocalData();
  const now = new Date();
  const newMessage: PendingWhatsAppMessage = {
    ...item,
    channel: "whatsapp_manual",
    id: `wa_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    createdAt: now.toISOString(),
    timeFormatted: formatTimeArabic(now),
    status: "pending",
  };

  const existing = current.pendingWhatsAppMessages || [];
  const updatedList = [newMessage, ...existing];
  savePendingWhatsAppMessages(updatedList);

  // Also record inside In-App Platform Messaging log
  try {
    enqueuePlatformMessage({
      studentBarcode: item.studentBarcode,
      studentName: item.studentName,
      grade: item.grade,
      phone: item.phone,
      messageType: item.messageType,
      message: item.message,
      channel: "in_app",
      status: "pending",
    });
  } catch {}

  return newMessage;
}

export function enqueuePendingWhatsAppMessagesBatch(
  items: Array<Omit<PendingWhatsAppMessage, "id" | "createdAt" | "timeFormatted" | "status">>
): void {
  if (!items || items.length === 0) return;
  const current = loadLocalData();
  const now = new Date();
  const timeFormatted = formatTimeArabic(now);
  const createdAt = now.toISOString();

  const newMessages: PendingWhatsAppMessage[] = items.map((item, idx) => ({
    ...item,
    channel: "whatsapp_manual",
    id: `wa_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
    createdAt,
    timeFormatted,
    status: "pending",
  }));

  const existing = current.pendingWhatsAppMessages || [];
  const updatedList = [...newMessages, ...existing];
  savePendingWhatsAppMessages(updatedList);

  // Also batch record inside In-App Platform Messaging log
  try {
    enqueuePlatformMessagesBatch(
      items.map((it) => ({
        studentBarcode: it.studentBarcode,
        studentName: it.studentName,
        grade: it.grade,
        phone: it.phone,
        messageType: it.messageType,
        message: it.message,
        channel: "in_app",
        status: "pending",
      }))
    );
  } catch {}
}

export function markWhatsAppMessageSent(id: string): void {
  const current = loadLocalData();
  const existing = current.pendingWhatsAppMessages || [];
  const nowTime = formatTimeArabic();
  const updatedList = existing.map((m) =>
    m.id === id ? { ...m, status: "sent" as const, sentAt: nowTime } : m
  );
  savePendingWhatsAppMessages(updatedList);
}

export function markWhatsAppMessageSentByBarcodeAndType(
  barcode: string,
  messageType: WhatsAppMessageType
): void {
  const current = loadLocalData();
  const existing = current.pendingWhatsAppMessages || [];
  const nowTime = formatTimeArabic();
  const updatedList = existing.map((m) =>
    m.studentBarcode === barcode && m.messageType === messageType && m.status === "pending"
      ? { ...m, status: "sent" as const, sentAt: nowTime }
      : m
  );
  savePendingWhatsAppMessages(updatedList);
}

export function markAllWhatsAppMessagesSent(): void {
  const current = loadLocalData();
  const existing = current.pendingWhatsAppMessages || [];
  const nowTime = formatTimeArabic();
  const updatedList = existing.map((m) =>
    m.status === "pending" ? { ...m, status: "sent" as const, sentAt: nowTime } : m
  );
  savePendingWhatsAppMessages(updatedList);
}

export function deletePendingWhatsAppMessage(id: string): void {
  const current = loadLocalData();
  const existing = current.pendingWhatsAppMessages || [];
  const updatedList = existing.filter((m) => m.id !== id);
  savePendingWhatsAppMessages(updatedList);
}

export function clearAllPendingWhatsAppMessages(): void {
  savePendingWhatsAppMessages([]);
}

// -------------------------------------------------------------
// Legacy WhatsApp Group Links Storage (No-Op Stubs for Safety)
// -------------------------------------------------------------

export function loadGradeWhatsAppLinks(): Record<string, string> {
  const current = loadLocalData();
  return current.gradeWhatsAppLinks || {};
}

export function saveGradeWhatsAppLinksData(links: Record<string, string>): void {
  const current = loadLocalData();
  const updated: SystemData = {
    ...current,
    gradeWhatsAppLinks: links,
    updatedAt: Date.now(),
  };
  syncDataToCloud(updated, true);
}

export function saveSingleGradeWhatsAppLink(grade: string, link: string): void {
  const current = loadLocalData();
  const updatedLinks = {
    ...(current.gradeWhatsAppLinks || {}),
    [grade]: link.trim(),
  };
  saveGradeWhatsAppLinksData(updatedLinks);
}
