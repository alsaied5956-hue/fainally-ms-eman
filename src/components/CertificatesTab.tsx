import React, { useState, useMemo } from "react";
import { Student, CertificateData, GradeName, GRADE_ORDER } from "../types";
import { TEACHER_NAME, getTodayKey, openWhatsApp, formatArabicDate } from "../utils/helpers";
import { matchStudentSearch } from "../utils/search";
import { StudentSearchBox } from "./StudentSearchBox";
import { printElement, downloadPrintableHtml } from "../utils/print";
import confetti from "canvas-confetti";
import { Award, Sparkles, Printer, Send, Star, CheckCircle, Search, Trophy, X, PlusCircle, Info, Download } from "lucide-react";

interface CertificatesTabProps {
  students: Student[];
}

export const CertificatesTab: React.FC<CertificatesTabProps> = ({ students }) => {
  const [filterGrade, setFilterGrade] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
  const [customStudentSearch, setCustomStudentSearch] = useState("");
  const [customStudent, setCustomStudent] = useState<Student | null>(null);
  const [customExamTitle, setCustomExamTitle] = useState("الاختبار الشهري الشامل لمادة الرياضيات");
  const [customScoreText, setCustomScoreText] = useState("الدرجة النهائية 100%");

  const [activeCertificate, setActiveCertificate] = useState<CertificateData | null>(null);

  // Top Achievers: either last exam score has 100% / final mark, or points > 40, or exam average >= 90%
  const topAchievers = useMemo(() => {
    let result = students.filter((s) => {
      if (filterGrade !== "ALL" && s.groupGrade !== filterGrade) return false;
      if (searchQuery.trim()) {
        const { match } = matchStudentSearch(s, searchQuery);
        if (!match) return false;
      }

      const hasFinalMark =
        s.lastExamScore?.includes("100%") ||
        s.lastExamScore?.includes("النهائية") ||
        (s.totalExamScores && s.totalExamScores.some((score) => score >= 90));

      return hasFinalMark || (s.points && s.points >= 40);
    });

    if (searchQuery.trim()) {
      result = [...result].sort((a, b) => {
        const scoreA = matchStudentSearch(a, searchQuery).score;
        const scoreB = matchStudentSearch(b, searchQuery).score;
        return scoreB - scoreA;
      });
    }

    return result;
  }, [students, filterGrade, searchQuery]);

  const handleGenerateCertificate = (student: Student, examTitle?: string, scoreText?: string) => {
    try {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
      });
    } catch {
      // Confetti fallback
    }

    const cert: CertificateData = {
      student,
      examTitle: examTitle || student.lastExamTitle || "اختبار التميز في الرياضيات",
      scoreText: scoreText || student.lastExamScore || "الدرجة النهائية 100%",
      percentage: 100,
      date: formatArabicDate(getTodayKey()),
      teacherName: TEACHER_NAME,
    };

    setActiveCertificate(cert);
  };

  const certCss = `
    @page { size: A4 landscape; margin: 10mm; }
    #printable-certificate {
      border: 12px double #b38728 !important;
      padding: 30px 40px !important;
      border-radius: 16px !important;
      background: #ffffff !important;
      color: #0f172a !important;
      text-align: center !important;
      min-height: 180mm !important;
      display: flex !important;
      flex-direction: column !important;
      justify-content: space-between !important;
      position: relative !important;
    }
  `;

  const handlePrintCertificate = () => {
    if (!activeCertificate) return;
    printElement("printable-certificate", {
      title: `شهادة_تقدير_${activeCertificate.student.name}`,
      orientation: "landscape",
      customCss: certCss,
    });
  };

  const handleDownloadCertificate = () => {
    if (!activeCertificate) return;
    downloadPrintableHtml(
      "printable-certificate",
      `شهادة_تقدير_${activeCertificate.student.name}.html`,
      {
        title: `شهادة تقدير - ${activeCertificate.student.name}`,
        orientation: "landscape",
        customCss: certCss,
      }
    );
  };

  const handleSendCertificateWhatsApp = (cert: CertificateData) => {
    const msg = `🌟 تهنئة وتكريم تفوق أكاديمي 🌟\n\nتتقدم الأستاذة إيمان الدمشيتي (أستاذة الرياضيات) بأسمى آيات التهاني والتبريكات للطالب/ة المتميز/ة:\n✨ (${cert.student.name}) ✨\nالمقيد بالصف: ${cert.student.groupGrade}\n\nنظراً لحصوله على: [${cert.scoreText}] في ${cert.examTitle}.\n\nتم إصدار شهادة تقدير رسمية تكريماً لجهوده وتفوقه الباهر، متمنين له دوام الريادة والنجاح 🌟📐`;
    openWhatsApp(cert.student.parentPhone || cert.student.phone || "", msg);
  };

  const handleCreateCustomCertificate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customStudent) return;
    handleGenerateCertificate(customStudent, customExamTitle, customScoreText);
    setIsCustomModalOpen(false);
    setCustomStudent(null);
    setCustomStudentSearch("");
  };

  return (
    <div className="space-y-6 font-tajawal">
      {/* Top Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/30 p-6 md:p-8 bg-gradient-to-r from-amber-500/15 via-indigo-900/30 to-amber-500/15 shadow-2xl flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-tr from-amber-400 to-yellow-200 text-slate-950 rounded-2xl shadow-xl shadow-amber-500/20 flex items-center justify-center">
            <Trophy className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-xl md:text-2xl font-bold font-fancy text-amber-300 flex items-center gap-2">
              <span>منظومة شهادات التقدير والتفوق الأكاديمي</span>
              <Sparkles className="w-5 h-5 text-amber-300 animate-pulse" />
            </h2>
            <p className="text-xs md:text-sm text-slate-300 mt-1 max-w-xl leading-relaxed">
              توليد وطباعة شهادات تقدير فاخرة للطلاب الحاصلين على الدرجات النهائية بضغطة زر واحدة وإرسالها المباشر لواتساب ولي الأمر.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsCustomModalOpen(true)}
          className="px-5 py-3 bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-200 hover:from-amber-300 text-slate-950 text-xs font-black rounded-2xl shadow-xl shadow-amber-500/25 flex items-center gap-2 transition-all transform hover:scale-[1.02] cursor-pointer active:scale-95"
        >
          <PlusCircle className="w-4 h-4" />
          <span>إصدار شهادة مخصصة لأي طالب</span>
        </button>
      </div>

      {/* Filter and Search */}
      <div className="glass-panel p-5 rounded-3xl flex flex-wrap items-center justify-between gap-3 shadow-2xl">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[300px]">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-amber-400/60 absolute right-3.5 top-3.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث بالاسم (مثال: أحمد علي) أو الباركود..."
              className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-100 text-xs pr-10 pl-8 py-3 rounded-2xl outline-none focus:border-amber-400 transition-all placeholder:text-slate-500 font-medium"
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
        </div>

        <span className="text-xs font-bold text-amber-300 font-fancy">
          ⭐ عدد المتفوقين المؤهلين للتكريم: {topAchievers.length} طالب
        </span>
      </div>

      {/* Top Achievers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {topAchievers.length === 0 ? (
          <div className="col-span-full glass-panel border-amber-500/20 p-10 rounded-3xl text-center space-y-3">
            <Award className="w-14 h-14 text-amber-400/50 mx-auto" />
            <h3 className="text-base font-bold text-slate-300 font-fancy">
              {searchQuery ? `لا يوجد نتائج مطابقة لبحث "${searchQuery}"` : "لا يوجد نتائج متطابقة في القائمة الحالية"}
            </h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              قم برصد درجات الاختبارات لإدراج الطلاب المتفوقين تلقائياً هنا أو اضغط زر "إصدار شهادة مخصصة" بالأعلى.
            </p>
          </div>
        ) : (
          topAchievers.map((student) => (
            <div
              key={student.barcode}
              className="glass-card hover:border-amber-400/50 p-6 rounded-3xl shadow-xl transition-all flex flex-col justify-between space-y-4 group hover:shadow-amber-500/10"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-amber-300 bg-slate-900/80 px-2.5 py-1 rounded-xl border border-indigo-500/20">
                    #{student.barcode}
                  </span>
                  <span className="text-xs font-black text-amber-300 flex items-center gap-1">
                    <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    {student.points || 0} نقطة
                  </span>
                </div>

                <h3 className="text-base font-bold text-slate-100 font-fancy group-hover:text-amber-300 transition-colors">
                  {student.name}
                </h3>
                <p className="text-xs text-slate-400">{student.groupGrade}</p>

                {student.lastExamScore && (
                  <div className="bg-[#080d1e] p-3 rounded-2xl border border-amber-500/20 text-xs">
                    <span className="text-slate-400 block text-[10px]">
                      {student.lastExamTitle || "آخر اختبار"}:
                    </span>
                    <span className="font-extrabold text-amber-300 font-mono">
                      {student.lastExamScore}
                    </span>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-indigo-500/20 flex gap-2">
                <button
                  type="button"
                  onClick={() => handleGenerateCertificate(student)}
                  className="flex-1 py-3 bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-200 hover:from-amber-300 text-slate-950 font-black text-xs rounded-2xl shadow-lg flex items-center justify-center gap-1.5 transition-transform active:scale-95 cursor-pointer"
                >
                  <Award className="w-4 h-4" />
                  <span>إصدار الشهادة 📜</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Custom Certificate Modal */}
      {isCustomModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="glass-panel p-6 md:p-8 rounded-3xl max-w-lg w-full shadow-2xl space-y-5 animate-in fade-in zoom-in-95 border-amber-500/40">
            <div className="flex items-center justify-between pb-3 border-b border-indigo-500/20">
              <h3 className="text-base font-bold font-fancy text-amber-300 flex items-center gap-2">
                <Award className="w-5 h-5 text-amber-400" />
                <span>إصدار شهادة تقدير مخصصة</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsCustomModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl bg-slate-800/50 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCustomCertificate} className="space-y-4 text-xs font-bold font-tajawal">
              <div className="space-y-1.5">
                <label className="text-slate-300">اختر الطالب بالبحث الذكي:</label>
                <StudentSearchBox
                  students={students}
                  value={customStudentSearch}
                  onChange={(val) => {
                    setCustomStudentSearch(val);
                    if (!val) setCustomStudent(null);
                  }}
                  onSelectStudent={(s) => setCustomStudent(s)}
                  placeholder="ابحث بالاسم أو الباركود..."
                  autoFocus
                />
              </div>

              {customStudent && (
                <div className="glass-card p-3.5 rounded-2xl border-emerald-500/40 text-emerald-300 font-fancy">
                  تم اختيار: <strong>{customStudent.name}</strong> ({customStudent.groupGrade})
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-slate-300">عنوان الاختبار أو المناسبة:</label>
                <input
                  type="text"
                  required
                  value={customExamTitle}
                  onChange={(e) => setCustomExamTitle(e.target.value)}
                  placeholder="مثال: الاختبار الشامل لمادة الرياضيات"
                  className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-100 px-4 py-3 rounded-2xl outline-none focus:border-amber-400 transition-all font-medium"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300">الدرجة أو نص الإشادة:</label>
                <input
                  type="text"
                  required
                  value={customScoreText}
                  onChange={(e) => setCustomScoreText(e.target.value)}
                  placeholder="مثال: الدرجة النهائية 100%"
                  className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-100 px-4 py-3 rounded-2xl outline-none focus:border-amber-400 transition-all font-medium"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsCustomModalOpen(false)}
                  className="px-5 py-2.5 rounded-2xl bg-slate-800/80 text-slate-300 hover:bg-slate-700 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={!customStudent}
                  className={`px-6 py-2.5 rounded-2xl font-black transition-all ${
                    customStudent
                      ? "bg-gradient-to-r from-amber-400 to-yellow-300 hover:from-amber-300 text-slate-950 shadow-md cursor-pointer active:scale-95"
                      : "bg-slate-800 text-slate-500 cursor-not-allowed"
                  }`}
                >
                  توليد وعرض الشهادة 📜
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Certificate Modal & Print Preview */}
      {activeCertificate && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 overflow-y-auto">
          <div className="max-w-4xl w-full space-y-4 my-auto">
            {/* Modal Controls */}
            <div className="no-print glass-panel p-4 md:p-5 rounded-3xl border-amber-500/30 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-300 font-fancy flex items-center gap-2">
                  <Award className="w-4 h-4 text-amber-400" />
                  معاينة شهادة التقدير الفاخرة للطباعة والمشاركة
                </span>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handlePrintCertificate}
                    className="px-4 py-2 rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-300 text-slate-950 font-black text-xs hover:from-amber-300 flex items-center gap-1.5 shadow-md cursor-pointer"
                  >
                    <Printer className="w-4 h-4" />
                    <span>طباعة / حفظ PDF</span>
                  </button>

                  <button
                    onClick={handleDownloadCertificate}
                    className="px-4 py-2 rounded-2xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center gap-1.5 cursor-pointer border border-indigo-500/20"
                    title="تحميل الشهادة كملف مستند للفتح والطباعة من كروم"
                  >
                    <Download className="w-3.5 h-3.5 text-amber-400" />
                    <span>تحميل كملف مستند</span>
                  </button>

                  <button
                    onClick={() => handleSendCertificateWhatsApp(activeCertificate)}
                    className="px-4 py-2 rounded-2xl bg-emerald-500 text-white font-bold text-xs hover:bg-emerald-400 flex items-center gap-1.5 shadow-md cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                    <span>إرسال لولي الأمر 📲</span>
                  </button>

                  <button
                    onClick={() => setActiveCertificate(null)}
                    className="px-4 py-2 rounded-2xl bg-slate-800/80 text-slate-300 text-xs font-bold hover:bg-slate-700 cursor-pointer"
                  >
                    إغلاق
                  </button>
                </div>
              </div>

              {/* Tip */}
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-2.5 flex items-center gap-2 text-[11px] text-amber-300">
                <Info className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  <strong>💡 للحفظ كملف PDF على جهازك:</strong> اضغط زر «طباعة / حفظ PDF» ثم اختر من نافذة الطباعة وجهة الحفظ <strong>«Save as PDF / حفظ بتنسيق PDF»</strong>.
                </span>
              </div>
            </div>

            {/* High-Resolution Luxury Certificate Container */}
            <div
              id="printable-certificate"
              className="bg-white text-slate-900 p-10 md:p-14 rounded-2xl shadow-2xl border-[12px] border-double border-[#b38728] relative overflow-hidden font-['Tajawal',sans-serif] text-center aspect-[1.414/1] flex flex-col justify-between"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 50% 50%, rgba(212, 175, 55, 0.05) 0%, transparent 60%)",
              }}
            >
              {/* Corner Ornaments */}
              <div className="absolute top-3 right-3 text-2xl text-[#b38728] font-serif select-none">
                ✦ ✤ ✦
              </div>
              <div className="absolute top-3 left-3 text-2xl text-[#b38728] font-serif select-none">
                ✦ ✤ ✦
              </div>
              <div className="absolute bottom-3 right-3 text-2xl text-[#b38728] font-serif select-none">
                ✦ ✤ ✦
              </div>
              <div className="absolute bottom-3 left-3 text-2xl text-[#b38728] font-serif select-none">
                ✦ ✤ ✦
              </div>

              {/* Certificate Header */}
              <div className="space-y-2">
                <div className="text-sm font-bold tracking-widest text-[#8c671b] uppercase">
                  جمهورية مصر العربية • منظومة الرياضيات المتطورة
                </div>
                <h1 className="text-3xl md:text-4xl font-extrabold text-[#7c5b16] font-['Amiri',serif] tracking-wide">
                  شـــهـــادة تــقـــديــر وتـــفـــوّق
                </h1>
                <div className="w-32 h-1 bg-gradient-to-r from-transparent via-[#b38728] to-transparent mx-auto mt-2" />
              </div>

              {/* Certificate Body */}
              <div className="space-y-4 my-auto py-4">
                <p className="text-base text-slate-700 font-medium">
                  يسر الأستاذة /{" "}
                  <strong className="text-lg font-black text-[#8c671b]">{TEACHER_NAME}</strong> أن
                  تمنح هذه الشهادة بكل فخر واعتزاز إلى الطالب/ـة المتميز/ة:
                </p>

                <div className="py-2">
                  <span className="text-3xl md:text-4xl font-black text-[#1e293b] border-b-2 border-dashed border-[#b38728] px-8 pb-1 inline-block">
                    {activeCertificate.student.name}
                  </span>
                </div>

                <p className="text-sm md:text-base text-slate-700 max-w-2xl mx-auto leading-relaxed">
                  المقيد بالصف:{" "}
                  <strong className="text-[#8c671b] font-bold">
                    {activeCertificate.student.groupGrade}
                  </strong>{" "}
                  تقديراً لاجتهاده وتفوقه الباهر وحصوله على{" "}
                  <strong className="text-emerald-700 font-black">
                    [{activeCertificate.scoreText}]
                  </strong>{" "}
                  في {activeCertificate.examTitle} لمادة الرياضيات.
                </p>
              </div>

              {/* Certificate Footer with Signature & Official Seal */}
              <div className="flex items-end justify-between pt-6 border-t border-slate-200 text-xs md:text-sm">
                <div className="text-right">
                  <p className="text-slate-500">تاريخ التكريم:</p>
                  <p className="font-bold text-slate-800">{activeCertificate.date}</p>
                </div>

                {/* Golden Seal */}
                <div className="w-20 h-20 rounded-full border-4 border-[#b38728] bg-amber-50 flex flex-col items-center justify-center text-center p-1 shadow-inner select-none rotate-6">
                  <Award className="w-5 h-5 text-[#b38728]" />
                  <span className="text-[9px] font-black text-[#7c5b16] leading-tight">
                    وسام التفوق والامتياز
                  </span>
                </div>

                <div className="text-left">
                  <p className="text-slate-500">أستاذة الرياضيات:</p>
                  <p className="font-extrabold text-[#7c5b16] text-base">{TEACHER_NAME}</p>
                  <p className="text-[11px] text-slate-400 font-mono">01070642904</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
