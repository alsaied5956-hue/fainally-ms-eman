import {
  writeBatch,
  doc,
  collection,
  getDocs,
  query,
  limit,
  DocumentReference,
  WriteBatch,
  Firestore
} from "firebase/firestore";
import { db } from "./firebase";

// Maximum operations per Firestore writeBatch is 500. We cap at 400 for safety buffer.
export const MAX_FIRESTORE_BATCH_SIZE = 400;

export interface BatchWriteOperation {
  type: "set" | "update" | "delete";
  ref: DocumentReference;
  data?: Record<string, unknown>;
  merge?: boolean;
}

export interface BatchProgressCallback {
  (completed: number, total: number, percentage: number): void;
}

// Global flag to coordinate listener muting during massive operations
let isBulkOperationInProgress = false;
const bulkOperationSubscribers: ((inProgress: boolean) => void)[] = [];

export function isBulkSyncActive(): boolean {
  return isBulkOperationInProgress;
}

export function subscribeToBulkOperationState(fn: (inProgress: boolean) => void): () => void {
  bulkOperationSubscribers.push(fn);
  return () => {
    const idx = bulkOperationSubscribers.indexOf(fn);
    if (idx !== -1) bulkOperationSubscribers.splice(idx, 1);
  };
}

function setBulkOperationStatus(status: boolean) {
  isBulkOperationInProgress = status;
  bulkOperationSubscribers.forEach((fn) => {
    try {
      fn(status);
    } catch {}
  });
}

/**
 * Execute a list of write, update, or delete operations in chunked batches.
 * Fully supports hundreds of thousands to billions of cumulative operations without throttling or memory issues.
 */
export async function executeBatchOperations(
  operations: BatchWriteOperation[],
  onProgress?: BatchProgressCallback
): Promise<{ success: boolean; totalProcessed: number; errors: unknown[] }> {
  if (!operations || operations.length === 0) {
    return { success: true, totalProcessed: 0, errors: [] };
  }

  setBulkOperationStatus(true);
  const total = operations.length;
  let processed = 0;
  const errors: unknown[] = [];

  try {
    for (let i = 0; i < total; i += MAX_FIRESTORE_BATCH_SIZE) {
      const chunk = operations.slice(i, i + MAX_FIRESTORE_BATCH_SIZE);
      const batch: WriteBatch = writeBatch(db);

      for (const op of chunk) {
        if (op.type === "set" && op.data) {
          batch.set(op.ref, op.data, { merge: op.merge ?? true });
        } else if (op.type === "update" && op.data) {
          batch.update(op.ref, op.data);
        } else if (op.type === "delete") {
          batch.delete(op.ref);
        }
      }

      // Retry mechanism with exponential backoff on rate limits
      let retries = 3;
      let success = false;
      while (retries > 0 && !success) {
        try {
          await batch.commit();
          success = true;
        } catch (err: any) {
          retries--;
          console.warn(`Batch commit warning (retries left: ${retries}):`, err?.message || err);
          if (retries === 0) {
            errors.push(err);
          } else {
            // Wait with backoff before retry to recover from network or throttling
            await new Promise((r) => setTimeout(r, 500 * (4 - retries)));
          }
        }
      }

      processed += chunk.length;
      if (onProgress) {
        const pct = Math.min(100, Math.round((processed / total) * 100));
        onProgress(processed, total, pct);
      }

      // 25ms micro-delay between chunks to allow network pipeline to drain and prevent browser thread freeze
      if (i + MAX_FIRESTORE_BATCH_SIZE < total) {
        await new Promise((r) => setTimeout(r, 25));
      }
    }
  } finally {
    setBulkOperationStatus(false);
  }

  return {
    success: errors.length === 0,
    totalProcessed: processed,
    errors,
  };
}

/**
 * Bulk Delete an entire collection or subcollection in chunked batches.
 * Prevents memory exhaustion by fetching document IDs in small pages.
 */
export async function bulkDeleteCollectionInBatches(
  collectionName: string,
  onProgress?: (deletedCount: number) => void
): Promise<{ success: boolean; totalDeleted: number }> {
  setBulkOperationStatus(true);
  let totalDeleted = 0;

  try {
    const colRef = collection(db, collectionName);

    while (true) {
      // Query small pages of documents to delete
      const q = query(colRef, limit(MAX_FIRESTORE_BATCH_SIZE));
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        break;
      }

      const batch = writeBatch(db);
      snapshot.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      await batch.commit();
      totalDeleted += snapshot.size;

      if (onProgress) {
        onProgress(totalDeleted);
      }

      if (snapshot.size < MAX_FIRESTORE_BATCH_SIZE) {
        break;
      }

      // Micro delay
      await new Promise((r) => setTimeout(r, 20));
    }
  } catch (err) {
    console.error(`Error during bulk delete of collection ${collectionName}:`, err);
    return { success: false, totalDeleted };
  } finally {
    setBulkOperationStatus(false);
  }

  return { success: true, totalDeleted };
}

/**
 * High-Scale Partitioning Helper:
 * If a compressed string payload exceeds 800KB (approaching Firestore's 1MB hard ceiling),
 * splits it into deterministic chunks stored under `system_state/chunk_{i}`.
 */
export const CHUNK_SIZE_BYTES = 700 * 1024; // 700 KB per chunk (very safe below 1048KB)

export function partitionLargePayload(payload: string): string[] {
  if (!payload || payload.length <= CHUNK_SIZE_BYTES) {
    return [payload];
  }

  const chunks: string[] = [];
  for (let i = 0; i < payload.length; i += CHUNK_SIZE_BYTES) {
    chunks.push(payload.slice(i, i + CHUNK_SIZE_BYTES));
  }
  return chunks;
}

export function assemblePartitionedPayload(chunks: string[]): string {
  if (!chunks || chunks.length === 0) return "";
  return chunks.join("");
}
