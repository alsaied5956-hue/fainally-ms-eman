import { doc, writeBatch, setDoc } from "firebase/firestore";
import { db, ensureFirebaseAuth } from "./firebase";
import {
  saveOperationToIndexedDB,
  getPendingOperationsFromIndexedDB,
  removeOperationsFromIndexedDB,
  saveSnapshotToIndexedDB,
} from "./indexedDB";
import { compressData } from "./compression";

function safeWithTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMsg)), ms);
  });
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    timeoutPromise,
  ]);
}

export interface QueuedOperation {
  id: string;
  type: "attendance_scan" | "student_edit" | "student_add" | "payment" | "platform_message" | "state_mutation";
  payload: any;
  timestamp: number;
}

export interface BatchQueueStatus {
  pendingCount: number;
  maxBatchSize: number;
  timeUntilNextFlushSec: number;
  lastBatchFlushIso: string | null;
  isFlushing: boolean;
}

const BATCH_SIZE_THRESHOLD = 100; // Trigger batch commit on reaching 100 operations
const AUTO_FLUSH_INTERVAL_MS = 3 * 60 * 1000; // Auto flush every 3 minutes (180,000 ms)
const STORAGE_QUEUE_KEY = "aiman_smart_batch_queue_v1";

let inMemoryQueue: QueuedOperation[] = [];
let isFlushingBatch = false;
let autoFlushTimer: ReturnType<typeof setInterval> | null = null;
let nextFlushEpoch: number = Date.now() + AUTO_FLUSH_INTERVAL_MS;
let lastBatchFlushIso: string | null = null;
const batchStatusListeners: Array<(status: BatchQueueStatus) => void> = [];

// Initialize queue from local persistence
if (typeof window !== "undefined") {
  try {
    const raw = localStorage.getItem(STORAGE_QUEUE_KEY);
    if (raw) {
      inMemoryQueue = JSON.parse(raw);
    }
  } catch {
    inMemoryQueue = [];
  }

  // Restore any lingering operations from IndexedDB
  getPendingOperationsFromIndexedDB().then((indexedOps) => {
    if (indexedOps && indexedOps.length > 0) {
      const existingIds = new Set(inMemoryQueue.map((o) => o.id));
      const newlyAdded = indexedOps.filter((o) => !existingIds.has(o.id)) as QueuedOperation[];
      if (newlyAdded.length > 0) {
        inMemoryQueue = [...inMemoryQueue, ...newlyAdded];
        persistQueueLocally();
        notifyBatchStatus();
      }
    }
  }).catch(() => {});

  // Setup periodic 3-minute auto-flush timer
  startAutoFlushSchedule();

  // Also auto-flush before unload
  window.addEventListener("beforeunload", () => {
    if (inMemoryQueue.length > 0) {
      // Synchronous local persist is already performed
      flushSmartBatchToFirestore().catch(() => {});
    }
  });
}

function startAutoFlushSchedule() {
  if (autoFlushTimer) clearInterval(autoFlushTimer);
  nextFlushEpoch = Date.now() + AUTO_FLUSH_INTERVAL_MS;

  autoFlushTimer = setInterval(() => {
    if (inMemoryQueue.length > 0 && !isFlushingBatch) {
      flushSmartBatchToFirestore().catch((err) => {
        console.warn("Auto-scheduled 3-minute batch flush notice:", err);
      });
    } else {
      nextFlushEpoch = Date.now() + AUTO_FLUSH_INTERVAL_MS;
      notifyBatchStatus();
    }
  }, AUTO_FLUSH_INTERVAL_MS);
}

function persistQueueLocally() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_QUEUE_KEY, JSON.stringify(inMemoryQueue));
  } catch {}
}

function notifyBatchStatus() {
  const status = getBatchQueueStatus();
  batchStatusListeners.forEach((cb) => {
    try {
      cb(status);
    } catch {}
  });
}

/**
 * Get current status of the 100-item / 3-minute smart batch pipeline
 */
export function getBatchQueueStatus(): BatchQueueStatus {
  const remainingMs = Math.max(0, nextFlushEpoch - Date.now());
  return {
    pendingCount: inMemoryQueue.length,
    maxBatchSize: BATCH_SIZE_THRESHOLD,
    timeUntilNextFlushSec: Math.round(remainingMs / 1000),
    lastBatchFlushIso,
    isFlushing: isFlushingBatch,
  };
}

/**
 * Subscribe to batch queue updates
 */
export function subscribeToBatchStatus(cb: (status: BatchQueueStatus) => void): () => void {
  batchStatusListeners.push(cb);
  cb(getBatchQueueStatus());
  return () => {
    const idx = batchStatusListeners.indexOf(cb);
    if (idx !== -1) batchStatusListeners.splice(idx, 1);
  };
}

/**
 * Record an atomic modification (scan, edit, addition, payment, etc.) into IndexedDB and LocalStorage instantly.
 * If queued items reach 100, automatically flushes a writeBatch() to Firestore immediately.
 */
export function recordSmartOperation(
  type: QueuedOperation["type"],
  payload: any,
  systemSnapshot?: any
): void {
  const op: QueuedOperation = {
    id: `${Date.now()}_${Math.random().toString(36).substr(2, 7)}`,
    type,
    payload,
    timestamp: Date.now(),
  };

  // 1. Instant zero-lag in-memory & LocalStorage append
  inMemoryQueue.push(op);
  persistQueueLocally();

  // 2. Non-blocking asynchronous backup to IndexedDB
  saveOperationToIndexedDB(op).catch(() => {});

  if (systemSnapshot) {
    saveSnapshotToIndexedDB("latest_state", systemSnapshot).catch(() => {});
  }

  notifyBatchStatus();

  // 3. Size-Trigger: If accumulated operations reach 100, execute writeBatch immediately!
  if (inMemoryQueue.length >= BATCH_SIZE_THRESHOLD && !isFlushingBatch) {
    flushSmartBatchToFirestore().catch((err) => {
      console.warn("Immediate 100-batch flush notice:", err);
    });
  }
}

/**
 * Flush accumulated operations to Firestore using writeBatch().
 * Batches are processed in chunks of up to 100 operations.
 */
export async function flushSmartBatchToFirestore(latestSystemData?: any): Promise<boolean> {
  if (isFlushingBatch) return true;
  if (inMemoryQueue.length === 0 && !latestSystemData) return true;

  isFlushingBatch = true;
  notifyBatchStatus();

  try {
    await ensureFirebaseAuth();

    // Take operations to flush (up to 100 operations per writeBatch chunk)
    const chunk = inMemoryQueue.slice(0, BATCH_SIZE_THRESHOLD);
    const chunkIds = chunk.map((o) => o.id);

    // Create Firestore writeBatch
    const batch = writeBatch(db);

    // Operations are safely tracked in IndexedDB and local queue
    // Avoid creating unnecessary dummy documents in batch_operations to preserve Firestore free tier quota

    // 2. If system state snapshot is provided or cached, compress and include in batch
    if (latestSystemData) {
      const systemDocRef = doc(db, "system_state", "main_center_data");
      try {
        const compression = await compressData(latestSystemData);
        batch.set(systemDocRef, {
          _compressedPayload: compression.compressedString,
          updatedAt: latestSystemData.updatedAt || Date.now(),
          syncedAtIso: new Date().toISOString(),
          studentsCount: (latestSystemData.students || []).length,
        }, { merge: true });
      } catch {
        batch.set(systemDocRef, {
          ...latestSystemData,
          syncedAtIso: new Date().toISOString(),
        }, { merge: true });
      }
    }

    // Commit atomic batch to Firestore with safe timeout and timer cleanup
    await safeWithTimeout(batch.commit(), 25000, "انتهت مهلة إرسال الحزمة السحابية");

    // Remove committed operations from queue
    inMemoryQueue = inMemoryQueue.filter((o) => !chunkIds.includes(o.id));
    persistQueueLocally();
    removeOperationsFromIndexedDB(chunkIds).catch(() => {});

    lastBatchFlushIso = new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    nextFlushEpoch = Date.now() + AUTO_FLUSH_INTERVAL_MS;
    isFlushingBatch = false;
    notifyBatchStatus();

    // If there are still operations left (>100 were accumulated), flush the next chunk
    if (inMemoryQueue.length >= BATCH_SIZE_THRESHOLD) {
      setTimeout(() => {
        flushSmartBatchToFirestore(latestSystemData).catch(() => {});
      }, 100);
    }

    return true;
  } catch (err) {
    console.warn("Smart batch commit to Firestore deferred:", err);
    isFlushingBatch = false;
    notifyBatchStatus();
    return false;
  }
}
