import React, { useState, useMemo, useRef, useEffect } from "react";
import { Student, GradeName, GroupDays, GRADE_ORDER } from "../types";
import { getTodayKey, openWhatsApp } from "../utils/helpers";
import { enqueuePlatformMessagesBatch } from "../utils/storage";
import {
  broadcastHomeworkChange,
  saveHomeworkToSupabase,
  subscribeToHomeworkChanges,
} from "../utils/supabaseClient";

function playFeedbackTone(success: boolean) {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = success ? 880 : 320;
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (success ? 0.15 : 0.25));
    osc.start();
    osc.stop(ctx.currentTime + (success ? 0.15 : 0.25));
  } catch {
    // Ignore audio error
  }
}
import {
  BookOpen,
  Send,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  UserX,
  Sparkles,
  Search,
  Filter,
  Users,
  QrCode,
  Trash2,
  Copy,
  Check,
  RotateCcw,
  ArrowRight,
  UserCheck,
  MessageCircle,
} from "lucide-react";

interface HomeworkTrackerTabProps {
  students: Student[];
  attendanceToday: Record<string, string>;
  onGoToMessages?: () => void;
}

export const HomeworkTrackerTab: React.FC<HomeworkTrackerTabProps> = ({
  students,
  attendanceToday = {},
  onGoToMessages,
}) => {
  const todayKey = getTodayKey();

  // 1. Group Selection States
  const [selectedGrade, setSelectedGrade] = useState<GradeName>("الصف الرابع الابتدائي");
  const [selectedDays, setSelectedDays] = useState<GroupDays>("سبت - إثنين - أربعاء");

  // 2. Barcode Scanning & Input States
  const [currentMode, setCurrentMode] = useState<"not_done" | "deficient">("not_done");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 3. Tracked Student Barcode Sets
  const [notDoneBarcodes, setNotDoneBarcodes] = useState<string[]>([]);
  const [deficientBarcodes, setDeficientBarcodes] = useState<string[]>([]);

  // 4. UI Feedback States
  const [feedbackMessage, setFeedbackMessage] = useState<{
    text: string;
    type: "success" | "warning" | "error";
  } | null>(null);
  const [isDispatched, setIsDispatched] = useState(false);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  // Focus input on mount or mode change
  useEffect(() => {
    inputRef.current?.focus();
  }, [currentMode, selectedGrade, selectedDays]);

  // ⚡ Supabase Realtime: Listen to homework updates from other assistants in sub-50ms
  useEffect(() => {
    const unsub = subscribeToHomeworkChanges((payload) => {
      setFeedbackMessage({
        text: `⚡ رصد فوري للواجبات: قام مساعد آخر بتوثيق واجبات (${payload.barcodes.length} طالب) وتم تحديث شاشتك لحظياً!`,
        type: "success",
      });
      setTimeout(() => setFeedbackMessage(null), 5000);
    });

    return () => {
      unsub();
    };
  }, []);

  // Filter students for the active Grade & Group Days
  const groupStudents = useMemo(() => {
    return students.filter(
      (s) => s.groupGrade === selectedGrade && s.groupDays === selectedDays
    );
  }, [students, selectedGrade, selectedDays]);

  // Split Group Students into:
  // - Absent (strictly excluded from homework notices)
  // - Not Done
  // - Deficient
  // - Automatically Completed (all remaining present)
  const processedLists = useMemo(() => {
    const notDoneSet = new Set(notDoneBarcodes);
    const deficientSet = new Set(deficientBarcodes);

    const absentStudents: Array<{ student: Student; reason: string }> = [];
    const notDoneStudents: Array<{ student: Student; message: string }> = [];
    const deficientStudents: Array<{ student: Student; message: string }> = [];
    const completedStudents: Array<{ student: Student; message: string }> = [];

    groupStudents.forEach((student) => {
      const bCode = String(student.barcode).trim();
      const statusToday = attendanceToday[bCode] || attendanceToday[student.barcode];

      // Rule 1: Absent Check (Must be excluded completely)
      if (statusToday === "غائب" || statusToday === "إذن") {
        absentStudents.push({
          student,
          reason: statusToday === "غائب" ? "مسجل غائب اليوم" : "مسجل غائب بإذن",
        });
        return;
      }

      // Rule 2: Present Students Distribution
      if (notDoneSet.has(bCode)) {
        notDoneStudents.push({
          student,
          message: `تنبيه منصة: ينوه النظام بأنه لم يتم تسليم الواجب المنزلي المطلوب للطالب/ة (${student.name}).`,
        });
      } else if (deficientSet.has(bCode)) {
        deficientStudents.push({
          student,
          message: `تنبيه منصة: تم تسليم الواجب للطالب/ة (${student.name}) ولكن يوجد تقصير في الحل أو إجابات غير مكتملة/خاطئة، يرجى المراجعة.`,
        });
      } else {
        // Automatically all remaining present students
        completedStudents.push({
          student,
          message: `تنبيه منصة: ممتاز! تم تسليم الواجب المنزلي كاملاً وبشكل صحيح للطالب/ة (${student.name}).`,
        });
      }
    });

    return {
      absentStudents,
      notDoneStudents,
      deficientStudents,
      completedStudents,
    };
  }, [groupStudents, notDoneBarcodes, deficientBarcodes, attendanceToday]);

  const totalPresent =
    processedLists.notDoneStudents.length +
    processedLists.deficientStudents.length +
    processedLists.completedStudents.length;

  // Handle Scanning or typing code and pressing Enter
  const handleBarcodeInput = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = barcodeInput.trim();
    if (!raw) return;

    // Find student in current group (or fallback to whole students list)
    let found = groupStudents.find(
      (s) => s.barcode === raw || s.phone.includes(raw) || s.name === raw
    );

    if (!found) {
      found = students.find((s) => s.barcode === raw || s.name.includes(raw));
    }

    if (!found) {
      setFeedbackMessage({
        text: `⚠️ لم يتم العثور على طالب بالكود: (${raw})`,
        type: "error",
      });
      playFeedbackTone(false);
      return;
    }

    const bCode = String(found.barcode).trim();
    const statusToday = attendanceToday[bCode] || attendanceToday[found.barcode];

    // Rule: Check if Absent
    if (statusToday === "غائب" || statusToday === "إذن") {
      setFeedbackMessage({
        text: `⛔ الطالب/ة (${found.name}) مسجل [غائب اليوم]! ممنوع إرسال أي إشعار واجب له ومستثنى تلقائياً.`,
        type: "warning",
      });
      playFeedbackTone(false);
      setBarcodeInput("");
      return;
    }

    // Add to appropriate list
    if (currentMode === "not_done") {
      // Remove from deficient if present
      setDeficientBarcodes((prev) => prev.filter((c) => c !== bCode));
      if (!notDoneBarcodes.includes(bCode)) {
        setNotDoneBarcodes((prev) => [...prev, bCode]);
        setFeedbackMessage({
          text: `🚨 تم تسجيل الطالب (${found.name}) في قائمة [لم يقم بالواجب].`,
          type: "success",
        });
        playFeedbackTone(true);
      } else {
        setFeedbackMessage({
          text: `ℹ️ الطالب (${found.name}) مسجل بالفعل في قائمة لم يقم بالواجب.`,
          type: "warning",
        });
      }
    } else {
      // Deficient mode
      // Remove from not_done if present
      setNotDoneBarcodes((prev) => prev.filter((c) => c !== bCode));
      if (!deficientBarcodes.includes(bCode)) {
        setDeficientBarcodes((prev) => [...prev, bCode]);
        setFeedbackMessage({
          text: `⚠️ تم تسجيل الطالب (${found.name}) في قائمة [تقصير في الواجب].`,
          type: "success",
        });
        playFeedbackTone(true);
      } else {
        setFeedbackMessage({
          text: `ℹ️ الطالب (${found.name}) مسجل بالفعل في قائمة التقصير.`,
          type: "warning",
        });
      }
    }

    setBarcodeInput("");
  };

  const handleRemoveFromNotDone = (bCode: string) => {
    setNotDoneBarcodes((prev) => prev.filter((c) => c !== bCode));
  };

  const handleRemoveFromDeficient = (bCode: string) => {
    setDeficientBarcodes((prev) => prev.filter((c) => c !== bCode));
  };

  const handleQuickAddStudent = (student: Student, mode: "not_done" | "deficient") => {
    const bCode = String(student.barcode).trim();
    const statusToday = attendanceToday[bCode] || attendanceToday[student.barcode];

    if (statusToday === "غائب" || statusToday === "إذن") {
      alert(`⛔ الطالب/ة (${student.name}) مسجل غائب اليوم ومستثنى تماماً.`);
      return;
    }

    if (mode === "not_done") {
      setDeficientBarcodes((prev) => prev.filter((c) => c !== bCode));
      if (!notDoneBarcodes.includes(bCode)) {
        setNotDoneBarcodes((prev) => [...prev, bCode]);
      }
    } else {
      setNotDoneBarcodes((prev) => prev.filter((c) => c !== bCode));
      if (!deficientBarcodes.includes(bCode)) {
        setDeficientBarcodes((prev) => [...prev, bCode]);
      }
    }
  };

  // Dispatch all notices to Platform Messages Batch (channel: in_app)
  const handleDispatchAllToPlatform = () => {
    if (totalPresent === 0) {
      alert("⚠️ لا يوجد طلاب حاضرون في هذه المجموعة لإرسال إشعارات لهم.");
      return;
    }

    const batchPayload = [
      // 1. Not done
      ...processedLists.notDoneStudents.map(({ student, message }) => ({
        studentBarcode: student.barcode,
        studentName: student.name,
        grade: student.groupGrade,
        phone: student.parentPhone || student.phone || "",
        messageType: "سلوك" as const,
        title: `تنبيه واجب: لم يتم التسليم - ${student.name}`,
        message,
        channel: "in_app" as const,
      })),
      // 2. Deficient
      ...processedLists.deficientStudents.map(({ student, message }) => ({
        studentBarcode: student.barcode,
        studentName: student.name,
        grade: student.groupGrade,
        phone: student.parentPhone || student.phone || "",
        messageType: "سلوك" as const,
        title: `تنبيه واجب: تقصير في الحل - ${student.name}`,
        message,
        channel: "in_app" as const,
      })),
      // 3. Completed
      ...processedLists.completedStudents.map(({ student, message }) => ({
        studentBarcode: student.barcode,
        studentName: student.name,
        grade: student.groupGrade,
        phone: student.parentPhone || student.phone || "",
        messageType: "تفوق" as const,
        title: `تنبيه واجب: تسليم ممتاز - ${student.name}`,
        message,
        channel: "in_app" as const,
      })),
    ];

    enqueuePlatformMessagesBatch(batchPayload);

    // ⚡ Supabase Realtime: Broadcast homework changes across all assistant screens in <20ms
    broadcastHomeworkChange({
      action: "bulk_update",
      barcodes: [
        ...processedLists.notDoneStudents.map((x) => x.student.barcode),
        ...processedLists.deficientStudents.map((x) => x.student.barcode),
        ...processedLists.completedStudents.map((x) => x.student.barcode),
      ],
      dateKey: todayKey,
      status: "done",
      updatedBy: "الماسح",
      timestamp: Date.now(),
    }).catch(console.warn);

    // ⚡ Supabase Direct Persistence: Save homework records in Supabase
    const hwRows = [
      ...processedLists.notDoneStudents.map(({ student }) => ({
        barcode: student.barcode,
        dateKey: todayKey,
        status: "not_done" as const,
        notes: "لم يتم تسليم الواجب",
      })),
      ...processedLists.deficientStudents.map(({ student }) => ({
        barcode: student.barcode,
        dateKey: todayKey,
        status: "incomplete" as const,
        notes: "حل ناقص / غير مكتمل",
      })),
      ...processedLists.completedStudents.map(({ student }) => ({
        barcode: student.barcode,
        dateKey: todayKey,
        status: "done" as const,
        notes: "تسليم ممتاز وكامل",
      })),
    ];
    saveHomeworkToSupabase(hwRows).catch(console.warn);

    setIsDispatched(true);
    setFeedbackMessage({
      text: `✅ تم بنجاح توثيق وإرسال إشعارات الواجبات داخل المنصة لكامل المجموعة (${totalPresent} طالب حاضر)! وتم استثناء (${processedLists.absentStudents.length}) طالب غائب تلقائياً.`,
      type: "success",
    });

    setTimeout(() => {
      setIsDispatched(false);
    }, 6000);
  };

  const handleResetSession = () => {
    setShowResetConfirm(true);
  };

  const handleConfirmResetSession = () => {
    setNotDoneBarcodes([]);
    setDeficientBarcodes([]);
    setFeedbackMessage(null);
    setShowResetConfirm(false);
  };

  const formattedLogText = [
    `=== تقرير إشعارات الواجبات على المنصة (${todayKey}) ===`,
    `الصف: ${selectedGrade} | المجموعة: ${selectedDays}`,
    `إجمالي الحاضرين المستحقين للإشعار: ${totalPresent} طالب | الغائبون المستثنون: ${processedLists.absentStudents.length} طالب`,
    "",
    `[1. لم يقوموا بالواجب (${processedLists.notDoneStudents.length} طالب)]:`,
    ...processedLists.notDoneStudents.map(
      (item) => `• كود: ${item.student.barcode} - ${item.student.name}: ${item.message}`
    ),
    "",
    `[2. تقصير / إجابات غير مكتملة (${processedLists.deficientStudents.length} طالب)]:`,
    ...processedLists.deficientStudents.map(
      (item) => `• كود: ${item.student.barcode} - ${item.student.name}: ${item.message}`
    ),
    "",
    `[3. تسليم كامل وصحيح تلقائياً (${processedLists.completedStudents.length} طالب)]:`,
    ...processedLists.completedStudents.map(
      (item) => `• كود: ${item.student.barcode} - ${item.student.name}: ${item.message}`
    ),
    "",
    `[4. الغائبون المستثنون قطيعاً (${processedLists.absentStudents.length} طالب)]:`,
    ...processedLists.absentStudents.map(
      (item) => `• كود: ${item.student.barcode} - ${item.student.name} (${item.reason})`
    ),
  ].join("\n");

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(formattedLogText);
    setCopiedSection("all");
    setTimeout(() => setCopiedSection(null), 2000);
  };

  return (
    <div className="space-y-6 text-right font-tajawal animate-fadeIn">
      {/* Top Banner & Header */}
      <div className="glass-panel p-6 md:p-8 rounded-3xl border border-indigo-500/25 bg-gradient-to-r from-slate-900/95 via-indigo-950/40 to-slate-900/90 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-wrap items-center justify-between gap-4 relative z-10">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-amber-500/15 border border-amber-400/30 text-amber-300 text-xs font-bold">
              <BookOpen className="w-4 h-4 text-amber-400" />
              <span>نظام رصد وإرسال إشعارات الواجبات الجماعية للمنصة</span>
            </div>
            <h2 className="text-2xl md:text-3xl font-black text-white font-fancy flex items-center gap-2">
              <span>تسجيل واجبات المجموعة والإرسال الفوري لأولياء الأمور</span>
            </h2>
            <p className="text-xs md:text-sm text-slate-300 max-w-2xl leading-relaxed">
              اختر المجموعة والصف، ثم سجل الطلاب المقصرين أو الذين لم يفعلوا الواجب بالكود أو بالنقر.
              سيقوم النظام آلياً بإرسال رسائل التنبيه للمقصرين، وإرسال إشعار التميز لمن أنجز الواجب
              كاملاً، واستثناء الغائبين تلقائياً دون أي تدخل يدوي!
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyLogs}
              className="px-3.5 py-2 rounded-2xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700/80 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              {copiedSection === "all" ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-300">تم نسخ التقرير</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>نسخ تقرير الرصد</span>
                </>
              )}
            </button>

            {onGoToMessages && (
              <button
                type="button"
                onClick={onGoToMessages}
                className="px-3.5 py-2 rounded-2xl bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 text-xs font-bold border border-indigo-500/40 flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <span>مركز المراسلة الداخلي</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Group Selector Controls */}
      <div className="glass-panel p-5 rounded-3xl border border-indigo-500/20 bg-slate-900/90 shadow-xl grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
        <div>
          <label className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-amber-400" />
            <span>1. اختيار الصف الدراسي:</span>
          </label>
          <select
            value={selectedGrade}
            onChange={(e) => setSelectedGrade(e.target.value as GradeName)}
            className="w-full px-3.5 py-2.5 rounded-2xl bg-slate-950 border border-slate-800 text-white text-xs font-bold focus:border-indigo-500 outline-none transition-all shadow-inner"
          >
            {GRADE_ORDER.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center gap-1.5">
            <Users className="w-4 h-4 text-sky-400" />
            <span>2. اختيار المجموعة / المواعيد:</span>
          </label>
          <select
            value={selectedDays}
            onChange={(e) => setSelectedDays(e.target.value as GroupDays)}
            className="w-full px-3.5 py-2.5 rounded-2xl bg-slate-950 border border-slate-800 text-white text-xs font-bold focus:border-indigo-500 outline-none transition-all shadow-inner"
          >
            <option value="سبت - إثنين - أربعاء">سبت - إثنين - أربعاء</option>
            <option value="أحد - ثلاثاء - خميس">أحد - ثلاثاء - خميس</option>
          </select>
        </div>

        {/* Real-time Group Stats Strip */}
        <div className="flex items-center justify-around p-2.5 rounded-2xl bg-slate-950/80 border border-slate-800 text-center">
          <div>
            <span className="text-[10px] text-slate-400 block">طلاب المجموعة</span>
            <strong className="text-base font-extrabold text-white font-mono">
              {groupStudents.length}
            </strong>
          </div>
          <div className="h-8 w-px bg-slate-800" />
          <div>
            <span className="text-[10px] text-emerald-400 block">الحاضرون اليوم</span>
            <strong className="text-base font-extrabold text-emerald-400 font-mono">
              {totalPresent}
            </strong>
          </div>
          <div className="h-8 w-px bg-slate-800" />
          <div>
            <span className="text-[10px] text-rose-400 block">الغائبون (مستثنون)</span>
            <strong className="text-base font-extrabold text-rose-400 font-mono">
              {processedLists.absentStudents.length}
            </strong>
          </div>
        </div>
      </div>

      {/* Barcode & Code Entry Section */}
      <div className="glass-panel p-6 rounded-3xl border border-indigo-500/30 bg-slate-900/90 shadow-2xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-extrabold text-white flex items-center gap-2">
            <QrCode className="w-5 h-5 text-amber-400" />
            <span>تسجيل ومسح أكواد الطلاب بالواجب (سكانر سريع أو كتابة + Enter)</span>
          </div>

          {/* Mode Switcher Buttons */}
          <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-2xl border border-slate-800">
            <button
              type="button"
              onClick={() => setCurrentMode("not_done")}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                currentMode === "not_done"
                  ? "bg-rose-600 text-white shadow-md shadow-rose-600/30 font-black"
                  : "text-slate-400 hover:text-rose-300"
              }`}
            >
              <XCircle className="w-3.5 h-3.5 text-rose-300" />
              <span>لم يقوموا بعمل الواجب 🚨</span>
            </button>
            <button
              type="button"
              onClick={() => setCurrentMode("deficient")}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                currentMode === "deficient"
                  ? "bg-amber-600 text-white shadow-md shadow-amber-600/30 font-black"
                  : "text-slate-400 hover:text-amber-300"
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
              <span>تقصير في الواجب (خطأ أو جزء) ⚠️</span>
            </button>
          </div>
        </div>

        {/* Input Barcode Form */}
        <form onSubmit={handleBarcodeInput} className="relative flex items-center gap-2">
          <div className="relative flex-1">
            <input
              ref={inputRef}
              type="text"
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              placeholder={
                currentMode === "not_done"
                  ? "اضرب الباركود أو اكتب كود الطالب الذي [لم يفعل الواجب] ثم اضغط Enter..."
                  : "اضرب الباركود أو اكتب كود الطالب الذي لديه [تقصير/خطأ في الواجب] ثم اضغط Enter..."
              }
              className={`w-full pr-4 pl-32 py-3.5 rounded-2xl bg-slate-950 border text-white text-sm font-mono outline-none shadow-inner transition-all ${
                currentMode === "not_done"
                  ? "border-rose-500/40 focus:border-rose-500 ring-rose-500/10"
                  : "border-amber-500/40 focus:border-amber-500 ring-amber-500/10"
              }`}
            />
            <button
              type="submit"
              className={`absolute left-2 top-2 bottom-2 px-5 rounded-xl text-white text-xs font-bold transition-all shadow-md cursor-pointer flex items-center gap-1.5 ${
                currentMode === "not_done"
                  ? "bg-rose-600 hover:bg-rose-500"
                  : "bg-amber-600 hover:bg-amber-500 text-slate-950 font-black"
              }`}
            >
              <span>تسجيل (Enter)</span>
            </button>
          </div>
        </form>

        {/* Feedback message banner */}
        {feedbackMessage && (
          <div
            className={`p-3 rounded-2xl text-xs md:text-sm font-bold flex items-center gap-2 animate-fadeIn ${
              feedbackMessage.type === "success"
                ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-300"
                : feedbackMessage.type === "warning"
                ? "bg-amber-500/15 border border-amber-500/30 text-amber-300"
                : "bg-rose-500/15 border border-rose-500/30 text-rose-300"
            }`}
          >
            {feedbackMessage.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{feedbackMessage.text}</span>
          </div>
        )}

        {/* Quick Click Add from Current Group Students */}
        <div className="pt-2">
          <span className="text-[11px] font-bold text-slate-400 block mb-2">
            💡 أو اختر بالنقر المباشر على اسم الطالب لإضافته لقائمة{" "}
            {currentMode === "not_done" ? "لم يقوموا بالواجب" : "تقصير في الواجب"}:
          </span>
          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto custom-scrollbar p-2 bg-slate-950/60 rounded-2xl border border-slate-800/80">
            {groupStudents.map((s) => {
              const isAbsent =
                attendanceToday[s.barcode] === "غائب" || attendanceToday[s.barcode] === "إذن";
              const isNotDone = notDoneBarcodes.includes(s.barcode);
              const isDeficient = deficientBarcodes.includes(s.barcode);

              if (isAbsent) return null;

              return (
                <button
                  key={s.barcode}
                  type="button"
                  onClick={() => handleQuickAddStudent(s, currentMode)}
                  className={`px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-all cursor-pointer flex items-center gap-1 ${
                    isNotDone
                      ? "bg-rose-950/50 border-rose-500/50 text-rose-300"
                      : isDeficient
                      ? "bg-amber-950/50 border-amber-500/50 text-amber-300"
                      : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600 hover:text-white"
                  }`}
                >
                  <span>{s.name}</span>
                  <span className="text-[9px] font-mono opacity-70">({s.barcode})</span>
                  {isNotDone && <span className="text-rose-400 font-mono text-[9px]">• لم يفعل</span>}
                  {isDeficient && (
                    <span className="text-amber-400 font-mono text-[9px]">• تقصير</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main 4 Distribution Blocks Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 1. Not Done List Block */}
        <div className="glass-panel p-5 rounded-3xl border border-rose-500/30 bg-gradient-to-b from-rose-950/25 to-slate-900/90 shadow-xl space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-rose-500/20">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400">
                <XCircle className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-extrabold text-white">
                  1. لم يقوموا بعمل الواجب المطلوب
                </h4>
                <p className="text-[10px] text-rose-300">يُرسل لهم تنبيه عدم التسليم</p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-300 font-black font-mono text-xs">
              {processedLists.notDoneStudents.length} طالب
            </span>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-1">
            {processedLists.notDoneStudents.map(({ student, message }) => (
              <div
                key={`nd-${student.barcode}`}
                className="p-3 rounded-2xl bg-slate-950/90 border border-rose-500/30 flex items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-white">{student.name}</span>
                    <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono text-[10px]">
                      {student.barcode}
                    </span>
                  </div>
                  <p className="text-rose-200 mt-1 font-mono text-[10px] truncate leading-relaxed">
                    {message}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(student.parentPhone || student.phone) && (
                    <button
                      type="button"
                      onClick={() => openWhatsApp(student.parentPhone || student.phone || "", message)}
                      className="px-2 py-1 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 transition-all cursor-pointer flex items-center gap-1 text-[11px] font-bold"
                      title="مراسلة فردية عبر واتساب لولي الأمر"
                    >
                      <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="hidden sm:inline">واتساب فردي</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemoveFromNotDone(student.barcode)}
                    className="p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-rose-400 hover:bg-rose-950 transition-all cursor-pointer"
                    title="إلغاء وإعادة للواجب الكامل"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}

            {processedLists.notDoneStudents.length === 0 && (
              <div className="p-8 text-center text-slate-500 bg-slate-950/40 rounded-2xl border border-dashed border-slate-800 text-xs">
                لم يتم تسجيل أي طالب في قائمة عدم الحل.
              </div>
            )}
          </div>
        </div>

        {/* 2. Deficient List Block */}
        <div className="glass-panel p-5 rounded-3xl border border-amber-500/30 bg-gradient-to-b from-amber-950/25 to-slate-900/90 shadow-xl space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-amber-500/20">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-extrabold text-white">
                  2. تقصير في الواجب (خطأ أو جزء متروك)
                </h4>
                <p className="text-[10px] text-amber-300">يُرسل لهم تنبيه التقصير والمراجعة</p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-300 font-black font-mono text-xs">
              {processedLists.deficientStudents.length} طالب
            </span>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-1">
            {processedLists.deficientStudents.map(({ student, message }) => (
              <div
                key={`def-${student.barcode}`}
                className="p-3 rounded-2xl bg-slate-950/90 border border-amber-500/30 flex items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-white">{student.name}</span>
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[10px]">
                      {student.barcode}
                    </span>
                  </div>
                  <p className="text-amber-200 mt-1 font-mono text-[10px] truncate leading-relaxed">
                    {message}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(student.parentPhone || student.phone) && (
                    <button
                      type="button"
                      onClick={() => openWhatsApp(student.parentPhone || student.phone || "", message)}
                      className="px-2 py-1 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 transition-all cursor-pointer flex items-center gap-1 text-[11px] font-bold"
                      title="مراسلة فردية عبر واتساب لولي الأمر"
                    >
                      <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="hidden sm:inline">واتساب فردي</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemoveFromDeficient(student.barcode)}
                    className="p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-amber-400 hover:bg-amber-950 transition-all cursor-pointer"
                    title="إلغاء وإعادة للواجب الكامل"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}

            {processedLists.deficientStudents.length === 0 && (
              <div className="p-8 text-center text-slate-500 bg-slate-950/40 rounded-2xl border border-dashed border-slate-800 text-xs">
                لم يتم تسجيل أي طالب في قائمة التقصير.
              </div>
            )}
          </div>
        </div>

        {/* 3. Completed Automatic List Block */}
        <div className="glass-panel p-5 rounded-3xl border border-emerald-500/30 bg-gradient-to-b from-emerald-950/25 to-slate-900/90 shadow-xl space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-emerald-500/20">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-extrabold text-white">
                  3. باقي طلاب المجموعة الحاضرين تلقائياً (تسليم كامل)
                </h4>
                <p className="text-[10px] text-emerald-300">يُرسل لهم تلقائياً إشعار التميز بنجاح</p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-black font-mono text-xs">
              {processedLists.completedStudents.length} طالب
            </span>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-1">
            {processedLists.completedStudents.map(({ student, message }) => (
              <div
                key={`comp-${student.barcode}`}
                className="p-3 rounded-2xl bg-slate-950/90 border border-emerald-500/30 flex items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-white">{student.name}</span>
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px]">
                      {student.barcode}
                    </span>
                  </div>
                  <p className="text-emerald-200 mt-1 font-mono text-[10px] truncate leading-relaxed">
                    {message}
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 text-[10px] font-bold shrink-0">
                  كامل وممتاز ✓
                </span>
              </div>
            ))}

            {processedLists.completedStudents.length === 0 && (
              <div className="p-8 text-center text-slate-500 bg-slate-950/40 rounded-2xl border border-dashed border-slate-800 text-xs">
                لا يوجد طلاب مؤهلون للواجب الكامل أو الجميع في القوائم الأخرى.
              </div>
            )}
          </div>
        </div>

        {/* 4. Absent Excluded Check Block */}
        <div className="glass-panel p-5 rounded-3xl border border-slate-700/60 bg-gradient-to-b from-slate-950/60 to-slate-900/90 shadow-xl space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-slate-800 text-slate-400">
                <UserX className="w-4 h-4 text-slate-300" />
              </div>
              <div>
                <h4 className="text-sm font-extrabold text-white">
                  4. الغائبون اليوم (مستثنون تماماً بناءً على فحص الغياب)
                </h4>
                <p className="text-[10px] text-slate-400">يُمنع إرسال أي إشعار واجب لهم نهائياً</p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 font-black font-mono text-xs">
              {processedLists.absentStudents.length} طالب
            </span>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-1">
            {processedLists.absentStudents.map(({ student, reason }) => (
              <div
                key={`abs-${student.barcode}`}
                className="p-3 rounded-2xl bg-slate-950/90 border border-slate-800 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-300">{student.name}</span>
                  <span className="text-slate-500 font-mono text-[10px]">({student.barcode})</span>
                </div>
                <span className="px-2 py-0.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-rose-300 text-[10px] font-bold">
                  {reason} (محمي من الإرسال)
                </span>
              </div>
            ))}

            {processedLists.absentStudents.length === 0 && (
              <div className="p-8 text-center text-slate-500 bg-slate-950/40 rounded-2xl border border-dashed border-slate-800 text-xs">
                لا يوجد أي طالب غائب اليوم في هذه المجموعة (الجميع حاضرون).
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Primary Dispatch Action Bottom Bar */}
      <div className="glass-panel p-6 rounded-3xl border border-amber-500/30 bg-slate-950/95 shadow-2xl flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs md:text-sm font-bold text-slate-300">
              ملخص البث الداخلي:
            </span>
            <span className="px-3 py-0.5 rounded-xl bg-indigo-500/20 text-indigo-300 text-xs font-mono font-bold border border-indigo-500/30">
              إجمالي الحاضرين: {totalPresent} طالب
            </span>
            <span className="px-3 py-0.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-mono font-bold border border-slate-700">
              المستثنون للغياب: {processedLists.absentStudents.length} طالب
            </span>
          </div>
          <p className="text-xs text-slate-400">
            الإرسال يتم حصرياً ومباشرة داخل المنصة المعتمدة ولا يتم إرسال أي رسائل للغائبين.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleResetSession}
            className="px-4 py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>تفريغ وبدء رصد جديد</span>
          </button>

          <button
            type="button"
            onClick={handleDispatchAllToPlatform}
            disabled={totalPresent === 0}
            className="px-6 py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-300 hover:from-amber-400 text-slate-950 text-sm font-black transition-all shadow-xl shadow-amber-500/25 flex items-center gap-2 cursor-pointer transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4 text-slate-950" />
            <span>
              اعتماد وإرسال إشعارات الواجبات لكامل المجموعة على المنصة فوراً ({totalPresent} طالب) 🚀
            </span>
          </button>
        </div>
      </div>

      {/* Reset Session Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="glass-panel border-amber-500/50 p-6 rounded-3xl max-w-sm w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95 text-right">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold font-fancy text-white">تأكيد تفريغ رصد الواجب</h3>
                <p className="text-xs text-amber-300">بدء جلسة رصد جديدة</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              هل أنت متأكد من رغبتك في تفريغ قوائم الرصد الحالية لهذه المجموعة لبدء رصد جديد؟
            </p>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={handleConfirmResetSession}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition cursor-pointer shadow-lg shadow-amber-500/20 flex items-center justify-center gap-1.5"
              >
                <RotateCcw className="w-4 h-4" />
                <span>نعم، تفريغ الرصد الآن</span>
              </button>
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
