export type GradeName =
  | "الصف الرابع الابتدائي"
  | "الصف الخامس الابتدائي"
  | "الصف السادس الابتدائي"
  | "الصف الأول الإعدادي"
  | "الصف الثاني الإعدادي"
  | "الصف الثالث الإعدادي"
  | "الصف الأول الثانوي"
  | "الصف الثاني الثانوي"
  | "الصف الثالث الثانوي";

export const GRADE_ORDER: GradeName[] = [
  "الصف الرابع الابتدائي",
  "الصف الخامس الابتدائي",
  "الصف السادس الابتدائي",
  "الصف الأول الإعدادي",
  "الصف الثاني الإعدادي",
  "الصف الثالث الإعدادي",
  "الصف الأول الثانوي",
  "الصف الثاني الثانوي",
  "الصف الثالث الثانوي"
];

export type GroupDays = "سبت - إثنين - أربعاء" | "أحد - ثلاثاء - خميس";

export interface GroupHistoryEntry {
  groupDays: GroupDays;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo?: string; // YYYY-MM-DD
  changedAt: string;     // ISO timestamp
  reason?: string;
}

export interface Student {
  barcode: string;
  name: string;
  phone: string;
  parentPhone: string;
  groupGrade: GradeName;
  groupDays: GroupDays;
  groupHistory?: GroupHistoryEntry[]; // Historical audit log for mid-term group shifts
  customMonthlyFee?: number; // السعر المخصص للطالب (مثلا 50 أو 60 أو 70 أو 80 أو إعفاء كامل)
  discountReason?: string; // سبب الخصم أو ملاحظات (أيتام، خصم إخوة، تفوق)
  points: number;
  totalAttendanceDays: number;
  totalAbsentDays: number;
  totalExamScores: number[]; // مصفوفة النسب المئوية للاختبارات
  lastExamTitle?: string;
  lastExamScore?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: number;
}

export type AttendanceStatus = "حضور" | "تأخير" | "غائب" | "إذن";

export interface PaymentRecord {
  id?: string;
  barcode?: string;
  amount: number;
  date: string;
  time: string;
  note?: string;
  month?: string; // YYYY-MM
  monthKey?: string; // YYYY-MM
  receiptNo?: string;
  isCardFee?: boolean;
  recordedBy?: string;
}

export type TabKey =
  | "scanner"
  | "add_student"
  | "attendance_report"
  | "cumulative_grades"
  | "pay_expenses"
  | "financials"
  | "exam_grades"
  | "early_warning"
  | "certificates"
  | "excel_integration"
  | "whatsapp_direct"
  | "manage_students"
  | "users"
  | "settings";


export type PermissionKey =
  | "add_student"
  | "edit_student"
  | "delete_student"
  | "change_status"
  | "pay_expenses"
  | "view_revenues"
  | "add_grades"
  | "send_messages"
  | "manage_prices"
  | "early_warning"
  | "certificates"
  | "excel_integration";

export interface UserAccount {
  username: string;
  pass: string;
  role: "admin" | "secretary";
  permissions: PermissionKey[];
}

export interface SessionSlot {
  id: string;
  label: string; // e.g. "1:00 م - 2:00 م"
  startHour: number; // 24h
  startMinute: number;
  lateThresholdMinute: number; // e.g. 15 mins after start
  endHour: number;
  endMinute: number;
}

export interface EarlyWarningStudent {
  student: Student;
  reasons: string[];
  absenceRate: number;
  examAverage: number;
  isUnpaidThisMonth: boolean;
  severity: "high" | "medium" | "low";
}

export type PlatformMessageType =
  | "غياب"
  | "تأخير"
  | "حضور"
  | "عكس_أيام"
  | "درجات"
  | "مصاريف"
  | "تنبيه"
  | "سلوك"
  | "تفوق"
  | "عام";

export type WhatsAppMessageType = PlatformMessageType;

export interface PlatformMessage {
  id: string;
  studentBarcode?: string;
  studentName: string;
  grade?: GradeName;
  phone?: string;
  messageType: PlatformMessageType;
  title?: string;
  message: string;
  createdAt: string;
  timeFormatted: string;
  status: "pending" | "sent" | "read" | "archived";
  sentAt?: string;
  channel?: "in_app" | "whatsapp_manual";
}

export type PendingWhatsAppMessage = PlatformMessage;

export interface CertificateData {
  student: Student;
  examTitle: string;
  scoreText: string;
  percentage: number;
  date: string;
  teacherName: string;
}

export type TabType =
  | "attendance-scan"
  | "homework-tracker"
  | "add-student"
  | "stats"
  | "cumulative-report"
  | "pay-expenses"
  | "expenses"
  | "grades"
  | "early-warning"
  | "certificates"
  | "excel-integration"
  | "platform-messages"
  | "whatsapp-manual"
  | "whatsapp-engine"
  | "manage-students"
  | "users"
  | "settings";
