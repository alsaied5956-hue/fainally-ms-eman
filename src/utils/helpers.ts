import { GradeName, GRADE_ORDER, Student, SessionSlot, PaymentRecord, GroupDays } from "../types";

export const SCHOOL_WHATSAPP_PHONE = "201070642904";
export const TEACHER_NAME = "الأستاذة إيمان الدمشيتي";

// Base default monthly prices per grade (from actual system records)
export const DEFAULT_GRADE_PRICES: Record<GradeName, number> = {
  "الصف الرابع الابتدائي": 100,
  "الصف الخامس الابتدائي": 100,
  "الصف السادس الابتدائي": 100,
  "الصف الأول الإعدادي": 120,
  "الصف الثاني الإعدادي": 120,
  "الصف الثالث الإعدادي": 150,
  "الصف الأول الثانوي": 180,
  "الصف الثاني الثانوي": 200,
  "الصف الثالث الثانوي": 220,
};

// Safe Local Date Key (YYYY-MM-DD) avoiding UTC shifts
export function getTodayKey(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getCurrentMonthKey(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function formatTimeArabic(d = new Date()): string {
  try {
    return d.toLocaleTimeString("ar-EG", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return d.toLocaleTimeString();
  }
}

export function formatArabicDate(dateStr?: string): string {
  try {
    const d = dateStr ? new Date(dateStr) : new Date();
    return d.toLocaleDateString("ar-EG", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return dateStr || "";
  }
}

export function getArabicDayName(dateStr: string): string {
  try {
    const parts = dateStr.split("-").map(Number);
    const d = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0) : new Date(dateStr);
    return d.toLocaleDateString("ar-EG", { weekday: "long" });
  } catch {
    return "";
  }
}

/**
 * Determine official scheduled group for any given date:
 * - Saturday (6), Monday (1), Wednesday (3) -> "سبت - إثنين - أربعاء"
 * - Sunday (0), Tuesday (2), Thursday (4) -> "أحد - ثلاثاء - خميس"
 * - Friday (5) -> Defaults to "سبت - إثنين - أربعاء" (weekly break)
 */
export function getGroupForDate(dateInput: string | Date = new Date()): GroupDays {
  let d: Date;
  if (dateInput instanceof Date) {
    d = dateInput;
  } else if (typeof dateInput === "string") {
    const parts = dateInput.split("-").map(Number);
    d = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0) : new Date(dateInput);
  } else {
    d = new Date();
  }

  const dayNum = d.getDay(); // 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
  if (dayNum === 6 || dayNum === 1 || dayNum === 3) {
    return "سبت - إثنين - أربعاء";
  }
  if (dayNum === 0 || dayNum === 2 || dayNum === 4) {
    return "أحد - ثلاثاء - خميس";
  }
  return "سبت - إثنين - أربعاء";
}

/**
 * Returns the official day-of-week indexes (0=Sun..6=Sat) for a group:
 * Group A (Sat, Mon, Wed) -> [6, 1, 3]
 * Group B (Sun, Tue, Thu) -> [0, 2, 4]
 */
export function getValidDaysForGroup(groupDays: string = ""): number[] {
  const norm = String(groupDays).toLowerCase();
  const isSatMonWed = norm.includes("سبت") || norm.includes("إثنين") || norm.includes("group a") || norm.includes("sat");
  if (isSatMonWed) {
    return [6, 1, 3]; // Saturday, Monday, Wednesday
  }
  return [0, 2, 4]; // Sunday, Tuesday, Thursday
}

/**
 * Check if date is an official attendance day for this student group.
 * Strictly checks that the day matches the scheduled days of the group.
 * Group A: Saturday (6), Monday (1), Wednesday (3) ONLY.
 * Group B: Sunday (0), Tuesday (2), Thursday (4) ONLY.
 * Any other day (such as Friday 5 or cross-group days) returns false.
 */
export function isOfficialGroupDay(groupDays: string = "", dateInput: string | Date = new Date()): boolean {
  let d: Date;
  if (dateInput instanceof Date) {
    d = dateInput;
  } else if (typeof dateInput === "string") {
    const parts = dateInput.split("-").map(Number);
    d = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0) : new Date(dateInput);
  } else {
    d = new Date();
  }

  const dayNum = d.getDay();
  const validDays = getValidDaysForGroup(groupDays);
  return validDays.includes(dayNum);
}

/**
 * Filters an array of date strings (YYYY-MM-DD) strictly to only those matching
 * the student's assigned group schedule.
 */
export function filterDatesByGroupSchedule(dates: string[], groupDays: string = ""): string[] {
  return dates.filter((dateStr) => isOfficialGroupDay(groupDays, dateStr));
}

/**
 * Generates an unbroken array of all official scheduled dates (YYYY-MM-DD) between startDate and endDate
 * strictly matching the student's assigned group schedule.
 * - Group A: Saturday, Monday, Wednesday ONLY
 * - Group B: Sunday, Tuesday, Thursday ONLY
 * This completely eliminates date gaps in student attendance records.
 */
export function generateScheduledDateSeries(
  startDateStr: string,
  endDateStr: string = getTodayKey(),
  groupDays: string = "سبت - إثنين - أربعاء"
): string[] {
  const result: string[] = [];
  if (!startDateStr || !endDateStr) return result;

  const [sYear, sMonth, sDay] = startDateStr.split("-").map(Number);
  const [eYear, eMonth, eDay] = endDateStr.split("-").map(Number);

  const start = new Date(sYear, sMonth - 1, sDay, 12, 0, 0);
  const end = new Date(eYear, eMonth - 1, eDay, 12, 0, 0);

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return result;
  }

  const cur = new Date(start);
  while (cur <= end) {
    if (isOfficialGroupDay(groupDays, cur)) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, "0");
      const d = String(cur.getDate()).padStart(2, "0");
      result.push(`${y}-${m}-${d}`);
    }
    cur.setDate(cur.getDate() + 1);
  }

  return result;
}

// Convert Arabic digits to English, remove non-digits, and normalize Egypt WhatsApp
export function cleanPhoneNumber(phone?: string): string {
  if (!phone) return "";
  const arabicDigits = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  let normalized = String(phone);
  for (let i = 0; i < 10; i++) {
    normalized = normalized.split(arabicDigits[i]).join(String(i));
  }
  let digits = normalized.replace(/\D/g, "");

  // 1. Handle international prefix "0020" or "00"
  if (digits.startsWith("0020")) {
    digits = digits.substring(2);
  } else if (digits.startsWith("00")) {
    digits = digits.substring(2);
  }

  // 2. Handle redundant "200" typo (e.g. typing 20 then 010...)
  if (digits.startsWith("200") && digits.length === 13) {
    digits = "20" + digits.substring(3);
  }

  // 3. Handle Egyptian national format (e.g. 010..., 011..., 012..., 015...)
  if (digits.startsWith("0")) {
    digits = "2" + digits;
  } else if (!digits.startsWith("2") && digits.length === 10) {
    digits = "20" + digits;
  }

  return digits;
}

export function getWhatsAppMode(): "web" | "app" {
  try {
    const saved = localStorage.getItem("aiman_whatsapp_mode");
    if (saved === "app") return "app";
    return "web"; // Default to Google Chrome WhatsApp Web
  } catch {
    return "web";
  }
}

export function setWhatsAppMode(mode: "web" | "app"): void {
  try {
    localStorage.setItem("aiman_whatsapp_mode", mode);
  } catch (e) {
    console.error("Failed to save whatsapp mode:", e);
  }
}

export function openWhatsApp(phone: string, message: string, forceMode?: "web" | "app"): void {
  const cleanPhone = cleanPhoneNumber(phone);
  if (!cleanPhone) return;
  const encodedMsg = encodeURIComponent(message);

  const mode = forceMode || getWhatsAppMode();

  let url = "";
  if (mode === "web") {
    // Opens WhatsApp Web directly inside a Google Chrome browser tab
    url = `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodedMsg}`;
  } else {
    // Opens WhatsApp Desktop application
    url = `https://wa.me/${cleanPhone}?text=${encodedMsg}`;
  }

  // Safe opening with popup-blocker fallback
  try {
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win || win.closed || typeof win.closed === "undefined") {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  } catch {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

export function getGradeIndex(grade: GradeName): number {
  const idx = GRADE_ORDER.indexOf(grade);
  return idx === -1 ? 999 : idx;
}

export function sortStudentsByGradeAndName(students: Student[]): Student[] {
  return [...students].sort((a, b) => {
    const gDiff = getGradeIndex(a.groupGrade) - getGradeIndex(b.groupGrade);
    if (gDiff !== 0) return gDiff;
    return (a.name || "").localeCompare(b.name || "", "ar");
  });
}

export function getExamAverage(student: Student): number {
  if (!student.totalExamScores || student.totalExamScores.length === 0) return 0;
  const sum = student.totalExamScores.reduce((acc, curr) => acc + curr, 0);
  return Math.round(sum / student.totalExamScores.length);
}

export function getAbsenceRate(student: Student): number {
  const total = (student.totalAttendanceDays || 0) + (student.totalAbsentDays || 0);
  if (total === 0) return 0;
  return Math.round(((student.totalAbsentDays || 0) / total) * 100);
}

export function getAttendanceRate(student: Student): number {
  const total = (student.totalAttendanceDays || 0) + (student.totalAbsentDays || 0);
  if (total === 0) return 100;
  return Math.round(((student.totalAttendanceDays || 0) / total) * 100);
}

// Pre-defined common session slots
export const PREDEFINED_SESSION_SLOTS: SessionSlot[] = [
  { id: "auto", label: "⚡ تلقائي حسب الوقت الحالي", startHour: 0, startMinute: 0, lateThresholdMinute: 15, endHour: 23, endMinute: 59 },
  { id: "slot_1pm", label: "الحصة: 1:00 م (سماح حتى 1:15 م)", startHour: 13, startMinute: 0, lateThresholdMinute: 15, endHour: 14, endMinute: 0 },
  { id: "slot_2pm", label: "الحصة: 2:00 م (سماح حتى 2:15 م)", startHour: 14, startMinute: 0, lateThresholdMinute: 15, endHour: 15, endMinute: 0 },
  { id: "slot_3pm", label: "الحصة: 3:00 م (سماح حتى 3:15 م)", startHour: 15, startMinute: 0, lateThresholdMinute: 15, endHour: 16, endMinute: 0 },
  { id: "slot_4pm", label: "الحصة: 4:00 م (سماح حتى 4:15 م)", startHour: 16, startMinute: 0, lateThresholdMinute: 15, endHour: 17, endMinute: 0 },
  { id: "slot_5pm", label: "الحصة: 5:00 م (سماح حتى 5:15 م)", startHour: 17, startMinute: 0, lateThresholdMinute: 15, endHour: 18, endMinute: 0 },
  { id: "slot_6pm", label: "الحصة: 6:00 م (سماح حتى 6:15 م)", startHour: 18, startMinute: 0, lateThresholdMinute: 15, endHour: 19, endMinute: 0 },
  { id: "slot_7pm", label: "الحصة: 7:00 م (سماح حتى 7:15 م)", startHour: 19, startMinute: 0, lateThresholdMinute: 15, endHour: 20, endMinute: 0 },
  { id: "slot_8pm", label: "الحصة: 8:00 م (سماح حتى 8:15 م)", startHour: 20, startMinute: 0, lateThresholdMinute: 15, endHour: 21, endMinute: 0 },
];

/**
 * Determine if arrival time is "حضور" (on-time) or "تأخير" (late) based on session slot.
 * As requested by user:
 * - 1:00 PM session: Window from 12:45 to 1:15 is considered on-time. After 1:15 is Late.
 * - 2:00 PM session: Window from 1:45 to 2:15 is on-time. After 2:15 is Late.
 * - 3:00 PM session: Window from 2:45 to 3:15 is on-time. After 3:15 is Late.
 */
export function evaluateAttendanceStatus(now: Date, slotId: string): "حضور" | "تأخير" {
  if (slotId === "auto") {
    // Look at the closest hour:
    // If minutes are between 45 of previous hour up to 15 of current hour -> on time.
    // If minutes are between 16 and 44 -> late.
    const minutes = now.getMinutes();
    if (minutes <= 15 || minutes >= 45) {
      return "حضور";
    }
    return "تأخير";
  }

  const slot = PREDEFINED_SESSION_SLOTS.find((s) => s.id === slotId);
  if (!slot) return "حضور";

  const currentMinutesFromMidnight = now.getHours() * 60 + now.getMinutes();
  const sessionStartMinutesFromMidnight = slot.startHour * 60 + slot.startMinute;
  const lateThresholdMinutesFromMidnight = sessionStartMinutesFromMidnight + slot.lateThresholdMinute;

  // On time if arriving before or up to late threshold (e.g. up to 1:15 PM for a 1:00 PM slot)
  if (currentMinutesFromMidnight <= lateThresholdMinutesFromMidnight) {
    return "حضور";
  }
  return "تأخير";
}

/**
 * Normalizes barcode strings by trimming, stripping legacy prefixes (e.g. "card_"),
 * and removing Arabic diacritics / invisible formatting characters.
 */
export function normalizeBarcode(code: string | number | undefined | null): string {
  if (code === undefined || code === null) return "";
  return String(code)
    .trim()
    .replace(/^card_/i, "")
    .replace(/[\u064B-\u065F\u0670\u200E\u200F\u202A-\u202E\s]/g, "")
    .trim();
}

/**
 * Checks if a payment record is specifically a card fee (e.g. 30 EGP barcode card)
 * and NOT a monthly tuition subscription fee.
 */
export function isCardFeeRecord(rec: PaymentRecord | undefined, key?: string): boolean {
  if (!rec) return false;
  if (rec.isCardFee) return true;
  if (key && key.startsWith("card_")) return true;
  if (rec.note && (rec.note.includes("كارت") || rec.note.includes("كارنيه") || rec.note.includes("استخراج كارت"))) {
    return true;
  }
  return false;
}

/**
 * Robust monthly tuition payment lookup for a student.
 * EXCLUDES administrative card fees (30 EGP), returning only real monthly subscriptions.
 */
export function getStudentMonthlyPayment(
  monthPayments: Record<string, PaymentRecord> | undefined,
  barcode: string | number | undefined | null
): PaymentRecord | undefined {
  if (!monthPayments || barcode === undefined || barcode === null) return undefined;
  const rawKey = String(barcode).trim();
  const cleanKey = normalizeBarcode(rawKey);
  if (!cleanKey) return undefined;

  // 1. Direct raw check (must not be a card fee)
  const rawRec = monthPayments[rawKey];
  if (rawRec && !isCardFeeRecord(rawRec, rawKey)) {
    return rawRec;
  }

  // 2. Direct cleanKey check
  const cleanRec = monthPayments[cleanKey];
  if (cleanRec && !isCardFeeRecord(cleanRec, cleanKey)) {
    return cleanRec;
  }

  // 3. Fallback scan across all keys for this month
  for (const [k, rec] of Object.entries(monthPayments)) {
    if (!rec) continue;
    if (isCardFeeRecord(rec, k)) continue;
    if (normalizeBarcode(k) === cleanKey) {
      return rec;
    }
  }

  return undefined;
}

/**
 * Card fee payment lookup for a student (e.g. 30 EGP barcode card fee).
 */
export function getStudentCardPayment(
  monthPayments: Record<string, PaymentRecord> | undefined,
  barcode: string | number | undefined | null
): PaymentRecord | undefined {
  if (!monthPayments || barcode === undefined || barcode === null) return undefined;
  const rawKey = String(barcode).trim();
  const cleanKey = normalizeBarcode(rawKey);
  if (!cleanKey) return undefined;

  // Check card_ prefixed key
  const cardKey = `card_${cleanKey}`;
  if (monthPayments[cardKey]) return monthPayments[cardKey];

  // Scan across keys for card fee
  for (const [k, rec] of Object.entries(monthPayments)) {
    if (!rec) continue;
    if (isCardFeeRecord(rec, k) && normalizeBarcode(k) === cleanKey) {
      return rec;
    }
  }

  return undefined;
}

/**
 * Standard alias for retrieving the student's monthly tuition payment record.
 */
export function getStudentPayment(
  monthPayments: Record<string, PaymentRecord> | undefined,
  barcode: string | number | undefined | null
): PaymentRecord | undefined {
  return getStudentMonthlyPayment(monthPayments, barcode);
}

/**
 * Checks whether a student has paid their MONTHLY TUITION for the given month.
 * Note: Having only paid the 30 EGP card fee does NOT count as paying the monthly tuition.
 */
export function isStudentPaid(
  monthPayments: Record<string, PaymentRecord> | undefined,
  barcode: string | number | undefined | null
): boolean {
  return !!getStudentMonthlyPayment(monthPayments, barcode);
}

/**
 * Checks whether a student has paid their card fee for the given month.
 */
export function isStudentCardPaid(
  monthPayments: Record<string, PaymentRecord> | undefined,
  barcode: string | number | undefined | null
): boolean {
  return !!getStudentCardPayment(monthPayments, barcode);
}

/**
 * Returns a normalized payments map where all keys are indexed by clean barcodes,
 * while preserving legacy keys so lookup never fails.
 */
export function normalizePaymentMap(
  payments: Record<string, Record<string, PaymentRecord>> | undefined
): Record<string, Record<string, PaymentRecord>> {
  if (!payments || typeof payments !== "object") return {};
  const normalized: Record<string, Record<string, PaymentRecord>> = {};

  for (const [monthKey, recMap] of Object.entries(payments)) {
    if (!recMap || typeof recMap !== "object") continue;
    normalized[monthKey] = {};
    for (const [rawK, rec] of Object.entries(recMap)) {
      if (!rec) continue;
      const cleanK = normalizeBarcode(rawK);
      if (cleanK) {
        normalized[monthKey][cleanK] = {
          ...rec,
          barcode: cleanK,
        };
      }
      if (rawK !== cleanK) {
        normalized[monthKey][rawK] = rec;
      }
    }
  }
  return normalized;
}

/**
 * Returns the latest month that actually has recorded payments,
 * preventing an empty month like (2026-09) from opening when all records are in (2026-08).
 */
export function getLatestActiveMonthKey(
  payments: Record<string, Record<string, PaymentRecord>> | undefined
): string {
  if (!payments || typeof payments !== "object") return getCurrentMonthKey();
  const monthsWithRecords = Object.entries(payments)
    .filter(([_, recMap]) => recMap && Object.keys(recMap).length > 0)
    .map(([mKey]) => mKey)
    .sort()
    .reverse();

  if (monthsWithRecords.length > 0) {
    const cur = getCurrentMonthKey();
    if (payments[cur] && Object.keys(payments[cur]).length > 0) {
      return cur;
    }
    return monthsWithRecords[0];
  }
  return getCurrentMonthKey();
}

