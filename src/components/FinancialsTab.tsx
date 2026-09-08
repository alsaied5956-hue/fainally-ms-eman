import React, { useState, useMemo } from "react";
import { Student, PaymentRecord, GradeName, GRADE_ORDER } from "../types";
import { getCurrentMonthKey, getTodayKey, sortStudentsByGradeAndName, DEFAULT_GRADE_PRICES, openWhatsApp, isStudentPaid, getStudentPayment } from "../utils/helpers";
import { matchStudentSearch } from "../utils/search";
import { forceCloudFullRefresh, exportPaidStudentsToCloud } from "../utils/storage";
import { playBeep } from "../utils/audio";
import confetti from "canvas-confetti";
import { StudentFinancialLedgerModal } from "./StudentFinancialLedgerModal";
import { UnpaidDefaultersModal } from "./UnpaidDefaultersModal";
import { EditPaymentModal } from "./EditPaymentModal";
import { exportDefaultersAndPaidExcel } from "../utils/excel";
import * as XLSX from "xlsx";
import {
  Coins,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  Search,
  Calendar,
  Tag,
  X,
  FileText,
  AlertTriangle,
  Printer,
  Edit2,
  Trash2,
  CreditCard,
  RefreshCw,
  Sparkles,
  CloudUpload,
  Database,
  ArrowUpRight,
} from "lucide-react";

interface FinancialsTabProps {
  students: Student[];
  payments: Record<string, Record<string, PaymentRecord>>;
  groupPrices: Record<GradeName, number>;
  onOpenMultiDeviceSync?: () => void;
  onRecordPayment?: (barcode: string, amount: number, monthKey: string, note: string) => void;
  onUpdatePayment?: (
    oldMonthKey: string,
    barcode: string,
    newMonthKey: string,
    newAmount: number,
    newNote: string,
    newDate?: string
  ) => void;
  onDeletePayment?: (monthKey: string, barcode: string) => void;
}

export const FinancialsTab: React.FC<FinancialsTabProps> = ({
  students,
  payments,
  groupPrices,
  onOpenMultiDeviceSync,
  onRecordPayment,
  onUpdatePayment,
  onDeletePayment,
}) => {
  // Determine available months with recorded payments
  const monthsWithRecords = useMemo(() => {
    const map: Record<string, number> = {};
    Object.entries(payments || {}).forEach(([mKey, recMap]) => {
      const count = Object.keys(recMap || {}).length;
      if (count > 0) {
        map[mKey] = count;
      }
    });
    return map;
  }, [payments]);

  // Default to a month with recorded payments if current month has 0, or fallback to current month
  const defaultInitialMonth = useMemo(() => {
    const cur = getCurrentMonthKey();
    if (monthsWithRecords[cur]) return cur;
    const keys = Object.keys(monthsWithRecords);
    if (keys.length > 0) {
      // Pick the latest month that has payments
      return keys.sort().reverse()[0];
    }
    return cur;
  }, [monthsWithRecords]);

  const [selectedMonth, setSelectedMonth] = useState<string>(defaultInitialMonth);
  const [filterGrade, setFilterGrade] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState<"ALL" | "PAID" | "UNPAID">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [ledgerModalStudent, setLedgerModalStudent] = useState<Student | null>(null);
  const [isUnpaidModalOpen, setIsUnpaidModalOpen] = useState(false);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [isExportingToCloud, setIsExportingToCloud] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [exportSuccessDetails, setExportSuccessDetails] = useState<{
    monthsCount: number;
    paidRecordsCount: number;
    totalAmountCollected: number;
    message: string;
  } | null>(null);
  const [editingPaymentData, setEditingPaymentData] = useState<{
    student: Student;
    record: PaymentRecord;
    monthKey: string;
  } | null>(null);

  const handleForceSync = async () => {
    setIsSyncingCloud(true);
    const res = await forceCloudFullRefresh();
    setIsSyncingCloud(false);
    setSyncFeedback(res.message);
    setTimeout(() => setSyncFeedback(null), 5000);
  };

  const handleExportPaidStudentsToCloud = async () => {
    setIsExportingToCloud(true);
    try {
      const res = await exportPaidStudentsToCloud();
      setIsExportingToCloud(false);
      if (res.success) {
        playBeep("success");
        try {
          confetti({
            particleCount: 70,
            spread: 60,
            origin: { y: 0.6 },
          });
        } catch {}
        setExportSuccessDetails({
          monthsCount: res.monthsCount,
          paidRecordsCount: res.paidRecordsCount,
          totalAmountCollected: res.totalAmountCollected,
          message: res.message,
        });
        setTimeout(() => setExportSuccessDetails(null), 8000);
      } else {
        playBeep("warning");
        setSyncFeedback(res.message);
        setTimeout(() => setSyncFeedback(null), 6000);
      }
    } catch (err) {
      setIsExportingToCloud(false);
      setSyncFeedback("حدث خطأ أثناء محاولة التصدير والمزامنة السحابية.");
      setTimeout(() => setSyncFeedback(null), 5000);
    }
  };

  const todayKey = getTodayKey();
  const isAllMonthsMode = selectedMonth === "ALL_MONTHS";
  const monthPayments = isAllMonthsMode ? {} : (payments[selectedMonth] || {});

  // Academic months list for easy tabs
  const monthPillsList = useMemo(() => {
    const now = new Date();
    const curYear = now.getFullYear();
    const pills = [
      { key: `${curYear}-08`, label: `شهر 8 (أغسطس ${curYear})`, monthNum: 8 },
      { key: `${curYear}-09`, label: `شهر 9 (سبتمبر ${curYear})`, monthNum: 9 },
      { key: `${curYear}-10`, label: `شهر 10 (أكتوبر ${curYear})`, monthNum: 10 },
      { key: `${curYear}-11`, label: `شهر 11 (نوفمبر ${curYear})`, monthNum: 11 },
      { key: `${curYear}-12`, label: `شهر 12 (ديسمبر ${curYear})`, monthNum: 12 },
      { key: `${curYear + 1}-01`, label: `شهر 1 (يناير ${curYear + 1})`, monthNum: 1 },
      { key: `${curYear + 1}-02`, label: `شهر 2 (فبراير ${curYear + 1})`, monthNum: 2 },
      { key: `${curYear + 1}-03`, label: `شهر 3 (مارس ${curYear + 1})`, monthNum: 3 },
      { key: `${curYear + 1}-04`, label: `شهر 4 (أبريل ${curYear + 1})`, monthNum: 4 },
      { key: `${curYear + 1}-05`, label: `شهر 5 (مايو ${curYear + 1})`, monthNum: 5 },
      { key: `${curYear + 1}-06`, label: `شهر 6 (يونيو ${curYear + 1})`, monthNum: 6 },
      { key: `${curYear + 1}-07`, label: `شهر 7 (يوليو ${curYear + 1})`, monthNum: 7 },
    ];

    // Include any custom keys in payments that aren't in the list
    Object.keys(payments || {}).forEach((k) => {
      if (!pills.some((p) => p.key === k)) {
        pills.push({ key: k, label: `شهر (${k})`, monthNum: 0 });
      }
    });

    return pills;
  }, [payments]);

  // Filter students based on selection
  const filteredStudents = useMemo(() => {
    const base = students.filter((s) => {
      if (filterGrade !== "ALL" && s.groupGrade !== filterGrade) return false;

      if (isAllMonthsMode) {
        // In all months mode, check if student has paid in any month
        const hasAnyPayment = Object.values(payments || {}).some((recMap) =>
          isStudentPaid(recMap as Record<string, PaymentRecord>, s.barcode)
        );
        if (filterStatus === "PAID" && !hasAnyPayment) return false;
        if (filterStatus === "UNPAID" && hasAnyPayment) return false;
        return true;
      }

      const isPaid = isStudentPaid(monthPayments, s.barcode);
      if (filterStatus === "PAID" && !isPaid) return false;
      if (filterStatus === "UNPAID" && isPaid) return false;
      return true;
    });

    if (searchQuery.trim()) {
      const scored: { student: Student; score: number }[] = [];
      for (const s of base) {
        const { match, score } = matchStudentSearch(s, searchQuery);
        if (match) {
          scored.push({ student: s, score });
        }
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.map((item) => item.student);
    }

    return sortStudentsByGradeAndName(base);
  }, [students, filterGrade, filterStatus, searchQuery, monthPayments, isAllMonthsMode, payments]);

  const { paidCount, unpaidCount, todayAmount, monthTotalAmount, totalAllTimeRevenue } = useMemo(() => {
    let paid = 0;
    let unpaid = 0;
    let todayTot = 0;
    let monthTot = 0;
    let allTimeTot = 0;

    // Calculate all time total
    Object.values(payments || {}).forEach((recMap) => {
      Object.values(recMap || {}).forEach((p) => {
        if (p?.amount) allTimeTot += p.amount;
      });
    });

    filteredStudents.forEach((s) => {
      if (isAllMonthsMode) {
        let studentTotal = 0;
        Object.values(payments || {}).forEach((recMap) => {
          const p = getStudentPayment(recMap as Record<string, PaymentRecord>, s.barcode);
          if (p) {
            studentTotal += p.amount;
            if (p.date === todayKey) todayTot += p.amount;
          }
        });
        if (studentTotal > 0) paid++;
        else unpaid++;
        monthTot += studentTotal;
      } else {
        const pay = getStudentPayment(monthPayments, s.barcode);
        if (pay) {
          paid++;
          monthTot += pay.amount;
          if (pay.date === todayKey) {
            todayTot += pay.amount;
          }
        } else {
          unpaid++;
        }
      }
    });

    return {
      paidCount: paid,
      unpaidCount: unpaid,
      todayAmount: todayTot,
      monthTotalAmount: monthTot,
      totalAllTimeRevenue: allTimeTot,
    };
  }, [filteredStudents, monthPayments, todayKey, isAllMonthsMode, payments]);

  const exportFinancialsExcel = () => {
    if (selectedMonth !== "ALL_MONTHS") {
      exportDefaultersAndPaidExcel({
        students,
        payments,
        groupPrices,
        selectedMonth,
        filterGrade,
        fileName: `كشف_الاشتراكات_وغير_الدافعين_${selectedMonth}_${filterGrade !== "ALL" ? filterGrade : "كافة_الصفوف"}`,
      });
      return;
    }

    const rows = filteredStudents.map((s, idx) => {
      const pay = getStudentPayment(monthPayments, s.barcode);
      const fee =
        s.customMonthlyFee ??
        groupPrices[s.groupGrade] ??
        DEFAULT_GRADE_PRICES[s.groupGrade] ??
        100;

      // Find all paid months for this student
      const studentPaidMonths = Object.entries(payments || {})
        .filter(([_, recMap]) => isStudentPaid(recMap as Record<string, PaymentRecord>, s.barcode))
        .map(([mKey, recMap]) => {
          const p = getStudentPayment(recMap as Record<string, PaymentRecord>, s.barcode);
          return `${mKey} (${p?.amount || 0}ج)`;
        })
        .join("، ");

      return {
        "م": idx + 1,
        "الباركود": s.barcode,
        "اسم الطالب": s.name,
        "الصف الدراسي": s.groupGrade,
        "الاشتراك المحدد (ج.م)": fee,
        "المبلغ المسدد للشهر الحالي": pay ? pay.amount : 0,
        "حالة سداد الشهر الحالي": pay ? "مدفوع" : "غير مدفوع",
        "تاريخ وساعة السداد": pay ? `${pay.date} ${pay.time}` : "-",
        "كافة الشهور المسددة للطالب": studentPaidMonths || "لا يوجد",
        "ملاحظات": pay?.note || (s.discountReason ? `خصم: ${s.discountReason}` : "-"),
        "رقم ولي الأمر": s.parentPhone || s.phone || "-",
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet["!views"] = [{ RTL: true }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "الإيرادات والاشتراكات");
    XLSX.writeFile(workbook, `الإحصاء_المالي_${selectedMonth}.xlsx`);
  };

  // Find if other months have recorded payments when current selected month is empty
  const otherActiveMonths = useMemo(() => {
    return Object.entries(monthsWithRecords as Record<string, number>)
      .filter(([mKey, count]) => mKey !== selectedMonth && Number(count) > 0)
      .sort((a, b) => b[0].localeCompare(a[0]));
  }, [monthsWithRecords, selectedMonth]);

  return (
    <div className="space-y-6 font-tajawal">
      {/* Month Switcher Bar / Fast Navigation Pills */}
      <div className="glass-panel p-3.5 rounded-3xl shadow-xl flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-indigo-500/20">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-amber-400" />
            <span className="text-sm font-bold text-slate-200">اختر شهر السداد والمصروفات:</span>
          </div>
          <div className="text-xs text-slate-400 font-medium">
            إجمالي كافة المدفوعات المسجلة في السجل: <span className="font-bold text-amber-300 font-mono">{totalAllTimeRevenue} ج.م</span>
          </div>
        </div>

        {/* Scrollable Month Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
          <button
            type="button"
            onClick={() => setSelectedMonth("ALL_MONTHS")}
            className={`px-3.5 py-2 rounded-2xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
              selectedMonth === "ALL_MONTHS"
                ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-md scale-105 font-black"
                : "bg-slate-900/80 text-slate-300 hover:bg-slate-800 border border-slate-700/50"
            }`}
          >
            <span>📑 كافة الشهور التراكمية</span>
          </button>

          {monthPillsList.map((pill) => {
            const isSelected = selectedMonth === pill.key;
            const paidCountInThisMonth = monthsWithRecords[pill.key] || 0;
            const hasData = paidCountInThisMonth > 0;

            return (
              <button
                key={pill.key}
                type="button"
                onClick={() => setSelectedMonth(pill.key)}
                className={`px-3.5 py-2 rounded-2xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                  isSelected
                    ? "bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-lg ring-2 ring-amber-400 font-black scale-105"
                    : hasData
                    ? "bg-emerald-950/60 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-900/50"
                    : "bg-slate-900/60 text-slate-400 border border-slate-800 hover:bg-slate-800"
                }`}
              >
                <span>{pill.label}</span>
                {hasData && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-black ${
                    isSelected ? "bg-amber-400 text-slate-950" : "bg-emerald-500/30 text-emerald-300"
                  }`}>
                    {paidCountInThisMonth} مدفوع
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Helpful Smart Notice Banner if Selected Month has 0 payments but other months have data */}
      {!isAllMonthsMode && paidCount === 0 && otherActiveMonths.length > 0 && (
        <div className="p-4 rounded-3xl bg-gradient-to-r from-amber-500/15 via-indigo-500/15 to-transparent border border-amber-400/40 flex items-center justify-between gap-3 flex-wrap shadow-lg animate-pulse">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="text-xs text-slate-200">
              <span className="font-bold text-amber-300">ملاحظة هامة: </span>
              أنت تعرض حالياً شهر <span className="font-bold underline text-white">{selectedMonth}</span> ولم تُسجل فيه مدفوعات بعد.
              يوجد مدفوعات مسجلة ومحفوظة بالكامل في:{" "}
              {otherActiveMonths.map(([mKey, count]) => (
                <span key={mKey} className="font-bold text-emerald-300 mx-1">
                  شهر {mKey} ({count} طالب مسدد)
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {otherActiveMonths.map(([mKey]) => (
              <button
                key={mKey}
                type="button"
                onClick={() => setSelectedMonth(mKey)}
                className="px-3 py-1.5 rounded-xl bg-amber-400 text-slate-950 text-xs font-black hover:bg-amber-300 transition-all shadow cursor-pointer"
              >
                انتقل لشهر {mKey} 👈
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Financial Metrics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="glass-card p-4.5 rounded-3xl text-center shadow-lg hover:border-emerald-400/40 transition-all duration-300">
          <p className="text-xs text-emerald-400 font-tajawal font-medium mb-1">
            {isAllMonthsMode ? "طلاب سددوا (أي شهر)" : `الاشتراكات المدفوعة (${selectedMonth})`}
          </p>
          <p className="text-2xl md:text-3xl font-black text-emerald-400 font-mono">{paidCount}</p>
        </div>

        <div
          onClick={() => setIsUnpaidModalOpen(true)}
          className="glass-card p-4.5 rounded-3xl text-center shadow-lg hover:border-rose-400/60 transition-all duration-300 cursor-pointer group bg-rose-500/5 hover:bg-rose-500/10"
          title="اضغط لفتح كشف الطلاب المتأخرين وتصدير PDF رسمي"
        >
          <p className="text-xs text-rose-400 font-tajawal font-medium mb-1 flex items-center justify-center gap-1">
            <span>اشتراكات مستحقة / غير مدفوعة</span>
            <Printer className="w-3 h-3 group-hover:scale-110 transition-transform text-rose-400" />
          </p>
          <p className="text-2xl md:text-3xl font-black text-rose-400 font-mono">{unpaidCount}</p>
          <span className="text-[10px] text-rose-300/80 font-bold block mt-0.5">اضغط لطباعة كشف PDF 🖨️</span>
        </div>

        <div className="glass-card p-4.5 rounded-3xl text-center shadow-lg hover:border-sky-400/40 transition-all duration-300">
          <p className="text-xs text-sky-400 font-tajawal font-medium mb-1">إيراد اليوم ({todayKey})</p>
          <p className="text-2xl md:text-3xl font-black text-sky-400 font-mono">{todayAmount} <span className="text-sm font-tajawal font-normal text-slate-400">ج.م</span></p>
        </div>

        <div className="glass-card p-4.5 rounded-3xl text-center shadow-lg hover:border-amber-400/40 transition-all duration-300">
          <p className="text-xs text-amber-400 font-tajawal font-medium mb-1">
            {isAllMonthsMode ? "إجمالي كافة المدفوعات المسجلة" : `إجمالي تحصيل شهر (${selectedMonth})`}
          </p>
          <p className="text-2xl md:text-3xl font-black text-amber-300 font-mono">{monthTotalAmount} <span className="text-sm font-tajawal font-normal text-slate-400">ج.م</span></p>
        </div>
      </div>

      {/* Filter and Action Controls */}
      <div className="glass-panel p-4 md:p-5 rounded-3xl flex flex-wrap items-center justify-between gap-3.5 shadow-xl font-tajawal">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[300px]">
          {/* Month Selector Input */}
          <div className="flex items-center gap-2 bg-[#080d1e] border border-indigo-500/30 px-3.5 py-2.5 rounded-2xl">
            <Calendar className="w-4 h-4 text-amber-400" />
            <input
              type="month"
              value={selectedMonth === "ALL_MONTHS" ? "" : selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-100 outline-none cursor-pointer"
            />
          </div>

          {/* Grade filter */}
          <select
            value={filterGrade}
            onChange={(e) => setFilterGrade(e.target.value)}
            className="bg-[#080d1e] border border-indigo-500/30 text-slate-100 text-xs font-bold px-3.5 py-2.5 rounded-2xl outline-none"
          >
            <option value="ALL" className="bg-slate-900 text-white">كل الصفوف الدراسية</option>
            {GRADE_ORDER.map((g) => (
              <option key={g} value={g} className="bg-slate-900 text-white">
                {g}
              </option>
            ))}
          </select>

          {/* Status filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as "ALL" | "PAID" | "UNPAID")}
            className="bg-[#080d1e] border border-indigo-500/30 text-slate-100 text-xs font-bold px-3.5 py-2.5 rounded-2xl outline-none"
          >
            <option value="ALL" className="bg-slate-900 text-white">الكل (مدفوع ومستحق)</option>
            <option value="PAID" className="bg-slate-900 text-white">المدفوع فقط ✅</option>
            <option value="UNPAID" className="bg-slate-900 text-white">المستحق وغير المدفوع فقط ❌</option>
          </select>

          {/* Smart Search Input */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-amber-400 absolute right-3.5 top-3.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث بالاسم (مثال: أحمد علي) أو الباركود..."
              className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-100 text-xs pr-9 pl-8 py-2.5 rounded-2xl outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/30 transition-all font-medium placeholder:text-slate-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute left-2.5 top-2.5 p-0.5 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {onOpenMultiDeviceSync && (
            <button
              type="button"
              onClick={onOpenMultiDeviceSync}
              className="px-4 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center gap-2 shadow-lg cursor-pointer transform hover:scale-105 active:scale-95 bg-gradient-to-r from-indigo-600 via-indigo-700 to-purple-700 hover:from-indigo-500 hover:to-purple-600 text-amber-300 border border-indigo-400/40 shadow-indigo-600/20"
              title="مركز توحيد ومزامنة جميع الأجهزة مع كشف شامل لـ (كام دفع وكام مدفعش)"
            >
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>📱💻 توحيد الأجهزة (كام دفع وكام مدفعش)</span>
            </button>
          )}

          {/* Dedicated Button: Export Paid Students Subscriptions to Cloud */}
          <button
            type="button"
            onClick={handleExportPaidStudentsToCloud}
            disabled={isExportingToCloud}
            className={`px-4 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center gap-2 shadow-lg cursor-pointer transform hover:scale-105 active:scale-95 ${
              isExportingToCloud
                ? "bg-gradient-to-r from-amber-400 to-yellow-300 text-slate-950 animate-pulse ring-2 ring-amber-300 shadow-amber-500/30"
                : "bg-gradient-to-r from-emerald-500 via-teal-500 to-amber-400 hover:from-emerald-400 hover:to-amber-300 text-slate-950 shadow-emerald-500/25"
            }`}
            title="تصدير ومزامنة كافة اشتراكات الطلاب الذين دفعوا المحفوظة على جهازك إلى السحابة فوراً"
          >
            <CloudUpload className={`w-4 h-4 text-slate-950 ${isExportingToCloud ? "animate-bounce" : ""}`} />
            <span>
              {isExportingToCloud
                ? "جارٍ التصدير والمزامنة..."
                : "☁️ تصدير الطلاب الذين دفعوا إلى السحابة"}
            </span>
          </button>

          <button
            type="button"
            onClick={handleForceSync}
            disabled={isSyncingCloud}
            className={`px-3.5 py-2.5 rounded-2xl border text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm cursor-pointer ${
              isSyncingCloud
                ? "bg-amber-500/20 text-amber-300 border-amber-400 animate-pulse"
                : "bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border-indigo-500/40"
            }`}
            title="جلب وتوحيد المدفوعات والشهور من كافة الأجهزة السحابية فوراً"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${isSyncingCloud ? "animate-spin" : ""}`} />
            <span>{isSyncingCloud ? "جارٍ المزامنة السحابية..." : "🔄 مزامنة فورية بين كافة الأجهزة"}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsUnpaidModalOpen(true)}
            className="px-4 py-2.5 rounded-2xl bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white text-xs font-black transition-all flex items-center gap-1.5 shadow-lg shadow-rose-900/30 cursor-pointer"
          >
            <Printer className="w-4 h-4 text-white" />
            <span>كشف غير المسددين (PDF رسمي لكل صف)</span>
          </button>

          <button
            onClick={exportFinancialsExcel}
            className="px-4 py-2.5 rounded-2xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>تصدير Excel</span>
          </button>
        </div>
      </div>

      {/* Cloud Export & Sync Spotlight Card */}
      <div className="p-4 md:p-5 rounded-3xl bg-gradient-to-r from-indigo-950/80 via-slate-900/90 to-emerald-950/70 border border-emerald-500/40 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="p-3 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-400/30 shadow-inner">
            <Database className="w-6 h-6 text-emerald-300" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-black text-white">
                تصدير ومزامنة اشتراكات الطلاب الذين دفعوا إلى السحابة
              </h4>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                مزامنة فورية بين كافة الأجهزة
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1 font-medium">
              إذا تم تسجيل مدفوعات على هذا الجهاز محلياً (Local Storage)، اضغط على الزر لرفعها وتوحيدها سحابياً فوراً لتظهر في نفس اللحظة على جميع الأجهزة الأخرى دون أي تعارض.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleExportPaidStudentsToCloud}
          disabled={isExportingToCloud}
          className={`px-5 py-3 rounded-2xl text-xs font-black transition-all flex items-center gap-2 shadow-xl cursor-pointer transform hover:scale-105 active:scale-95 ${
            isExportingToCloud
              ? "bg-amber-400 text-slate-950 animate-pulse ring-2 ring-yellow-300"
              : "bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-200 hover:from-amber-300 text-slate-950 shadow-amber-500/30"
          }`}
        >
          <CloudUpload className={`w-4 h-4 ${isExportingToCloud ? "animate-bounce" : ""}`} />
          <span>
            {isExportingToCloud
              ? "جارٍ الرفع والمزامنة السحابية..."
              : "🚀 تصدير ومزامنة المدفوعات للسحابة الآن"}
          </span>
        </button>
      </div>

      {/* Export Success Modal/Feedback Box */}
      {exportSuccessDetails && (
        <div className="p-4 rounded-3xl bg-gradient-to-r from-emerald-950 via-teal-950 to-slate-900 border-2 border-emerald-400 text-white shadow-2xl animate-fade-in flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-emerald-500/20 text-emerald-400">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h4 className="text-sm font-black text-emerald-300">
                تمت المزامنة وتصدير المدفوعات السحابية بنجاح تام!
              </h4>
              <p className="text-xs text-slate-200 mt-0.5 font-medium">
                {exportSuccessDetails.message}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-200 text-xs font-mono font-bold border border-emerald-400/30">
              {exportSuccessDetails.paidRecordsCount} عملية سداد
            </span>
            <span className="px-3 py-1.5 rounded-xl bg-amber-500/20 text-amber-200 text-xs font-mono font-bold border border-amber-400/30">
              {exportSuccessDetails.totalAmountCollected.toLocaleString("ar-EG")} ج.م
            </span>
            <button
              onClick={() => setExportSuccessDetails(null)}
              className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Instant Sync Feedback Toast */}
      {syncFeedback && (
        <div className="p-3.5 rounded-2xl bg-emerald-950/80 border border-emerald-500/50 text-emerald-200 text-xs font-bold flex items-center gap-2 shadow-lg animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{syncFeedback}</span>
        </div>
      )}

      {/* Financial Table */}
      <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-xs md:text-sm font-tajawal">
            <thead>
              <tr className="bg-slate-900/90 text-amber-400 font-bold border-b border-indigo-500/30">
                <th className="p-3.5">م</th>
                <th className="p-3.5">الباركود</th>
                <th className="p-3.5">اسم الطالب</th>
                <th className="p-3.5">الصف الدراسي</th>
                <th className="p-3.5">الاشتراك المحدد</th>
                <th className="p-3.5">تاريخ ووقت السداد</th>
                <th className="p-3.5">المبلغ المسدد</th>
                <th className="p-3.5">حالة السداد</th>
                <th className="p-3.5 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-indigo-950/50">
              {filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400 italic">
                    {searchQuery ? `لا توجد نتائج مطابقة لـ "${searchQuery}"` : "لا يوجد سجلات مطابقة للبحث المحدد."}
                  </td>
                </tr>
              ) : (
                filteredStudents.map((student, idx) => {
                  const pay = getStudentPayment(monthPayments, student.barcode);
                  const fee =
                    student.customMonthlyFee ??
                    groupPrices[student.groupGrade] ??
                    DEFAULT_GRADE_PRICES[student.groupGrade] ??
                    100;

                  // Get all payments recorded for this student across all months
                  const studentAllPayments = Object.entries(payments || {})
                    .filter(([_, recMap]) => isStudentPaid(recMap as Record<string, PaymentRecord>, student.barcode))
                    .map(([mKey, recMap]) => ({
                      monthKey: mKey,
                      record: getStudentPayment(recMap as Record<string, PaymentRecord>, student.barcode)!,
                    }));

                  const totalPaidByStudent = studentAllPayments.reduce(
                    (sum, item) => sum + (item.record?.amount || 0),
                    0
                  );

                  return (
                    <tr key={student.barcode} className="hover:bg-indigo-500/10 transition-colors font-medium">
                      <td className="p-3.5 font-mono text-slate-400">{idx + 1}</td>
                      <td className="p-3.5 font-mono text-amber-300 font-bold">{student.barcode}</td>
                      <td className="p-3.5 font-bold text-slate-100">{student.name}</td>
                      <td className="p-3.5 text-slate-300">{student.groupGrade}</td>
                      <td className="p-3.5">
                        <span className="font-bold text-slate-200">{fee} ج.م</span>
                        {student.customMonthlyFee !== undefined && (
                          <span className="block text-[10px] text-amber-300/80">
                            (مخصص: {student.discountReason || "اشتراك مخفض"})
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 font-mono text-slate-400">
                        {isAllMonthsMode ? (
                          studentAllPayments.length > 0 ? (
                            <div className="flex flex-wrap gap-1 max-w-xs">
                              {studentAllPayments.map((p) => (
                                <span
                                  key={p.monthKey}
                                  className="px-1.5 py-0.5 rounded bg-indigo-900/60 text-[10px] text-indigo-200 border border-indigo-500/30"
                                >
                                  {p.monthKey}: {p.record.date}
                                </span>
                              ))}
                            </div>
                          ) : (
                            "-"
                          )
                        ) : pay ? (
                          `${pay.date} ${pay.time}`
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="p-3.5 font-mono font-bold text-amber-300">
                        {isAllMonthsMode
                          ? `${totalPaidByStudent} ج.م (${studentAllPayments.length} شهر)`
                          : pay
                          ? `${pay.amount} ج.م`
                          : "0 ج.م"}
                      </td>
                      <td className="p-3.5">
                        {isAllMonthsMode ? (
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-bold border inline-block ${
                              studentAllPayments.length > 0
                                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                : "bg-rose-500/20 text-rose-300 border-rose-500/40"
                            }`}
                          >
                            {studentAllPayments.length > 0
                              ? `✅ مسدد (${studentAllPayments.length} شهر)`
                              : "❌ لا يوجد سداد مسجل"}
                          </span>
                        ) : (
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-bold border inline-block ${
                              pay
                                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                : "bg-rose-500/20 text-rose-300 border-rose-500/40"
                            }`}
                          >
                            {pay ? "✅ تم السداد" : "❌ مستحق غير مدفوع"}
                          </span>
                        )}
                      </td>
                      <td className="p-3.5">
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setLedgerModalStudent(student)}
                            className="px-2.5 py-1.5 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-200 text-[11px] font-bold cursor-pointer transition-all flex items-center gap-1"
                            title="عرض كشف الحساب المالي المفصل وسجل شهور العام"
                          >
                            <FileText className="w-3.5 h-3.5 text-amber-400" />
                            <span>كشف الحساب 📊</span>
                          </button>

                          {!isAllMonthsMode && pay ? (
                            <>
                              {onUpdatePayment && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditingPaymentData({
                                      student,
                                      record: pay,
                                      monthKey: selectedMonth,
                                    })
                                  }
                                  className="px-2 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-[11px] font-bold cursor-pointer transition-all flex items-center gap-1"
                                  title="تعديل هذا السداد أو تحويله لشهر آخر"
                                >
                                  <Edit2 className="w-3 h-3 text-amber-400" />
                                  <span>تعديل ✏️</span>
                                </button>
                              )}

                              <button
                                onClick={() => {
                                  const receiptMsg = `إيصال استلام اشتراك 🧾\nمنظومة الأستاذة إيمان الدمشيتي - رياضيات 📐\nاسم الطالب: ${student.name}\nالصف: ${student.groupGrade}\nعن شهر: ${selectedMonth}\nالمبلغ المسدد: ${pay.amount} ج.م\nالتاريخ: ${pay.date}\nمع تحيات ميس إيمان الدمشيتي ✨`;
                                  openWhatsApp(student.parentPhone || student.phone || "", receiptMsg);
                                }}
                                className="px-2 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold cursor-pointer transition-all"
                              >
                                📲 إيصال
                              </button>
                            </>
                          ) : (
                            <>
                              {onRecordPayment && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (
                                      confirm(
                                        `هل تود إثبات سداد مبلغ (${fee} ج.م) عن شهر (${selectedMonth}) للطالب (${student.name})؟`
                                      )
                                    ) {
                                      onRecordPayment(
                                        student.barcode,
                                        fee,
                                        selectedMonth,
                                        `سداد اشتراك ${selectedMonth}`
                                      );
                                    }
                                  }}
                                  className="px-2 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold cursor-pointer transition-all flex items-center gap-1 shadow-sm"
                                >
                                  <CreditCard className="w-3 h-3" />
                                  <span>سداد 💳</span>
                                </button>
                              )}

                              <button
                                onClick={() => {
                                  const reminderMsg = `تذكير ودي بسداد الاشتراك 🔔\nمنظومة الأستاذة إيمان الدمشيتي - رياضيات 📐\nاسم الطالب: ${student.name}\nالصف: ${student.groupGrade}\nنود تذكيركم بسداد اشتراك شهر (${selectedMonth}) وقيمته: ${fee} ج.م.\nشاكرين لكم حسن تعاونكم واهتمامكم ✨`;
                                  openWhatsApp(student.parentPhone || student.phone || "", reminderMsg);
                                }}
                                className="px-2 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[11px] font-bold cursor-pointer transition-all"
                              >
                                🔔 تذكير
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Student Detailed Financial Ledger Modal */}
      {ledgerModalStudent && (
        <StudentFinancialLedgerModal
          student={ledgerModalStudent}
          payments={payments}
          groupPrices={groupPrices}
          isOpen={!!ledgerModalStudent}
          onClose={() => setLedgerModalStudent(null)}
          onRecordQuickPayment={onRecordPayment}
          onUpdatePayment={onUpdatePayment}
          onDeletePayment={onDeletePayment}
        />
      )}

      {/* Unpaid Defaulters Official PDF & Multi-Grade Modal */}
      <UnpaidDefaultersModal
        students={students}
        payments={payments}
        groupPrices={groupPrices}
        isOpen={isUnpaidModalOpen}
        onClose={() => setIsUnpaidModalOpen(false)}
        onRecordPayment={onRecordPayment}
      />

      {/* Edit Payment Modal */}
      {editingPaymentData && onUpdatePayment && (
        <EditPaymentModal
          isOpen={!!editingPaymentData}
          student={editingPaymentData.student}
          payment={editingPaymentData.record}
          monthKey={editingPaymentData.monthKey}
          onClose={() => setEditingPaymentData(null)}
          onSave={(oldMonthKey, barcode, newMonthKey, newAmount, newNote, newDate) => {
            onUpdatePayment(oldMonthKey, barcode, newMonthKey, newAmount, newNote, newDate);
            setEditingPaymentData(null);
          }}
          onDelete={(monthKey, barcode) => {
            if (onDeletePayment) {
              onDeletePayment(monthKey, barcode);
            }
            setEditingPaymentData(null);
          }}
        />
      )}
    </div>
  );
};
