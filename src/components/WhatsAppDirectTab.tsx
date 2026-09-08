import React, { useState, useMemo } from "react";
import { Student, WhatsAppMessageType } from "../types";
import { openWhatsApp, sortStudentsByGradeAndName, getExamAverage, getAbsenceRate } from "../utils/helpers";
import { enqueuePendingWhatsAppMessage, markWhatsAppMessageSent } from "../utils/storage";
import { StudentSearchBox } from "./StudentSearchBox";
import { matchStudentSearch } from "../utils/search";
import {
  MessageSquare,
  Send,
  AlertTriangle,
  Search,
  User,
  X,
  Clock,
  Flame,
  UserX,
  RotateCcw,
  GraduationCap,
  ShieldAlert,
  Copy,
  CheckCircle2,
  BookmarkPlus,
  BookOpen,
  DollarSign,
  Phone,
  Sparkles,
} from "lucide-react";

interface WhatsAppDirectTabProps {
  students: Student[];
  onOpenWhatsAppOutbox?: () => void;
  pendingWhatsAppCount?: number;
}

export const WhatsAppDirectTab: React.FC<WhatsAppDirectTabProps> = ({
  students,
  onOpenWhatsAppOutbox,
  pendingWhatsAppCount = 0,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [customMessage, setCustomMessage] = useState("");
  const [activeMessageType, setActiveMessageType] = useState<WhatsAppMessageType>("تنبيه");
  const [activeTemplateKey, setActiveTemplateKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sideSearchQuery, setSideSearchQuery] = useState("");

  const sortedStudents = useMemo(() => {
    const list = sortStudentsByGradeAndName(students);
    if (!sideSearchQuery.trim()) return list;

    const filtered = list.filter((s) => matchStudentSearch(s, sideSearchQuery).match);
    return filtered.sort((a, b) => {
      const scoreA = matchStudentSearch(a, sideSearchQuery).score;
      const scoreB = matchStudentSearch(b, sideSearchQuery).score;
      return scoreB - scoreA;
    });
  }, [students, sideSearchQuery]);

  const handleSelectStudent = (student: Student) => {
    setSelectedStudent(student);
    setSearchQuery(student.name);
    // If a template was active, re-generate it for the new student
    if (activeTemplateKey) {
      applyTemplate(activeTemplateKey, student);
    }
  };

  const applyTemplate = (templateKey: string, studentOverride?: Student | null) => {
    const student = studentOverride !== undefined ? studentOverride : selectedStudent;
    if (!student) {
      alert("⚠️ يرجى اختيار الطالب أولاً لتجهيز نص الرسالة ببياناته الخاصة!");
      return;
    }

    setActiveTemplateKey(templateKey);
    let text = "";
    let msgType: WhatsAppMessageType = "تنبيه";

    switch (templateKey) {
      case "absence":
        msgType = "غياب";
        text =
          `تنبيه غياب من منظومة الأستاذة إيمان الدمشيتي 📐\n` +
          `نفيدكم بعلم أن الطالب/ة: (${student.name})\n` +
          `المقيد في مجموعة: [${student.groupGrade} - ${student.groupDays}]\n` +
          `قد غاب عن حصة الرياضيات اليوم.\n` +
          `نرجو الاطمئنان عليه ومتابعة سبب الغياب حرصاً على مستواه العلمي والتزامه بالدروس ✨`;
        break;

      case "late":
        msgType = "تأخير";
        text =
          `تنبيه تأخير من منظومة الأستاذة إيمان الدمشيتي 📐\n` +
          `نفيدكم بعلم أن الطالب/ة: (${student.name})\n` +
          `المقيد في مجموعة: [${student.groupGrade} - ${student.groupDays}]\n` +
          `قد حضر متأخراً عن موعد بدء الحصة اليوم.\n` +
          `نرجو حث الطالب على الحضور في الموعد المحدد لعدم فوات شرح بداية الحصة ✨`;
        break;

      case "cross_days":
        msgType = "عكس_أيام";
        text =
          `تنبيه حضور تعويضي من منظومة الأستاذة إيمان الدمشيتي 📐\n` +
          `نفيدكم بعلم أن الطالب/ة: (${student.name})\n` +
          `المقيد أساساً في مجموعة: [${student.groupGrade} - ${student.groupDays}]\n` +
          `قد حضر اليوم في حصة تعويضية بمجموعة أخرى (عكس الأيام).\n` +
          `تم تسجيل حضوره ومتابعته في القاعة بنجاح ✨`;
        break;

      case "hw_shortage":
        msgType = "تنبيه";
        text =
          `تنبيه واجب من منظومة الأستاذة إيمان الدمشيتي 📐\n` +
          `نفيدكم بعلم أن الطالب/ة: (${student.name})\n` +
          `المقيد في: [${student.groupGrade} - ${student.groupDays}]\n` +
          `لديه تقصير في أداء واجب الرياضيات المطلوب منه اليوم.\n` +
          `نرجو المتابعة والحرص على إكمال الواجبات أولاً بأول ✨`;
        break;

      case "no_hw":
        msgType = "تنبيه";
        text =
          `تنبيه عاجل من منظومة الأستاذة إيمان الدمشيتي 📐\n` +
          `نفيدكم بعلم أن الطالب/ة: (${student.name})\n` +
          `المقيد في: [${student.groupGrade} - ${student.groupDays}]\n` +
          `لم يقم بعمل واجب الرياضيات المطلوب منه نهائياً اليوم.\n` +
          `نرجو التنبيه والمتابعة الفورية حرصاً على مستواه الدراسي ✨`;
        break;

      case "last_exam":
        msgType = "درجات";
        {
          const avg = getExamAverage(student);
          const scoreInfo = student.lastExamScore
            ? `درجة (${student.lastExamScore})`
            : student.totalExamScores && student.totalExamScores.length > 0
            ? `متوسط درجات (${avg}%)`
            : `درجة متميزة`;
          const examTitle = student.lastExamTitle ? `في اختبار (${student.lastExamTitle})` : `في آخر اختبار رياضيات`;

          text =
            `تقرير نتيجة اختبار من منظومة الأستاذة إيمان الدمشيتي 📐\n` +
            `نفيدكم بأن الطالب/ة: (${student.name})\n` +
            `الصف: [${student.groupGrade}]\n` +
            `قد حصل ${examTitle} على: ${scoreInfo}.\n` +
            (avg > 0 ? `المعدل التراكمي للاختبارات: (${avg}%).\n` : "") +
            `نرجو الاستمرار في التحفيز والمتابعة المستمرة لمزيد من التفوق 🌟`;
        }
        break;

      case "bad_behavior":
        msgType = "سلوك";
        text =
          `تنبيه هام بشأن الانضباط من منظومة الأستاذة إيمان الدمشيتي 📐\n` +
          `نفيدكم بعلم أن الطالب/ة: (${student.name})\n` +
          `المقيد في: [${student.groupGrade} - ${student.groupDays}]\n` +
          `صدر منه سلوك غير منضبط / عدم تركيز وتشتيت داخل الحصة اليوم، مما أثر على استيعابه وسير الشرح.\n` +
          `نرجو التحدث معه والتوجيه لضمان الالتزام والهدوء التام في القاعة ✨`;
        break;

      case "fee_reminder":
        msgType = "مصاريف";
        text =
          `تذكير من منظومة الأستاذة إيمان الدمشيتي 📐\n` +
          `تحية طيبة لولي أمر الطالب/ة: (${student.name})\n` +
          `المقيد في: [${student.groupGrade}]\n` +
          `نود التذكير بسداد المصروفات الشهرية المستحقة لحصة الرياضيات.\n` +
          `شاكرين حسن تعاونكم وحرصكم الدائم ✨`;
        break;

      default:
        msgType = "تنبيه";
        text = "";
        break;
    }

    setActiveMessageType(msgType);
    setCustomMessage(text);
  };

  const handleCopyMessage = () => {
    if (!customMessage) return;
    navigator.clipboard.writeText(customMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveToOutboxOnly = () => {
    if (!selectedStudent) {
      alert("⚠️ يرجى اختيار طالب أولاً!");
      return;
    }
    if (!customMessage.trim()) {
      alert("⚠️ يرجى كتابة نص الرسالة أولاً!");
      return;
    }

    const targetPhone = selectedStudent.parentPhone || selectedStudent.phone || "";
    enqueuePendingWhatsAppMessage({
      studentBarcode: selectedStudent.barcode,
      studentName: selectedStudent.name,
      grade: selectedStudent.groupGrade,
      phone: targetPhone,
      messageType: activeMessageType,
      message: customMessage.trim(),
    });

    alert(
      `📥 تم حفظ الرسالة بنجاح في "طابور رسائل الواتساب المعلقة"!\nيمكنك إرسالها لاحقاً في أي وقت بنقرة واحدة.`
    );
  };

  const handleSendMessage = () => {
    if (!selectedStudent) {
      alert("⚠️ يرجى اختيار طالب أولاً!");
      return;
    }
    if (!customMessage.trim()) {
      alert("⚠️ يرجى كتابة نص الرسالة أولاً!");
      return;
    }

    const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
    const targetPhone = selectedStudent.parentPhone || selectedStudent.phone || "";

    // Enqueue message into persistent WhatsApp queue
    const queuedMsg = enqueuePendingWhatsAppMessage({
      studentBarcode: selectedStudent.barcode,
      studentName: selectedStudent.name,
      grade: selectedStudent.groupGrade,
      phone: targetPhone,
      messageType: activeMessageType,
      message: customMessage.trim(),
    });

    if (isOnline) {
      openWhatsApp(targetPhone, customMessage.trim());
      if (queuedMsg?.id) {
        markWhatsAppMessageSent(queuedMsg.id);
      }
      alert(`✅ جاري فتح الواتساب لإرسال الرسالة لولي أمر (${selectedStudent.name})!`);
    } else {
      alert(
        `⚡ أنت في وضع الأوفلاين (بدون إنترنت):\nتم حفظ الرسالة بنجاح في "طابور رسائل الواتساب المعلقة".\nيمكنك فتح الطابور وإرسال كافة الرسائل بضغطة زر فور عودة الاتصال!`
      );
    }
  };

  return (
    <div className="space-y-6 font-tajawal">
      {/* Top Banner for WhatsApp Auxiliary Option */}
      <div className="relative overflow-hidden rounded-3xl border border-emerald-500/30 p-5 bg-gradient-to-r from-[#0d1c20] via-[#102422] to-[#0d1627] flex flex-wrap items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shadow-md">
            <MessageSquare className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white font-fancy flex items-center gap-2">
              <span>المراسلة الفردية اليدوية عبر واتساب (خيار جانبي)</span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/30">
                يدوي فقط عند الحاجة
              </span>
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              التواصل الأساسي يتم وتوثيقه داخل المنصة. يتيح لك هذا الخيار الجانبي إرسال رسالة واتساب فردية مخصصة لأي طالب أو ولي أمر يدوياً.
            </p>
          </div>
        </div>

        {onOpenWhatsAppOutbox && pendingWhatsAppCount > 0 && (
          <button
            type="button"
            onClick={onOpenWhatsAppOutbox}
            className="px-4 py-2.5 rounded-2xl bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-200 hover:from-amber-300 text-slate-950 text-xs font-black transition-all shadow-md shadow-amber-500/20 flex items-center gap-2 cursor-pointer active:scale-95"
          >
            <Flame className="w-4 h-4 text-slate-950" />
            <span>عرض طابور الرسائل المعلقة ({pendingWhatsAppCount})</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Direct Message Form (2 Columns) */}
        <div className="lg:col-span-2 space-y-5">
          <div className="glass-panel p-6 md:p-8 rounded-3xl shadow-2xl space-y-5">
            <div className="flex items-center gap-3.5 pb-4 border-b border-indigo-500/20">
              <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-2xl flex items-center justify-center shadow-md">
                <MessageSquare className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold font-fancy text-amber-300">
                  نظام المراسلة الفردية المباشرة
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  إرسال رسائل الغياب، التأخير، التعويض (عكس الأيام)، الواجبات، نتائج الامتحانات، وتنبيهات السلوك لولي الأمر
                </p>
              </div>
            </div>

            <div className="space-y-4 text-xs font-bold font-tajawal">
              {/* Student Search with High-Performance Fuzzy Box */}
              <div className="space-y-1.5">
                <label className="text-slate-300">ابحث باسم الطالب (تسامح مع الإملاء والأجزاء) أو الباركود / الكود:</label>
                <StudentSearchBox
                  students={students}
                  value={searchQuery}
                  onChange={(val) => {
                    setSearchQuery(val);
                    if (!val) {
                      setSelectedStudent(null);
                      setActiveTemplateKey(null);
                    }
                  }}
                  onSelectStudent={(s) => {
                    handleSelectStudent(s);
                  }}
                  placeholder="ابحث بالاسم (مثال: أحمد علي) أو برقم الهاتف أو الباركود..."
                />
              </div>

              {/* Selected Student Card */}
              {selectedStudent && (
                <div className="glass-card border-amber-500/40 p-4 rounded-2xl flex items-center justify-between shadow-inner animate-in fade-in">
                  <div>
                    <h4 className="text-base font-bold text-amber-300 font-fancy flex items-center gap-2">
                      <User className="w-4 h-4 text-amber-400" />
                      <span>{selectedStudent.name}</span>
                    </h4>
                    <p className="text-xs text-slate-400 mt-1">
                      {selectedStudent.groupGrade} • {selectedStudent.groupDays} • هاتف ولي الأمر:{" "}
                      <span className="font-mono text-amber-300 font-bold" dir="ltr">
                        {selectedStudent.parentPhone}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedStudent(null);
                      setSearchQuery("");
                      setActiveTemplateKey(null);
                      setCustomMessage("");
                    }}
                    className="px-3.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    تغيير الطالب ✕
                  </button>
                </div>
              )}

              {/* Quick Templates Categories */}
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <label className="text-slate-300 text-xs font-bold flex items-center gap-1.5">
                    <span>قوالب الرسائل الجاهزة (اختر قالباً للتعبئة التلقائية):</span>
                  </label>
                  {activeTemplateKey && (
                    <span className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-lg">
                      قالب مفعل
                    </span>
                  )}
                </div>

                {/* Section 1: Attendance, Delay & Makeup */}
                <div className="space-y-1.5">
                  <p className="text-[11px] text-slate-400 font-semibold">📌 الحضور والغياب والتعويض:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => applyTemplate("absence")}
                      className={`p-2.5 rounded-2xl border text-xs font-bold transition-all text-right flex items-center gap-2 cursor-pointer ${
                        activeTemplateKey === "absence"
                          ? "bg-rose-500/25 border-rose-400 text-rose-200 shadow-md"
                          : "bg-rose-500/10 hover:bg-rose-500/20 border-rose-500/30 text-rose-300"
                      }`}
                    >
                      <UserX className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>🔴 إشعار غياب اليوم</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => applyTemplate("late")}
                      className={`p-2.5 rounded-2xl border text-xs font-bold transition-all text-right flex items-center gap-2 cursor-pointer ${
                        activeTemplateKey === "late"
                          ? "bg-amber-500/25 border-amber-400 text-amber-200 shadow-md"
                          : "bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-300"
                      }`}
                    >
                      <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>🟡 إشعار تأخير عن الحصة</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => applyTemplate("cross_days")}
                      className={`p-2.5 rounded-2xl border text-xs font-bold transition-all text-right flex items-center gap-2 cursor-pointer ${
                        activeTemplateKey === "cross_days"
                          ? "bg-cyan-500/25 border-cyan-400 text-cyan-200 shadow-md"
                          : "bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-500/30 text-cyan-300"
                      }`}
                    >
                      <RotateCcw className="w-4 h-4 text-cyan-400 shrink-0" />
                      <span>🔄 تعويض (عكس الأيام)</span>
                    </button>
                  </div>
                </div>

                {/* Section 2: Homework, Exam & Behavior */}
                <div className="space-y-1.5 pt-1">
                  <p className="text-[11px] text-slate-400 font-semibold">📌 الواجبات والامتحانات والسلوك:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={() => applyTemplate("hw_shortage")}
                      className={`p-2.5 rounded-2xl border text-xs font-bold transition-all text-right flex items-center gap-2 cursor-pointer ${
                        activeTemplateKey === "hw_shortage"
                          ? "bg-amber-500/25 border-amber-400 text-amber-200 shadow-md"
                          : "bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-300"
                      }`}
                    >
                      <BookOpen className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>⚠️ تقصير في الواجب</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => applyTemplate("no_hw")}
                      className={`p-2.5 rounded-2xl border text-xs font-bold transition-all text-right flex items-center gap-2 cursor-pointer ${
                        activeTemplateKey === "no_hw"
                          ? "bg-rose-500/25 border-rose-400 text-rose-200 shadow-md"
                          : "bg-rose-500/10 hover:bg-rose-500/20 border-rose-500/30 text-rose-300"
                      }`}
                    >
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>🚨 لم يقم بالواجب</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => applyTemplate("last_exam")}
                      className={`p-2.5 rounded-2xl border text-xs font-bold transition-all text-right flex items-center gap-2 cursor-pointer ${
                        activeTemplateKey === "last_exam"
                          ? "bg-sky-500/25 border-sky-400 text-sky-200 shadow-md"
                          : "bg-sky-500/10 hover:bg-sky-500/20 border-sky-500/30 text-sky-300"
                      }`}
                    >
                      <GraduationCap className="w-4 h-4 text-sky-400 shrink-0" />
                      <span>📊 آخر درجة امتحان</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => applyTemplate("bad_behavior")}
                      className={`p-2.5 rounded-2xl border text-xs font-bold transition-all text-right flex items-center gap-2 cursor-pointer ${
                        activeTemplateKey === "bad_behavior"
                          ? "bg-purple-500/25 border-purple-400 text-purple-200 shadow-md"
                          : "bg-purple-500/10 hover:bg-purple-500/20 border-purple-500/30 text-purple-300"
                      }`}
                    >
                      <ShieldAlert className="w-4 h-4 text-purple-400 shrink-0" />
                      <span>🛑 تنبيه سلوك سيئ</span>
                    </button>
                  </div>
                </div>

                {/* Section 3: Fee Reminder */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => applyTemplate("fee_reminder")}
                    className={`w-full p-2.5 rounded-2xl border text-xs font-bold transition-all text-right flex items-center justify-center gap-2 cursor-pointer ${
                      activeTemplateKey === "fee_reminder"
                        ? "bg-emerald-500/25 border-emerald-400 text-emerald-200 shadow-md"
                        : "bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-300"
                    }`}
                  >
                    <DollarSign className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>💵 تذكير بالمصروفات الشهرية المستحقة</span>
                  </button>
                </div>
              </div>

              {/* Message Textarea */}
              <div className="space-y-1.5 pt-2">
                <div className="flex items-center justify-between">
                  <label className="text-slate-300">نص الرسالة المرسلة (يمكنك التعديل والإضافة بحرية):</label>
                  {customMessage && (
                    <button
                      type="button"
                      onClick={handleCopyMessage}
                      className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      {copied ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400">تم النسخ!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>نسخ النص</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
                <textarea
                  rows={6}
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  placeholder="اختر طالباً وقالب رسالة أعلاه، أو اكتب نص الرسالة هنا مباشرة..."
                  className="w-full bg-[#080d1e] border border-indigo-500/30 focus:border-amber-400 text-slate-100 p-4 rounded-2xl outline-none text-xs leading-relaxed transition-all font-medium"
                />
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSendMessage}
                  disabled={!selectedStudent}
                  className={`py-3.5 rounded-2xl font-black text-xs md:text-sm transition-all flex items-center justify-center gap-2 shadow-xl ${
                    selectedStudent
                      ? "bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 text-slate-950 shadow-emerald-500/20 cursor-pointer active:scale-[0.99]"
                      : "bg-slate-800 text-slate-500 cursor-not-allowed opacity-50"
                  }`}
                >
                  <Send className="w-4 h-4" />
                  <span>إرسال عبر الواتساب الآن 📲</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveToOutboxOnly}
                  disabled={!selectedStudent}
                  className={`py-3.5 rounded-2xl font-bold text-xs md:text-sm transition-all flex items-center justify-center gap-2 border ${
                    selectedStudent
                      ? "bg-slate-800/80 hover:bg-slate-700/80 text-amber-300 border-amber-500/30 cursor-pointer active:scale-[0.99]"
                      : "bg-slate-800/40 text-slate-600 border-slate-800 cursor-not-allowed opacity-50"
                  }`}
                >
                  <BookmarkPlus className="w-4 h-4 text-amber-400" />
                  <span>حفظ في طابور المعلق فقط ⏳</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Directory Side List (1 Column) */}
        <div className="glass-panel p-5 rounded-3xl shadow-2xl flex flex-col h-[700px]">
          <h3 className="text-sm font-bold font-fancy text-amber-300 pb-3 border-b border-indigo-500/20 mb-3 flex items-center justify-between">
            <span>👥 دليل الطلاب ومؤشرات الأداء</span>
            <span className="text-[11px] text-slate-400 font-mono font-normal">{sortedStudents.length} طالب</span>
          </h3>

          {/* Side filter search */}
          <div className="relative mb-3">
            <Search className="w-4 h-4 text-amber-400/60 absolute right-3.5 top-3 pointer-events-none" />
            <input
              type="text"
              value={sideSearchQuery}
              onChange={(e) => setSideSearchQuery(e.target.value)}
              placeholder="تصفية الدليل بالاسم أو الكود..."
              className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-200 text-xs pr-10 pl-8 py-2.5 rounded-2xl outline-none focus:border-amber-400 transition-all font-medium"
            />
            {sideSearchQuery && (
              <button
                type="button"
                onClick={() => setSideSearchQuery("")}
                className="absolute left-3 top-3 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
            {sortedStudents.length === 0 ? (
              <p className="text-center text-xs text-slate-500 py-6">لا يوجد طلاب مطابقين للتصفية.</p>
            ) : (
              sortedStudents.map((s) => {
                const avg = getExamAverage(s);
                const abs = getAbsenceRate(s);

                return (
                  <div
                    key={s.barcode}
                    onClick={() => handleSelectStudent(s)}
                    className={`p-3.5 rounded-2xl border text-xs cursor-pointer transition-all flex items-center justify-between ${
                      selectedStudent?.barcode === s.barcode
                        ? "bg-amber-500/15 border-amber-400/80 shadow-lg"
                        : "glass-card hover:border-amber-500/30"
                    }`}
                  >
                    <div>
                      <h4 className="font-bold font-fancy text-slate-200">{s.name}</h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {s.groupGrade} • <span className="font-mono text-amber-300/80">#{s.barcode}</span>
                      </p>
                    </div>

                    <div className="text-left space-y-0.5 font-bold text-[11px] font-mono">
                      <span className={avg >= 80 ? "text-emerald-400" : "text-amber-300"}>
                        امتحان: {avg}%
                      </span>
                      <br />
                      <span className={abs > 20 ? "text-rose-400" : "text-slate-400"}>
                        غياب: {abs}%
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
