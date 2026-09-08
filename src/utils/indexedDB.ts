/**
 * Robust IndexedDB Storage Engine for Zero-Latency Local Operations
 * Provides safe, asynchronous, persistent storage in the browser.
 */

const DB_NAME = "AimanCenterDB_v1";
const DB_VERSION = 1;
const STORE_OPERATIONS = "pending_operations";
const STORE_SNAPSHOT = "system_snapshot";

interface OperationRecord {
  id: string;
  type: string;
  payload: any;
  timestamp: number;
}

let dbInstance: IDBDatabase | null = null;
let dbInitPromise: Promise<IDBDatabase | null> | null = null;

export async function openIndexedDB(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return null;
  }

  if (dbInstance) return dbInstance;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e: IDBVersionChangeEvent) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_OPERATIONS)) {
          db.createObjectStore(STORE_OPERATIONS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_SNAPSHOT)) {
          db.createObjectStore(STORE_SNAPSHOT, { keyPath: "key" });
        }
      };

      request.onsuccess = (e) => {
        dbInstance = (e.target as IDBOpenDBRequest).result;
        resolve(dbInstance);
      };

      request.onerror = (e) => {
        console.warn("IndexedDB open error (falling back to LocalStorage):", e);
        resolve(null);
      };
    } catch (err) {
      console.warn("IndexedDB not supported or blocked, using LocalStorage:", err);
      resolve(null);
    }
  });

  return dbInitPromise;
}

/**
 * Save an operation to IndexedDB pending queue
 */
export async function saveOperationToIndexedDB(op: OperationRecord): Promise<void> {
  try {
    const db = await openIndexedDB();
    if (!db) return;

    const tx = db.transaction(STORE_OPERATIONS, "readwrite");
    const store = tx.objectStore(STORE_OPERATIONS);
    store.put(op);
  } catch (err) {
    // Non-fatal, LocalStorage handles synchronous fallback
  }
}

/**
 * Get all pending operations from IndexedDB
 */
export async function getPendingOperationsFromIndexedDB(): Promise<OperationRecord[]> {
  try {
    const db = await openIndexedDB();
    if (!db) return [];

    return new Promise<OperationRecord[]>((resolve) => {
      const tx = db.transaction(STORE_OPERATIONS, "readonly");
      const store = tx.objectStore(STORE_OPERATIONS);
      const req = store.getAll();

      req.onsuccess = () => {
        resolve(req.result || []);
      };
      req.onerror = () => {
        resolve([]);
      };
    });
  } catch {
    return [];
  }
}

/**
 * Delete specific operations from IndexedDB once committed to Firestore
 */
export async function removeOperationsFromIndexedDB(ids: string[]): Promise<void> {
  try {
    const db = await openIndexedDB();
    if (!db || ids.length === 0) return;

    const tx = db.transaction(STORE_OPERATIONS, "readwrite");
    const store = tx.objectStore(STORE_OPERATIONS);
    ids.forEach((id) => store.delete(id));
  } catch {
    // Non-fatal
  }
}

/**
 * Save system state snapshot to IndexedDB for large offline persistence
 */
export async function saveSnapshotToIndexedDB(key: string, data: any): Promise<void> {
  try {
    const db = await openIndexedDB();
    if (!db) return;

    const tx = db.transaction(STORE_SNAPSHOT, "readwrite");
    const store = tx.objectStore(STORE_SNAPSHOT);
    store.put({ key, data, updatedAt: Date.now() });
  } catch {
    // Non-fatal
  }
}

/**
 * Load system state snapshot from IndexedDB
 */
export async function loadSnapshotFromIndexedDB(key: string): Promise<any | null> {
  try {
    const db = await openIndexedDB();
    if (!db) return null;

    return new Promise<any>((resolve) => {
      const tx = db.transaction(STORE_SNAPSHOT, "readonly");
      const store = tx.objectStore(STORE_SNAPSHOT);
      const req = store.get(key);

      req.onsuccess = () => {
        resolve(req.result ? req.result.data : null);
      };
      req.onerror = () => {
        resolve(null);
      };
    });
  } catch {
    return null;
  }
}
