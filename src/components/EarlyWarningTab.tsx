import React, { useState, useMemo } from "react";
import { Student, PaymentRecord, GradeName, GRADE_ORDER } from "../types";
import { getAttendanceRate, getAbsenceRate, getExamAverage, openWhatsApp, getCurrentMonthKey, isStudentPaid } from "../utils/helpers";
import { matchStudentSearch } from "../utils/search";
import {
  AlertTriangle,
  AlertOctagon,
  ShieldAlert,
  Send,
  Filter,
  CheckCircle,
  Search,
  X,
  Bot,
  Sparkles,
  RefreshCw,
  Copy,
  Check,
  Award,
  BookOpen,
} from "lucide-react";
import {
  requestStudentAcademicAnalysis,
  AcademicAnalysisResult,
} from "../services/geminiService";

interface EarlyWarningTabProps {
  students?: Student[];
  payments?: Record<string, Record<string, PaymentRecord>>;
}

export const EarlyWarningTab: React.FC<EarlyWarningTabProps> = ({
  students = [],
  payments = {},
}) => {
  const [filterType, setFilterType] = useState<"ALL" | "ABSENCE" | "GRADES" | "PAYMENT">("ALL");
  const [filterGrade, setFilterGrade] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedAnalysisStudent, setSelectedAnalysisStudent] = useState<{
    student: Student;
    absRate: number;
    examAvg: number;
    isUnpaid: boolean;
  } | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AcademicAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const currentMonthKey = getCurrentMonthKey();

  const handleOpenAIAnalysis = async (
    student: Student,
    absRate: number,
    examAvg: number,
    isUnpaid: boolean
  ) => {
    setSelectedAnalysisStudent({ student, absRate, examAvg, isUnpaid });
    setIsAnalyzing(true);
    setAnalysisResult(null);

    try {
      const recentScores = (student.totalExamScores || []).map((s: any) =>
        typeof s === "object" && s !== null ? Number(s.score) || 0 : Number(s) || 0
      );
      const res = await requestStudentAcademicAnalysis({
        studentName: student.name,
        studentBarcode: student.barcode,
        grade: student.groupGrade,
        absenceRate: absRate,
        totalAbsentDays: student.totalAbsentDays || 0,
        examAverage: examAvg,
        recentScores,
        isUnpaid,
        behaviorNotes: student.notes,
      });
      setAnalysisResult(res);
    } catch (err) {
      console.warn("AI Analysis error:", err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Evaluate students at risk
  const warningList = useMemo(() => {
    return students
      .map((student) => {
        const absRate = getAbsenceRate(student);
        const examAvg = getExamAverage(student);
        const isUnpaid = !isStudentPaid(payments?.[currentMonthKey], student.barcode);

        const reasons: string[] = [];
        let severity: "high" | "medium" | "low" = "low";

        // Absence Risk
        if (absRate >= 30 || student.totalAbsentDays >= 3) {
          reasons.push(`نسبة غياب مرتفعة جداً (${absRate}%) - غاب ${student.totalAbsentDays} حصص`);
          severity = "high";
        } else if (absRate >= 20 || student.totalAbsentDays >= 2) {
          reasons.push(`غياب متكرر (${absRate}%)`);
          severity = "medium";
        }

        // Exam Risk
        if (student.totalExamScores && student.totalExamScores.length > 0) {
          if (examAvg < 50) {
            reasons.push(`تراجع حاد في درجات الرياضيات (${examAvg}%)`);
            severity = "high";
          } else if (examAvg < 65) {
            reasons.push(`مستوى أكاديمي ضعيف (${examAvg}%)`);
            if (severity === "low") {
              severity = "medium";
            }
          }
        }

        // Unpaid
        if (isUnpaid) {
          reasons.push(`اشتراك شهر ${currentMonthKey} غير مدفوع حتى الآن`);
        }

        return {
          student,
          reasons,
          absRate,
          examAvg,
          isUnpaid,
          severity,
          hasRisk: reasons.length > 0,
        };
      })
      .filter((item) => {
        if (!item.hasRisk) return false;
        if (filterGrade !== "ALL" && item.student.groupGrade !== filterGrade) return false;
        if (filterType === "ABSENCE" && item.absRate < 20) return false;
        if (filterType === "GRADES" && item.examAvg >= 65) return false;
        if (filterType === "PAYMENT" && !item.isUnpaid) return false;
        if (searchQuery.trim()) {
          const { match } = matchStudentSearch(item.student, searchQuery);
          return match;
        }
        return true;
      });
  }, [students, payments, currentMonthKey, filterGrade, filterType, searchQuery]);

  const handleSendWarning = (student: Student, reasons: string[]) => {
    const reasonsText = reasons.map((r) => `• ${r}`).join("\n");
    const msg = `🚨 إنذار متابعة عاجل من منظومة الأستاذة إيمان الدمشيتي 📐\n\nنلفت عناية ولي أمر الطالب/ة: (${student.name})\nالمقيد في: ${student.groupGrade}\n\nنود إحاطتكم علماً بالملاحظات التالية:\n${reasonsText}\n\nنرجو التواصل الفوري والاهتمام لمصلحة الطالب ومستقبله التعليمي ✨`;
    openWhatsApp(student.parentPhone || student.phone || "", msg);
  };

  const highCount = warningList.filter((w) => w.severity === "high").length;
  const mediumCount = warningList.filter((w) => w.severity === "medium").length;

  return (
    <div className="space-y-6">
      {/* Alert Header Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-panel border-rose-500/40 p-5 rounded-3xl flex items-center gap-3.5 shadow-xl">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center shadow-md">
            <AlertOctagon className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-rose-300 font-bold font-tajawal">إنذارات عالية الخطورة 🔴</p>
            <p className="text-2xl font-black text-rose-400 font-mono">{highCount} <span className="text-xs font-tajawal font-normal text-slate-400">طالب</span></p>
          </div>
        </div>

        <div className="glass-panel border-amber-500/40 p-5 rounded-3xl flex items-center gap-3.5 shadow-xl">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shadow-md">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-amber-300 font-bold font-tajawal">إنذارات متوسطة 🟡</p>
            <p className="text-2xl font-black text-amber-300 font-mono">{mediumCount} <span className="text-xs font-tajawal font-normal text-slate-400">طالب</span></p>
          </div>
        </div>

        <div className="glass-panel border-sky-500/40 p-5 rounded-3xl flex items-center gap-3.5 shadow-xl">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/30 text-sky-400 flex items-center justify-center shadow-md">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-sky-300 font-bold font-tajawal">إجمالي الحالات المتابعة</p>
            <p className="text-2xl font-black text-sky-400 font-mono">{warningList.length} <span className="text-xs font-tajawal font-normal text-slate-400">طالب</span></p>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="glass-panel p-5 rounded-3xl flex flex-wrap items-center justify-between gap-3 shadow-2xl font-tajawal">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[300px]">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as "ALL" | "ABSENCE" | "GRADES" | "PAYMENT")}
            className="bg-[#080d1e] border border-indigo-500/30 text-slate-100 text-xs font-bold px-4 py-3 rounded-2xl outline-none"
          >
            <option value="ALL">جميع أنواع الإنذارات</option>
            <option value="ABSENCE">إنذارات الغياب المتكرر فقط 🔴</option>
            <option value="GRADES">إنذارات تراجع الدرجات فقط 📉</option>
            <option value="PAYMENT">المتأخرات المالية فقط 💳</option>
          </select>

          <select
            value={filterGrade}
            onChange={(e) => setFilterGrade(e.target.value)}
            className="bg-[#080d1e] border border-indigo-500/30 text-slate-100 text-xs font-bold px-4 py-3 rounded-2xl outline-none"
          >
            <option value="ALL">كل الصفوف الدراسية</option>
            {GRADE_ORDER.map((g) => (
              <option key={g} value={g} className="bg-slate-900 text-white">
                {g}
              </option>
            ))}
          </select>

          {/* Search box */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-amber-400/60 absolute right-3.5 top-3.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث بالاسم أو الباركود..."
              className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-100 text-xs pr-10 pl-8 py-3 rounded-2xl outline-none focus:border-amber-400 transition-all font-medium"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute left-3 top-3 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <p className="text-xs text-slate-400">
          النظام يفحص آلياً نسب الغياب والدرجات وحالة الدفع للتنبيه الاستباقي
        </p>
      </div>

      {/* Warning List Cards */}
      <div className="space-y-3 font-tajawal">
        {warningList.length === 0 ? (
          <div className="glass-panel border-emerald-500/30 p-10 rounded-3xl text-center space-y-3">
            <CheckCircle className="w-14 h-14 text-emerald-400 mx-auto drop-shadow-md" />
            <h3 className="text-lg font-bold font-fancy text-emerald-300">
              {searchQuery ? `لا توجد إنذارات مطابقة لبحث "${searchQuery}"` : "رائع! لا يوجد طلاب في دائرة الخطر أو الإنذار حالياً"}
            </h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              جميع الطلاب يظهرون التزاماً ممتازاً بالحضور ومستوى درجات مستقر وحالة سداد منتظمة.
            </p>
          </div>
        ) : (
          warningList.map(({ student, reasons, severity, absRate, examAvg, isUnpaid }) => (
            <div
              key={student.barcode}
              className={`p-5 rounded-3xl glass-card transition-all flex flex-wrap items-center justify-between gap-4 shadow-xl ${
                severity === "high"
                  ? "border-rose-500/50 border-r-8 border-r-rose-500"
                  : "border-amber-500/40 border-r-8 border-r-amber-500"
              }`}
            >
              <div className="space-y-2 flex-1 min-w-[280px]">
                <div className="flex items-center gap-2.5">
                  <h4 className="text-base font-bold font-fancy text-white">{student.name}</h4>
                  <span className="text-[11px] font-mono text-amber-300 bg-slate-900/80 px-2.5 py-1 rounded-xl border border-indigo-500/20">
                    #{student.barcode}
                  </span>
                  <span className="text-xs font-bold text-amber-300/90">
                    {student.groupGrade} ({student.groupDays})
                  </span>
                </div>

                <div className="space-y-1.5 pt-1">
                  {reasons.map((reason, i) => (
                    <div key={i} className="text-xs text-rose-300 font-medium flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0" />
                      <span>{reason}</span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-4 text-[11px] text-slate-400 pt-1">
                  <span>
                    نسبة الغياب: <strong className="text-rose-400 font-mono">{absRate}%</strong>
                  </span>
                  <span>
                    متوسط الدرجات: <strong className="text-amber-300 font-mono">{examAvg}%</strong>
                  </span>
                  <span>
                    ولي الأمر: <strong className="text-slate-200 font-mono">{student.parentPhone}</strong>
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleOpenAIAnalysis(student, absRate, examAvg, isUnpaid)}
                  className="px-4 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs rounded-2xl shadow-lg shadow-purple-600/30 flex items-center gap-2 transition-all cursor-pointer"
                >
                  <Bot className="w-4 h-4 text-amber-300" />
                  <span>تشخيص الذكاء الاصطناعي (Gemini) ✨</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSendWarning(student, reasons)}
                  className="px-5 py-3 bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 text-white font-black text-xs rounded-2xl shadow-lg shadow-rose-600/30 flex items-center gap-2 transition-all transform hover:scale-[1.02] shrink-0 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>إرسال إنذار فوري لولي الأمر 📲</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* AI Diagnostic Modal */}
      {selectedAnalysisStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in font-tajawal text-right">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-[#0c1424] border border-purple-500/40 p-6 md:p-8 shadow-2xl space-y-6">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center text-purple-300">
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-white flex items-center gap-2">
                    <span>تشخيص وتحليل الأداء الأكاديمي (Gemini AI)</span>
                    {analysisResult && (
                      <span
                        className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold border ${
                          analysisResult.riskLevel === "HIGH"
                            ? "bg-rose-500/20 text-rose-300 border-rose-500/30"
                            : analysisResult.riskLevel === "MEDIUM"
                            ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                            : analysisResult.riskLevel === "EXCELLENT"
                            ? "bg-purple-500/20 text-purple-300 border-purple-500/30"
                            : "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                        }`}
                      >
                        درجة الخطورة: {analysisResult.riskLevel}
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-400">
                    الطالب: <strong className="text-white">{selectedAnalysisStudent.student.name}</strong> • {selectedAnalysisStudent.student.groupGrade}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAnalysisStudent(null)}
                className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Loading State */}
            {isAnalyzing && (
              <div className="py-12 text-center space-y-3 bg-slate-950/60 rounded-2xl border border-purple-500/20">
                <div className="inline-flex p-3 rounded-2xl bg-purple-600/20 text-purple-300 animate-pulse">
                  <RefreshCw className="w-8 h-8 animate-spin text-purple-400" />
                </div>
                <p className="text-sm font-bold text-white">
                  جاري تحليل السجلات والدرجات بالذكاء الاصطناعي مع معالجة غير متزامنة...
                </p>
                <p className="text-xs text-slate-400">
                  يتم توجيه الطلب عبر طابور المعالجة الآمن لمنع أي تضارب بين الأجهزة أو تجاوز معدل الاستخدام (Rate Limit).
                </p>
              </div>
            )}

            {/* Analysis Result Details */}
            {!isAnalyzing && analysisResult && (
              <div className="space-y-5">
                {/* Source Badge */}
                <div className="flex items-center justify-between text-xs px-4 py-2 rounded-xl bg-slate-950/80 border border-slate-800">
                  <span className="text-slate-400">حالة الاستجابة ومصدر البيانات:</span>
                  <span
                    className={`font-bold font-mono px-2 py-0.5 rounded-md ${
                      analysisResult.source === "gemini"
                        ? "text-emerald-400 bg-emerald-950/40"
                        : analysisResult.source === "cache"
                        ? "text-sky-400 bg-sky-950/40"
                        : "text-amber-400 bg-amber-950/40"
                    }`}
                  >
                    {analysisResult.source === "gemini"
                      ? "Gemini 3.8 Flash (Live) ✓"
                      : analysisResult.source === "cache"
                      ? "Isolated Session Cache (0ms) ⚡"
                      : "Safety Fallback Default 🛡️"}
                  </span>
                </div>

                {/* Diagnosis Box */}
                <div className="p-4 rounded-2xl bg-slate-950/90 border border-purple-500/30 space-y-2">
                  <div className="flex items-center gap-2 text-purple-300 font-extrabold text-sm">
                    <Sparkles className="w-4 h-4 text-amber-300" />
                    <span>التشخيص التربوي والأكاديمي:</span>
                  </div>
                  <p className="text-xs md:text-sm text-slate-200 leading-relaxed">
                    {analysisResult.diagnosis}
                  </p>
                </div>

                {/* Key Factors */}
                <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                  <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span>العوامل المؤثرة المكتشفة:</span>
                  </h4>
                  <ul className="space-y-1 text-xs text-slate-300">
                    {analysisResult.keyFactors.map((factor, idx) => (
                      <li key={idx} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                        <span>{factor}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Teacher Action Plan */}
                <div className="p-4 rounded-2xl bg-indigo-950/30 border border-indigo-500/40 space-y-2">
                  <h4 className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                    <BookOpen className="w-4 h-4 text-indigo-400" />
                    <span>خطة عمل مقترحة للمعلمة (الأستاذة إيمان):</span>
                  </h4>
                  <ul className="space-y-1.5 text-xs text-slate-200">
                    {analysisResult.teacherActionPlan.map((plan, idx) => (
                      <li key={idx} className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-lg bg-indigo-600/30 text-indigo-300 flex items-center justify-center font-mono font-bold text-[10px] shrink-0">
                          {idx + 1}
                        </span>
                        <span>{plan}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Parent Advisory Note */}
                <div className="p-4 rounded-2xl bg-slate-950/90 border border-emerald-500/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                      <Send className="w-3.5 h-3.5" />
                      <span>رسالة استشارية لولي الأمر:</span>
                    </h4>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(analysisResult.parentAdvisoryNote);
                          setCopiedKey("parent_advisory");
                          setTimeout(() => setCopiedKey(null), 2000);
                        }}
                        className="px-2.5 py-1 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-bold border border-slate-800 flex items-center gap-1 cursor-pointer"
                      >
                        {copiedKey === "parent_advisory" ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span className="text-emerald-300">تم النسخ</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>نسخ</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          openWhatsApp(
                            selectedAnalysisStudent.student.parentPhone || selectedAnalysisStudent.student.phone || "",
                            `توجيه وإرشاد أكاديمي من الأستاذة إيمان الدمشيتي 📐:\n\n${analysisResult.parentAdvisoryNote}`
                          )
                        }
                        className="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Send className="w-3 h-3" />
                        <span>إرسال واتساب</span>
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed font-sans p-3 rounded-xl bg-slate-900 border border-slate-800">
                    {analysisResult.parentAdvisoryNote}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
