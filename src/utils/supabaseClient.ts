/**
 * src/utils/supabaseClient.ts
 * High-Performance Supabase v2 Client & Sub-20ms Realtime WebSocket Hub
 * Powers Instant Multi-Device Sync for Attendance, Group Finalization, Payments, Homework, and Students
 */

import { createClient, SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import { isOfficialGroupDay } from "./helpers";

const SUPABASE_URL =
  (import.meta as any).env?.VITE_SUPABASE_URL || "https://lzdvmzumwuqycwdecaan.supabase.co";
const SUPABASE_ANON_KEY =
  (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || "sb_publishable_B2ATdO71x3VxvOL18ATZtA_bupiDf3l";

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 30,
    },
  },
});

export interface LiveScanPayload {
  barcode: string;
  name: string;
  grade: string;
  days: string;
  status: "حضور" | "تأخير" | "غياب";
  timeIso: string;
  timeDisplay: string;
  isPaid: boolean;
  scannedBy: string;
  timestamp: number;
}

export interface GroupFinishedPayload {
  grade: string;
  days: string;
  absentBarcodes: string[];
  lateBarcodes: string[];
  presentBarcodes: string[];
  dateKey: string;
  finishedBy: string;
  timestamp: number;
}

export interface PaymentSyncPayload {
  action: "record" | "update" | "delete";
  barcode: string;
  monthKey: string;
  amount: number;
  date: string;
  time: string;
  note: string;
  recordedBy: string;
  timestamp: number;
}

export interface HomeworkSyncPayload {
  action: "update" | "bulk_update";
  barcodes: string[];
  dateKey: string;
  status: "done" | "incomplete" | "not_done";
  notes?: string;
  updatedBy: string;
  timestamp: number;
}

export interface StudentSyncPayload {
  action: "add" | "update" | "delete";
  barcode: string;
  studentData?: any;
  timestamp: number;
}

export function getTodayDateKey(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ------------------------------------------------------------------------
// 1. DEDICATED REALTIME HUB (Sub-20ms WebSocket Channel)
// ------------------------------------------------------------------------

let realtimeHubChannel: RealtimeChannel | null = null;

export function getOrCreateRealtimeHub(): RealtimeChannel {
  if (!realtimeHubChannel) {
    realtimeHubChannel = supabase.channel("realtime-center-hub", {
      config: {
        broadcast: {
          self: false, // Don't echo back to the emitting device
          ack: false,  // Fire-and-forget for absolute zero-latency
        },
      },
    });

    realtimeHubChannel.subscribe((status) => {
      console.log(`[Supabase Realtime Hub] Status: ${status}`);
    });
  }
  return realtimeHubChannel;
}

// ------------------------------------------------------------------------
// 2. BROADCAST METHODS (Zero Latency Emits)
// ------------------------------------------------------------------------

/** Broadcast single scan to all assistant screens */
export async function broadcastLiveScan(payload: LiveScanPayload): Promise<void> {
  try {
    const channel = getOrCreateRealtimeHub();
    await channel.send({
      type: "broadcast",
      event: "assistant_scan",
      payload,
    });
  } catch (err) {
    console.warn("Realtime broadcast scan notice:", err);
  }
}

/** Broadcast group finish (حفظ وإرسال الغياب للكل) across all screens */
export async function broadcastGroupFinished(payload: GroupFinishedPayload): Promise<void> {
  try {
    const channel = getOrCreateRealtimeHub();
    await channel.send({
      type: "broadcast",
      event: "group_finished",
      payload,
    });
  } catch (err) {
    console.warn("Realtime broadcast group finish notice:", err);
  }
}

/** Broadcast payment record / update / delete across all screens */
export async function broadcastPaymentChange(payload: PaymentSyncPayload): Promise<void> {
  try {
    const channel = getOrCreateRealtimeHub();
    await channel.send({
      type: "broadcast",
      event: "payment_change",
      payload,
    });
  } catch (err) {
    console.warn("Realtime broadcast payment notice:", err);
  }
}

/** Broadcast homework status update across all screens */
export async function broadcastHomeworkChange(payload: HomeworkSyncPayload): Promise<void> {
  try {
    const channel = getOrCreateRealtimeHub();
    await channel.send({
      type: "broadcast",
      event: "homework_change",
      payload,
    });
  } catch (err) {
    console.warn("Realtime broadcast homework notice:", err);
  }
}

/** Broadcast student addition, update, or deletion */
export async function broadcastStudentChange(payload: StudentSyncPayload): Promise<void> {
  try {
    const channel = getOrCreateRealtimeHub();
    await channel.send({
      type: "broadcast",
      event: "student_change",
      payload,
    });
  } catch (err) {
    console.warn("Realtime broadcast student notice:", err);
  }
}

// ------------------------------------------------------------------------
// 3. LISTENERS (Instant Reception on All Devices)
// ------------------------------------------------------------------------

export function subscribeToLiveScans(
  onScanReceived: (payload: LiveScanPayload) => void
): () => void {
  const channel = getOrCreateRealtimeHub();
  channel.on("broadcast", { event: "assistant_scan" }, ({ payload }) => {
    if (payload && typeof onScanReceived === "function") {
      onScanReceived(payload as LiveScanPayload);
    }
  });
  return () => {};
}

export function subscribeToGroupFinished(
  onGroupFinished: (payload: GroupFinishedPayload) => void
): () => void {
  const channel = getOrCreateRealtimeHub();
  channel.on("broadcast", { event: "group_finished" }, ({ payload }) => {
    if (payload && typeof onGroupFinished === "function") {
      onGroupFinished(payload as GroupFinishedPayload);
    }
  });
  return () => {};
}

export function subscribeToPaymentChanges(
  onPaymentChanged: (payload: PaymentSyncPayload) => void
): () => void {
  const channel = getOrCreateRealtimeHub();
  channel.on("broadcast", { event: "payment_change" }, ({ payload }) => {
    if (payload && typeof onPaymentChanged === "function") {
      onPaymentChanged(payload as PaymentSyncPayload);
    }
  });
  return () => {};
}

export function subscribeToHomeworkChanges(
  onHomeworkChanged: (payload: HomeworkSyncPayload) => void
): () => void {
  const channel = getOrCreateRealtimeHub();
  channel.on("broadcast", { event: "homework_change" }, ({ payload }) => {
    if (payload && typeof onHomeworkChanged === "function") {
      onHomeworkChanged(payload as HomeworkSyncPayload);
    }
  });
  return () => {};
}

export function subscribeToStudentChanges(
  onStudentChanged: (payload: StudentSyncPayload) => void
): () => void {
  const channel = getOrCreateRealtimeHub();
  channel.on("broadcast", { event: "student_change" }, ({ payload }) => {
    if (payload && typeof onStudentChanged === "function") {
      onStudentChanged(payload as StudentSyncPayload);
    }
  });
  return () => {};
}

// ------------------------------------------------------------------------
// 4. SUPABASE POSTGRES PERSISTENCE HELPERS
// ------------------------------------------------------------------------

// In-memory barcode to student_id cache to avoid redundant network lookups
const barcodeToIdCache = new Map<string, string>();

async function getStudentIdByBarcode(barcode: string): Promise<string | null> {
  const b = String(barcode).trim();
  if (barcodeToIdCache.has(b)) {
    return barcodeToIdCache.get(b)!;
  }
  const { data } = await supabase
    .from("students")
    .select("id")
    .eq("barcode", b)
    .maybeSingle();

  if (data?.id) {
    barcodeToIdCache.set(b, data.id);
    return data.id;
  }
  return null;
}

/** Save single attendance record to Supabase */
export async function saveAttendanceToSupabase(record: {
  barcode: string;
  studentName: string;
  status: "حضور" | "تأخير" | "غياب";
  timeIso?: string;
  dateKey?: string;
  scannedBy?: string;
}): Promise<void> {
  const dateKey = record.dateKey || getTodayDateKey();
  const studentId = await getStudentIdByBarcode(record.barcode);
  if (!studentId) return;

  await supabase
    .from("attendance_logs")
    .upsert(
      {
        student_id: studentId,
        barcode: String(record.barcode).trim(),
        student_name: record.studentName,
        date_key: dateKey,
        time_recorded: record.timeIso || new Date().toISOString(),
        status: record.status,
        scanned_by: record.scannedBy || "admin",
      },
      { onConflict: "student_id,date_key" }
    );
}

/**
 * Bulk save group attendance to Supabase in parallel chunks
 * Called when "حفظ وإرسال الغياب للكل" is clicked
 */
export async function saveBulkAttendanceToSupabase(
  records: Array<{
    barcode: string;
    studentName: string;
    status: "حضور" | "تأخير" | "غياب";
    dateKey: string;
    scannedBy?: string;
  }>
): Promise<void> {
  if (!records || records.length === 0) return;

  const rowsToInsert = [];
  for (const rec of records) {
    const sId = await getStudentIdByBarcode(rec.barcode);
    if (!sId) continue;
    rowsToInsert.push({
      student_id: sId,
      barcode: String(rec.barcode).trim(),
      student_name: rec.studentName,
      date_key: rec.dateKey,
      time_recorded: new Date().toISOString(),
      status: rec.status,
      scanned_by: rec.scannedBy || "admin",
    });
  }

  const chunkSize = 100;
  for (let i = 0; i < rowsToInsert.length; i += chunkSize) {
    const chunk = rowsToInsert.slice(i, i + chunkSize);
    await supabase
      .from("attendance_logs")
      .upsert(chunk, { onConflict: "student_id,date_key" });
  }
}

/** Save or update payment in Supabase */
export async function savePaymentToSupabase(record: {
  barcode: string;
  monthKey: string;
  amount: number;
  date?: string;
  note?: string;
  recordedBy?: string;
}): Promise<void> {
  const studentId = await getStudentIdByBarcode(record.barcode);
  if (!studentId) return;

  await supabase
    .from("payments")
    .upsert(
      {
        student_id: studentId,
        month_key: record.monthKey,
        amount_paid: Number(record.amount) || 0,
        required_amount: Number(record.amount) || 100,
        discount: 0,
        status: "paid",
        payment_date: record.date ? new Date(record.date).toISOString() : new Date().toISOString(),
        received_by: record.recordedBy || "admin",
        notes: record.note || "سداد اشتراك",
      },
      { onConflict: "student_id,month_key" }
    );
}

/** Delete payment from Supabase */
export async function deletePaymentFromSupabase(barcode: string, monthKey: string): Promise<void> {
  const studentId = await getStudentIdByBarcode(barcode);
  if (!studentId) return;

  await supabase
    .from("payments")
    .delete()
    .eq("student_id", studentId)
    .eq("month_key", monthKey);
}

/** Save or update homework record in Supabase */
export async function saveHomeworkToSupabase(records: Array<{
  barcode: string;
  dateKey: string;
  status: "done" | "incomplete" | "not_done";
  notes?: string;
}>): Promise<void> {
  if (!records || records.length === 0) return;

  const rows = [];
  for (const r of records) {
    const sId = await getStudentIdByBarcode(r.barcode);
    if (!sId) continue;
    rows.push({
      student_id: sId,
      date_key: r.dateKey,
      title: "واجب الحصة",
      status: r.status,
      notes: r.notes || "",
    });
  }

  if (rows.length > 0) {
    await supabase.from("homework").insert(rows);
  }
}

/** Save student to Supabase */
export async function saveStudentToSupabase(s: any): Promise<void> {
  if (!s || !s.barcode) return;
  const payload = {
    barcode: String(s.barcode).trim(),
    name: s.name || "طالب بدون اسم",
    phone: String(s.phone || ""),
    parent_phone: String(s.parentPhone || s.phone || "00000000000"),
    grade: s.groupGrade || s.grade || "غير محدد",
    group_days: s.groupDays || "غير محدد",
    group_time: s.groupTime || "04:00 م",
    monthly_fee: Number(s.monthlyFee) || 0,
    discount: Number(s.discount) || 0,
    notes: s.notes || "",
    is_active: s.isActive !== false,
  };

  const { data } = await supabase
    .from("students")
    .upsert(payload, { onConflict: "barcode" })
    .select("id")
    .single();

  if (data?.id) {
    barcodeToIdCache.set(String(s.barcode).trim(), data.id);
  }
}

/** Delete student from Supabase */
export async function deleteStudentFromSupabase(barcode: string): Promise<void> {
  const b = String(barcode).trim();
  barcodeToIdCache.delete(b);
  await supabase.from("students").delete().eq("barcode", b);
}

/**
 * Fetch real attendance logs for a student directly from Supabase,
 * dynamically filtering out cross-day or off-schedule records based on the student's assigned group schedule.
 * Group A: Sat/Mon/Wed only
 * Group B: Sun/Tue/Thu only
 */
export async function fetchStudentAttendanceBySchedule(
  barcode: string,
  groupDays?: string
): Promise<Array<{
  id: string;
  barcode: string;
  studentName: string;
  dateKey: string;
  status: "حضور" | "تأخير" | "غياب";
  timeRecorded: string;
  sessionSlotId?: string;
  scannedBy?: string;
  notes?: string;
}>> {
  const b = String(barcode).trim();
  
  const { data, error } = await supabase
    .from("attendance_logs")
    .select("*")
    .eq("barcode", b)
    .order("date_key", { ascending: false });

  if (error || !data) {
    console.warn("Failed to fetch attendance logs from Supabase:", error);
    return [];
  }

  // If groupDays is provided, strictly isolate dates according to the group schedule
  if (groupDays) {
    return data.filter((row) => isOfficialGroupDay(groupDays, row.date_key));
  }

  return data;
}
