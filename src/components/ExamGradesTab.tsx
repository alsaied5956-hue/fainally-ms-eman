import React, { useState, useEffect } from "react";
import { Student } from "../types";
import { openWhatsApp, SCHOOL_WHATSAPP_PHONE, sortStudentsByGradeAndName } from "../utils/helpers";
import { enqueuePlatformMessage } from "../utils/storage";
import { playBeep } from "../utils/audio";
import { StudentSearchBox } from "./StudentSearchBox";
import { FileCheck2, Send, Sparkles, UserCheck, MessageSquare, Clock, CheckCircle2, Loader2 } from "lucide-react";

interface ExamGradesTabProps {
  students: Student[];
  onRecordGrade: (barcode: string, examTitle: string, score: number, maxScore: number) => void;
}

export const ExamGradesTab: React.FC<ExamGradesTabProps> = ({
  students,
  onRecordGrade,
}) => {
  // Retain the exam title and maximum score across submissions and browser refreshes
  const [examTitle, setExamTitle] = useState<string>(() => {
    return localStorage.getItem("eman_last_exam_title") || "التقييم الأول";
  });
  const [maxScore, setMaxScore] = useState<number>(() => {
    const saved = localStorage.getItem("eman_last_max_score");
    return saved !== null && !isNaN(Number(saved)) && Number(saved) > 0 ? Number(saved) : 10;
  });

  const [searchInput, setSearchInput] = useState("");
  const [studentScore, setStudentScore] = useState<number | "">("");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [lastRecordedInfo, setLastRecordedInfo] = useState<{
    studentName: string;
    barcode: string;
    grade: string;
    score: number;
    maxScore: number;
    percentage: number;
    examTitle: string;
  } | null>(null);

  // Sync to local storage whenever title or max score changes
  const handleExamTitleChange = (val: string) => {
    setExamTitle(val);
    try {
      localStorage.setItem("eman_last_exam_title", val);
    } catch {
      // ignore
    }
  };

  const handleMaxScoreChange = (val: number) => {
    setMaxScore(val);
    try {
      localStorage.setItem("eman_last_max_score", String(val));
    } catch {
      // ignore
    }
  };

  const handleSelectStudent = (student: Student) => {
    setSelectedStudent(student);
    setSearchInput(student.name);
    playBeep("success");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!selectedStudent) {
      setFeedback({ type: "error", message: "⚠️ يرجى اختيار أو مسح باركود طالب مسجل أولاً!" });
      return;
    }

    const scoreNum = Number(studentScore);
    const maxNum = Number(maxScore);

    if (isNaN(scoreNum) || isNaN(maxNum) || maxNum <= 0) {
      setFeedback({ type: "error", message: "⚠️ يرجى إدخال درجات صحيحة ومقبولة!" });
      return;
    }

    if (scoreNum < 0) {
      setFeedback({ type: "error", message: "⚠️ لا يمكن أن تكون درجة الطالب أقل من الصفر!" });
      return;
    }

    if (scoreNum > maxNum) {
      setFeedback({ type: "error", message: `⚠️ لا يمكن أن تكون درجة الطالب (${scoreNum}) أكبر من الدرجة العظمى (${maxNum})!` });
      return;
    }

    setIsSubmitting(true);

    const currentTitle = examTitle.trim() || "التقييم الأول";

    // 1. Record grade in system
    onRecordGrade(selectedStudent.barcode, currentTitle, scoreNum, maxNum);
    playBeep("success");

    const percentage = Math.round((scoreNum / maxNum) * 100);
    let evaluation = "ممتاز جداً 🌟 واصل التألق والتميز!";
    if (percentage < 60) {
      evaluation = "⚠️ تحذير عاجل: مستوى الطالب يحتاج متابعة ومذاكرة مضاعفة.";
    } else if (percentage < 80) {
      evaluation = "جيد 👍 ونتطلع للمزيد من الاجتهاد والتركيز.";
    }

    const msg = `نتيجة اختبار الرياضيات 📐\nالامتحان: (${currentTitle})\nاسم الطالب: ${selectedStudent.name}\nالصف: ${selectedStudent.groupGrade}\nالدرجة: ${scoreNum} من ${maxNum} (${percentage}%)\nالتقييم: ${evaluation}\nمع تحيات ميس إيمان الدمشيتي ✨`;

    const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

    // Direct Platform Notification sent to Firebase platform_messages & notifications collections
    enqueuePlatformMessage({
      studentBarcode: selectedStudent.barcode,
      studentName: selectedStudent.name,
      grade: selectedStudent.groupGrade,
      phone: selectedStudent.parentPhone,
      messageType: "درجات",
      title: `نتيجة تقييم الرياضيات - ${selectedStudent.name}`,
      message: msg,
      channel: "in_app",
    });

    setFeedback({
      type: "success",
      message: `✅ تم رصد درجة (${selectedStudent.name}): ${scoreNum}/${maxNum} (${percentage}%) وبث إشعار المنصة الفوري بنجاح!`,
    });

    // Save info for visual confirmation card
    setLastRecordedInfo({
      studentName: selectedStudent.name,
      barcode: selectedStudent.barcode,
      grade: selectedStudent.groupGrade,
      phone: selectedStudent.parentPhone,
      score: scoreNum,
      maxScore: maxNum,
      percentage,
      examTitle: currentTitle,
      message: msg,
    });

    // Reset student selection & score, BUT strictly KEEP examTitle and maxScore intact!
    setSearchInput("");
    setSelectedStudent(null);
    setStudentScore("");
    setIsSubmitting(false);

    setTimeout(() => {
      setFeedback(null);
    }, 4500);
  };

  const handleSendAllGradesToTeacher = () => {
    const sorted = sortStudentsByGradeAndName(students);
    let msg = `📋 كشف درجات آخر اختبار لطلاب ميس إيمان الدمشيتي:\n\n`;
    let count = 0;
    sorted.forEach((s) => {
      if (s.lastExamScore) {
        count++;
        msg += `• ${s.name} (${s.groupGrade}): ${s.lastExamScore}\n`;
      }
    });

    if (count === 0) {
      setFeedback({ type: "error", message: "⚠️ لا يوجد درجات مسجلة للطلاب بعد!" });
      return;
    }

    openWhatsApp(SCHOOL_WHATSAPP_PHONE, msg);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="glass-panel p-6 md:p-8 rounded-3xl shadow-2xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3.5 pb-4 border-b border-indigo-500/20">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shadow-md">
              <FileCheck2 className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold font-fancy text-amber-300">
                رصد وإضافة درجات الاختبارات الفورية
              </h2>
              <p className="text-xs text-slate-400 font-tajawal mt-0.5">
                بحث ذكي بالاسم أو الباركود وحساب النسب المئوية آلياً مع إشعار ولي الأمر
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSendAllGradesToTeacher}
            className="px-4 py-2.5 rounded-2xl bg-gradient-to-r from-sky-500/20 to-cyan-500/10 hover:bg-sky-500/30 border border-sky-500/30 text-sky-300 text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer font-tajawal"
          >
            <span>📲 إرسال الكشف لميس إيمان</span>
          </button>
        </div>

        {feedback && (
          <div
            className={`p-3 rounded-2xl text-xs font-bold border transition-all ${
              feedback.type === "success"
                ? "bg-emerald-950/80 text-emerald-300 border-emerald-500/40"
                : "bg-rose-950/80 text-rose-300 border-rose-500/40"
            }`}
          >
            {feedback.message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs font-bold font-tajawal">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-slate-300">عنوان أو موضوع الامتحان *</label>
              <span className="text-[11px] text-amber-400/80 font-normal">
                (يظل ثابتاً تلقائياً لسرعة رصد باقي الطلاب)
              </span>
            </div>
            <input
              type="text"
              required
              value={examTitle}
              onChange={(e) => handleExamTitleChange(e.target.value)}
              placeholder="مثال: التقييم الأول، التقييم الثاني، اختبار الجبر..."
              className="w-full bg-[#080d1e] border border-indigo-500/30 focus:border-amber-400 text-slate-100 px-4 py-3 rounded-2xl outline-none text-sm font-medium transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-slate-300 flex items-center justify-between">
              <span>ابحث باسم الطالب أو باركود الكارت:</span>
              <span className="text-[11px] text-amber-400 font-normal">
                يدعم البحث السريع (الاسم الأول والأخير وتخطي الأسماء الوسطى)
              </span>
            </label>
            <StudentSearchBox
              students={students}
              value={searchInput}
              onChange={(val) => {
                setSearchInput(val);
                if (!val) setSelectedStudent(null);
              }}
              onSelectStudent={handleSelectStudent}
              placeholder="اكتب اسم الطالب (مثال: أحمد علي) أو اضرب الباركود..."
              autoFocus
            />
          </div>

          {selectedStudent && (
            <div className="glass-card border-emerald-500/40 p-4 rounded-2xl flex items-center justify-between animate-in fade-in">
              <div>
                <h4 className="text-sm font-bold text-emerald-300 font-fancy">{selectedStudent.name}</h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectedStudent.groupGrade} • {selectedStudent.groupDays} • باركود #{selectedStudent.barcode}
                </p>
              </div>
              <div className="text-left font-mono text-xs text-amber-300">
                ⭐ النقاط: {selectedStudent.points || 0}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-slate-300">الدرجة العظمى (الامتحان من كام) *</label>
              <input
                type="number"
                min={1}
                required
                value={maxScore}
                onChange={(e) => handleMaxScoreChange(Number(e.target.value))}
                placeholder="مثال: 10 أو 20 أو 50"
                className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-100 px-4 py-3 rounded-2xl font-mono text-sm outline-none font-bold focus:border-amber-400 transition-all"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-300">درجة الطالب المحققة *</label>
              <input
                type="number"
                step="0.5"
                min={0}
                required
                value={studentScore}
                onChange={(e) => setStudentScore(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="مثال: 10 أو 9.5"
                className="w-full bg-[#080d1e] border border-amber-400 text-amber-300 font-black px-4 py-3 rounded-2xl text-lg outline-none font-mono focus:ring-2 focus:ring-amber-400/30 transition-all"
              />
            </div>
          </div>

          {studentScore !== "" && maxScore > 0 && (
            <div className="p-3.5 bg-slate-950/60 rounded-2xl text-center border border-indigo-500/20">
              <span className="text-slate-400 text-xs">النسبة المحققة: </span>
              <span className="text-lg font-black text-amber-300 font-mono">
                {Math.round((Number(studentScore) / maxScore) * 100)}%
              </span>
            </div>
          )}

          <button
            type="submit"
            disabled={!selectedStudent || isSubmitting}
            className={`w-full py-3.5 rounded-2xl font-black text-sm transition-all flex items-center justify-center gap-2 shadow-xl ${
              selectedStudent && !isSubmitting
                ? "bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-200 hover:from-amber-300 hover:to-yellow-100 text-slate-950 shadow-amber-500/25 cursor-pointer active:scale-[0.99]"
                : "bg-slate-800 text-slate-500 cursor-not-allowed opacity-50"
            }`}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                <span>جارٍ رصد النتيجة...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-slate-950" />
                <span>حفظ ورصد درجة الامتحان بالمنصة ✅</span>
              </>
            )}
          </button>
        </form>

        {/* Last Recorded Student Feedback Toast / Banner */}
        {lastRecordedInfo && (
          <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex flex-wrap items-center justify-between gap-3 animate-in fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-bold text-emerald-300 font-fancy">
                  تم رصد وتوثيق نتيجة: {lastRecordedInfo.studentName} ({lastRecordedInfo.grade})
                </p>
                <p className="text-[11px] text-slate-300 font-tajawal mt-0.5">
                  الامتحان: <span className="text-amber-300 font-bold">{lastRecordedInfo.examTitle}</span> • الدرجة:{" "}
                  <span className="font-mono text-emerald-300 font-bold">
                    {lastRecordedInfo.score}/{lastRecordedInfo.maxScore} ({lastRecordedInfo.percentage}%)
                  </span>
                </p>
              </div>
            </div>
            
            {lastRecordedInfo.phone && lastRecordedInfo.message && (
              <button
                type="button"
                onClick={() => openWhatsApp(lastRecordedInfo.phone!, lastRecordedInfo.message!)}
                className="px-3 py-1.5 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-400/40 text-emerald-300 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                title="خيار جانبي يدوي: فتح واتساب ولي الأمر وإرسال النتيجة"
              >
                <Send className="w-3.5 h-3.5" />
                <span>إرسال واتساب يدوي (خيار جانبي)</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
