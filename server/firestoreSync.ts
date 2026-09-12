import zlib from "zlib";
import type { Firestore } from "firebase/firestore";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import {
  setSystemDataFromCloud,
  getSystemCache,
  broadcastPortalSSE,
} from "./portalStore";

const STATUS_TO_CODE: Record<string, number> = { "حضور": 1, "غائب": 2, "تأخير": 3, "إذن": 4 };
const CODE_TO_STATUS: Record<number, string> = { 1: "حضور", 2: "غائب", 3: "تأخير", 4: "إذن" };

function hydrateStudent(raw: any): any {
  if (!raw || typeof raw !== "object") return raw;
  if (raw.barcode && raw.name) return raw;
  return {
    barcode: String(raw.b || ""),
    name: String(raw.n || ""),
    groupGrade: raw.g || "الصف الرابع الابتدائي",
    groupDays: raw.d || "سبت - إثنين - أربعاء",
    phone: String(raw.p || "0"),
    parentPhone: String(raw.pp || "0"),
    points: Number(raw.pts || 0),
    totalAttendanceDays: Number(raw.ad || 0),
    totalAbsentDays: Number(raw.abd || 0),
    totalExamScores: Array.isArray(raw.es) ? raw.es : [],
    customMonthlyFee: raw.fee,
    discountReason: raw.dr,
    lastExamTitle: raw.let || "",
    lastExamScore: raw.les || "",
    notes: raw.nt || "",
    createdAt: raw.ca || "",
  };
}

function hydrateAttendanceMap(attMap: any): any {
  if (!attMap || typeof attMap !== "object") return attMap;
  const res: Record<string, string> = {};
  for (const [k, v] of Object.entries(attMap)) {
    if (typeof v === "number" && CODE_TO_STATUS[v]) {
      res[k] = CODE_TO_STATUS[v];
    } else {
      res[k] = String(v);
    }
  }
  return res;
}

function hydrateHistory(history: any): any {
  if (!history || typeof history !== "object") return history;
  const res: Record<string, any> = {};
  for (const [date, dayMap] of Object.entries(history)) {
    res[date] = hydrateAttendanceMap(dayMap);
  }
  return res;
}

function hydratePayments(payments: any): any {
  if (!payments || typeof payments !== "object") return payments;
  const res: Record<string, any> = {};
  for (const [month, monthData] of Object.entries(payments)) {
    if (!monthData || typeof monthData !== "object") continue;
    res[month] = {};
    for (const [key, c] of Object.entries(monthData as Record<string, any>)) {
      if (!c || typeof c !== "object") continue;
      if (c.amount !== undefined) {
        res[month][key] = c;
        continue;
      }
      res[month][key] = {
        barcode: key,
        month,
        monthKey: month,
        amount: c.a !== undefined ? c.a : 0,
        date: c.d || "",
        time: c.t || "",
        note: c.n || `اشتراك شهر (${month})`,
        receiptNo: c.r || "",
        isCardFee: !!c.c,
        recordedBy: c.by || "admin",
      };
    }
  }
  return res;
}

export function hydrateSystemPayload(data: any): any {
  if (!data || typeof data !== "object") return data;
  if (data._packed !== 3 && data._v !== 3 && (!Array.isArray(data.students) || !data.students[0]?.b)) {
    return data;
  }
  const res = { ...data };
  if (Array.isArray(data.students)) {
    res.students = data.students.map(hydrateStudent);
  }
  if (data.attendanceHistory) {
    res.attendanceHistory = hydrateHistory(data.attendanceHistory);
  }
  if (data.attendanceToday) {
    res.attendanceToday = hydrateAttendanceMap(data.attendanceToday);
  }
  if (data.payments) {
    res.payments = hydratePayments(data.payments);
  }
  return res;
}

export function decompressServerPayload(data: any): any {
  if (!data) return null;
  if (data._compressedPayload && typeof data._compressedPayload === "string") {
    let payload = data._compressedPayload;
    if (payload.startsWith("GZIP:")) payload = payload.slice(5);
    const buf = Buffer.from(payload, "base64");
    const decompressed = JSON.parse(zlib.gunzipSync(buf).toString("utf8"));
    return hydrateSystemPayload(decompressed);
  }
  return hydrateSystemPayload(data);
}

let isSyncingToFirestore = false;
let queuedFirestorePush = false;

export async function pushServerStateToFirestore(db: Firestore, fullData?: any): Promise<boolean> {
  if (isSyncingToFirestore) {
    queuedFirestorePush = true;
    return true;
  }

  isSyncingToFirestore = true;
  try {
    const dataToSave = fullData || getSystemCache();
    const cleanData = {
      ...dataToSave,
      _lastClientId: "server_synced",
      _lastClientTimestamp: Date.now(),
      updatedAt: Date.now(),
      syncedAtIso: new Date().toISOString(),
    };

    const jsonStr = JSON.stringify(cleanData);
    const gzipped = zlib.gzipSync(Buffer.from(jsonStr, "utf8"));
    const b64 = "GZIP:" + gzipped.toString("base64");

    const docPayload = {
      _compressedPayload: b64,
      _lastClientId: "server_synced",
      _lastClientTimestamp: Date.now(),
      updatedAt: Date.now(),
      syncedAtIso: new Date().toISOString(),
      studentsCount: cleanData.students?.length || 0,
    };

    const dRef = doc(db, "system_state", "main_center_data");
    await setDoc(dRef, docPayload);
    return true;
  } catch (err) {
    console.warn("[FirestoreSync] Error pushing state to Firestore:", err);
    return false;
  } finally {
    isSyncingToFirestore = false;
    if (queuedFirestorePush) {
      queuedFirestorePush = false;
      setTimeout(() => pushServerStateToFirestore(db), 1000);
    }
  }
}

export async function initFirestoreSync(db: Firestore): Promise<void> {
  const dRef = doc(db, "system_state", "main_center_data");

  // 1. Initial hydration on cold start: load authoritative Firestore cloud state
  try {
    const snap = await getDoc(dRef);
    if (snap.exists()) {
      const data = snap.data();
      const hydrated = decompressServerPayload(data);
      if (hydrated && Array.isArray(hydrated.students) && hydrated.students.length > 0) {
        setSystemDataFromCloud(hydrated);
        console.log(`[FirestoreSync] Cold start: Loaded ${hydrated.students.length} students directly from Firestore.`);
      }
    }
  } catch (err: any) {
    console.warn("[FirestoreSync] Notice during cold start getDoc:", err?.message || err);
  }

  // 2. Real-time onSnapshot listener: instantly catch changes from any device
  try {
    onSnapshot(
      dRef,
      (snapshot) => {
        try {
          if (!snapshot.exists()) return;
          const data = snapshot.data();
          if (!data) return;

          // Don't bounce back server's own writes
          if (data._lastClientId === "server_synced") return;

          const hydrated = decompressServerPayload(data);
          if (hydrated && Array.isArray(hydrated.students)) {
            setSystemDataFromCloud(hydrated);
            console.log(`[FirestoreSync] Snapshot received. Updated cache with ${hydrated.students.length} students.`);

            // Broadcast lightweight notification over SSE so all devices pull the latest delta immediately
            broadcastPortalSSE({
              type: "SYSTEM_DATA_UPDATED",
              version: getSystemCache().version,
              studentsCount: getSystemCache().students.length,
              timestamp: Date.now(),
            });
          }
        } catch (procErr) {
          console.warn("[FirestoreSync] Snapshot processing error:", procErr);
        }
      },
      (err) => {
        console.warn("[FirestoreSync] onSnapshot listener warning:", err?.message || err);
      }
    );
  } catch (listenerErr) {
    console.warn("[FirestoreSync] Failed to initialize Firestore listener:", listenerErr);
  }
}
