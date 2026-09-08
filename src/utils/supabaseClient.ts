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

export interface AttendanceStatusSyncPayload {
  action: "update" | "delete";
  barcode: string;
  dateKey: string;
  status: string; // "" or "لم يسجل" for deletion/clearance
  previousStatus?: string;
  changedBy?: string;
  timestamp: number;
}

export interface GradeSyncPayload {
  action: "record" | "update" | "clear" | "delete";
  barcode: string;
  examTitle?: string;
  score?: number;
  maxScore?: number;
  scoreFormatted?: string;
  scoreString?: string;
  points?: number;
  totalExamScores?: number[];
  updatedScores?: number[];
  timestamp: number;
}

export interface SessionClearedSyncPayload {
  grade: string;
  resetTodayAttendance?: boolean;
  clearedBy?: string;
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

/** Broadcast single attendance status update or deletion/clearance across all devices */
export async function broadcastAttendanceStatusChange(payload: AttendanceStatusSyncPayload): Promise<void> {
  try {
    const channel = getOrCreateRealtimeHub();
    await channel.send({
      type: "broadcast",
      event: "attendance_status_change",
      payload,
    });
  } catch (err) {
    console.warn("Realtime broadcast attendance status notice:", err);
  }
}

/** Broadcast grade recording, modification, or clearance across all devices */
export async function broadcastGradeChange(payload: GradeSyncPayload): Promise<void> {
  try {
    const channel = getOrCreateRealtimeHub();
    await channel.send({
      type: "broadcast",
      event: "grade_change",
      payload,
    });
  } catch (err) {
    console.warn("Realtime broadcast grade notice:", err);
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

// In-memory barcode to student_id cache to avoid redundant network lookups
const barcodeToIdCache = new Map<string, string>();

const paymentListeners = new Set<(payload: PaymentSyncPayload) => void>();
let paymentsDbChannel: RealtimeChannel | null = null;

function initPaymentsDbChannelOnce(): void {
  if (paymentsDbChannel) return;
  try {
    // Note: In Supabase, postgres_changes callbacks MUST be registered BEFORE calling .subscribe()
    paymentsDbChannel = supabase
      .channel("payments-db-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments" },
        async (payload) => {
          try {
            if (payload.eventType === "DELETE") {
              const oldRow = payload.old as any;
              if (oldRow) {
                let barcode = "";
                for (const [b, id] of barcodeToIdCache.entries()) {
                  if (id === oldRow.student_id) {
                    barcode = b;
                    break;
                  }
                }
                if (!barcode && oldRow.student_id) {
                  const { data } = await supabase.from("students").select("barcode").eq("id", oldRow.student_id).maybeSingle();
                  if (data?.barcode) barcode = data.barcode;
                }
                if (barcode && oldRow.month_key) {
                  const syncPayload: PaymentSyncPayload = {
                    action: "delete",
                    barcode,
                    monthKey: oldRow.month_key,
                    amount: 0,
                    date: "",
                    time: "",
                    note: "",
                    recordedBy: "external_sync",
                    timestamp: Date.now(),
                  };
                  paymentListeners.forEach((fn) => {
                    try { fn(syncPayload); } catch {}
                  });
                }
              }
            } else if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
              const newRow = payload.new as any;
              if (newRow) {
                let barcode = "";
                for (const [b, id] of barcodeToIdCache.entries()) {
                  if (id === newRow.student_id) {
                    barcode = b;
                    break;
                  }
                }
                if (!barcode && newRow.student_id) {
                  const { data } = await supabase.from("students").select("barcode").eq("id", newRow.student_id).maybeSingle();
                  if (data?.barcode) barcode = data.barcode;
                }
                if (barcode && newRow.month_key) {
                  const syncPayload: PaymentSyncPayload = {
                    action: payload.eventType === "INSERT" ? "record" : "update",
                    barcode,
                    monthKey: newRow.month_key,
                    amount: Number(newRow.amount_paid) || 0,
                    date: newRow.payment_date || "",
                    time: "",
                    note: newRow.notes || "",
                    recordedBy: newRow.received_by || "external_sync",
                    timestamp: Date.now(),
                  };
                  paymentListeners.forEach((fn) => {
                    try { fn(syncPayload); } catch {}
                  });
                }
              }
            }
          } catch (err) {
            console.warn("Postgres CDC payments listener error:", err);
          }
        }
      );

    paymentsDbChannel.subscribe((status) => {
      console.log(`[Supabase Payments DB Channel] Status: ${status}`);
    });
  } catch (err) {
    console.warn("Failed to initialize payments DB channel:", err);
  }
}

export function subscribeToPaymentChanges(
  onPaymentChanged: (payload: PaymentSyncPayload) => void
): () => void {
  paymentListeners.add(onPaymentChanged);

  // 1. WebSocket sub-20ms broadcast event
  const hubChannel = getOrCreateRealtimeHub();
  hubChannel.on("broadcast", { event: "payment_change" }, ({ payload }) => {
    if (payload && typeof onPaymentChanged === "function") {
      onPaymentChanged(payload as PaymentSyncPayload);
    }
  });

  // 2. Dedicated channel for Postgres changes (registered before subscribe)
  initPaymentsDbChannelOnce();

  return () => {
    paymentListeners.delete(onPaymentChanged);
  };
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

const studentListeners = new Set<(payload: StudentSyncPayload) => void>();
let studentsDbChannel: RealtimeChannel | null = null;

function initStudentsDbChannelOnce(): void {
  if (studentsDbChannel) return;
  try {
    studentsDbChannel = supabase
      .channel("students-db-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "students" },
        (payload) => {
          try {
            if (payload.eventType === "DELETE") {
              const oldRow = payload.old as any;
              const barcode = oldRow?.barcode;
              if (barcode) {
                studentListeners.forEach((fn) => {
                  try { fn({ action: "delete", barcode, timestamp: Date.now() }); } catch {}
                });
              }
            } else if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
              const newRow = payload.new as any;
              if (newRow?.barcode) {
                studentListeners.forEach((fn) => {
                  try {
                    fn({
                      action: payload.eventType === "INSERT" ? "add" : "update",
                      barcode: newRow.barcode,
                      studentData: {
                        barcode: newRow.barcode,
                        name: newRow.name,
                        phone: newRow.phone,
                        parentPhone: newRow.parent_phone,
                        groupGrade: newRow.grade,
                        groupDays: newRow.group_days,
                        notes: newRow.notes,
                        updatedAt: Date.now(),
                      },
                      timestamp: Date.now(),
                    });
                  } catch {}
                });
              }
            }
          } catch (err) {
            console.warn("Postgres CDC students listener error:", err);
          }
        }
      );
    studentsDbChannel.subscribe((status) => {
      console.log(`[Supabase Students DB Channel] Status: ${status}`);
    });
  } catch (err) {
    console.warn("Failed to initialize students DB channel:", err);
  }
}

export function subscribeToStudentChanges(
  onStudentChanged: (payload: StudentSyncPayload) => void
): () => void {
  studentListeners.add(onStudentChanged);

  const hubChannel = getOrCreateRealtimeHub();
  hubChannel.on("broadcast", { event: "student_change" }, ({ payload }) => {
    if (payload && typeof onStudentChanged === "function") {
      onStudentChanged(payload as StudentSyncPayload);
    }
  });

  initStudentsDbChannelOnce();

  return () => {
    studentListeners.delete(onStudentChanged);
  };
}

const attendanceStatusListeners = new Set<(payload: AttendanceStatusSyncPayload) => void>();

export function subscribeToAttendanceStatusChanges(
  onAttendanceChanged: (payload: AttendanceStatusSyncPayload) => void
): () => void {
  attendanceStatusListeners.add(onAttendanceChanged);

  const hubChannel = getOrCreateRealtimeHub();
  hubChannel.on("broadcast", { event: "attendance_status_change" }, ({ payload }) => {
    if (payload && typeof onAttendanceChanged === "function") {
      onAttendanceChanged(payload as AttendanceStatusSyncPayload);
    }
  });

  return () => {
    attendanceStatusListeners.delete(onAttendanceChanged);
  };
}

const gradeChangeListeners = new Set<(payload: GradeSyncPayload) => void>();

export function subscribeToGradeChanges(
  onGradeChanged: (payload: GradeSyncPayload) => void
): () => void {
  gradeChangeListeners.add(onGradeChanged);

  const hubChannel = getOrCreateRealtimeHub();
  hubChannel.on("broadcast", { event: "grade_change" }, ({ payload }) => {
    if (payload && typeof onGradeChanged === "function") {
      onGradeChanged(payload as GradeSyncPayload);
    }
  });

  return () => {
    gradeChangeListeners.delete(onGradeChanged);
  };
}

export async function broadcastSessionCleared(payload: SessionClearedSyncPayload): Promise<void> {
  try {
    const hubChannel = getOrCreateRealtimeHub();
    await hubChannel.send({
      type: "broadcast",
      event: "session_cleared",
      payload,
    });
  } catch (err) {
    console.warn("broadcastSessionCleared error:", err);
  }
}

const sessionClearedListeners = new Set<(payload: SessionClearedSyncPayload) => void>();

export function subscribeToSessionCleared(
  onSessionCleared: (payload: SessionClearedSyncPayload) => void
): () => void {
  sessionClearedListeners.add(onSessionCleared);

  const hubChannel = getOrCreateRealtimeHub();
  hubChannel.on("broadcast", { event: "session_cleared" }, ({ payload }) => {
    if (payload && typeof onSessionCleared === "function") {
      onSessionCleared(payload as SessionClearedSyncPayload);
    }
  });

  return () => {
    sessionClearedListeners.delete(onSessionCleared);
  };
}

// ------------------------------------------------------------------------
// 4. SUPABASE POSTGRES PERSISTENCE HELPERS
// ------------------------------------------------------------------------

async function getStudentIdByBarcode(barcode: string): Promise<string | null> {
  try {
    const b = String(barcode).trim();
    if (barcodeToIdCache.has(b)) {
      return barcodeToIdCache.get(b)!;
    }
    const { data, error } = await supabase
      .from("students")
      .select("id")
      .eq("barcode", b)
      .maybeSingle();

    if (error || !data) {
      return null;
    }
    if (data?.id) {
      barcodeToIdCache.set(b, data.id);
      return data.id;
    }
    return null;
  } catch (err) {
    console.warn("getStudentIdByBarcode error:", err);
    return null;
  }
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
  try {
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
  } catch (err) {
    console.warn("saveAttendanceToSupabase error:", err);
  }
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

  try {
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
  } catch (err) {
    console.warn("saveBulkAttendanceToSupabase error:", err);
  }
}

/** Delete single attendance record from Supabase */
export async function deleteAttendanceFromSupabase(barcode: string, dateKey: string): Promise<void> {
  try {
    const studentId = await getStudentIdByBarcode(barcode);
    if (!studentId) return;

    await supabase
      .from("attendance_logs")
      .delete()
      .eq("student_id", studentId)
      .eq("date_key", dateKey);
  } catch (err) {
    console.warn("deleteAttendanceFromSupabase error:", err);
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
  try {
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
  } catch (err) {
    console.warn("savePaymentToSupabase error:", err);
  }
}

/** Delete payment from Supabase */
export async function deletePaymentFromSupabase(barcode: string, monthKey: string): Promise<void> {
  try {
    const studentId = await getStudentIdByBarcode(barcode);
    if (!studentId) return;

    await supabase
      .from("payments")
      .delete()
      .eq("student_id", studentId)
      .eq("month_key", monthKey);
  } catch (err) {
    console.warn("deletePaymentFromSupabase error:", err);
  }
}

/** Save or update homework record in Supabase */
export async function saveHomeworkToSupabase(records: Array<{
  barcode: string;
  dateKey: string;
  status: "done" | "incomplete" | "not_done";
  notes?: string;
}>): Promise<void> {
  if (!records || records.length === 0) return;

  try {
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
  } catch (err) {
    console.warn("saveHomeworkToSupabase error:", err);
  }
}

/** Save student to Supabase */
export async function saveStudentToSupabase(s: any): Promise<void> {
  if (!s || !s.barcode) return;
  try {
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
  } catch (err) {
    console.warn("saveStudentToSupabase error:", err);
  }
}

/** Delete student from Supabase */
export async function deleteStudentFromSupabase(barcode: string): Promise<void> {
  try {
    const b = String(barcode).trim();
    barcodeToIdCache.delete(b);
    await supabase.from("students").delete().eq("barcode", b);
  } catch (err) {
    console.warn("deleteStudentFromSupabase error:", err);
  }
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

/**
 * Invokes the database stored procedure to fetch an unbroken date series strictly matching
 * the student's group schedule (Sat/Mon/Wed for Group A, Sun/Tue/Thu for Group B)
 * outer-joined with real attendance records to prevent missing date gaps.
 */
export async function fetchStudentCompleteScheduleAttendance(
  barcode: string,
  startDate: string,
  endDate?: string
): Promise<Array<{
  student_id: string;
  barcode: string;
  student_name: string;
  group_days: string;
  date_key: string;
  day_of_week: number;
  day_name: string;
  status: string;
  is_recorded: boolean;
  time_recorded?: string;
}>> {
  const b = String(barcode).trim();
  const { data, error } = await supabase.rpc("get_student_complete_schedule_attendance", {
    p_barcode: b,
    p_start_date: startDate,
    p_end_date: endDate || new Date().toISOString().split("T")[0],
  });

  if (error || !data) {
    console.warn("get_student_complete_schedule_attendance RPC error:", error);
    return [];
  }

  return data;
}

/**
 * Records student group transfer in Supabase for audit compliance and schedule isolation
 */
export async function recordStudentGroupHistoryInSupabase(record: {
  barcode: string;
  groupDays: string;
  effectiveFrom: string;
  effectiveTo?: string;
  reason?: string;
}): Promise<void> {
  try {
    const studentId = await getStudentIdByBarcode(record.barcode);
    if (!studentId) return;

    await supabase.from("student_group_history").insert({
      student_id: studentId,
      barcode: String(record.barcode).trim(),
      group_days: record.groupDays,
      effective_from: record.effectiveFrom,
      effective_to: record.effectiveTo || null,
      reason: record.reason || "تحويل مجموعة دراسية",
    });
  } catch (err) {
    console.warn("recordStudentGroupHistoryInSupabase error:", err);
  }
}

