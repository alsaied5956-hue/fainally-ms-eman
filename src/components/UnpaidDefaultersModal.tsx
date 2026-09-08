import React, { useState, useMemo } from "react";
import { Student, PaymentRecord, GradeName, GroupDays, GRADE_ORDER } from "../types";
import {
  TEACHER_NAME,
  getCurrentMonthKey,
  getTodayKey,
  formatArabicDate,
  DEFAULT_GRADE_PRICES,
  sortStudentsByGradeAndName,
  openWhatsApp,
  isStudentPaid,
  getStudentPayment,
  getLatestActiveMonthKey,
} from "../utils/helpers";
import { printElement, downloadPrintableHtml } from "../utils/print";
import { enqueuePlatformMessagesBatch } from "../utils/storage";
import { exportDefaultersAndPaidExcel } from "../utils/excel";
import {
  X,
  Printer,
  FileSpreadsheet,
  Download,
  Phone,
  AlertTriangle,
  Calendar,
  CreditCard,
  Send,
  Sparkles,
  Info,
  CheckCircle2,
  XCircle,
  Layers,
} from "lucide-react";

interface UnpaidDefaultersModalProps {
  students: Student[];
  payments: Record<string, Record<string, PaymentRecord>>;
  groupPrices: Record<GradeName, number>;
  isOpen: boolean;
  onClose: () => void;
  onRecordPayment?: (barcode: string, amount: number, monthKey: string, note: string) => void;
}

export const UnpaidDefaultersModal: React.FC<UnpaidDefaultersModalProps> = ({
  students,
  payments,
  groupPrices,
  isOpen,
  onClose,
  onRecordPayment,
}) => {
  const [selectedMonth, setSelectedMonth] = useState(() => getLatestActiveMonthKey(payments));
  const [selectedGrade, setSelectedGrade] = useState<string>("ALL");
  const [selectedDays, setSelectedDays] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  // Default to UNPAID_ONLY so clicking "كشف غير المسددين" immediately shows ONLY those who haven't paid
  const [displayMode, setDisplayMode] = useState<"PAID_THEN_UNPAID" | "UNPAID_ONLY">("UNPAID_ONLY");
  const [batchActionNotice, setBatchActionNotice] = useState<string | null>(null);

  const todayKey = getTodayKey();
  const formattedToday = formatArabicDate(todayKey);
  const monthPayments = payments[selectedMonth] || {};

  // Extract all available months that have recorded payments
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    set.add(getCurrentMonthKey());
    Object.keys(payments || {}).forEach((m) => {
      if (Object.keys(payments[m] || {}).length > 0) set.add(m);
    });
    return Array.from(set).sort().reverse();
  }, [payments]);

  // Extract all relevant students based on current filters
  const filteredStudentsList = useMemo(() => {
    const list = students.filter((s) => {
      // Grade filter
      if (selectedGrade !== "ALL" && s.groupGrade !== selectedGrade) return false;

      // Days filter
      if (selectedDays !== "ALL" && s.groupDays !== selectedDays) return false;

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesName = s.name.toLowerCase().includes(q);
        const matchesBarcode = s.barcode.toLowerCase().includes(q);
        const matchesPhone = s.parentPhone?.includes(q) || s.phone?.includes(q);
        if (!matchesName && !matchesBarcode && !matchesPhone) return false;
      }

      return true;
    });

    return sortStudentsByGradeAndName(list);
  }, [students, selectedGrade, selectedDays, searchQuery]);

  // Extract all unpaid students for the selected month (using normalized barcode lookup)
  const unpaidStudentsList = useMemo(() => {
    return filteredStudentsList.filter((s) => !isStudentPaid(monthPayments, s.barcode));
  }, [filteredStudentsList, monthPayments]);

  // Extract all paid students for the selected month (using normalized barcode lookup)
  const paidStudentsList = useMemo(() => {
    return filteredStudentsList.filter((s) => isStudentPaid(monthPayments, s.barcode));
  }, [filteredStudentsList, monthPayments]);

  // Calculate metrics
  const totalUnpaidAmount = useMemo(() => {
    return unpaidStudentsList.reduce((sum, s) => {
      const fee =
        s.customMonthlyFee ??
        groupPrices[s.groupGrade] ??
        DEFAULT_GRADE_PRICES[s.groupGrade] ??
        100;
      return sum + fee;
    }, 0);
  }, [unpaidStudentsList, groupPrices]);

  const totalPaidAmount = useMemo(() => {
    return paidStudentsList.reduce((sum, s) => {
      const pay = getStudentPayment(monthPayments, s.barcode);
      const fee =
        s.customMonthlyFee ??
        groupPrices[s.groupGrade] ??
        DEFAULT_GRADE_PRICES[s.groupGrade] ??
        100;
      return sum + (pay ? pay.amount : fee);
    }, 0);
  }, [paidStudentsList, monthPayments, groupPrices]);

  const handlePrintPDF = () => {
    const title =
      displayMode === "UNPAID_ONLY"
        ? `كشف_الطلاب_غير_المسددين_${selectedMonth}_${selectedGrade !== "ALL" ? selectedGrade : "كافة_الصفوف"}`
        : `كشف_الاشتراكات_والمتأخرين_${selectedMonth}_${selectedGrade !== "ALL" ? selectedGrade : "كافة_الصفوف"}`;
    printElement("printable-unpaid-defaulters-doc", {
      title: `${title} - منظومة ${TEACHER_NAME}`,
      orientation: "portrait",
    });
  };

  const handleDownloadHtml = () => {
    const title =
      displayMode === "UNPAID_ONLY"
        ? `كشف_الطلاب_غير_المسددين_${selectedMonth}_${selectedGrade !== "ALL" ? selectedGrade : "كافة_الصفوف"}`
        : `كشف_الاشتراكات_والمتأخرين_${selectedMonth}_${selectedGrade !== "ALL" ? selectedGrade : "كافة_الصفوف"}`;
    downloadPrintableHtml("printable-unpaid-defaulters-doc", `${title}.html`, {
      title: `${title} - منظومة ${TEACHER_NAME}`,
      orientation: "portrait",
    });
  };

  const handleExportExcel = () => {
    exportDefaultersAndPaidExcel({
      students,
      payments,
      groupPrices,
      selectedMonth,
      filterGrade: selectedGrade,
      filterDays: selectedDays,
    });
  };

  const handleSendAllWhatsAppReminders = () => {
    if (unpaidStudentsList.length === 0) return;

    const itemsToQueue = unpaidStudentsList.map((s) => {
      const fee =
        s.customMonthlyFee ??
        groupPrices[s.groupGrade] ??
        DEFAULT_GRADE_PRICES[s.groupGrade] ??
        100;

      const reminderMsg =
        `تذكير ودي بسداد الاشتراك 🔔\n` +
        `منظومة الأستاذة إيمان الدمشيتي - خبيرة الرياضيات 📐\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `👤 الطالب/ة: ${s.name}\n` +
        `📚 الصف: ${s.groupGrade} (${s.groupDays})\n` +
        `📅 الشهر المستحق: ${selectedMonth}\n` +
        `💰 قيمة الاشتراك: ${fee} ج.م\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `نرجو من حضراتكم التكرم بسرعة سداد الاشتراك لضمان استمرار متابعة الطالب.\n` +
        `شاكرين لكم حسن تعاونكم واهتمامكم ✨`;

      return {
        studentBarcode: s.barcode,
        studentName: s.name,
        grade: s.groupGrade,
        phone: s.parentPhone || s.phone || "",
        messageType: "مصاريف" as const,
        title: `تذكير بسداد اشتراك شهر ${selectedMonth} - ${s.name}`,
        message: reminderMsg,
        channel: "in_app" as const,
      };
    });

    enqueuePlatformMessagesBatch(itemsToQueue);

    setBatchActionNotice(
      `✅ تم بث وإرسال تذكيرات المصروفات لعدد (${unpaidStudentsList.length}) طالب داخل المنصة وحفظها فورياً في السحابة!`
    );

    setTimeout(() => {
      setBatchActionNotice(null);
    }, 6000);
  };

  // Group students by grade for multi-page rendering
  const gradesToRender =
    selectedGrade === "ALL"
      ? GRADE_ORDER.filter((g) => filteredStudentsList.some((s) => s.groupGrade === g))
      : [selectedGrade as GradeName];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center p-3 md:p-6 overflow-y-auto no-print-backdrop font-tajawal">
      {/* Top Controls Bar */}
      <div className="no-print bg-[#0a1124] border border-amber-500/30 w-full max-w-6xl p-4 md:p-5 rounded-3xl flex flex-col gap-4 mb-6 shadow-2xl sticky top-2 z-50">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-rose-500/20 to-amber-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shadow-md">
              <Layers className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h3 className="text-lg md:text-xl font-black text-amber-300 font-fancy">
                {displayMode === "UNPAID_ONLY"
                  ? "كشف الطلاب غير المسددين (الذين لم يدفعوا فقط)"
                  : "كشف الاشتراكات والمتأخرين (المسددون أولاً ثم غير المسددين)"}
              </h3>
              <p className="text-xs text-slate-300">
                {displayMode === "UNPAID_ONLY"
                  ? "حصر دقيق وحصري للطلاب الذين لم يسددوا الاشتراك مع استبعاد أي طالب دفع، وطباعة PDF وإكسيل رسمي"
                  : "تصدير Excel وشيتات منفصلة لكل صف دراسي مع ترتيب الطلاب (الذين سددوا أولاً ثم المتأخرين) وطباعة PDF رسمية"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleExportExcel}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 font-black text-xs shadow-lg shadow-emerald-500/30 flex items-center gap-2 cursor-pointer transition-all transform active:scale-95"
              title="تصدير شيت إكسيل مقسم لكل صف دراسي"
            >
              <FileSpreadsheet className="w-4 h-4 text-slate-950" />
              <span>📊 تصدير Excel مقسم لكل صف</span>
            </button>

            <button
              type="button"
              onClick={handlePrintPDF}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/30 flex items-center gap-2 cursor-pointer transition-all transform active:scale-95"
            >
              <Printer className="w-4 h-4 text-slate-950" />
              <span>{displayMode === "UNPAID_ONLY" ? "🖨️ طباعة كشف غير المسددين فقط (PDF)" : "طباعة وتصدير PDF (A4)"}</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadHtml}
              className="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
              title="تحميل مستند HTML قابل للطباعة لاحقاً"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              <span>حفظ HTML</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="إغلاق"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-indigo-500/20 text-xs font-bold">
          {/* Month Selector */}
          <div className="flex items-center gap-2 bg-[#060b17] border border-indigo-500/30 px-3 py-2 rounded-xl">
            <Calendar className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-slate-400 shrink-0">الشهر:</span>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-transparent text-white font-bold outline-none cursor-pointer w-full text-xs"
            />
          </div>

          {/* Grade Selector */}
          <div className="flex items-center gap-2 bg-[#060b17] border border-indigo-500/30 px-3 py-2 rounded-xl">
            <span className="text-slate-400 shrink-0">الصف:</span>
            <select
              value={selectedGrade}
              onChange={(e) => setSelectedGrade(e.target.value)}
              className="bg-transparent text-amber-300 font-bold outline-none cursor-pointer w-full text-xs"
            >
              <option value="ALL" className="bg-slate-900 text-white">كل الصفوف الدراسية</option>
              {GRADE_ORDER.map((g) => (
                <option key={g} value={g} className="bg-slate-900 text-white">
                  {g}
                </option>
              ))}
            </select>
          </div>

          {/* Group Days Selector */}
          <div className="flex items-center gap-2 bg-[#060b17] border border-indigo-500/30 px-3 py-2 rounded-xl">
            <span className="text-slate-400 shrink-0">المجموعة:</span>
            <select
              value={selectedDays}
              onChange={(e) => setSelectedDays(e.target.value)}
              className="bg-transparent text-white font-bold outline-none cursor-pointer w-full text-xs"
            >
              <option value="ALL" className="bg-slate-900 text-white">كل المجموعات (الكل)</option>
              <option value="سبت - إثنين - أربعاء" className="bg-slate-900 text-white">سبت - إثنين - أربعاء</option>
              <option value="أحد - ثلاثاء - خميس" className="bg-slate-900 text-white">أحد - ثلاثاء - خميس</option>
            </select>
          </div>

          {/* Display Mode Switcher */}
          <div className="flex items-center gap-2 bg-[#060b17] border border-indigo-500/30 px-3 py-2 rounded-xl">
            <span className="text-slate-400 shrink-0">العرض:</span>
            <select
              value={displayMode}
              onChange={(e) => setDisplayMode(e.target.value as "PAID_THEN_UNPAID" | "UNPAID_ONLY")}
              className="bg-transparent text-emerald-300 font-bold outline-none cursor-pointer w-full text-xs"
            >
              <option value="UNPAID_ONLY" className="bg-slate-900 text-white">
                غير المسددين فقط ❌ (المتأخرين عن الدفع فقط)
              </option>
              <option value="PAID_THEN_UNPAID" className="bg-slate-900 text-white">
                المسددون أولاً ثم غير المسددين ✅❌ (كشف مجمع)
              </option>
            </select>
          </div>
        </div>

        {/* Available Months Quick Selector */}
        {availableMonths.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap w-full bg-[#070c1b] p-2 rounded-2xl border border-indigo-500/20 text-xs">
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
                      ? "bg-amber-500 text-slate-950 font-black shadow-md"
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

        {/* Batch Reminder WhatsApp Blast & Notice */}
        <div className="flex items-center justify-between gap-3 flex-wrap pt-2 border-t border-indigo-500/20">
          <div className="flex items-center gap-3 text-xs font-bold text-slate-300">
            <span className="px-3 py-1 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              المسددون: <strong className="font-mono">{paidStudentsList.length}</strong> طالب ({totalPaidAmount} ج.م)
            </span>
            <span className="px-3 py-1 rounded-xl bg-rose-500/20 text-rose-300 border border-rose-500/30">
              غير المسددين: <strong className="font-mono">{unpaidStudentsList.length}</strong> طالب ({totalUnpaidAmount} ج.م)
            </span>
          </div>

          <button
            type="button"
            onClick={handleSendAllWhatsAppReminders}
            disabled={unpaidStudentsList.length === 0}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 disabled:opacity-40 cursor-pointer transition-all"
          >
            <Phone className="w-3.5 h-3.5" />
            <span>تجهيز تذكير واتساب للمتأخرين ({unpaidStudentsList.length} طالب)</span>
          </button>
        </div>

        {/* Notice Banner */}
        {batchActionNotice && (
          <div className="w-full p-3 rounded-2xl bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{batchActionNotice}</span>
          </div>
        )}
      </div>

      {/* Printable Report Document (A4 Printable Component) */}
      <div
        id="printable-unpaid-defaulters-doc"
        className="w-full max-w-5xl space-y-8 bg-white text-slate-900 p-8 md:p-12 rounded-3xl shadow-2xl print:p-0 print:m-0 print:shadow-none print:w-full font-['Tajawal',sans-serif]"
      >
        {gradesToRender.length === 0 || filteredStudentsList.length === 0 ? (
          <div className="text-center py-16 text-slate-500 space-y-3">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h4 className="text-lg font-bold text-slate-800">لا توجد بيانات مطابقة للبحث</h4>
            <p className="text-xs text-slate-500">
              تأكد من اختيار الصف والشهر المطلوب.
            </p>
          </div>
        ) : (
          gradesToRender.map((grade) => {
            const gradeStudents = filteredStudentsList.filter((s) => s.groupGrade === grade);
            if (gradeStudents.length === 0) return null;

            const gradePaid = gradeStudents.filter((s) => isStudentPaid(monthPayments, s.barcode));
            const gradeUnpaid = gradeStudents.filter((s) => !isStudentPaid(monthPayments, s.barcode));

            // If in UNPAID_ONLY mode and no unpaid in this grade, skip
            if (displayMode === "UNPAID_ONLY" && gradeUnpaid.length === 0) return null;

            const gradePaidMoney = gradePaid.reduce((sum, s) => {
              const pay = getStudentPayment(monthPayments, s.barcode);
              const fee =
                s.customMonthlyFee ??
                groupPrices[s.groupGrade] ??
                DEFAULT_GRADE_PRICES[s.groupGrade] ??
                100;
              return sum + (pay ? pay.amount : fee);
            }, 0);

            const gradeUnpaidMoney = gradeUnpaid.reduce((sum, s) => {
              const fee =
                s.customMonthlyFee ??
                groupPrices[s.groupGrade] ??
                DEFAULT_GRADE_PRICES[s.groupGrade] ??
                100;
              return sum + fee;
            }, 0);

            const collectionRate = gradeStudents.length > 0
              ? Math.round((gradePaid.length / gradeStudents.length) * 100)
              : 0;

            return (
              <section
                key={grade}
                className="page-break-grade border-b-4 border-dashed border-slate-300 print:border-none pb-8 print:pb-0 mb-8 print:mb-0"
                style={{ pageBreakAfter: "always", breakAfter: "page" }}
              >
                {/* Official Printable Header */}
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
                    <span className="text-base md:text-lg font-black bg-indigo-100 text-indigo-950 px-4 py-1.5 rounded-full border border-indigo-300 inline-block shadow-sm">
                      {grade}
                    </span>
                    <p className="text-xs text-slate-800 font-black mt-1">
                      {displayMode === "UNPAID_ONLY"
                        ? `كشف الطلاب غير المسددين (المتأخرين عن الدفع) لشهر (${selectedMonth})`
                        : `كشف اشتراكات ومصروفات شهر (${selectedMonth})`}
                    </p>
                  </div>

                  <div className="text-left text-xs font-semibold text-slate-600">
                    <p>تاريخ الاستخراج:</p>
                    <p className="font-bold text-slate-900">{formattedToday}</p>
                  </div>
                </div>

                {/* Grade Level Summary Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-slate-100 p-3 rounded-2xl border border-slate-300 text-xs font-bold mb-5">
                  <div className="text-slate-800">
                    إجمالي طلاب الصف: <strong className="text-black font-mono text-sm">{gradeStudents.length}</strong> طالب
                  </div>
                  <div className="text-emerald-800">
                    المسددون: <strong className="font-mono text-sm">{gradePaid.length}</strong> طالب ({gradePaidMoney} ج.م)
                  </div>
                  <div className="text-rose-800">
                    غير المسددين: <strong className="font-mono text-sm">{gradeUnpaid.length}</strong> طالب ({gradeUnpaidMoney} ج.م)
                  </div>
                  <div className="text-indigo-800">
                    نسبة التحصيل: <strong className="font-mono text-sm">{collectionRate}%</strong>
                  </div>
                </div>

                {/* Section 1: All Paid Students FIRST (if not unpaid only) */}
                {displayMode === "PAID_THEN_UNPAID" && (
                  <div className="mb-6 space-y-2">
                    <div className="flex items-center justify-between bg-emerald-100/80 border border-emerald-300 px-3 py-1.5 rounded-xl text-xs font-black text-emerald-900">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                        <span>أولاً: الطلاب الذين سددوا الاشتراك ({gradePaid.length} طالب)</span>
                      </div>
                      <span className="font-mono">{gradePaidMoney} ج.م محصلة</span>
                    </div>

                    {gradePaid.length === 0 ? (
                      <p className="text-xs text-slate-400 italic p-3 text-center bg-slate-50 rounded-xl border border-slate-200">
                        لم يتم تسجيل أي عمليات سداد لهذا الصف في هذا الشهر حتى الآن.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-right border-collapse text-xs">
                          <thead>
                            <tr className="bg-emerald-800 text-white font-bold border-b border-emerald-700 print:bg-emerald-100 print:text-black">
                              <th className="p-2 border border-slate-300 text-center w-10">م</th>
                              <th className="p-2 border border-slate-300 text-center w-24">الباركود</th>
                              <th className="p-2 border border-slate-300">اسم الطالب</th>
                              <th className="p-2 border border-slate-300">المجموعة</th>
                              <th className="p-2 border border-slate-300 text-center">المبلغ المسدد</th>
                              <th className="p-2 border border-slate-300 text-center">حالة السداد</th>
                              <th className="p-2 border border-slate-300 text-center">تاريخ السداد</th>
                              <th className="p-2 border border-slate-300 text-center">هاتف ولي الأمر</th>
                            </tr>
                          </thead>
                          <tbody>
                            {gradePaid.map((student, idx) => {
                              const pay = getStudentPayment(monthPayments, student.barcode);
                              const fee =
                                student.customMonthlyFee ??
                                groupPrices[student.groupGrade] ??
                                DEFAULT_GRADE_PRICES[student.groupGrade] ??
                                100;
                              const paidAmount = pay ? pay.amount : fee;

                              return (
                                <tr key={student.barcode} className="hover:bg-emerald-50/50 transition-colors">
                                  <td className="p-2 border border-slate-300 text-center font-mono font-bold text-slate-600">
                                    {idx + 1}
                                  </td>
                                  <td className="p-2 border border-slate-300 text-center font-mono font-bold text-emerald-800 print:text-black">
                                    #{student.barcode}
                                  </td>
                                  <td className="p-2 border border-slate-300 font-bold text-slate-900 text-[13px]">
                                    {student.name}
                                    {student.discountReason && (
                                      <span className="block text-[10px] text-slate-500 font-normal">
                                        ({student.discountReason})
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-2 border border-slate-300 text-slate-700 text-xs">
                                    {student.groupDays}
                                  </td>
                                  <td className="p-2 border border-slate-300 text-center font-mono font-bold text-emerald-700">
                                    {paidAmount} ج.م
                                  </td>
                                  <td className="p-2 border border-slate-300 text-center">
                                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 inline-block">
                                      ✅ تم السداد
                                    </span>
                                  </td>
                                  <td className="p-2 border border-slate-300 text-center font-mono text-slate-600">
                                    {pay ? `${pay.date}` : "-"}
                                  </td>
                                  <td className="p-2 border border-slate-300 text-center font-mono text-slate-700">
                                    {student.parentPhone || student.phone || "-"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* Section 2: All Unpaid Students SECOND */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between bg-rose-100/80 border border-rose-300 px-3 py-1.5 rounded-xl text-xs font-black text-rose-900">
                    <div className="flex items-center gap-1.5">
                      <XCircle className="w-4 h-4 text-rose-700" />
                      <span>
                        {displayMode === "UNPAID_ONLY"
                          ? `كشف الطلاب المتأخرين عن السداد (${gradeUnpaid.length} طالب)`
                          : `ثانياً: الطلاب المتأخرين عن السداد (${gradeUnpaid.length} طالب)`}
                      </span>
                    </div>
                    <span className="font-mono">{gradeUnpaidMoney} ج.م متبقية</span>
                  </div>

                  {gradeUnpaid.length === 0 ? (
                    <p className="text-xs text-emerald-600 font-bold p-3 text-center bg-emerald-50 rounded-xl border border-emerald-200">
                      🎉 جميع طلاب هذا الصف سددوا الاشتراك بالكامل ولا يوجد أي متأخرات!
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-right border-collapse text-xs">
                        <thead>
                          <tr className="bg-rose-900 text-white font-bold border-b border-rose-800 print:bg-rose-100 print:text-black">
                            <th className="p-2 border border-slate-300 text-center w-10">م</th>
                            <th className="p-2 border border-slate-300 text-center w-24">الباركود</th>
                            <th className="p-2 border border-slate-300">اسم الطالب</th>
                            <th className="p-2 border border-slate-300">المجموعة</th>
                            <th className="p-2 border border-slate-300 text-center">الاشتراك المستحق</th>
                            <th className="p-2 border border-slate-300 text-center">حالة السداد</th>
                            <th className="p-2 border border-slate-300 text-center">هاتف ولي الأمر</th>
                            <th className="p-2 border border-slate-300 text-center no-print">إجراء سريع</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gradeUnpaid.map((student, idx) => {
                            const fee =
                              student.customMonthlyFee ??
                              groupPrices[student.groupGrade] ??
                              DEFAULT_GRADE_PRICES[student.groupGrade] ??
                              100;

                            return (
                              <tr key={student.barcode} className="hover:bg-rose-50/50 transition-colors">
                                <td className="p-2 border border-slate-300 text-center font-mono font-bold text-slate-600">
                                  {idx + 1}
                                </td>
                                <td className="p-2 border border-slate-300 text-center font-mono font-bold text-rose-800 print:text-black">
                                  #{student.barcode}
                                </td>
                                <td className="p-2 border border-slate-300 font-bold text-slate-900 text-[13px]">
                                  {student.name}
                                  {student.discountReason && (
                                    <span className="block text-[10px] text-amber-700 font-normal">
                                      ({student.discountReason})
                                    </span>
                                  )}
                                </td>
                                <td className="p-2 border border-slate-300 text-slate-700 text-xs">
                                  {student.groupDays}
                                </td>
                                <td className="p-2 border border-slate-300 text-center font-mono font-bold text-slate-900">
                                  {fee} ج.م
                                </td>
                                <td className="p-2 border border-slate-300 text-center">
                                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-700 border border-rose-300 inline-block">
                                    ❌ غير مسدد
                                  </span>
                                </td>
                                <td className="p-2 border border-slate-300 text-center font-mono text-slate-700">
                                  {student.parentPhone || student.phone || "-"}
                                </td>
                                <td className="p-2 border border-slate-300 text-center no-print">
                                  <div className="flex items-center justify-center gap-1">
                                    {onRecordPayment && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          onRecordPayment(
                                            student.barcode,
                                            fee,
                                            selectedMonth,
                                            `سداد اشتراك ${selectedMonth}`
                                          );
                                        }}
                                        className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold shadow-sm cursor-pointer"
                                        title="إثبات السداد الآن"
                                      >
                                        سداد 💳
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const msg =
                                          `تذكير بسداد الاشتراك 🔔\n` +
                                          `منظومة الأستاذة إيمان الدمشيتي - رياضيات 📐\n` +
                                          `اسم الطالب: ${student.name}\n` +
                                          `الصف: ${student.groupGrade}\n` +
                                          `نود تذكيركم بسداد اشتراك شهر (${selectedMonth}) وقيمته: ${fee} ج.م.\n` +
                                          `شاكرين حسن تعاونكم واهتمامكم ✨`;
                                        openWhatsApp(student.parentPhone || student.phone || "", msg);
                                      }}
                                      className="p-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-800 border border-amber-400 cursor-pointer"
                                      title="إرسال تذكير واتساب فوري"
                                    >
                                      <Phone className="w-3 h-3" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Sign-off Footer */}
                <div className="mt-8 pt-4 border-t-2 border-slate-300 flex justify-between items-center text-xs font-bold text-slate-700">
                  <div>
                    <p>المشرف المسؤول: ........................................</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[#8c671b] font-black text-sm">أستاذة المادة: أ/ إيمان الدمشيتي</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">التوقيع والاعتماد: ........................................</p>
                  </div>
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
};
