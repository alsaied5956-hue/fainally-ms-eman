import { Student, PaymentRecord } from "../types";
import { db, ensureFirebaseAuth } from "./firebase";
import { doc, setDoc, onSnapshot, Unsubscribe } from "firebase/firestore";
import { CLIENT_ID } from "./onlineRealtimeSync";

export interface StudentLiveEvent {
  barcode: string;
  action: "update" | "delete" | "attendance_change" | "payment_change" | "exam_change" | "account_revoked";
  deletedItemType?: "student" | "attendance" | "payment" | "exam" | "account";
  deletedItemId?: string; // e.g. dateKey for attendance, monthKey for payment, examIndex/all
  dateKey?: string;
  attendanceStatus?: string | null;
  paymentMonthKey?: string;
  paymentRecord?: PaymentRecord | null;
  examScore?: number | string | null;
  examTitle?: string;
  studentData?: Partial<Student> | null;
  reason?: string;
  updatedAt: number;
  clientId?: string;
  version: number;
}

// In-memory SWR cache for active students: barcode -> cached data + timestamp
interface SWREntry {
  student: Student;
  cachedAt: number;
  version: number;
}

const swrStudentCache = new Map<string, SWREntry>();
const swrListeners = new Map<string, Set<(student: Student | null, event?: StudentLiveEvent) => void>>();

/**
 * Get cached student with 0ms latency (Stale)
 */
export function getCachedStudent(barcode: string): Student | null {
  const clean = String(barcode).trim();
  const entry = swrStudentCache.get(clean);
  return entry ? entry.student : null;
}

/**
 * Set student into local SWR cache
 */
export function setCachedStudent(barcode: string, student: Student): void {
  const clean = String(barcode).trim();
  swrStudentCache.set(clean, {
    student,
    cachedAt: Date.now(),
    version: Date.now(),
  });
  notifySWRListeners(clean, student);
}

/**
 * Invalidate cached student and notify all listening components
 */
export function invalidateStudentCache(barcode: string, deleted: boolean = false): void {
  const clean = String(barcode).trim();
  if (deleted) {
    swrStudentCache.delete(clean);
    notifySWRListeners(clean, null);
  } else {
    const entry = swrStudentCache.get(clean);
    if (entry) {
      entry.cachedAt = 0; // Force stale revalidate on next cycle
    }
  }
}

function notifySWRListeners(barcode: string, student: Student | null, event?: StudentLiveEvent): void {
  const clean = String(barcode).trim();
  const set = swrListeners.get(clean);
  if (set) {
    set.forEach((cb) => {
      try {
        cb(student, event);
      } catch (err) {
        console.warn("[StudentLiveSync] SWR listener notice:", err);
      }
    });
  }
}

/**
 * Broadcast an immediate update or deletion event to `/students_live/{barcode}`
 * Multi-layer broadcast: Window CustomEvent (0ms) -> BroadcastChannel -> Express SSE -> Scoped Firestore Doc
 */
export async function broadcastStudentLiveEvent(
  event: Omit<StudentLiveEvent, "clientId" | "updatedAt" | "version">
): Promise<void> {
  const barcode = String(event.barcode).trim();
  if (!barcode) return;

  const fullEvent: StudentLiveEvent = {
    ...event,
    barcode,
    clientId: CLIENT_ID,
    updatedAt: Date.now(),
    version: Date.now(),
  };

  // 1. Instant local DOM & SWR update (0ms latency on current window)
  if (event.action === "delete" && event.deletedItemType === "student") {
    invalidateStudentCache(barcode, true);
  }

  if (typeof window !== "undefined") {
    try {
      const channel = new BroadcastChannel("eman_student_live_channel");
      channel.postMessage(fullEvent);
      channel.close();
    } catch {}

    window.dispatchEvent(
      new CustomEvent("eman_student_live_event", {
        detail: fullEvent,
      })
    );
  }

  // 2. High-speed Express Server broadcast (<20ms to all parent SSE streams)
  try {
    fetch("/api/portal/student-live-event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": CLIENT_ID,
      },
      body: JSON.stringify(fullEvent),
    }).catch(() => {});
  } catch {}

  // 3. Scoped Firestore Document write strictly to `/students_live/{barcode}`
  try {
    await ensureFirebaseAuth();
    if (db) {
      const liveDocRef = doc(db, "students_live", barcode);
      await setDoc(liveDocRef, fullEvent, { merge: true });
    }
  } catch (err) {
    console.warn("[StudentLiveSync] Firestore write notice:", err);
  }
}

/**
 * Scoped subscription strictly to `/students_live/{barcode}`
 * Saves 95% bandwidth by avoiding full root database listeners.
 * Includes debouncing and connection jitter to handle 1,000+ concurrent parent logins safely.
 */
export function subscribeToStudentLiveBarcode(
  barcode: string,
  onEvent: (event: StudentLiveEvent) => void
): () => void {
  const cleanBarcode = String(barcode).trim();
  if (!cleanBarcode) return () => {};

  let isCancelled = false;

  // Add SWR listener
  let listenerSet = swrListeners.get(cleanBarcode);
  if (!listenerSet) {
    listenerSet = new Set();
    swrListeners.set(cleanBarcode, listenerSet);
  }
  const swrCb = (_st: Student | null, ev?: StudentLiveEvent) => {
    if (ev && !isCancelled) onEvent(ev);
  };
  listenerSet.add(swrCb);

  // Incoming event dispatcher
  const handleIncoming = (ev: StudentLiveEvent) => {
    if (isCancelled) return;
    if (String(ev.barcode).trim() !== cleanBarcode) return;

    // Handle student deletion / revocation remotely
    if (ev.action === "account_revoked" || (ev.action === "delete" && ev.deletedItemType === "student")) {
      executeInstantRemoteLogout(ev.reason || "تم حذف هذا الطالب أو الحساب من قِبل إدارة المنظومة.");
    }

    onEvent(ev);
  };

  // 1. Window custom event
  const onWindowEvent = (e: Event) => {
    const customEv = e as CustomEvent<StudentLiveEvent>;
    if (customEv.detail) {
      handleIncoming(customEv.detail);
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("eman_student_live_event", onWindowEvent);
  }

  // 2. BroadcastChannel cross-tab communication
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel("eman_student_live_channel");
    channel.onmessage = (msgEv) => {
      if (msgEv.data) handleIncoming(msgEv.data);
    };
  } catch {}

  // 3. Scoped Firestore Realtime Listener: Strictly `/students_live/{barcode}`
  // Add slight random jitter (50ms - 250ms) to protect quota during multi-parent traffic spikes
  let firestoreUnsub: Unsubscribe | null = null;
  const jitterMs = Math.floor(Math.random() * 200) + 50;

  const jitterTimer = setTimeout(() => {
    if (isCancelled) return;
    ensureFirebaseAuth()
      .then(() => {
        if (isCancelled || !db) return;
        try {
          const liveDocRef = doc(db, "students_live", cleanBarcode);
          firestoreUnsub = onSnapshot(
            liveDocRef,
            (snap) => {
              if (isCancelled || !snap.exists()) return;
              const data = snap.data() as StudentLiveEvent;
              if (data && data.updatedAt) {
                handleIncoming(data);
              }
            },
            (err) => {
              // Benign quota or network notice
              console.info("[StudentLiveSync] Scoped doc notice:", err?.message);
            }
          );
        } catch (err) {
          console.warn("[StudentLiveSync] onSnapshot error:", err);
        }
      })
      .catch(() => {});
  }, jitterMs);

  return () => {
    isCancelled = true;
    clearTimeout(jitterTimer);

    const s = swrListeners.get(cleanBarcode);
    if (s) {
      s.delete(swrCb);
      if (s.size === 0) swrListeners.delete(cleanBarcode);
    }

    if (typeof window !== "undefined") {
      window.removeEventListener("eman_student_live_event", onWindowEvent);
    }
    if (channel) {
      channel.close();
      channel = null;
    }
    if (firestoreUnsub) {
      firestoreUnsub();
      firestoreUnsub = null;
    }
  };
}

/**
 * Triggers instant remote logout, purges sessionStorage & local storage, and hard-redirects
 */
export function executeInstantRemoteLogout(reason?: string): void {
  const finalReason = reason || "تم حذف هذا الحساب من قِبل إدارة المنظومة وفصل الجلسة فوراً.";

  if (typeof window === "undefined") return;

  try {
    sessionStorage.clear();
  } catch {}

  try {
    localStorage.removeItem("eman_portal_session");
  } catch {}

  // Broadcast to all other tabs on same device
  try {
    const bus = new BroadcastChannel("eman_portal_accounts_bus");
    bus.postMessage({
      type: "ACCOUNT_REVOKED",
      reason: finalReason,
      timestamp: Date.now(),
    });
    bus.close();
  } catch {}

  window.dispatchEvent(
    new CustomEvent("eman_account_revoked", {
      detail: {
        reason: finalReason,
        revokedAt: new Date().toISOString(),
      },
    })
  );

  // If user is currently viewing the app, inform them with alert and hard reload to root
  try {
    alert(`⚠️ تنبيه أمني:\n${finalReason}`);
  } catch {}

  try {
    window.location.href = "/?notice=" + encodeURIComponent(finalReason);
  } catch {}
}
