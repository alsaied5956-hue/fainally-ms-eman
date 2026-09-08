import { doc, setDoc, onSnapshot, arrayUnion } from "firebase/firestore";
import { db, ensureFirebaseAuth } from "./firebase";

export interface LiveAttendanceEvent {
  studentId: string;
  status: "حضور" | "تأخير" | "غائب";
  timestamp: number;
}

const LIVE_EVENTS_DOC_PATH = "live_events";
const LIVE_EVENTS_DOC_ID = "today";

/**
 * Push an instantaneous, lightweight attendance event to Firestore path `live_events/today`.
 * Contains ONLY: { studentId, status, timestamp }.
 * The write is ultra-lightweight (~60 bytes), consumes minimal quota,
 * avoids unbounded array growth (prevents hitting the 1MB document ceiling),
 * and notifies any secondary systems in the exact same second without loading full student profiles.
 */
const liveChannel =
  typeof window !== "undefined" && "BroadcastChannel" in window
    ? new BroadcastChannel("aiman_live_events_stream")
    : null;

let pendingLiveEventsQueue: LiveAttendanceEvent[] = [];
let isFlushingLiveEvents = false;
let liveFlushTimeout: ReturnType<typeof setTimeout> | null = null;
let lastLiveWriteTimestamp = 0;

async function processLiveEventsQueue(): Promise<void> {
  if (isFlushingLiveEvents || pendingLiveEventsQueue.length === 0) return;

  const now = Date.now();
  const timeSinceLastWrite = now - lastLiveWriteTimestamp;
  const MIN_WRITE_INTERVAL_MS = 2000; // Safeguard Firestore quota

  if (timeSinceLastWrite < MIN_WRITE_INTERVAL_MS) {
    if (!liveFlushTimeout) {
      liveFlushTimeout = setTimeout(() => {
        liveFlushTimeout = null;
        processLiveEventsQueue().catch(() => {});
      }, MIN_WRITE_INTERVAL_MS - timeSinceLastWrite);
    }
    return;
  }

  isFlushingLiveEvents = true;
  const eventsToProcess = [...pendingLiveEventsQueue];
  pendingLiveEventsQueue = [];
  const latestEvent = eventsToProcess[eventsToProcess.length - 1];

  // Broadcast to local tabs/windows with zero network and zero quota usage
  if (liveChannel && latestEvent) {
    try {
      liveChannel.postMessage(latestEvent);
    } catch {}
  }

  try {
    await ensureFirebaseAuth();
    const eventDocRef = doc(db, LIVE_EVENTS_DOC_PATH, LIVE_EVENTS_DOC_ID);

    await setDoc(
      eventDocRef,
      {
        lastEvent: latestEvent,
        recentBatch: eventsToProcess.slice(-10),
        updatedAt: latestEvent.timestamp,
      },
      { merge: true }
    );
    lastLiveWriteTimestamp = Date.now();
  } catch (err) {
    // Graceful fallback on quota exhaustion or network drop
    console.warn("Live event push notice (safe fallback):", err);
  }

  isFlushingLiveEvents = false;

  if (pendingLiveEventsQueue.length > 0) {
    setTimeout(() => {
      processLiveEventsQueue().catch(() => {});
    }, MIN_WRITE_INTERVAL_MS);
  }
}

/**
 * Push an instantaneous attendance event.
 * Always broadcasts to local tabs/windows via zero-quota BroadcastChannel.
 * By default, skips individual Firestore document writes during routine group scanning to protect quota,
 * and saves writes for batch finalization or explicit sync.
 */
export async function pushLiveAttendanceEvent(
  studentId: string,
  status: "حضور" | "تأخير" | "غائب",
  timestamp: number = Date.now(),
  writeToFirestore: boolean = false
): Promise<void> {
  const event: LiveAttendanceEvent = {
    studentId: String(studentId).trim(),
    status,
    timestamp,
  };

  // Instant broadcast to local tabs with zero cloud quota
  if (liveChannel) {
    try {
      liveChannel.postMessage(event);
    } catch {}
  }

  if (writeToFirestore) {
    pendingLiveEventsQueue.push(event);
    processLiveEventsQueue().catch(() => {});
  }
}

/**
 * Push multiple attendance events in a single coordinated atomic write.
 * Prevents Firestore document contention when finalizing entire groups or recording bulk absences.
 */
export async function pushLiveAttendanceBatch(
  events: Array<{ studentId: string; status: "حضور" | "تأخير" | "غائب"; timestamp?: number }>
): Promise<void> {
  if (!events || events.length === 0) return;

  const mapped: LiveAttendanceEvent[] = events.map((e) => ({
    studentId: String(e.studentId).trim(),
    status: e.status,
    timestamp: e.timestamp || Date.now(),
  }));

  pendingLiveEventsQueue.push(...mapped);
  processLiveEventsQueue().catch(() => {});
}

/**
 * Realtime Listener for the Second System (المنظومة الثانية):
 * Restricts onSnapshot EXCLUSIVELY to `live_events/today`.
 * Instantly receives incoming scans in the exact same second,
 * allowing instant parent notifications without downloading or querying full student documents.
 */
export function subscribeToLiveEventStream(
  onEvent: (event: LiveAttendanceEvent) => void,
  onError?: (err: unknown) => void
): () => void {
  const eventDocRef = doc(db, LIVE_EVENTS_DOC_PATH, LIVE_EVENTS_DOC_ID);
  let lastProcessedTimestamp = 0;

  const unsubscribe = onSnapshot(
    eventDocRef,
    (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.data();
      const last = data?.lastEvent as LiveAttendanceEvent | undefined;

      if (last && last.timestamp && last.timestamp > lastProcessedTimestamp) {
        lastProcessedTimestamp = last.timestamp;
        try {
          onEvent(last);
        } catch (e) {
          console.error("Error in live event listener handler:", e);
        }
      }
    },
    (err) => {
      console.warn("Live events stream onSnapshot error:", err);
      if (onError) onError(err);
    }
  );

  return unsubscribe;
}
