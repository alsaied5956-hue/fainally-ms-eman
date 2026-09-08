import React, { useState, useMemo } from "react";
import { Student, GradeName, GroupDays, GRADE_ORDER } from "../types";
import { getTodayKey } from "../utils/helpers";
import { enqueuePlatformMessage } from "../utils/storage";
import {
  BookOpen,
  X,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  UserX,
  Send,
  Copy,
  Check,
  Sparkles,
  Filter,
  Users,
} from "lucide-react";

interface BulkHomeworkModalProps {
  isOpen: boolean;
  onClose: () => void;
  students: Student[];
  attendanceToday?: Record<string, string>;
  targetDate?: string;
  onNotificationsDispatched?: () => void;
}

export interface HomeworkDispatchResult {
  notDone: Array<{ student: Student; message: string }>;
  deficient: Array<{ student: Student; message: string }>;
  completed: Array<{ student: Student; message: string }>;
  absentExcluded: Array<{ student: Student; reason: string }>;
}

export function processBulkHomeworkRules(
  students: Student[],
  selectedGrade: string,
  selectedDays: string,
  notDoneCodesText: string,
  deficientCodesText: string,
  attendanceToday: Record<string, string> = {}
): HomeworkDispatchResult {
  // Parse codes helpers
  const parseCodes = (text: string): Set<string> => {
    const tokens = text
      .split(/[\n,\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    return new Set(tokens);
  };

  const notDoneSet = parseCodes(notDoneCodesText);
  const deficientSet = parseCodes(deficientCodesText);

  // Filter students by selected Grade and Group Days
  const groupStudents = students.filter((s) => {
    if (selectedGrade !== "all" && s.groupGrade !== selectedGrade) return false;
    if (selectedDays !== "all" && s.groupDays !== selectedDays) return false;
    return true;
  });

  const result: HomeworkDispatchResult = {
    notDone: [],
    deficient: [],
    completed: [],
    absentExcluded: [],
  };

  groupStudents.forEach((student) => {
    const code = String(student.barcode).trim();
    const todayStatus = attendanceToday[code] || attendanceToday[student.barcode];

    // First Rule: Absent Check
    // If student is marked absent/excused today -> STRICTLY EXCLUDED from homework notification
    if (todayStatus === "غائب" || todayStatus === "إذن") {
      result.absentExcluded.push({
        student,
        reason: todayStatus === "غائب" ? "مسجل غائب اليوم" : "مسجل غائب بإذن",
      });
      return;
    }

    // Second Rule: Homework Distribution for Present Students
    if (notDoneSet.has(code)) {
      // 1. Not done list
      result.notDone.push({
        student,
        message: `تنبيه منصة: ينوه النظام بأنه لم يتم تسليم الواجب المنزلي المطلوب للطالب/ة (${student.name}).`,
      });
    } else if (deficientSet.has(code)) {
      // 2. Deficient / wrong list
      result.deficient.push({
        student,
        message: `تنبيه منصة: تم تسليم الواجب للطالب/ة (${student.name}) ولكن يوجد تقصير في الحل أو إجابات غير مكتملة/خاطئة، يرجى المراجعة.`,
      });
    } else {
      // 3. All other group students automatically
      result.completed.push({
        student,
        message: `تنبيه منصة: ممتاز! تم تسليم الواجب المنزلي كاملاً وبشكل صحيح للطالب/ة (${student.name}).`,
      });
    }
  });

  return result;
}

export const BulkHomeworkModal: React.FC<BulkHomeworkModalProps> = ({
  isOpen,
  onClose,
  students,
  attendanceToday = {},
  targetDate = getTodayKey(),
  onNotificationsDispatched,
}) => {
  const [selectedGrade, setSelectedGrade] = useState<string>("all");
  const [selectedDays, setSelectedDays] = useState<string>("all");
  const [notDoneInput, setNotDoneInput] = useState<string>("");
  const [deficientInput, setDeficientInput] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"preview" | "summary">("preview");
  const [isSending, setIsSending] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const processed = useMemo(() => {
    return processBulkHomeworkRules(
      students,
      selectedGrade,
      selectedDays,
      notDoneInput,
      deficientInput,
      attendanceToday
    );
  }, [students, selectedGrade, selectedDays, notDoneInput, deficientInput, attendanceToday]);

  if (!isOpen) return null;

  const totalToSend =
    processed.notDone.length + processed.deficient.length + processed.completed.length;

  const handleSendAllPlatformNotifications = () => {
    if (totalToSend === 0) {
      alert("⚠️ لا يوجد طلاب مستحقون لإرسال إشعارات الواجب في هذه المجموعة.");
      return;
    }

    setIsSending(true);

    // Enqueue 1: Not done
    processed.notDone.forEach(({ student, message }) => {
      enqueuePlatformMessage({
        studentBarcode: student.barcode,
        studentName: student.name,
        grade: student.groupGrade,
        phone: student.parentPhone || student.phone || "",
        messageType: "سلوك",
        title: `تنبيه واجب: عدم تسليم - ${student.name}`,
        message,
        channel: "in_app",
      });
    });

    // Enqueue 2: Deficient
    processed.deficient.forEach(({ student, message }) => {
      enqueuePlatformMessage({
        studentBarcode: student.barcode,
        studentName: student.name,
        grade: student.groupGrade,
        phone: student.parentPhone || student.phone || "",
        messageType: "سلوك",
        title: `تنبيه واجب: تقصير في الحل - ${student.name}`,
        message,
        channel: "in_app",
      });
    });

    // Enqueue 3: Completed
    processed.completed.forEach(({ student, message }) => {
      enqueuePlatformMessage({
        studentBarcode: student.barcode,
        studentName: student.name,
        grade: student.groupGrade,
        phone: student.parentPhone || student.phone || "",
        messageType: "تفوق",
        title: `تنبيه واجب: تسليم ممتاز - ${student.name}`,
        message,
        channel: "in_app",
      });
    });

    setIsSending(false);
    setSuccessMessage(
      `✅ تم بنجاح توثيق وإرسال إشعارات الواجبات داخل المنصة لعدد (${totalToSend}) طالب! تم استثناء (${processed.absentExcluded.length}) طالب غائب تلقائياً.`
    );

    if (onNotificationsDispatched) {
      onNotificationsDispatched();
    }

    setTimeout(() => {
      setSuccessMessage(null);
    }, 4500);
  };

  const handleCopyTextSection = (section: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(section);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const allRecordsFormattedText = [
    `=== إشعارات الواجبات الجماعية للمنصة (${targetDate}) ===`,
    `الصف: ${selectedGrade === "all" ? "جميع الصفوف" : selectedGrade} | المجموعة: ${selectedDays === "all" ? "جميع المجموعات" : selectedDays}`,
    "",
    `[1. قائمة عدم الحل (${processed.notDone.length} طالب)]:`,
    ...processed.notDone.map(
      (item) => `• كود ${item.student.barcode} - ${item.student.name}: ${item.message}`
    ),
    "",
    `[2. قائمة التقصير والحل الخاطئ (${processed.deficient.length} طالب)]:`,
    ...processed.deficient.map(
      (item) => `• كود ${item.student.barcode} - ${item.student.name}: ${item.message}`
    ),
    "",
    `[3. تسليم كامل وممتاز (${processed.completed.length} طالب)]:`,
    ...processed.completed.map(
      (item) => `• كود ${item.student.barcode} - ${item.student.name}: ${item.message}`
    ),
    "",
    `[4. الغائبون المستثنون تماماً (${processed.absentExcluded.length} طالب)]:`,
    ...processed.absentExcluded.map(
      (item) => `• كود ${item.student.barcode} - ${item.student.name} (${item.reason})`
    ),
  ].join("\n");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn font-tajawal">
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-3xl bg-slate-900 border border-indigo-500/30 shadow-2xl overflow-hidden text-right">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center text-amber-300">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-black text-white font-fancy">
                  محرك إشعارات الواجبات الجماعية للمنصة
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-bold border border-indigo-500/30">
                  فرز ذكي واستثناء الغياب
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                توزيع إشعارات الواجب تلقائياً حسب القواعد المعتمدة مع منع الإرسال للغائبين
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 md:p-6 space-y-6 custom-scrollbar">
          {successMessage && (
            <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs md:text-sm font-bold flex items-center gap-2 animate-bounce">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Group and Grade Selection */}
          <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-3">
            <div className="text-xs font-bold text-slate-300 flex items-center gap-2">
              <Filter className="w-4 h-4 text-amber-400" />
              <span>1. تحديد المرحلة والمجموعة الدراسية:</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1">الصف الدراسي:</label>
                <select
                  value={selectedGrade}
                  onChange={(e) => setSelectedGrade(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-bold focus:border-indigo-500 outline-none"
                >
                  <option value="all">جميع المراحل والصفوف</option>
                  {GRADE_ORDER.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1">المجموعة / الأيام:</label>
                <select
                  value={selectedDays}
                  onChange={(e) => setSelectedDays(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-bold focus:border-indigo-500 outline-none"
                >
                  <option value="all">جميع المجموعات (الكل)</option>
                  <option value="سبت - إثنين - أربعاء">سبت - إثنين - أربعاء</option>
                  <option value="أحد - ثلاثاء - خميس">أحد - ثلاثاء - خميس</option>
                </select>
              </div>
            </div>
          </div>

          {/* Code Inputs: Not Done & Deficient */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 1. Not Done Codes */}
            <div className="p-4 rounded-2xl bg-rose-950/20 border border-rose-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                  <XCircle className="w-4 h-4 text-rose-400" />
                  <span>أكواد "لم يفعل الواجب" (عدم الحل):</span>
                </label>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300">
                  {processed.notDone.length} طالب
                </span>
              </div>
              <textarea
                value={notDoneInput}
                onChange={(e) => setNotDoneInput(e.target.value)}
                placeholder="اكتب أو انسخ الأكواد هنا مفصولة بمسافات أو أسطر أو فواصل (مثال: 101 104 205)..."
                rows={3}
                className="w-full p-2.5 rounded-xl bg-slate-950/90 border border-rose-500/20 text-white text-xs font-mono focus:border-rose-400 outline-none resize-none"
              />
              <p className="text-[10px] text-slate-400">
                النص الصادر: <em>"تنبيه منصة: ينوه النظام بأنه لم يتم تسليم الواجب المنزلي المطلوب..."</em>
              </p>
            </div>

            {/* 2. Deficient / Error Codes */}
            <div className="p-4 rounded-2xl bg-amber-950/20 border border-amber-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span>أكواد "تقصير / حل غير مكتمل أو خاطئ":</span>
                </label>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300">
                  {processed.deficient.length} طالب
                </span>
              </div>
              <textarea
                value={deficientInput}
                onChange={(e) => setDeficientInput(e.target.value)}
                placeholder="اكتب أو انسخ الأكواد هنا مفصولة بمسافات أو أسطر أو فواصل (مثال: 102 108)..."
                rows={3}
                className="w-full p-2.5 rounded-xl bg-slate-950/90 border border-amber-500/20 text-white text-xs font-mono focus:border-amber-400 outline-none resize-none"
              />
              <p className="text-[10px] text-slate-400">
                النص الصادر: <em>"تنبيه منصة: تم تسليم الواجب للطالب/ة... ولكن يوجد تقصير في الحل..."</em>
              </p>
            </div>
          </div>

          {/* Real-time Status Metric Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="p-3 rounded-2xl bg-rose-950/30 border border-rose-500/30 text-center">
              <span className="text-[11px] font-bold text-rose-300 block">لم يحل الواجب</span>
              <strong className="text-xl font-black text-rose-400 font-mono">
                {processed.notDone.length}
              </strong>
            </div>

            <div className="p-3 rounded-2xl bg-amber-950/30 border border-amber-500/30 text-center">
              <span className="text-[11px] font-bold text-amber-300 block">تقصير أو خطأ</span>
              <strong className="text-xl font-black text-amber-400 font-mono">
                {processed.deficient.length}
              </strong>
            </div>

            <div className="p-3 rounded-2xl bg-emerald-950/30 border border-emerald-500/30 text-center">
              <span className="text-[11px] font-bold text-emerald-300 block">واجب كامل وممتاز</span>
              <strong className="text-xl font-black text-emerald-400 font-mono">
                {processed.completed.length}
              </strong>
            </div>

            <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 text-center">
              <span className="text-[11px] font-bold text-slate-400 block">مستثنى (غائب اليوم)</span>
              <strong className="text-xl font-black text-slate-300 font-mono">
                {processed.absentExcluded.length}
              </strong>
            </div>
          </div>

          {/* Results Tab Switching */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("preview")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    activeTab === "preview"
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  معاينة السجلات الجاهزة ({totalToSend} إشعار)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("summary")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    activeTab === "summary"
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  المستثنون بسبب الغياب ({processed.absentExcluded.length})
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleCopyTextSection("all", allRecordsFormattedText)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center gap-1.5 cursor-pointer"
              >
                {copiedSection === "all" ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-300">تم نسخ التقرير الكامل</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>نسخ كل السجلات</span>
                  </>
                )}
              </button>
            </div>

            {/* Active Tab Panels */}
            {activeTab === "preview" ? (
              <div className="space-y-3 max-h-72 overflow-y-auto custom-scrollbar pr-1">
                {/* Not Done Items */}
                {processed.notDone.map(({ student, message }) => (
                  <div
                    key={`nd-${student.barcode}`}
                    className="p-3 rounded-xl bg-rose-950/20 border border-rose-500/30 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-white">{student.name}</span>
                        <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono text-[10px]">
                          كود: {student.barcode}
                        </span>
                      </div>
                      <p className="text-rose-200 mt-1 font-mono text-[11px] truncate">{message}</p>
                    </div>
                    <span className="shrink-0 px-2 py-1 rounded-lg bg-rose-500/20 text-rose-300 font-bold text-[10px]">
                      لم يسلم
                    </span>
                  </div>
                ))}

                {/* Deficient Items */}
                {processed.deficient.map(({ student, message }) => (
                  <div
                    key={`def-${student.barcode}`}
                    className="p-3 rounded-xl bg-amber-950/20 border border-amber-500/30 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-white">{student.name}</span>
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[10px]">
                          كود: {student.barcode}
                        </span>
                      </div>
                      <p className="text-amber-200 mt-1 font-mono text-[11px] truncate">{message}</p>
                    </div>
                    <span className="shrink-0 px-2 py-1 rounded-lg bg-amber-500/20 text-amber-300 font-bold text-[10px]">
                      تقصير / خطأ
                    </span>
                  </div>
                ))}

                {/* Completed Items */}
                {processed.completed.map(({ student, message }) => (
                  <div
                    key={`comp-${student.barcode}`}
                    className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/30 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-white">{student.name}</span>
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px]">
                          كود: {student.barcode}
                        </span>
                      </div>
                      <p className="text-emerald-200 mt-1 font-mono text-[11px] truncate">{message}</p>
                    </div>
                    <span className="shrink-0 px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 font-bold text-[10px]">
                      كامل وممتاز ✓
                    </span>
                  </div>
                ))}

                {totalToSend === 0 && (
                  <div className="p-8 text-center text-slate-500 bg-slate-950/40 rounded-2xl border border-dashed border-slate-800">
                    لا يوجد طلاب حاضرون في هذه المجموعة أو لم يتم إدخال بيانات.
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
                {processed.absentExcluded.map(({ student, reason }) => (
                  <div
                    key={`abs-${student.barcode}`}
                    className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <UserX className="w-4 h-4 text-slate-400" />
                      <span className="font-bold text-slate-300">{student.name}</span>
                      <span className="text-slate-500 font-mono text-[11px]">({student.barcode})</span>
                    </div>
                    <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-400 text-[10px] font-bold">
                      مستثنى ({reason})
                    </span>
                  </div>
                ))}

                {processed.absentExcluded.length === 0 && (
                  <div className="p-8 text-center text-slate-500 bg-slate-950/40 rounded-2xl border border-dashed border-slate-800">
                    لا يوجد أي طالب غائب في المجموعة المختارة (الجميع حاضرون).
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 md:p-5 border-t border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-400 font-bold">
            إجمالي الإشعارات الجاهزة للإرسال:{" "}
            <span className="text-amber-400 font-mono text-sm">{totalToSend}</span> طالب حاضر
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-all cursor-pointer"
            >
              إغلاق
            </button>

            <button
              type="button"
              onClick={handleSendAllPlatformNotifications}
              disabled={isSending || totalToSend === 0}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-300 hover:from-amber-400 text-slate-950 text-xs font-black transition-all shadow-lg shadow-amber-500/20 flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transform active:scale-95"
            >
              <Send className="w-4 h-4 text-slate-950" />
              <span>
                {isSending
                  ? "جاري المعالجة والإرسال..."
                  : `توثيق وإرسال إشعارات الواجبات داخل المنصة (${totalToSend})`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
