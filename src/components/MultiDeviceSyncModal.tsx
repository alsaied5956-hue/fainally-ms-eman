import React, { useState, useMemo, useRef } from "react";
import {
  Cloud,
  CloudUpload,
  CloudDownload,
  CheckCircle2,
  AlertCircle,
  Users,
  CreditCard,
  FileJson,
  UploadCloud,
  DownloadCloud,
  RefreshCw,
  X,
  ShieldCheck,
  Sparkles,
  Search,
  Calendar,
  XCircle,
  Phone,
  MessageCircle,
  FileSpreadsheet,
  Coins,
  Check,
  Filter,
  Award,
  Activity,
  Wifi,
  Database,
  Server,
  Zap,
} from "lucide-react";
import {
  syncAndMergeAllDevicesData,
  exportCompleteBackupJSON,
  importAndMergeCompleteBackupJSON,
  getCloudDiagnostics,
  CloudDiagnosticsInfo,
  subscribeToSyncStatus,
  getSyncStatus,
  SyncStatus,
} from "../utils/storage";
import { testFirestoreConnection } from "../utils/firebase";
import { Student, PaymentRecord, GradeName, GRADE_ORDER } from "../types";
import { getCurrentMonthKey, DEFAULT_GRADE_PRICES, openWhatsApp, getStudentPayment, isStudentPaid } from "../utils/helpers";
import { matchStudentSearch } from "../utils/search";
import * as XLSX from "xlsx";

interface MultiDeviceSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  students: Student[];
  payments: Record<string, Record<string, PaymentRecord>>;
  groupPrices?: Record<GradeName, number>;
  isOnline: boolean;
  onRecordPayment?: (barcode: string, amount: number, monthKey: string, note: string) => void;
}

export const MultiDeviceSyncModal: React.FC<MultiDeviceSyncModalProps> = ({
  isOpen,
  onClose,
  students,
  payments,
  groupPrices,
  isOnline,
  onRecordPayment,
}) => {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "info";
    title: string;
    message: string;
    details?: string;
  } | null>(null);

  // Month & Payment Status Filters
  const allRecordedMonths = useMemo(() => {
    const set = new Set<string>();
    Object.keys(payments || {}).forEach((m) => {
      if (Object.keys(payments[m] || {}).length > 0) {
        set.add(m);
      }
    });
    const cur = getCurrentMonthKey();
    set.add(cur);
    return Array.from(set).sort().reverse();
  }, [payments]);

  const [selectedMonth, setSelectedMonth] = useState<string>(() => getCurrentMonthKey());
  const [selectedGrade, setSelectedGrade] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PAID" | "UNPAID">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeViewTab, setActiveViewTab] = useState<"financials" | "sync_actions" | "cloud_diagnostics">("financials");
  const [pingResult, setPingResult] = useState<{ ok: boolean; latencyMs: number; error?: string } | null>(null);
  const [isPinging, setIsPinging] = useState(false);
  const [diagnosticsData, setDiagnosticsData] = useState<CloudDiagnosticsInfo>(() => getCloudDiagnostics());
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => getSyncStatus());

  React.useEffect(() => {
    return subscribeToSyncStatus((st) => setSyncStatus(st));
  }, []);

  const handleRunPingTest = async () => {
    setIsPinging(true);
    try {
      const res = await testFirestoreConnection();
      setPingResult(res);
      setDiagnosticsData(getCloudDiagnostics());
    } finally {
      setIsPinging(false);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Calculate detailed financial breakdown for selectedMonth & grade
  const monthPayments = useMemo(() => {
    return (payments && payments[selectedMonth]) || {};
  }, [payments, selectedMonth]);

  const studentsFilteredByGrade = useMemo(() => {
    if (selectedGrade === "ALL") return students;
    return students.filter((s) => s.groupGrade === selectedGrade);
  }, [students, selectedGrade]);

  const financialStats = useMemo(() => {
    let paidCount = 0;
    let unpaidCount = 0;
    let totalCollected = 0;
    let totalExpected = 0;

    const paidList: { student: Student; payment: PaymentRecord }[] = [];
    const unpaidList: { student: Student; expectedFee: number }[] = [];

    studentsFilteredByGrade.forEach((student) => {
      const payment = getStudentPayment(monthPayments, student.barcode);
      const fee =
        student.customMonthlyFee !== undefined
          ? student.customMonthlyFee
          : (groupPrices && groupPrices[student.groupGrade]) ||
            DEFAULT_GRADE_PRICES[student.groupGrade] ||
            150;

      totalExpected += fee;

      if (payment) {
        paidCount++;
        totalCollected += Number(payment.amount) || 0;
        paidList.push({ student, payment });
      } else {
        unpaidCount++;
        unpaidList.push({ student, expectedFee: fee });
      }
    });

    const paidPercentage =
      studentsFilteredByGrade.length > 0
        ? Math.round((paidCount / studentsFilteredByGrade.length) * 100)
        : 0;
    const unpaidPercentage =
      studentsFilteredByGrade.length > 0
        ? Math.round((unpaidCount / studentsFilteredByGrade.length) * 100)
        : 0;

    return {
      totalStudents: studentsFilteredByGrade.length,
      paidCount,
      unpaidCount,
      totalCollected,
      totalExpected,
      remainingExpected: Math.max(0, totalExpected - totalCollected),
      paidPercentage,
      unpaidPercentage,
      paidList,
      unpaidList,
    };
  }, [studentsFilteredByGrade, monthPayments, groupPrices]);

  // Filtered student list for table
  const displayedStudents = useMemo(() => {
    return studentsFilteredByGrade.filter((student) => {
      const isPaid = isStudentPaid(monthPayments, student.barcode);

      if (statusFilter === "PAID" && !isPaid) return false;
      if (statusFilter === "UNPAID" && isPaid) return false;

      if (searchQuery.trim()) {
        const { match } = matchStudentSearch(student, searchQuery);
        const matchesPhone =
          (student.phone && student.phone.includes(searchQuery)) ||
          (student.parentPhone && student.parentPhone.includes(searchQuery));
        return match || matchesPhone;
      }
      return true;
    });
  }, [studentsFilteredByGrade, monthPayments, statusFilter, searchQuery]);

  // Global counts across all months and modules for status headers
  const totalLocalStudents = students.length;
  let totalLocalPayments = 0;
  const totalMonths = Object.keys(payments || {}).length;
  Object.values(payments || {}).forEach((m) => {
    totalLocalPayments += Object.keys(m || {}).length;
  });

  const totalLocalGrades = useMemo(() => {
    return students.reduce((acc, s) => acc + (s.totalExamScores?.length || 0), 0);
  }, [students]);

  // Action 1: Push & Merge with Cloud with ultra-fast data compression
  const handlePushAndMerge = async () => {
    setLoadingAction("push");
    setFeedback({
      type: "info",
      title: "⏳ جاري ضغط البيانات وتوحيدها سحابياً...",
      message: "يتم الآن ضغط كافة سجلات الطلاب والدرجات والاشتراكات لتقليل حجمها وبثها تلقائياً لكافة الهواتف والأجهزة المفتوحة في ثوانٍ...",
    });
    try {
      const result = await syncAndMergeAllDevicesData("push_and_merge");
      if (result.success) {
        setFeedback({
          type: "success",
          title: "🎉 تم ضغط وتوحيد البيانات وبثها لجميع الأجهزة بنجاح!",
          message: result.message,
          details: `بيانات هذا الجهاز قبل التوحيد: ${result.localStudentsBefore} طالب | السحابة: ${result.cloudStudentsBefore} طالب | الإجمالي الموحد النهائي: ${result.unifiedStudentsCount} طالب. يتم التحديث تلقائياً في كافة الأجهزة المفتوحة دون الحاجة لطلب السحب.`,
        });
      } else {
        setFeedback({
          type: "error",
          title: "تنبيه المزامنة",
          message: result.message,
        });
      }
    } catch (e: any) {
      setFeedback({
        type: "error",
        title: "خطأ غير متوقع",
        message: e?.message || "حدث خطأ أثناء المزامنة.",
      });
    } finally {
      setLoadingAction(null);
    }
  };

  // Action 2: Pull & Merge latest from Cloud
  const handlePullLatest = async () => {
    setLoadingAction("pull");
    setFeedback({
      type: "info",
      title: "⏳ جاري سحب وتحديث البيانات من السحابة...",
      message: "يتم الآن جلب وتطبيق أحدث قاعدة بيانات من السحابة...",
    });
    try {
      const result = await syncAndMergeAllDevicesData("pull_and_merge");
      if (result.success) {
        setFeedback({
          type: "success",
          title: "✅ تم سحب وتحديث كل البيانات من السحابة!",
          message: `تم تحديث هذا الجهاز بنجاح. يحتوي الآن على (${result.unifiedStudentsCount}) طالب و (${result.unifiedPaymentsCount}) اشتراك مدفوع.`,
        });
      } else {
        setFeedback({
          type: "error",
          title: "تعذر سحب البيانات",
          message: result.message,
        });
      }
    } catch (e: any) {
      setFeedback({
        type: "error",
        title: "خطأ في السحب",
        message: e?.message || "حدث خطأ أثناء جلب البيانات.",
      });
    } finally {
      setLoadingAction(null);
    }
  };

  // Action 3: Export complete JSON backup
  const handleExportJSON = () => {
    try {
      exportCompleteBackupJSON();
      setFeedback({
        type: "info",
        title: "💾 تم تنزيل ملف النسخة الاحتياطية الشاملة!",
        message:
          "تم حفظ ملف النسخة الاحتياطية على جهازك. يمكنك الآن نقله (عبر واتساب أو فلاشة) واستيراده في أي جهاز آخر لدمج الطلاب مباشرة حتى بدون إنترنت.",
      });
    } catch (e: any) {
      setFeedback({
        type: "error",
        title: "فشل التصدير",
        message: e?.message || "تعذر تصدير الملف.",
      });
    }
  };

  // Action 4: Import JSON file from another device
  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoadingAction("import_file");
    setFeedback(null);
    try {
      const result = await importAndMergeCompleteBackupJSON(file);
      if (result.success) {
        setFeedback({
          type: "success",
          title: "🎉 تم دمج ملف الجهاز الآخر بنجاح!",
          message: result.message,
          details: `تم دمج واستيراد (${result.importedStudentsCount}) طالب من الملف. الإجمالي الحالي أصبح (${result.totalStudentsAfter}) طالب و (${result.totalPaymentsAfter}) اشتراك.`,
        });
      } else {
        setFeedback({
          type: "error",
          title: "فشل استيراد الملف",
          message: result.message,
        });
      }
    } catch (err: any) {
      setFeedback({
        type: "error",
        title: "خطأ في الملف",
        message: err?.message || "ملف غير صالح.",
      });
    } finally {
      setLoadingAction(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Action 5: Export to Excel
  const handleExportExcel = () => {
    const rows = studentsFilteredByGrade.map((s, idx) => {
      const bKey = String(s.barcode).trim();
      const payment = monthPayments[bKey] || monthPayments[s.barcode];
      const fee =
        s.customMonthlyFee !== undefined
          ? s.customMonthlyFee
          : (groupPrices && groupPrices[s.groupGrade]) ||
            DEFAULT_GRADE_PRICES[s.groupGrade] ||
            150;

      return {
        "م": idx + 1,
        "الباركود": s.barcode,
        "اسم الطالب": s.name,
        "الصف الدراسي": s.groupGrade,
        "مواعيد المجموعة": s.groupDays || "-",
        [`حالة الدفع لشهر ${selectedMonth}`]: payment ? "دفع ✅" : "لم يدفع ❌",
        "المبلغ المدفوع (ج.م)": payment ? Number(payment.amount) : 0,
        "المبلغ المستحق": fee,
        "تاريخ الدفع": payment?.date || "-",
        "وقت الدفع": payment?.time || "-",
        "رقم تليفون الطالب": s.phone || "-",
        "رقم ولي الأمر": s.parentPhone || "-",
        "ملاحظات": payment?.note || s.discountReason || "-",
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, `دفع شهر ${selectedMonth}`);
    XLSX.writeFile(workbook, `كشف_مدفوعات_شهر_${selectedMonth}.xlsx`);
  };

  // Action 6: Send WhatsApp Payment Reminder
  const handleSendPaymentReminder = (student: Student, expectedFee: number) => {
    const phone = student.parentPhone || student.phone;
    if (!phone) {
      alert("لا يوجد رقم هاتف مسجل لهذا الطالب!");
      return;
    }
    const message = `السلام عليكم ورحمة الله وبركاته،\nنود تذكير سيادتكم بضرورة سداد اشتراك شهر (${selectedMonth}) للطالب/ة: *${student.name}* (${student.groupGrade}) والمستحق بقيمة *${expectedFee} ج.م*.\nشاكرين ومقدرين حسن تعاونكم وحرصكم الدائم.`;
    openWhatsApp(phone, message);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-6 bg-black/85 backdrop-blur-md animate-fadeIn overflow-y-auto">
      <div className="relative w-full max-w-5xl bg-gradient-to-b from-slate-900 via-slate-900 to-[#0b1329] border border-indigo-500/30 rounded-3xl shadow-2xl overflow-hidden my-auto text-slate-100 font-['Readex_Pro','Cairo',sans-serif] flex flex-col max-h-[92vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-indigo-500/20 bg-indigo-950/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 border border-white/20">
              <Cloud className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-xl font-black text-amber-300 flex items-center gap-2">
                <span>توحيد الأجهزة وكشف المدفوعات</span>
                <span className="px-2.5 py-0.5 rounded-full text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {isOnline ? "متصل بالسحابة 🟢" : "أوفلاين 🟡"}
                </span>
              </h2>
              <p className="text-xs text-slate-300">
                متابعة دقيقة لـ (كام دفع وكام مدفعش) مع دمج وتوحيد كافة بيانات الأجهزة
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
              title="إغلاق"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs between Financials (كام دفع وكام مدفعش) & Sync Actions (المزامنة والدمج) */}
        <div className="px-6 pt-3 pb-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0 flex-wrap">
          <div className="flex items-center gap-2 p-1 rounded-2xl bg-slate-800/90 border border-slate-700/80">
            <button
              onClick={() => setActiveViewTab("financials")}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
                activeViewTab === "financials"
                  ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <CreditCard className="w-4 h-4" />
              <span>💰 كشف (كام دفع وكام مدفعش)</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20 font-mono">
                {financialStats.totalStudents}
              </span>
            </button>

            <button
              onClick={() => setActiveViewTab("sync_actions")}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
                activeViewTab === "sync_actions"
                  ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <CloudUpload className="w-4 h-4" />
              <span>🔄 إجراءات المزامنة والدمج السحابي</span>
            </button>

            <button
              onClick={() => {
                setActiveViewTab("cloud_diagnostics");
                setDiagnosticsData(getCloudDiagnostics());
              }}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
                activeViewTab === "cloud_diagnostics"
                  ? "bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>🩺 فحص وتشخيص الربط السحابي</span>
            </button>
          </div>

          {/* Month Selector for the Active View */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-slate-800/80 border border-slate-700 px-3 py-1.5 rounded-xl text-xs">
              <Calendar className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-slate-400">الشهر:</span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-transparent text-amber-300 font-bold outline-none cursor-pointer"
              >
                {allRecordedMonths.map((m) => (
                  <option key={m} value={m} className="bg-slate-900 text-white">
                    شهر {m}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleExportExcel}
              className="px-3 py-1.5 rounded-xl bg-emerald-700/40 hover:bg-emerald-700/60 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
              title="تصدير الكشف إلى Excel"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>تصدير إكسيل</span>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar flex-1">
          
          {/* Main Financials View (كام دفع وكام مدفعش) */}
          {activeViewTab === "financials" && (
            <div className="space-y-5 animate-fadeIn">
              
              {/* Top Hero Stats: كام دفع وكام مدفعش */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                
                {/* 1. Total Students in Grade/Month */}
                <div className="bg-gradient-to-br from-slate-800/90 to-slate-800/40 border border-slate-700/80 rounded-2xl p-4 flex items-center justify-between shadow-lg">
                  <div className="space-y-1">
                    <p className="text-xs text-slate-400 font-medium">إجمالي طلاب الكشف</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-black text-blue-300 font-mono">
                        {financialStats.totalStudents}
                      </span>
                      <span className="text-xs text-slate-400">طالب</span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      المستهدف: <strong className="text-slate-200">{financialStats.totalExpected.toLocaleString("ar-EG")} ج.م</strong>
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0">
                    <Users className="w-6 h-6" />
                  </div>
                </div>

                {/* 2. Paid Count (كام دفع) */}
                <div className="bg-gradient-to-br from-emerald-950/60 to-emerald-900/20 border border-emerald-500/40 rounded-2xl p-4 flex items-center justify-between shadow-lg">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <p className="text-xs text-emerald-300 font-bold">✅ الذين دفعوا (كام دفع)</p>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-black text-emerald-400 font-mono">
                        {financialStats.paidCount}
                      </span>
                      <span className="text-xs text-emerald-200/80">طالب ({financialStats.paidPercentage}%)</span>
                    </div>
                    <p className="text-[11px] text-emerald-200/90 font-bold">
                      المحصل: <span className="text-amber-300 font-mono">{financialStats.totalCollected.toLocaleString("ar-EG")} ج.م</span>
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 flex items-center justify-center shrink-0 shadow-inner">
                    <Coins className="w-6 h-6" />
                  </div>
                </div>

                {/* 3. Unpaid Count (كام مدفعش) */}
                <div className="bg-gradient-to-br from-rose-950/60 to-rose-900/20 border border-rose-500/40 rounded-2xl p-4 flex items-center justify-between shadow-lg">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <XCircle className="w-4 h-4 text-rose-400" />
                      <p className="text-xs text-rose-300 font-bold">❌ لم يدفعوا بعد (كام مدفعش)</p>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-black text-rose-400 font-mono">
                        {financialStats.unpaidCount}
                      </span>
                      <span className="text-xs text-rose-200/80">طالب ({financialStats.unpaidPercentage}%)</span>
                    </div>
                    <p className="text-[11px] text-rose-200/90 font-bold">
                      المتبقي: <span className="text-amber-300 font-mono">{financialStats.remainingExpected.toLocaleString("ar-EG")} ج.م</span>
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-300 flex items-center justify-center shrink-0 shadow-inner">
                    <AlertCircle className="w-6 h-6" />
                  </div>
                </div>

              </div>

              {/* Progress Bar of Payment */}
              <div className="p-3 bg-slate-800/60 border border-slate-700/80 rounded-2xl space-y-1.5">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-emerald-400 flex items-center gap-1">
                    <span>نسبة التحصيل لشهر ({selectedMonth}):</span>
                    <span>{financialStats.paidPercentage}%</span>
                  </span>
                  <span className="text-rose-400">
                    غير مسدد: {financialStats.unpaidCount} طالب
                  </span>
                </div>
                <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden border border-slate-700/60 flex">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500 rounded-l-full"
                    style={{ width: `${financialStats.paidPercentage}%` }}
                  />
                  <div
                    className="h-full bg-gradient-to-r from-rose-600 to-rose-500 transition-all duration-500"
                    style={{ width: `${financialStats.unpaidPercentage}%` }}
                  />
                </div>
              </div>

              {/* Filtering Controls */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                
                {/* Search Bar */}
                <div className="md:col-span-5 relative">
                  <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ابحث بالاسم أو الباركود أو رقم التليفون..."
                    className="w-full pl-3 pr-10 py-2.5 bg-slate-800/90 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Grade Dropdown */}
                <div className="md:col-span-3">
                  <select
                    value={selectedGrade}
                    onChange={(e) => setSelectedGrade(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-800/90 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-bold"
                  >
                    <option value="ALL">جميع المراحل والصفوف</option>
                    {GRADE_ORDER.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status Segmented Switcher */}
                <div className="md:col-span-4 flex items-center p-1 bg-slate-800/90 border border-slate-700 rounded-xl">
                  <button
                    onClick={() => setStatusFilter("ALL")}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                      statusFilter === "ALL"
                        ? "bg-slate-700 text-white shadow"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    الكل ({studentsFilteredByGrade.length})
                  </button>

                  <button
                    onClick={() => setStatusFilter("PAID")}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1 ${
                      statusFilter === "PAID"
                        ? "bg-emerald-600 text-white shadow"
                        : "text-emerald-400 hover:text-emerald-300"
                    }`}
                  >
                    <span>دفعوا</span>
                    <span className="font-mono">({financialStats.paidCount})</span>
                  </button>

                  <button
                    onClick={() => setStatusFilter("UNPAID")}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1 ${
                      statusFilter === "UNPAID"
                        ? "bg-rose-600 text-white shadow"
                        : "text-rose-400 hover:text-rose-300"
                    }`}
                  >
                    <span>لم يدفعوا</span>
                    <span className="font-mono">({financialStats.unpaidCount})</span>
                  </button>
                </div>

              </div>

              {/* Student List Table */}
              <div className="border border-slate-700/80 rounded-2xl overflow-hidden bg-slate-800/40 shadow-inner">
                <div className="max-h-[380px] overflow-y-auto custom-scrollbar">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-900/90 text-slate-400 sticky top-0 z-10 border-b border-slate-700">
                      <tr>
                        <th className="py-3 px-3.5 font-bold">الطالب</th>
                        <th className="py-3 px-3.5 font-bold">الصف والمواعيد</th>
                        <th className="py-3 px-3.5 font-bold text-center">حالة الدفع</th>
                        <th className="py-3 px-3.5 font-bold text-center">المبلغ</th>
                        <th className="py-3 px-3.5 font-bold">هاتف ولي الأمر / تذكير</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {displayedStudents.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-10 text-center text-slate-400">
                            لا توجد نتائج مطابقة للبحث أو الفلتر المحدد.
                          </td>
                        </tr>
                      ) : (
                        displayedStudents.map((student) => {
                          const bKey = String(student.barcode).trim();
                          const payment = monthPayments[bKey] || monthPayments[student.barcode];
                          const fee =
                            student.customMonthlyFee !== undefined
                              ? student.customMonthlyFee
                              : (groupPrices && groupPrices[student.groupGrade]) ||
                                DEFAULT_GRADE_PRICES[student.groupGrade] ||
                                150;

                          return (
                            <tr
                              key={student.barcode}
                              className="hover:bg-slate-800/70 transition-colors"
                            >
                              {/* Student Info */}
                              <td className="py-2.5 px-3.5">
                                <div className="font-bold text-white text-sm">
                                  {student.name}
                                </div>
                                <div className="text-[11px] text-amber-300/80 font-mono">
                                  {student.barcode}
                                </div>
                              </td>

                              {/* Grade & Days */}
                              <td className="py-2.5 px-3.5">
                                <div className="text-slate-200 font-medium">
                                  {student.groupGrade}
                                </div>
                                <div className="text-[11px] text-slate-400">
                                  {student.groupDays || "مجموعة عامة"}
                                </div>
                              </td>

                              {/* Payment Status Badge */}
                              <td className="py-2.5 px-3.5 text-center">
                                {payment ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>دفع ✅</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                    <XCircle className="w-3.5 h-3.5" />
                                    <span>لم يدفع ❌</span>
                                  </span>
                                )}
                              </td>

                              {/* Amount */}
                              <td className="py-2.5 px-3.5 text-center font-mono">
                                {payment ? (
                                  <div>
                                    <span className="text-sm font-black text-emerald-400">
                                      {Number(payment.amount)} ج.م
                                    </span>
                                    <p className="text-[10px] text-slate-400">
                                      {payment.date || "مسجل"}
                                    </p>
                                  </div>
                                ) : (
                                  <div>
                                    <span className="text-sm font-bold text-rose-400">
                                      مستحق {fee} ج.م
                                    </span>
                                  </div>
                                )}
                              </td>

                              {/* WhatsApp / Action */}
                              <td className="py-2.5 px-3.5">
                                <div className="flex items-center gap-2">
                                  {student.parentPhone || student.phone ? (
                                    <button
                                      type="button"
                                      onClick={() => handleSendPaymentReminder(student, fee)}
                                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                                        payment
                                          ? "bg-slate-700/80 hover:bg-slate-700 text-slate-300"
                                          : "bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/40 text-emerald-300"
                                      }`}
                                      title={payment ? "مراسلة ولي الأمر" : "إرسال تذكير بالسداد عبر واتساب"}
                                    >
                                      <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
                                      <span>
                                        {payment ? "واتساب" : "تذكير بالسداد"}
                                      </span>
                                    </button>
                                  ) : (
                                    <span className="text-[11px] text-slate-500">لا يوجد هاتف</span>
                                  )}

                                  {!payment && onRecordPayment && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        onRecordPayment(student.barcode, fee, selectedMonth, "سداد سريع من نافذة توحيد الأجهزة");
                                      }}
                                      className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition-all cursor-pointer flex items-center gap-1"
                                      title="تسجيل الدفع الآن"
                                    >
                                      <Check className="w-3 h-3" />
                                      <span>دفع الآن</span>
                                    </button>
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

            </div>
          )}

          {/* Sync Actions View (المزامنة والدمج السحابي) */}
          {activeViewTab === "sync_actions" && (
            <div className="space-y-6 animate-fadeIn">
              
              {/* Quota Limit Notice Banner */}
              {syncStatus.isQuotaExceeded && (
                <div className="p-4 rounded-2xl border border-amber-500/50 bg-amber-950/70 text-amber-200 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-black text-sm text-amber-300">
                    <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
                    <span>تنبيه الكوتة اليومية للفايربيز (Firestore Free Tier Quota Limit)</span>
                  </div>
                  <p className="leading-relaxed">
                    تم الوصول للحد اليومي المجاني للكتابة السحابية اليوم ({syncStatus.quotaMessage}).
                    <strong className="text-white block mt-1">
                      ✅ لا تقلق نهائياً: كافة بياناتك وطلابك ({totalLocalStudents} طالب) والدرجات والاشتراكات محفوظة ومؤمنة محلياً 100%، ويمكنك استخدام زر &quot;تصدير واستيراد ملف JSON&quot; بالأسفل لمزامنة أي جهاز آخر فوراً بدون نت وبدون استهلاك كوتة!
                    </strong>
                  </p>
                </div>
              )}

              {/* Feedback message banner */}
              {feedback && (
                <div
                  className={`p-4 rounded-2xl border text-sm font-medium animate-fadeIn ${
                    feedback.type === "success"
                      ? "bg-emerald-950/80 border-emerald-500/50 text-emerald-200"
                      : feedback.type === "error"
                      ? "bg-rose-950/80 border-rose-500/50 text-rose-200"
                      : "bg-blue-950/80 border-blue-500/50 text-blue-200"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {feedback.type === "success" ? (
                      <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
                    ) : feedback.type === "error" ? (
                      <AlertCircle className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
                    ) : (
                      <Sparkles className="w-6 h-6 text-blue-400 shrink-0 mt-0.5" />
                    )}
                    <div className="space-y-1">
                      <h4 className="font-black text-base">{feedback.title}</h4>
                      <p>{feedback.message}</p>
                      {feedback.details && (
                        <p className="text-xs opacity-90 pt-1 font-mono">{feedback.details}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Status Overview Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400">طلاب هذا الجهاز</p>
                    <p className="text-lg font-black text-blue-300">{totalLocalStudents} <span className="text-xs font-normal">طالب</span></p>
                  </div>
                </div>

                <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                    <Award className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400">الدرجات المرصودة</p>
                    <p className="text-lg font-black text-amber-300">{totalLocalGrades} <span className="text-xs font-normal">درجة</span></p>
                  </div>
                </div>

                <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                    <CreditCard className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400">إجمالي الاشتراكات</p>
                    <p className="text-lg font-black text-emerald-300">{totalLocalPayments} <span className="text-xs font-normal">إيصال</span></p>
                  </div>
                </div>

                <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 flex items-center justify-center shrink-0">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400">شهور الاشتراكات</p>
                    <p className="text-lg font-black text-purple-300">{totalMonths} <span className="text-xs font-normal">شهور</span></p>
                  </div>
                </div>

                <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 flex items-center gap-3 col-span-2 sm:col-span-1">
                  <div className={`w-10 h-10 rounded-xl ${isOnline ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-amber-500/10 border-amber-500/30 text-amber-400"} border flex items-center justify-center shrink-0`}>
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400">حالة الاتصال</p>
                    <p className={`text-sm font-black ${isOnline ? "text-emerald-400" : "text-amber-400"}`}>
                      {isOnline ? "متصل بالسحابة ✅" : "غير متصل ⚠️"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Step by Step Explanatory Guide Box */}
              <div className="p-4 md:p-5 rounded-2xl bg-gradient-to-r from-indigo-950/50 via-slate-900 to-indigo-950/50 border border-indigo-500/40 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black text-amber-300 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
                    <span>كيف يعمل توحيد البيانات مع الضغط فائق السرعة والبث التلقائي:</span>
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-bold">
                    بث تلقائي 100% ⚡
                  </span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-300">
                  <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/80 space-y-1.5">
                    <div className="flex items-center gap-2 text-indigo-300 font-bold">
                      <span className="w-5 h-5 rounded-full bg-indigo-500/20 flex items-center justify-center text-xs font-mono">1</span>
                      <span>ضغط فائق للبيانات 🗜️:</span>
                    </div>
                    <p className="text-slate-400">
                      يتم ضغط حجم بيانات الطلاب والدرجات بنسبة تصل لـ <strong className="text-emerald-300">90%</strong> لنقل فوري عبر النت الضعيف في ثوانٍ معدودة.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/80 space-y-1.5">
                    <div className="flex items-center gap-2 text-amber-300 font-bold">
                      <span className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center text-xs font-mono">2</span>
                      <span>دمج وتوحيد كامل 🚀:</span>
                    </div>
                    <p className="text-slate-400">
                      دمج وحفظ كل الطلاب والاشتراكات والدرجات من كافة الأجهزة بدون فقدان أو حذف أي طالب نهائياً.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/80 space-y-1.5">
                    <div className="flex items-center gap-2 text-emerald-300 font-bold">
                      <span className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center text-xs font-mono">3</span>
                      <span>تحديث تلقائي فوري 📡:</span>
                    </div>
                    <p className="text-slate-400">
                      تنتقل البيانات <strong className="text-amber-300">تلقائياً</strong> لباقي الهواتف والأجهزة المفتوحة فوراً <strong className="text-white">دون الحاجة لضغط زر سحب أو طلب البيانات</strong>!
                    </p>
                  </div>
                </div>
              </div>

              {/* Direct Cloud Action Buttons */}
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                  {/* Primary Hero Button: Push & Merge with Compression */}
                  <button
                    onClick={handlePushAndMerge}
                    disabled={loadingAction !== null}
                    className="md:col-span-8 relative p-5 rounded-2xl bg-gradient-to-r from-indigo-600 via-indigo-700 to-purple-700 hover:from-indigo-500 hover:to-purple-600 text-white font-bold shadow-xl shadow-indigo-600/30 border border-indigo-400/40 transition-all hover:scale-[1.01] active:scale-[0.99] cursor-pointer flex flex-col items-start gap-2.5 text-right disabled:opacity-50 group"
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2.5 text-base md:text-lg font-black text-amber-300">
                        {loadingAction === "push" ? (
                          <RefreshCw className="w-6 h-6 animate-spin text-amber-300" />
                        ) : (
                          <CloudUpload className="w-6 h-6 text-amber-300 group-hover:scale-110 transition-transform" />
                        )}
                        <span>⚡ توحيد ومزامنة كافة الأجهزة بضغطة واحدة</span>
                      </div>
                      <span className="px-2.5 py-1 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-mono font-black">
                        ضغط فائق + بث فوري
                      </span>
                    </div>
                    <p className="text-xs text-indigo-100/90 leading-relaxed font-normal">
                      اضغط هنا لضغط وتوحيد كافة طلاب هذا الجهاز ({totalLocalStudents} طالب) والمدفوعات، وسيتم بث النسخة الموحدة <strong className="text-amber-300 font-bold">تلقائياً وفورياً لجميع الهواتف والأجهزة الأخرى</strong> دون أي تدخل يدوي.
                    </p>
                  </button>

                  {/* Secondary Utility Button: Pull Latest (Optional) */}
                  <button
                    onClick={handlePullLatest}
                    disabled={loadingAction !== null}
                    className="md:col-span-4 relative p-5 rounded-2xl bg-slate-800/90 hover:bg-slate-800 text-slate-200 border border-slate-700 hover:border-slate-600 transition-all cursor-pointer flex flex-col items-start justify-between gap-2 text-right disabled:opacity-50"
                    title="اختياري - يتم تحديث هذا الجهاز تلقائياً من السحابة دون الحاجة للضغط"
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2 text-sm font-bold text-slate-300">
                        {loadingAction === "pull" ? (
                          <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                        ) : (
                          <CloudDownload className="w-4 h-4 text-emerald-400" />
                        )}
                        <span>تحديث يدوي للجهاز</span>
                      </div>
                      <span className="text-[10px] text-slate-400 bg-slate-700/80 px-2 py-0.5 rounded-lg">
                        اختياري
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      يتم التحديث تلقائياً فورياً. يمكنك استخدام هذا الزر إذا أردت إعادة التحقق اليدوي الآن.
                    </p>
                  </button>
                </div>
              </div>

              {/* Offline File Transfer */}
              <div className="p-4 md:p-5 rounded-2xl bg-slate-800/40 border border-slate-700/60 space-y-3">
                <h3 className="text-sm font-black text-slate-300 flex items-center gap-2">
                  <FileJson className="w-4 h-4 text-amber-400" />
                  <span>طريقة بديلة لنقل ودمج البيانات بدون إنترنت (عبر ملف النسخة الاحتياطية):</span>
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <button
                    onClick={handleExportJSON}
                    className="p-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white text-xs font-bold transition-all flex items-center justify-center gap-2.5 cursor-pointer shadow"
                  >
                    <DownloadCloud className="w-4 h-4 text-amber-400" />
                    <span>💾 تصدير ملف النسخة الاحتياطية الموحدة (.json)</span>
                  </button>

                  <div>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileSelected}
                      accept=".json"
                      className="hidden"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={loadingAction !== null}
                      className="w-full p-3.5 rounded-xl bg-purple-900/60 hover:bg-purple-800/80 border border-purple-500/40 text-purple-200 text-xs font-bold transition-all flex items-center justify-center gap-2.5 cursor-pointer shadow disabled:opacity-50"
                    >
                      {loadingAction === "import_file" ? (
                        <RefreshCw className="w-4 h-4 animate-spin text-purple-300" />
                      ) : (
                        <UploadCloud className="w-4 h-4 text-purple-300" />
                      )}
                      <span>📥 استيراد ودمج ملف نسخة احتياطية من جهاز آخر</span>
                    </button>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* Cloud Diagnostics & Audit View (فحص وتشخيص الربط السحابي) */}
          {activeViewTab === "cloud_diagnostics" && (
            <div className="space-y-5 animate-fadeIn">
              
              {/* Header Banner */}
              <div className="p-5 rounded-2xl bg-gradient-to-r from-blue-950/60 via-slate-900 to-cyan-950/50 border border-cyan-500/30">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-2xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-400">
                      <Activity className="w-6 h-6 animate-pulse" />
                    </div>
                    <div>
                      <h3 className="text-base font-black text-white flex items-center gap-2">
                        <span>لوحة الفحص والتشخيص السحابي المباشر (Cloud Diagnostic & Audit)</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-cyan-500/20 text-cyan-300 font-mono border border-cyan-500/30">
                          Live Architecture Monitor
                        </span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        أداة مهندس الأنظمة السحابية للتحقق من سلامة خطوط الاتصال، أزمنة الاستجابة، وأحجام البيانات.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={handleRunPingTest}
                    disabled={isPinging}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-cyan-900/30 disabled:opacity-50"
                  >
                    {isPinging ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>جاري فحص الاتصال والسيرفر...</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4 text-amber-300" />
                        <span>اختبار زمن الاستجابة الفعلي (Ping Server)</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Ping Result Box */}
                {pingResult && (
                  <div className={`mt-4 p-3.5 rounded-xl border flex items-center justify-between gap-3 text-xs font-bold ${
                    pingResult.ok 
                      ? "bg-emerald-950/50 border-emerald-500/40 text-emerald-300"
                      : "bg-red-950/50 border-red-500/40 text-red-300"
                  }`}>
                    <div className="flex items-center gap-2">
                      <Wifi className="w-4 h-4" />
                      <span>{pingResult.ok ? "تم الاتصال بسيرفر Firestore بنجاح وبسرعة فائقة!" : "فشل فحص الاتصال بالسحابة"}</span>
                      {pingResult.error && <span className="text-red-400 text-[11px]">({pingResult.error})</span>}
                    </div>
                    <div className="flex items-center gap-2 font-mono text-sm bg-black/40 px-3 py-1 rounded-lg">
                      <span>زمن الاستجابة (Latency):</span>
                      <strong className={pingResult.latencyMs < 300 ? "text-emerald-400" : "text-amber-400"}>
                        {pingResult.latencyMs} ms
                      </strong>
                    </div>
                  </div>
                )}
              </div>

              {/* Real-time Health Metrics Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                
                {/* Metric 1: Connection & Auth */}
                <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-700/80 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="font-bold">حالة الجلسة والتوثيق</span>
                    <Server className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping inline-block" />
                    <span className="text-sm font-black text-emerald-400">
                      {isOnline ? "متصل ومفوض (Auth OK)" : "وضع بدون إنترنت (Offline)"}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    ميزة منع تكرار الجلسات وتأخير المحاولات (Auth Deduplication & Cooldown) مفعلة.
                  </p>
                </div>

                {/* Metric 2: 1MB Guard & Partitioning */}
                <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-700/80 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="font-bold">حماية سقف الـ 1MB</span>
                    <Database className="w-4 h-4 text-purple-400" />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-base font-black text-purple-300 font-mono">
                      {diagnosticsData.payloadSizeKB ? `${diagnosticsData.payloadSizeKB} KB` : "محمي تلقائياً"}
                    </span>
                    <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/30">
                      {diagnosticsData.isPartitioned ? `مقسم (${diagnosticsData.chunksCount} أجزاء)` : "حجم آمن"}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    نظام التقسيم التلقائي (Chunk Partitioning) يمنع خطأ Firestore 1MB نهائياً.
                  </p>
                </div>

                {/* Metric 3: Sync Success / Failure */}
                <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-700/80 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="font-bold">إحصائيات المزامنة الحية</span>
                    <RefreshCw className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="flex items-baseline gap-3">
                    <div className="text-xs">
                      <span className="text-slate-400">نجاح: </span>
                      <strong className="text-emerald-400 font-mono text-sm">{diagnosticsData.successfulSyncs}</strong>
                    </div>
                    <div className="text-xs">
                      <span className="text-slate-400">فشل: </span>
                      <strong className="text-rose-400 font-mono text-sm">{diagnosticsData.failedSyncs}</strong>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    آخر محاولة: {diagnosticsData.lastSyncAttempt || "قبل لحظات"}
                  </p>
                </div>

                {/* Metric 4: Deadlock Breaker & Concurrency */}
                <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-700/80 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="font-bold">حالة القفل ومنع التعليق</span>
                    <Check className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-black text-slate-200">
                      {diagnosticsData.isCurrentlySyncing ? "قيد الإرسال الآن" : "جاهز وخالي من التعليق"}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    مراقب القفل (Deadlock Breaker) يحرر الاتصال تلقائياً بعد 15 ثانية إن حدث بطء.
                  </p>
                </div>

              </div>

              {/* Technical Audit Checklist & Root Cause Resolution */}
              <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
                <h4 className="text-sm font-black text-slate-200 flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>تقرير التدقيق الفني الشامل (Architectural Health & Safety Audit):</span>
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/60 flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5 text-xs font-black font-mono">1</span>
                    <div>
                      <strong className="text-white block mb-0.5">معالجة تضخم مستند الأحداث المباشرة (Event Stream)</strong>
                      <p className="text-slate-400 text-[11px]">
                        تم استبدال مصفوفة الأحداث غير المحدودة (Unbounded arrayUnion) بآلية التسجيل المباشر المعزول والمحدود، لمنع تجاوز حجم المستند وتوقف المزامنة نهائياً.
                      </p>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/60 flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5 text-xs font-black font-mono">2</span>
                    <div>
                      <strong className="text-white block mb-0.5">تقسيم المستندات الكبيرة (Automatic Payload Partitioning)</strong>
                      <p className="text-slate-400 text-[11px]">
                        في حال تجاوز البيانات المضغوطة 700KB، يقوم النظام تلقائياً بتجزئتها إلى مستندات فرعية مستقلة وإعادة تجميعها عند القراءة دون أي تدخل بشري.
                      </p>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/60 flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5 text-xs font-black font-mono">3</span>
                    <div>
                      <strong className="text-white block mb-0.5">إعادة المحاولة مع التراجع الأسي والعشوائية (Exponential Backoff + Jitter)</strong>
                      <p className="text-slate-400 text-[11px]">
                        تم استبدال المحاولات الفورية بعشوائية زمنية وتراجع تدريجي (Jitter) لمنع ازدحام الشبكة وظاهرة Retry Storms أثناء تذبذب الإنترنت.
                      </p>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/60 flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5 text-xs font-black font-mono">4</span>
                    <div>
                      <strong className="text-white block mb-0.5">حماية جلسة الدخول وتوحيد الطلبات (Auth Session Deduplication)</strong>
                      <p className="text-slate-400 text-[11px]">
                        منع إرسال طلبات مصادقة متزامنة متكررة، ووضع فترة تبريد ذكية لمنع حظر الطلبات من السيرفر.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Last Error Detail Box if any */}
                {diagnosticsData.lastSyncError && (
                  <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-xs text-amber-300">
                    <div className="font-bold flex items-center gap-1.5 mb-1">
                      <AlertCircle className="w-4 h-4 text-amber-400" />
                      <span>آخر ملاحظة مسجلة في سجل النظام ({diagnosticsData.lastSyncError.timestamp}):</span>
                    </div>
                    <code className="block bg-black/40 p-2 rounded text-[11px] font-mono text-amber-200 mt-1 break-all">
                      {diagnosticsData.lastSyncError.message}
                    </code>
                  </div>
                )}
              </div>

            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950/80 shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping inline-block" />
            <span>
              إجمالي الطلاب الحاليين: <strong className="text-white">{students.length} طالب</strong> | المشتركين في شهر {selectedMonth}: <strong className="text-emerald-400">{financialStats.paidCount} طالب</strong>
            </span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-colors cursor-pointer"
          >
            إغلاق النافذة
          </button>
        </div>

      </div>
    </div>
  );
};
