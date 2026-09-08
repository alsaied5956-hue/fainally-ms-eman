import React, { useState, useEffect, useMemo } from "react";
import { Student } from "../types";
import { openWhatsApp } from "../utils/helpers";
import { playBeep } from "../utils/audio";
import {
  Award,
  Sparkles,
  Send,
  X,
  CheckCircle2,
  AlertTriangle,
  Star,
  Copy,
  MessageSquare,
  RefreshCw,
  Phone,
} from "lucide-react";

interface EditGradeModalProps {
  student: Student | null;
  isOpen: boolean;
  onClose: () => void;
  onSaveGrade: (
    barcode: string,
    examTitle: string,
    score: number,
    maxScore: number,
    newPoints: number,
    openChatWithParent: boolean,
    customMessage?: string
  ) => void;
}

export const EditGradeModal: React.FC<EditGradeModalProps> = ({
  student,
  isOpen,
  onClose,
  onSaveGrade,
}) => {
  const [examTitle, setExamTitle] = useState("");
  const [maxScore, setMaxScore] = useState<number>(10);
  const [studentScore, setStudentScore] = useState<number | "">("");
  const [pointsBonus, setPointsBonus] = useState<number>(0);
  const [shouldOpenWhatsApp, setShouldOpenWhatsApp] = useState<boolean>(false);
  const [customMsgText, setCustomMsgText] = useState<string>("");
  const [isCustomMsgEdited, setIsCustomMsgEdited] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Parse existing student score on modal open
  useEffect(() => {
    if (student && isOpen) {
      const defaultTitle = student.lastExamTitle?.trim() || "التقييم الأول";
      setExamTitle(defaultTitle);

      let parsedScore: number | "" = "";
      let parsedMax = 10;

      if (student.lastExamScore) {
        // Examples: "9/10 (90%)", "18/20", "45 من 50"
        const clean = student.lastExamScore.replace(/[^\d./من]/g, " ").trim();
        const parts = clean.split(/[/من\s]+/).filter(Boolean);
        if (parts.length >= 2) {
          const s = parseFloat(parts[0]);
          const m = parseFloat(parts[1]);
          if (!isNaN(s) && !isNaN(m) && m > 0) {
            parsedScore = s;
            parsedMax = m;
          }
        } else if (parts.length === 1) {
          const s = parseFloat(parts[0]);
          if (!isNaN(s)) parsedScore = s;
        }
      }

      setMaxScore(parsedMax);
      setStudentScore(parsedScore);
      setPointsBonus(0);
      setShouldOpenWhatsApp(false);
      setIsCustomMsgEdited(false);
      setErrorMsg(null);
      setCopied(false);
    }
  }, [student, isOpen]);

  // Real-time calculations
  const numScore = typeof studentScore === "number" ? studentScore : 0;
  const numMax = maxScore > 0 ? maxScore : 10;
  const percentage = maxScore > 0 && studentScore !== "" ? Math.round((numScore / numMax) * 100) : 0;

  const evaluationInfo = useMemo(() => {
    if (studentScore === "") return { text: "يرجى كتابة الدرجة", badgeColor: "text-slate-400 bg-slate-800" };
    if (percentage >= 90) {
      return {
        text: "ممتاز جداً 🌟 واصل التألق والتميز في الرياضيات!",
        badgeColor: "text-emerald-300 bg-emerald-950/80 border-emerald-500/40",
      };
    } else if (percentage >= 75) {
      return {
        text: "جيد جداً 👍 ونتطلع للمزيد من الاجتهاد والتفوق.",
        badgeColor: "text-sky-300 bg-sky-950/80 border-sky-500/40",
      };
    } else if (percentage >= 60) {
      return {
        text: "مقبول ⚠️ يحتاج لتركيز أكبر ومراجعة مستمرة للواجبات.",
        badgeColor: "text-amber-300 bg-amber-950/80 border-amber-500/40",
      };
    } else {
      return {
        text: "⚠️ تنبيه هام: مستوى الطالب بحاجة لمتابعة عاجلة ومضاعفة المذاكرة.",
        badgeColor: "text-rose-300 bg-rose-950/80 border-rose-500/40",
      };
    }
  }, [studentScore, percentage]);

  // Generated WhatsApp message
  const generatedWhatsAppMsg = useMemo(() => {
    if (!student) return "";
    const title = examTitle.trim() || "التقييم الأول";
    const scoreText = studentScore !== "" ? `${studentScore} من ${maxScore} (${percentage}%)` : "لم ترصد";
    const totalPts = (student.points || 0) + (pointsBonus || 0);

    return `تعديل وتحديث رصد درجة اختبار الرياضيات 📐\n\nالسادة أولياء الأمور الكرام،\nتم تعديل وتحديث رصد درجة الاختبار لدى الأستاذة إيمان الدمشيتي:\n\n🔹 اسم الطالب/ة: ${student?.name || ""}\n📚 الصف الدراسي: ${student?.groupGrade || ""}\n📝 موضوع الاختبار: ${title}\n📊 الدرجة بعد التعديل: ${scoreText}\n🌟 التقييم: ${evaluationInfo.text}\n⭐ إجمالي نقاط الطالب: ${totalPts}\n\nشاكرين حرصكم ومتابعتكم المستمرة ✨\nمع تحيات ميس إيمان الدمشيتي 📐`;
  }, [student, examTitle, studentScore, maxScore, percentage, evaluationInfo, pointsBonus]);

  const activeMsg = isCustomMsgEdited ? customMsgText : generatedWhatsAppMsg;

  const handleSubmit = (e: React.FormEvent, forceWhatsApp?: boolean) => {
    e.preventDefault();
    if (studentScore === "") {
      setErrorMsg("⚠️ يرجى إدخال درجة الطالب المحققة!");
      return;
    }

    const s = Number(studentScore);
    const m = Number(maxScore);

    if (isNaN(s) || isNaN(m) || m <= 0) {
      setErrorMsg("⚠️ يرجى التأكد من كتابة أرقام صحيحة!");
      return;
    }

    if (s < 0) {
      setErrorMsg("⚠️ لا يمكن أن تكون درجة الطالب بالسالب!");
      return;
    }

    if (s > m) {
      setErrorMsg(`⚠️ درجة الطالب (${s}) لا يمكن أن تكون أكبر من الدرجة العظمى (${m})!`);
      return;
    }

    const openChat = forceWhatsApp !== undefined ? forceWhatsApp : shouldOpenWhatsApp;
    const finalMsg = isCustomMsgEdited ? customMsgText : generatedWhatsAppMsg;

    // Call parent handler
    onSaveGrade(
      student.barcode,
      examTitle.trim() || "التقييم الأول",
      s,
      m,
      (student.points || 0) + (pointsBonus || 0),
      openChat,
      finalMsg
    );

    playBeep("success");
    onClose();
  };

  const handleCopyMessage = () => {
    navigator.clipboard?.writeText(activeMsg);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  if (!isOpen || !student) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 md:p-6 overflow-y-auto animate-in fade-in">
      <div className="glass-panel w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden border border-amber-500/30 flex flex-col my-auto font-tajawal max-h-[92vh]">
        {/* Modal Header */}
        <div className="p-4 md:p-5 bg-gradient-to-r from-amber-500/15 via-indigo-950/40 to-slate-900 border-b border-indigo-500/20 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center shadow-md">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base md:text-lg font-bold font-fancy text-amber-300">
                تعديل رصد درجة الامتحان وحساب النسبة
              </h3>
              <p className="text-[11px] text-slate-400">
                إعادة رصد وتعديل الدرجة وتجهيز رسالة واتساب المباشرة لولي الأمر
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-slate-700/50 transition-all cursor-pointer"
            title="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={(e) => handleSubmit(e)} className="p-4 md:p-6 space-y-4 overflow-y-auto custom-scrollbar flex-1 text-xs">
          {errorMsg && (
            <div className="p-3 rounded-2xl bg-rose-950/80 text-rose-300 border border-rose-500/40 font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Student Profile Overview Card */}
          <div className="glass-card p-3.5 rounded-2xl border-indigo-500/30 flex flex-wrap items-center justify-between gap-2.5">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-amber-300 font-fancy">{student.name}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold">
                  {student.groupGrade}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                <span>باركود: #{student.barcode}</span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Phone className="w-3 h-3 text-emerald-400" />
                  {student.parentPhone || "لا يوجد هاتف"}
                </span>
              </p>
            </div>

            <div className="text-left font-mono">
              <span className="text-[11px] text-slate-400 block">الدرجة السابقة المسجلة:</span>
              <span className="font-bold text-slate-200 text-xs bg-slate-900 px-2 py-1 rounded-lg border border-slate-700 block">
                {student.lastExamScore || "لا يوجد درجة مسجلة"}
              </span>
            </div>
          </div>

          {/* Exam Title */}
          <div className="space-y-1.5 font-bold">
            <label className="text-slate-300 flex items-center justify-between">
              <span>عنوان أو موضوع الامتحان *</span>
              <span className="text-[10px] text-amber-400 font-normal">
                (اسم الاختبار المراد تعديله)
              </span>
            </label>
            <input
              type="text"
              required
              value={examTitle}
              onChange={(e) => {
                setExamTitle(e.target.value);
                setErrorMsg(null);
              }}
              placeholder="مثال: التقييم الأول، امتحان شهر أكتوبر، اختبار الجبر..."
              className="w-full bg-[#080d1e] border border-indigo-500/30 focus:border-amber-400 text-slate-100 px-4 py-2.5 rounded-2xl outline-none text-xs font-bold transition-all"
            />
          </div>

          {/* Scores Input Grid (Interactive New Entry) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="space-y-1.5 font-bold">
              <label className="text-slate-300">الدرجة العظمى (من كام) *</label>
              <input
                type="number"
                min={1}
                required
                value={maxScore}
                onChange={(e) => {
                  setMaxScore(Math.max(1, Number(e.target.value)));
                  setErrorMsg(null);
                }}
                placeholder="مثال: 10 أو 20 أو 50"
                className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-100 px-4 py-2.5 rounded-2xl font-mono text-sm outline-none font-bold focus:border-amber-400 transition-all"
              />
            </div>

            <div className="space-y-1.5 font-bold">
              <label className="text-slate-300 flex items-center justify-between">
                <span>درجة الطالب المحققة *</span>
                <span className="text-[10px] text-emerald-400 font-normal">
                  (اكتب الدرجة الجديدة)
                </span>
              </label>
              <input
                type="number"
                step="0.5"
                min={0}
                max={maxScore}
                required
                value={studentScore}
                onChange={(e) => {
                  setStudentScore(e.target.value === "" ? "" : Number(e.target.value));
                  setErrorMsg(null);
                }}
                placeholder="مثال: 9.5 أو 18 أو 45"
                className="w-full bg-[#080d1e] border-2 border-amber-400 text-amber-300 font-black px-4 py-2.5 rounded-2xl text-base outline-none font-mono focus:ring-2 focus:ring-amber-400/30 transition-all"
                autoFocus
              />
            </div>
          </div>

          {/* Real-time Percentage & Rating Banner */}
          {studentScore !== "" && maxScore > 0 && (
            <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-indigo-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-300 font-bold">النسبة المئوية المحسوبة:</span>
                <span className="text-lg font-black font-mono text-amber-300">
                  {studentScore} / {maxScore} ({percentage}%)
                </span>
              </div>

              <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    percentage >= 85
                      ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                      : percentage >= 65
                      ? "bg-gradient-to-r from-amber-500 to-yellow-300"
                      : "bg-gradient-to-r from-rose-500 to-red-400"
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
                />
              </div>

              <div className={`p-2 rounded-xl border text-[11px] font-bold ${evaluationInfo.badgeColor}`}>
                {evaluationInfo.text}
              </div>
            </div>
          )}

          {/* Points Bonus adjustment */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-indigo-950/20 border border-indigo-500/20">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
              <span className="text-slate-300 font-bold">إجمالي نقاط الطالب الحالية:</span>
              <span className="font-mono text-amber-300 font-bold">{student.points || 0}</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400 font-medium">تعديل النقاط:</span>
              <input
                type="number"
                value={pointsBonus}
                onChange={(e) => setPointsBonus(Number(e.target.value))}
                className="w-16 bg-[#080d1e] border border-amber-500/30 text-amber-300 font-mono font-bold px-2 py-1 rounded-xl text-center text-xs outline-none"
                placeholder="0"
              />
            </div>
          </div>

          {/* WhatsApp Direct Chat Setup */}
          <div className="space-y-2 pt-2 border-t border-indigo-500/20">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-emerald-300 font-bold cursor-pointer">
                <input
                  type="checkbox"
                  checked={shouldOpenWhatsApp}
                  onChange={(e) => setShouldOpenWhatsApp(e.target.checked)}
                  className="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
                />
                <span className="text-xs">📲 فتح شات ولي الأمر على واتساب فور حفظ التعديل</span>
              </label>

              <button
                type="button"
                onClick={handleCopyMessage}
                className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer transition-colors"
                title="نسخ نص الرسالة"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copied ? "تم النسخ ✓" : "نسخ الرسالة"}</span>
              </button>
            </div>

            {/* Live WhatsApp message preview and editor */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>معاينة رسالة الواتساب المجهزة لولي الأمر:</span>
                {isCustomMsgEdited && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsCustomMsgEdited(false);
                      setCustomMsgText("");
                    }}
                    className="text-amber-400 hover:underline flex items-center gap-1 text-[10px]"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    <span>إعادة ضبط للقالب التلقائي</span>
                  </button>
                )}
              </div>
              <textarea
                rows={4}
                value={activeMsg}
                onChange={(e) => {
                  setCustomMsgText(e.target.value);
                  setIsCustomMsgEdited(true);
                }}
                className="w-full bg-[#050914] border border-emerald-500/30 text-slate-200 p-3 rounded-2xl text-[11px] font-tajawal outline-none focus:border-emerald-400 transition-all resize-none leading-relaxed"
                placeholder="نص رسالة الواتساب..."
              />
            </div>
          </div>

          {/* Modal Action Buttons */}
          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-3 border-t border-indigo-500/20 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs cursor-pointer transition-all"
            >
              إلغاء
            </button>

            <button
              type="submit"
              className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-200 hover:from-amber-300 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/25 flex items-center gap-2 cursor-pointer transition-all active:scale-95"
            >
              <CheckCircle2 className="w-4 h-4 text-slate-950" />
              <span>{shouldOpenWhatsApp ? "حفظ التعديل ومراسلة واتساب 📲" : "حفظ التعديل وبث إشعار المنصة 💾"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
