import React, { useState, useMemo } from "react";
import { Student, PaymentRecord, GradeName, GRADE_ORDER } from "../types";
import { getAttendanceRate, getAbsenceRate, getExamAverage, openWhatsApp, getCurrentMonthKey, isStudentPaid } from "../utils/helpers";
import { matchStudentSearch } from "../utils/search";
import { AlertTriangle, AlertOctagon, ShieldAlert, Send, Filter, CheckCircle, Search, X } from "lucide-react";

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

  const currentMonthKey = getCurrentMonthKey();

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
          warningList.map(({ student, reasons, severity, absRate, examAvg }) => (
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

              <button
                type="button"
                onClick={() => handleSendWarning(student, reasons)}
                className="px-5 py-3 bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 text-white font-black text-xs rounded-2xl shadow-lg shadow-rose-600/30 flex items-center gap-2 transition-all transform hover:scale-[1.02] shrink-0 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>إرسال إنذار فوري لولي الأمر 📲</span>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
