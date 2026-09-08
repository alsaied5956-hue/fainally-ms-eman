import React, { useState, useMemo } from "react";
import { Student, GradeName, PaymentRecord, GRADE_ORDER, GroupDays } from "../types";
import {
  TEACHER_NAME,
  getTodayKey,
  getCurrentMonthKey,
  formatArabicDate,
  getAttendanceRate,
  getAbsenceRate,
  getExamAverage,
  DEFAULT_GRADE_PRICES,
  isStudentPaid,
  getLatestActiveMonthKey,
} from "../utils/helpers";
import { printElement, downloadPrintableHtml } from "../utils/print";
import { Printer, X, FileText, Download, Info, CheckCircle2, Calendar, Users } from "lucide-react";

interface PrintPDFModalProps {
  type: "attendance" | "exams" | "all" | "unpaid";
  students: Student[];
  attendanceToday: Record<string, string>;
  payments?: Record<string, Record<string, PaymentRecord>>;
  groupPrices?: Record<GradeName, number>;
  onClose: () => void;
}

export const PrintPDFModal: React.FC<PrintPDFModalProps> = ({
  type: initialType,
  students,
  attendanceToday,
  payments = {},
  groupPrices = DEFAULT_GRADE_PRICES,
  onClose,
}) => {
  const [activeReportType, setActiveReportType] = useState<"attendance" | "exams" | "unpaid">(
    initialType === "unpaid" ? "unpaid" : initialType === "exams" ? "exams" : "attendance"
  );
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getLatestActiveMonthKey(payments));
  const [selectedGroupDays, setSelectedGroupDays] = useState<"ALL" | GroupDays>("ALL");

  const todayKey = getTodayKey();
  const formattedDate = formatArabicDate(todayKey);

  const monthPayments = payments[selectedMonth] || {};

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    set.add(getCurrentMonthKey());
    Object.keys(payments || {}).forEach((m) => {
      if (Object.keys(payments[m] || {}).length > 0) set.add(m);
    });
    return Array.from(set).sort().reverse();
  }, [payments]);

  const reportTitle =
    activeReportType === "attendance"
      ? `كشف_حضور_وغياب_${todayKey}`
      : activeReportType === "exams"
      ? `سجل_الدرجات_التراكمي_${todayKey}`
      : `كشف_الطلاب_الذين_لم_يدفعوا_شهر_${selectedMonth}`;

  const handlePrint = () => {
    printElement("printable-report-document", {
      title: `${reportTitle} - منظومة ${TEACHER_NAME}`,
      orientation: "portrait",
    });
  };

  const handleDownloadHtml = () => {
    downloadPrintableHtml(
      "printable-report-document",
      `${reportTitle}.html`,
      {
        title: `${reportTitle} - منظومة ${TEACHER_NAME}`,
        orientation: "portrait",
      }
    );
  };

  const renderStudentTable = (studentList: Student[], startingIndex = 1) => {
    return (
      <table className="w-full text-right border-collapse text-xs border border-slate-300">
        <thead>
          <tr className="bg-slate-100 text-[#7c5b16] font-black border-b border-slate-300">
            <th className="p-2 border border-slate-300 text-center w-10">م</th>
            <th className="p-2 border border-slate-300 text-center w-24">الباركود</th>
            <th className="p-2 border border-slate-300">اسم الطالب ثلاثي</th>
            <th className="p-2 border border-slate-300 text-center">أيام المجموعة</th>
            {activeReportType === "attendance" ? (
              <>
                <th className="p-2 border border-slate-300 text-center">حالة اليوم</th>
                <th className="p-2 border border-slate-300 text-center">نسبة الحضور</th>
                <th className="p-2 border border-slate-300 text-center">نسبة الغياب</th>
              </>
            ) : activeReportType === "exams" ? (
              <>
                <th className="p-2 border border-slate-300">آخر امتحان ودرجته</th>
                <th className="p-2 border border-slate-300 text-center">متوسط الامتحانات</th>
                <th className="p-2 border border-slate-300 text-center">النقاط ⭐</th>
              </>
            ) : (
              <>
                <th className="p-2 border border-slate-300 text-center">قيمة الاشتراك المستحق</th>
                <th className="p-2 border border-slate-300 text-center">حالة السداد</th>
              </>
            )}
            <th className="p-2 border border-slate-300 text-center">رقم ولي الأمر</th>
            {activeReportType === "unpaid" && (
              <th className="p-2 border border-slate-300">ملاحظات وخصومات</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {studentList.map((student, idx) => {
            const status = attendanceToday[student.barcode] || "غائب";
            const attRate = getAttendanceRate(student);
            const absRate = getAbsenceRate(student);
            const examAvg = getExamAverage(student);
            const fee =
              student.customMonthlyFee ??
              groupPrices[student.groupGrade] ??
              DEFAULT_GRADE_PRICES[student.groupGrade] ??
              100;

            const isSatMonWed = student.groupDays === "سبت - إثنين - أربعاء";

            return (
              <tr
                key={student.barcode}
                className="hover:bg-amber-50/50 transition-colors page-break-avoid"
              >
                <td className="p-2 border border-slate-300 font-mono text-center">
                  {startingIndex + idx}
                </td>
                <td className="p-2 border border-slate-300 font-mono font-bold text-center">
                  #{student.barcode}
                </td>
                <td className="p-2 border border-slate-300 font-bold text-slate-900 text-[13px]">
                  {student.name}
                </td>
                <td className="p-2 border border-slate-300 text-center">
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-black border inline-block whitespace-nowrap ${
                      isSatMonWed
                        ? "bg-sky-100 text-sky-950 border-sky-300"
                        : "bg-emerald-100 text-emerald-950 border-emerald-300"
                    }`}
                  >
                    {student.groupDays}
                  </span>
                </td>
                {activeReportType === "attendance" ? (
                  <>
                    <td className="p-2 border border-slate-300 font-bold text-center">
                      <span
                        className={
                          status === "حضور"
                            ? "text-emerald-700"
                            : status === "تأخير"
                            ? "text-amber-700"
                            : "text-rose-700"
                        }
                      >
                        {status}
                      </span>
                    </td>
                    <td className="p-2 border border-slate-300 text-center font-bold text-emerald-700">
                      {attRate}%
                    </td>
                    <td className="p-2 border border-slate-300 text-center font-bold text-rose-700">
                      {absRate}%
                    </td>
                  </>
                ) : activeReportType === "exams" ? (
                  <>
                    <td className="p-2 border border-slate-300 font-bold text-[#8c671b]">
                      {student.lastExamScore || "لا يوجد"}
                    </td>
                    <td className="p-2 border border-slate-300 text-center font-black">
                      {examAvg}%
                    </td>
                    <td className="p-2 border border-slate-300 text-center font-bold text-amber-700">
                      {student.points || 0} ⭐
                    </td>
                  </>
                ) : (
                  <>
                    <td className="p-2 border border-slate-300 text-center font-mono font-bold text-slate-900">
                      {fee} ج.م
                    </td>
                    <td className="p-2 border border-slate-300 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-700 border border-rose-300 inline-block">
                        ❌ غير مسدد
                      </span>
                    </td>
                  </>
                )}
                <td className="p-2 border border-slate-300 font-mono text-center text-slate-700">
                  {student.parentPhone}
                </td>
                {activeReportType === "unpaid" && (
                  <td className="p-2 border border-slate-300 text-xs text-slate-600">
                    {student.discountReason ? `خصم: ${student.discountReason}` : "-"}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center p-3 md:p-6 overflow-y-auto font-tajawal">
      {/* Top Controls Bar (Hidden during actual print) */}
      <div className="no-print bg-[#0c1328] border border-indigo-500/30 w-full max-w-5xl p-4 md:p-5 rounded-3xl flex flex-col gap-4 mb-6 shadow-2xl sticky top-2 z-50">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-400/30 shadow-md">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base md:text-lg font-black text-amber-300">
                معاينة وتصدير ملفات PDF الرسمية (كل مرحلة في صفحة مستقلة A4)
              </h3>
              <p className="text-xs text-slate-300 font-medium">
                تفتح نافذة الطباعة مباشرة في تبويب جديد للحفظ كملف PDF عالي الدقة
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handlePrint}
              className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-200 hover:from-amber-300 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/20 flex items-center gap-2 transition-all transform hover:scale-105 active:scale-95 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة وتصدير PDF الآن (Ctrl + P)</span>
            </button>

            <button
              onClick={handleDownloadHtml}
              className="px-3.5 py-2.5 rounded-2xl bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
              title="تحميل التقرير كملف للفتح والطباعة في أي وقت"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              <span>تحميل كملف HTML</span>
            </button>

            <button
              onClick={onClose}
              className="p-2.5 rounded-2xl bg-slate-800/90 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
              title="إغلاق المعاينة"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Selection Bar & Month Selector */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-indigo-500/20">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-400">نوع التقرير المعروض:</span>
            
            <button
              onClick={() => setActiveReportType("attendance")}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeReportType === "attendance"
                  ? "bg-amber-500 text-slate-950 shadow-md font-black"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              <span>📄 كشف الحضور والغياب</span>
            </button>

            <button
              onClick={() => setActiveReportType("exams")}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeReportType === "exams"
                  ? "bg-sky-500 text-slate-950 shadow-md font-black"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              <span>📊 سجل الدرجات التراكمي</span>
            </button>

            <button
              onClick={() => setActiveReportType("unpaid")}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeReportType === "unpaid"
                  ? "bg-rose-500 text-white shadow-md font-black"
                  : "bg-slate-800 text-rose-300 hover:bg-slate-700"
              }`}
            >
              <span>🔴 كشف غير المسددين (الذين لم يدفعوا فقط)</span>
            </button>
          </div>

          {/* Group Days Filter */}
          <div className="flex items-center gap-2 bg-[#080d1e] border border-indigo-500/40 px-3 py-1.5 rounded-xl">
            <Users className="w-3.5 h-3.5 text-amber-400" />
            <label className="text-xs font-bold text-slate-300">المجموعة:</label>
            <select
              value={selectedGroupDays}
              onChange={(e) => setSelectedGroupDays(e.target.value as "ALL" | GroupDays)}
              className="bg-transparent text-xs font-bold text-amber-300 outline-none cursor-pointer"
            >
              <option value="ALL" className="bg-slate-900 text-white">
                كافة المجموعات (تقسيم سبت/إثنين/أربعاء و أحد/ثلاثاء/خميس)
              </option>
              <option value="سبت - إثنين - أربعاء" className="bg-slate-900 text-white">
                مجموعة (سبت - إثنين - أربعاء) فقط
              </option>
              <option value="أحد - ثلاثاء - خميس" className="bg-slate-900 text-white">
                مجموعة (أحد - ثلاثاء - خميس) فقط
              </option>
            </select>
          </div>

          {activeReportType === "unpaid" && (
            <div className="flex items-center gap-2 bg-[#080d1e] border border-rose-500/40 px-3 py-1.5 rounded-xl">
              <Calendar className="w-3.5 h-3.5 text-rose-400" />
              <label className="text-xs font-bold text-rose-300">الشهر المطلوب استخراجه:</label>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-transparent text-xs font-bold text-white outline-none cursor-pointer"
              />
            </div>
          )}
        </div>

        {/* Available Months Quick Selector when on Unpaid tab */}
        {activeReportType === "unpaid" && availableMonths.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap w-full bg-[#080d1e] p-2 rounded-2xl border border-rose-500/30 text-xs">
            <span className="text-xs font-bold text-slate-400 shrink-0">الشهور المتوفرة:</span>
            {availableMonths.map((m) => {
              const countPaid = Object.keys(payments[m] || {}).length;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSelectedMonth(m)}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    selectedMonth === m
                      ? "bg-rose-500 text-white font-black shadow-md"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  <span>{m}</span>
                  {countPaid > 0 && (
                    <span className="text-[10px] opacity-80 font-mono">({countPaid} مسدد)</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Tip for Saving PDF */}
        <div className="w-full bg-amber-500/10 border border-amber-500/30 rounded-2xl p-2.5 flex items-center gap-2 text-xs text-amber-300">
          <Info className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            <strong>💡 للحفظ كملف PDF:</strong> عند الضغط على زر الطباعة، ستفتح صفحة التقرير في تبويب كروم وتظهر نافذة الطباعة تلقائياً، اختر وجهة الطباعة <strong>«Save as PDF / حفظ بتنسيق PDF»</strong>.
          </span>
        </div>
      </div>

      {/* Printable Multi-Page Document Container */}
      <div
        id="printable-report-document"
        className="w-full max-w-5xl space-y-8 bg-white text-slate-900 p-8 md:p-12 rounded-3xl shadow-2xl print:p-0 print:m-0 print:shadow-none print:w-full font-['Tajawal',sans-serif]"
      >
        {GRADE_ORDER.map((grade) => {
          let gradeStudents = students.filter((s) => s.groupGrade === grade);

          // If report is for unpaid only, filter out any student who has paid (using normalized barcode lookup)
          if (activeReportType === "unpaid") {
            gradeStudents = gradeStudents.filter((s) => !isStudentPaid(monthPayments, s.barcode));
          }

          // Filter by selectedGroupDays if not ALL
          if (selectedGroupDays !== "ALL") {
            gradeStudents = gradeStudents.filter((s) => s.groupDays === selectedGroupDays);
          }

          if (gradeStudents.length === 0) return null;

          const satStudents = gradeStudents.filter((s) => s.groupDays === "سبت - إثنين - أربعاء");
          const sunStudents = gradeStudents.filter((s) => s.groupDays === "أحد - ثلاثاء - خميس");
          const otherStudents = gradeStudents.filter(
            (s) => s.groupDays !== "سبت - إثنين - أربعاء" && s.groupDays !== "أحد - ثلاثاء - خميس"
          );

          const totalGradeUnpaidMoney =
            activeReportType === "unpaid"
              ? gradeStudents.reduce((sum, s) => {
                  const fee =
                    s.customMonthlyFee ??
                    groupPrices[s.groupGrade] ??
                    DEFAULT_GRADE_PRICES[s.groupGrade] ??
                    100;
                  return sum + fee;
                }, 0)
              : 0;

          const satUnpaidMoney =
            activeReportType === "unpaid"
              ? satStudents.reduce((sum, s) => {
                  const fee =
                    s.customMonthlyFee ??
                    groupPrices[s.groupGrade] ??
                    DEFAULT_GRADE_PRICES[s.groupGrade] ??
                    100;
                  return sum + fee;
                }, 0)
              : 0;

          const sunUnpaidMoney =
            activeReportType === "unpaid"
              ? sunStudents.reduce((sum, s) => {
                  const fee =
                    s.customMonthlyFee ??
                    groupPrices[s.groupGrade] ??
                    DEFAULT_GRADE_PRICES[s.groupGrade] ??
                    100;
                  return sum + fee;
                }, 0)
              : 0;

          return (
            <section
              key={grade}
              className="page-break-grade border-b-4 border-dashed border-slate-300 print:border-none pb-8 print:pb-0 mb-8 print:mb-0"
              style={{ pageBreakAfter: "always", breakAfter: "page" }}
            >
              {/* Grade Page Header */}
              <div className="flex items-center justify-between border-b-2 border-[#b38728] pb-4 mb-4">
                <div className="text-right">
                  <h1 className="text-2xl font-black text-[#8c671b] leading-tight">
                    منظومة {TEACHER_NAME}
                  </h1>
                  <p className="text-xs text-slate-600 font-bold">
                    أستاذة الرياضيات | هاتف: 01070642904
                  </p>
                </div>

                <div className="text-center">
                  <span
                    className={`text-lg font-black px-4 py-1.5 rounded-full border inline-block shadow-sm ${
                      activeReportType === "unpaid"
                        ? "bg-rose-100 text-rose-800 border-rose-300"
                        : "bg-amber-100 text-[#7c5b16] border-amber-300"
                    }`}
                  >
                    {grade}
                  </span>
                  <p className="text-xs text-slate-700 font-black mt-1">
                    {activeReportType === "attendance"
                      ? "كشف الحضور والغياب اليومي"
                      : activeReportType === "exams"
                      ? "سجل الدرجات والنتائج التراكمية"
                      : `كشف الطلاب غير المسددين لاشتراك شهر (${selectedMonth}) - الذين لم يدفعوا فقط`}
                  </p>
                  {selectedGroupDays !== "ALL" && (
                    <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200 mt-1 inline-block">
                      تصفية: {selectedGroupDays}
                    </span>
                  )}
                </div>

                <div className="text-left text-xs font-semibold text-slate-600">
                  <p>تاريخ الاستخراج:</p>
                  <p className="font-bold text-slate-900">{formattedDate}</p>
                </div>
              </div>

              {/* Summary Stats for Grade with Group Breakdown */}
              <div className="flex flex-wrap items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs font-bold mb-4 gap-2">
                {activeReportType === "unpaid" ? (
                  <>
                    <span>
                      إجمالي غير المسددين:{" "}
                      <strong className="text-rose-700 font-black">{gradeStudents.length} طالب</strong>
                    </span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="bg-sky-50 text-sky-950 px-2.5 py-1 rounded border border-sky-300 font-bold">
                        📅 سبت - إثنين - أربعاء: <strong>{satStudents.length} طالب</strong> ({satUnpaidMoney} ج.م)
                      </span>
                      <span className="bg-emerald-50 text-emerald-950 px-2.5 py-1 rounded border border-emerald-300 font-bold">
                        📅 أحد - ثلاثاء - خميس: <strong>{sunStudents.length} طالب</strong> ({sunUnpaidMoney} ج.م)
                      </span>
                    </div>
                    <span>
                      المبالغ المتأخرة:{" "}
                      <strong className="text-amber-700 font-black font-mono">{totalGradeUnpaidMoney} ج.م</strong>
                    </span>
                  </>
                ) : (
                  <>
                    <span>إجمالي طلاب المرحلة: <strong>{gradeStudents.length} طالب</strong></span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="bg-sky-50 text-sky-950 px-2.5 py-1 rounded border border-sky-300 font-bold">
                        📅 سبت - إثنين - أربعاء: <strong>{satStudents.length} طالب</strong>
                      </span>
                      <span className="bg-emerald-50 text-emerald-950 px-2.5 py-1 rounded border border-emerald-300 font-bold">
                        📅 أحد - ثلاثاء - خميس: <strong>{sunStudents.length} طالب</strong>
                      </span>
                    </div>
                    <span>
                      متوسط الحضور:{" "}
                      {Math.round(
                        gradeStudents.reduce((acc, s) => acc + getAttendanceRate(s), 0) /
                          (gradeStudents.length || 1)
                      )}
                      %
                    </span>
                  </>
                )}
              </div>

              {/* Table(s) Segmented by Group Days */}
              {selectedGroupDays === "ALL" ? (
                <div className="space-y-6">
                  {/* Group 1: سبت - إثنين - أربعاء */}
                  {satStudents.length > 0 && (
                    <div className="page-break-avoid">
                      <div className="flex items-center justify-between bg-sky-100/90 border-r-4 border-sky-700 px-3 py-2 rounded-lg mb-2 print:bg-slate-100 print:border-black">
                        <div className="flex items-center gap-2">
                          <span className="text-base">📅</span>
                          <h4 className="font-black text-sky-950 text-xs md:text-sm">
                            مجموعة: سبت - إثنين - أربعاء
                          </h4>
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-sky-200 text-sky-900 border border-sky-300">
                            {satStudents.length} طالب
                          </span>
                        </div>
                        {activeReportType === "unpaid" && (
                          <span className="text-xs font-bold text-rose-800 font-mono">
                            المتأخرات: {satUnpaidMoney} ج.م
                          </span>
                        )}
                      </div>
                      <div className="overflow-x-auto">
                        {renderStudentTable(satStudents, 1)}
                      </div>
                    </div>
                  )}

                  {/* Group 2: أحد - ثلاثاء - خميس */}
                  {sunStudents.length > 0 && (
                    <div className="page-break-avoid mt-5">
                      <div className="flex items-center justify-between bg-emerald-100/90 border-r-4 border-emerald-700 px-3 py-2 rounded-lg mb-2 print:bg-slate-100 print:border-black">
                        <div className="flex items-center gap-2">
                          <span className="text-base">📅</span>
                          <h4 className="font-black text-emerald-950 text-xs md:text-sm">
                            مجموعة: أحد - ثلاثاء - خميس
                          </h4>
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-200 text-emerald-900 border border-emerald-300">
                            {sunStudents.length} طالب
                          </span>
                        </div>
                        {activeReportType === "unpaid" && (
                          <span className="text-xs font-bold text-rose-800 font-mono">
                            المتأخرات: {sunUnpaidMoney} ج.م
                          </span>
                        )}
                      </div>
                      <div className="overflow-x-auto">
                        {renderStudentTable(sunStudents, 1)}
                      </div>
                    </div>
                  )}

                  {/* Group 3: Other days if any */}
                  {otherStudents.length > 0 && (
                    <div className="page-break-avoid mt-5">
                      <div className="bg-slate-100 border-r-4 border-slate-600 px-3 py-2 rounded-lg mb-2">
                        <h4 className="font-black text-slate-800 text-xs">
                          مجموعات أخرى ({otherStudents.length} طالب)
                        </h4>
                      </div>
                      <div className="overflow-x-auto">
                        {renderStudentTable(otherStudents, 1)}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="page-break-avoid">
                  <div className="flex items-center justify-between bg-slate-100 border-r-4 border-[#b38728] px-3 py-2 rounded-lg mb-2">
                    <h4 className="font-black text-slate-900 text-xs md:text-sm flex items-center gap-2">
                      <span>📅</span>
                      <span>كشف طلاب مجموعة ({selectedGroupDays})</span>
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-200 text-amber-900">
                        {gradeStudents.length} طالب
                      </span>
                    </h4>
                    {activeReportType === "unpaid" && (
                      <span className="text-xs font-bold text-rose-800 font-mono">
                        إجمالي المتأخرات: {totalGradeUnpaidMoney} ج.م
                      </span>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    {renderStudentTable(gradeStudents, 1)}
                  </div>
                </div>
              )}

              {/* Grade Page Footer */}
              <div className="flex items-center justify-between pt-6 mt-4 border-t border-slate-200 text-xs text-slate-600">
                <div>
                  <p>اعتماد وتوقيع أستاذة المادة:</p>
                  <p className="font-extrabold text-[#7c5b16] mt-1">{TEACHER_NAME}</p>
                </div>
                <div className="text-center font-mono text-[10px] text-slate-400">
                  صفحة مستقلة مخصصة لـ [{grade}]
                </div>
                <div className="text-left font-bold">
                  <span>ختم المنظومة المعتمد</span>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};
