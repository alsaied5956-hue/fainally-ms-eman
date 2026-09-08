import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Student,
  GradeName,
  GroupDays,
  GRADE_ORDER,
  PaymentRecord,
} from "../types";
import {
  getCurrentMonthKey,
  openWhatsApp,
  evaluateAttendanceStatus,
  isStudentPaid,
  getGroupForDate,
  isOfficialGroupDay,
} from "../utils/helpers";
import { playBeep, speakArabicGreeting } from "../utils/audio";
import { StudentSearchBox } from "./StudentSearchBox";
import { enqueuePlatformMessagesBatch, flushPendingSyncToCloud } from "../utils/storage";
import { pushLiveAttendanceEvent } from "../utils/liveEventStream";
import { dispatchPushNotification } from "../services/pushNotificationService";
import {
  broadcastLiveScan,
  saveAttendanceToSupabase,
  subscribeToLiveScans,
  LiveScanPayload,
} from "../utils/supabaseClient";
import {
  ScanLine,
  UserCheck,
  CheckCircle2,
  Clock,
  XCircle,
  PlusCircle,
  Search,
  Sparkles,
  Send,
  X,
  FileText,
  Bell,
  ArrowLeft,
  ArrowRight,
  Users,
  AlertTriangle,
  UserX,
  UserPlus,
  BookOpen,
  Phone,
  RefreshCw,
  RotateCcw,
  CloudUpload,
  Loader2,
} from "lucide-react";

interface AttendanceScannerProps {
  students: Student[];
  attendanceToday: Record<string, string>;
  scanLogOrder: string[];
  scanLogTimes: Record<string, string>;
  payments: Record<string, Record<string, PaymentRecord>>;
  voiceEnabled: boolean;
  activeSessionSlotId: string;
  onRecordAttendance?: (
    barcode: string,
    status: "حضور" | "تأخير",
    timeIso: string,
    student: Student
  ) => void;
  onFinishGroup?: (
    grade: GradeName,
    days: GroupDays,
    absentList: { student: Student; message: string; type: "غائب" }[],
    lateList: { student: Student; message: string; type: "تأخير" }[],
    crossDayList?: { student: Student; message: string; type: "عكس_أيام" }[]
  ) => void;
  onRemoveFromScanner?: (barcode: string) => void;
  onClearSessionScans?: (grade: GradeName, resetTodayAttendance?: boolean) => void;
  onChangeStatus?: (barcode: string, dateKey: string, newStatus: string) => void;
  onSyncGroupSession?: () => Promise<boolean>;
  onNavigateToReport?: () => void;
}

export const AttendanceScanner: React.FC<AttendanceScannerProps> = ({
  students,
  attendanceToday,
  scanLogOrder,
  scanLogTimes,
  payments,
  voiceEnabled,
  activeSessionSlotId,
  onRecordAttendance,
  onFinishGroup,
  onRemoveFromScanner,
  onClearSessionScans,
  onChangeStatus,
  onSyncGroupSession,
  onNavigateToReport,
}) => {
  const [selectedGrade, setSelectedGrade] = useState<GradeName>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("aiman_scanner_grade") as GradeName;
      if (saved && GRADE_ORDER.includes(saved) && saved !== "الصف الخامس الابتدائي") return saved;
    }
    return "الصف الرابع الابتدائي";
  });

  const [selectedDays, setSelectedDays] = useState<GroupDays>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("aiman_scanner_days") as GroupDays;
      if (saved === "سبت - إثنين - أربعاء" || saved === "أحد - ثلاثاء - خميس") return saved;
    }
    // Auto-detect group schedule matching today's actual day of week
    return getGroupForDate(new Date());
  });

  const [barcodeInput, setBarcodeInput] = useState("");
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualModalTab, setManualModalTab] = useState<"manual_search" | "other_days">("manual_search");
  const [manualSearchQuery, setManualSearchQuery] = useState("");
  const [otherDaysSearchQuery, setOtherDaysSearchQuery] = useState("");
  const [selectedManualStudent, setSelectedManualStudent] = useState<Student | null>(null);
  const [tableSearch, setTableSearch] = useState("");
  const [isNewSessionModalOpen, setIsNewSessionModalOpen] = useState(false);
  const [sessionResetSuccessNotice, setSessionResetSuccessNotice] = useState<string | null>(null);
  const [isSyncingGroup, setIsSyncingGroup] = useState(false);
  const [syncGroupNotice, setSyncGroupNotice] = useState<string | null>(null);

  const handleManualGroupSync = async () => {
    setIsSyncingGroup(true);
    try {
      const success = onSyncGroupSession ? await onSyncGroupSession() : await flushPendingSyncToCloud(true);
      if (success) {
        setSyncGroupNotice("✅ تمت مزامنة حضور هذه المجموعة بالكامل في عملية سحابية واحدة بنجاح!");
        setTimeout(() => setSyncGroupNotice(null), 5000);
      }
    } catch (err) {
      console.error("Manual group sync failed:", err);
    } finally {
      setIsSyncingGroup(false);
    }
  };

  // حالة نافذة تأكيد إرسال الغياب للكل (Confirmation Modal)
  const [absenceConfirmData, setAbsenceConfirmData] = useState<{
    grade: GradeName;
    days: GroupDays;
    absentList: { student: Student; message: string; type: "غائب" }[];
    lateList: { student: Student; message: string; type: "تأخير" }[];
    crossDayList: { student: Student; message: string; type: "عكس_أيام" }[];
    presentCount: number;
    totalStudents: number;
  } | null>(null);
  const [absenceSearchQuery, setAbsenceSearchQuery] = useState("");

  // Success Notification after finishing group
  const [finishedBanner, setFinishedBanner] = useState<{
    grade: GradeName;
    days: GroupDays;
    present: number;
    late: number;
    absent: number;
    crossDay?: number;
    queueItems?: { student: Student; message: string; type: "غائب" | "تأخير" | "عكس_أيام" }[];
  } | null>(null);

  const [scanAlert, setScanAlert] = useState<{
    type: "success" | "warning" | "error";
    title: string;
    message: string;
    student?: Student;
    time?: string;
    status?: string;
    isPaid?: boolean;
    canAcceptMakeup?: boolean;
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // ⚡ Supabase Realtime State: Incoming scans from other assistants in sub-50ms
  const [liveAssistantNotice, setLiveAssistantNotice] = useState<{
    name: string;
    status: string;
    by: string;
    time: string;
  } | null>(null);

  // ⚡ Listen to instant scans across all assistant devices
  useEffect(() => {
    const unsubscribe = subscribeToLiveScans((payload: LiveScanPayload) => {
      setLiveAssistantNotice({
        name: payload.name,
        status: payload.status,
        by: payload.scannedBy || "مساعد آخر",
        time: payload.timeDisplay || "الآن",
      });

      // Automatically dismiss the ticker after 4 seconds
      const timer = setTimeout(() => {
        setLiveAssistantNotice(null);
      }, 4000);

      // Record in local state if student exists
      const targetStudent = (students || []).find(
        (s) => String(s.barcode).trim() === String(payload.barcode).trim()
      );
      if (targetStudent && onRecordAttendance) {
        onRecordAttendance(
          payload.barcode,
          payload.status as "حضور" | "تأخير",
          payload.timeIso,
          targetStudent
        );
      }

      return () => clearTimeout(timer);
    });

    return () => {
      unsubscribe();
    };
  }, [students, onRecordAttendance]);

  // Sync selected group to localStorage
  const handleGradeChange = (grade: GradeName) => {
    setSelectedGrade(grade);
    setFinishedBanner(null);
    setSelectedManualStudent(null);
    if (typeof window !== "undefined") {
      localStorage.setItem("aiman_scanner_grade", grade);
    }
  };

  const handleDaysChange = (days: GroupDays) => {
    setSelectedDays(days);
    setFinishedBanner(null);
    setSelectedManualStudent(null);
    if (typeof window !== "undefined") {
      localStorage.setItem("aiman_scanner_days", days);
    }
  };

  // Keep focus on input for continuous scanning
  useEffect(() => {
    if (!isManualModalOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [scanAlert, isManualModalOpen]);

  const processAttendance = (
    student: Student,
    overrideStatus?: "حضور" | "تأخير"
  ) => {
    setFinishedBanner(null);

    // 1. Strict Grade validation: MUST BE THE EXACT SAME GRADE
    // وميدخلش غير الطلاب الي من نفس الصف الدراسي
    if (student.groupGrade !== selectedGrade) {
      playBeep("error");
      setScanAlert({
        type: "error",
        title: "🚫 غير مسموح: طالب من صف دراسي مختلف!",
        message: `الطالب (${student.name}) مقيد في [${student.groupGrade}]، بينما الحصة الحالية بالقاعة مخصصة لـ [${selectedGrade}]. غير مسموح بدخول طلاب من صفوف أخرى!`,
        student,
      });
      return;
    }

    // 2. Prevent duplicate scan if student is already in the classroom presence list
    const alreadyScanned = (scanLogOrder || []).some(
      (b) => String(b).trim() === String(student.barcode).trim()
    );
    if (alreadyScanned && !overrideStatus) {
      const existingIso = scanLogTimes?.[student.barcode];
      const existingTimeStr = existingIso
        ? new Date(existingIso).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })
        : "";
      const existingStatus = attendanceToday?.[student.barcode] || "حضور";
      playBeep("warning");
      setScanAlert({
        type: "warning",
        title: `⚠️ مسجل بالفعل في القاعة: ${student.name}`,
        message: `الطالب موجود بالقاعة بالفعل وتم تسجيل دخوله بحالة (${existingStatus})${existingTimeStr ? ` في تمام الساعة (${existingTimeStr})` : ""}.`,
        student,
        time: existingTimeStr,
        status: existingStatus,
      });
      return;
    }

    // 3. Record student at entry time & evaluate whether on-time (حضور) or late (تأخير)
    const now = new Date();
    const nowTimeStr = now.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
    const calculatedStatus = overrideStatus || evaluateAttendanceStatus(now, activeSessionSlotId);

    const monthKey = getCurrentMonthKey();
    const isPaid = isStudentPaid(payments?.[monthKey], student.barcode);

    if (onRecordAttendance) {
      onRecordAttendance(student.barcode, calculatedStatus, now.toISOString(), student);
    }

    // 1️⃣ Live Event Pipeline: Instant broadcast to Firestore path `live_events/today`
    pushLiveAttendanceEvent(student.barcode, calculatedStatus, now.getTime());

    // 🔔 Native Background Web Push: Dispatches to parent device even when phone is locked or app is closed
    dispatchPushNotification({
      targetUserIds: [student.barcode, student.parentPhone || "", student.phone || ""].filter(Boolean),
      title:
        calculatedStatus === "حضور"
          ? "🟢 تسجيل حضور في المركز"
          : calculatedStatus === "تأخير"
          ? "⚠️ تنبيه تأخير عن الحصة"
          : "🔴 تنبيه غياب عن الحصة",
      body: `تم تسجيل ${calculatedStatus} للطالب (${student.name}) في مركز الرياضيات (${nowTimeStr}).`,
      type: "attendance",
      tag: `att-${student.barcode}-${nowTimeStr}`,
      eventId: `att-${student.barcode}-${calculatedStatus}-${nowTimeStr}`,
      url: "/?tab=attendance",
    }).catch(() => {});

    // ⚡ Supabase Realtime: Instant broadcast across all assistant screens in <20ms
    broadcastLiveScan({
      barcode: student.barcode,
      name: student.name,
      grade: student.groupGrade,
      days: student.groupDays,
      status: calculatedStatus,
      timeIso: now.toISOString(),
      timeDisplay: nowTimeStr,
      isPaid,
      scannedBy: "الماسح السريع",
      timestamp: Date.now(),
    }).catch(console.warn);

    // ⚡ Supabase Direct Persistence (Zero quota limitations, sub-5ms)
    saveAttendanceToSupabase({
      barcode: student.barcode,
      studentName: student.name,
      status: calculatedStatus,
      timeIso: now.toISOString(),
      scannedBy: "admin",
    }).catch(console.warn);

    playBeep("success");
    speakArabicGreeting(student.name, voiceEnabled);

    const isOfficialDay = isOfficialGroupDay(student.groupDays, now);
    const isCrossDay = student.groupDays !== selectedDays;

    let groupDayNote = `المجموعة: ${student.groupGrade} | ${student.groupDays}`;
    if (!isOfficialDay) {
      groupDayNote = `🔄 حضور تعويضي: اليوم ليس اليوم الرسمي لمجموعة الطالب (${student.groupDays})`;
    } else if (isCrossDay) {
      groupDayNote = `🔄 طالب تعويض أيام لنفس الصف (${student.groupGrade} - ${student.groupDays})`;
    } else {
      groupDayNote = `✅ حضور في اليوم الرسمي للمجموعة (${student.groupGrade} - ${student.groupDays})`;
    }

    setScanAlert({
      type: "success",
      title: calculatedStatus === "تأخير"
        ? `🟡 تسجيل دخول متأخر: ${student.name}`
        : `🟢 أهلاً بك يا ${student.name} (حضور في الموعد)`,
      message: groupDayNote,
      student,
      time: nowTimeStr,
      status: calculatedStatus,
      isPaid,
    });
  };

  const handleClearSessionForCurrentGrade = (resetTodayAttendance = false) => {
    if (onClearSessionScans) {
      onClearSessionScans(selectedGrade, resetTodayAttendance);
    }
    setScanAlert(null);
    setFinishedBanner(null);
    setIsNewSessionModalOpen(false);
    setSessionResetSuccessNotice(
      resetTodayAttendance
        ? `✅ تم بدء حصة جديدة وتصفير شاشة التحضير وحضور اليوم لـ [${selectedGrade}] بنجاح!`
        : `✅ تم تفريغ شاشة التحضير لـ [${selectedGrade}] وبدء حصة جديدة معزولة تماماً!`
    );
    setTimeout(() => {
      setSessionResetSuccessNotice(null);
    }, 4500);
  };

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const barcode = barcodeInput.trim();
    setBarcodeInput("");
    if (!barcode) return;

    const student = studentMap.get(barcode) || students.find((s) => String(s.barcode).trim() === barcode);

    if (!student) {
      playBeep("error");
      setScanAlert({
        type: "error",
        title: "❌ باركود غير مسجل",
        message: `الباركود (${barcode}) غير مسجل في منظومة الطلاب! يرجى إضافة الطالب أولاً.`,
      });
      return;
    }

    processAttendance(student);
  };

  const handleRecordManual = (status: "حضور" | "تأخير", studentToRecord?: Student) => {
    const target = studentToRecord || selectedManualStudent;
    if (!target) return;
    processAttendance(target, status);
    setIsManualModalOpen(false);
    setSelectedManualStudent(null);
    setManualSearchQuery("");
    setOtherDaysSearchQuery("");
  };

  // Handler: Finish and Send Group Attendance - Prepares absence list & opens Confirmation Modal
  const handleFinishGroupClick = () => {
    const groupStudents = (students || []).filter(
      (s) => s.groupGrade === selectedGrade && s.groupDays === selectedDays
    );

    if (groupStudents.length === 0) {
      setSessionResetSuccessNotice("⚠️ لا يوجد طلاب مسجلين في هذه المجموعة حتى الآن!");
      return;
    }

    const absentList: { student: Student; message: string; type: "غائب" }[] = [];
    const lateList: { student: Student; message: string; type: "تأخير" }[] = [];
    const crossDayList: { student: Student; message: string; type: "عكس_أيام" }[] = [];
    let presentCount = 0;

    // طابور الحضور الفعلي بالقاعة الحالية (الطلاب الذين تم مسح كروت دخولهم)
    const queueBarcodeSet = new Set((scanLogOrder || []).map((b) => String(b).trim()));

    groupStudents.forEach((student) => {
      const bCode = String(student.barcode).trim();
      const isPresentInQueue = queueBarcodeSet.has(bCode);

      if (!isPresentInQueue) {
        // الطالب مقيد بهذه المجموعة ولكنه لم يمر على الإسكانر -> غائب
        const msg =
          `تنبيه من منظومة الأستاذة إيمان الدمشيتي 📐\n` +
          `نفيدكم بعلم أن الطالب/ة: (${student.name})\n` +
          `المقيد في الصف: [${student.groupGrade}] - مجموعة: [${student.groupDays}]\n` +
          `قد تغيب اليوم عن حضور حصة الرياضيات (${new Date().toLocaleDateString("ar-EG")}).\n` +
          `نرجو منكم المتابعة والاهتمام حرصاً على مستواه الدراسي وعدم تفويت المنهج.`;
        absentList.push({ student, message: msg, type: "غائب" });
      } else {
        // الطالب مسجل حضور في طابور الحصة
        const currentStatus = attendanceToday?.[student.barcode];
        const timeIso = scanLogTimes?.[student.barcode];
        const timeStr = timeIso
          ? new Date(timeIso).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })
          : "";

        if (currentStatus === "تأخير") {
          const msg =
            `تنبيه من منظومة الأستاذة إيمان الدمشيتي 📐\n` +
            `نفيدكم بعلم أن الطالب/ة: (${student.name})\n` +
            `المقيد في الصف: [${student.groupGrade}] - مجموعة: [${student.groupDays}]\n` +
            `قد حضر اليوم متأخراً عن الموعد المحدد لحصة الرياضيات${timeStr ? ` في تمام الساعة (${timeStr})` : ""}.\n` +
            `يرجى التنبيه على الالتزام بالحضور في الموعد لبدء الشرح في وقته.`;
          lateList.push({ student, message: msg, type: "تأخير" });
        } else {
          presentCount++;
        }
      }
    });

    // الطلاب المسجلين لنفس الصف ولكن في أيام أخرى وحضروا اليوم تعويضياً ومسجلين بالقاعة
    (scanLogOrder || []).forEach((barcode) => {
      const bCode = String(barcode).trim();
      const st = (students || []).find((s) => String(s.barcode).trim() === bCode);
      if (!st) return;
      if (st.groupGrade === selectedGrade && st.groupDays !== selectedDays) {
        const timeIso = scanLogTimes?.[bCode];
        const timeStr = timeIso
          ? new Date(timeIso).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })
          : "";
        const statusToday = attendanceToday?.[bCode] === "تأخير" ? "تأخير" : "حضور";

        const msg =
          `تنبيه من منظومة الأستاذة إيمان الدمشيتي 📐\n` +
          `نفيدكم بعلم أن الطالب/ة: (${st.name})\n` +
          `المقيد في مجموعة: [${st.groupGrade} - ${st.groupDays}]\n` +
          `قد حضر اليوم في مجموعة تعويض الأيام: [${selectedGrade} - ${selectedDays}]\n` +
          `حالة التسجيل: (${statusToday})${timeStr ? ` في تمام الساعة (${timeStr})` : ""}.\n` +
          `تم تسجيل حضوره تعويضياً بنجاح.`;

        crossDayList.push({
          student: st,
          message: msg,
          type: "عكس_أيام",
        });
      }
    });

    // فتح نافذة التأكيد الحوارية مع قائمة الغائبين فقط دون إغلاق المجموعة أو إرسال البيانات فوراً
    setAbsenceSearchQuery("");
    setAbsenceConfirmData({
      grade: selectedGrade,
      days: selectedDays,
      absentList,
      lateList,
      crossDayList,
      presentCount,
      totalStudents: groupStudents.length,
    });
  };

  // إلغاء نافذة التأكيد والعودة للتعديل دون إرسال البيانات أو إغلاق المجموعة
  const handleCancelAbsenceConfirm = () => {
    setAbsenceConfirmData(null);
  };

  // تحويل طالب غائب إلى حاضر مباشرة من داخل نافذة المراجعة قبل الإرسال
  const handleMarkAbsentStudentPresent = (studentToMark: Student) => {
    if (!absenceConfirmData) return;
    const nowIso = new Date().toISOString();
    if (onRecordAttendance) {
      onRecordAttendance(studentToMark.barcode, "حضور", nowIso, studentToMark);
    }
    setAbsenceConfirmData((prev) => {
      if (!prev) return null;
      const updatedAbsentList = prev.absentList.filter(
        (item) => item.student.barcode !== studentToMark.barcode
      );
      return {
        ...prev,
        absentList: updatedAbsentList,
        presentCount: prev.presentCount + 1,
      };
    });
  };

  // تأكيد واعتماد الغياب وإرسال البيانات فعلياً وإغلاق المجموعة
  const handleConfirmAndSendAbsence = () => {
    if (!absenceConfirmData) return;

    const { grade, days, absentList, lateList, crossDayList, presentCount } = absenceConfirmData;

    // 1. Permanently record attendance in today's state and history, and clear group & cross-day from active scanner queue
    if (onFinishGroup) {
      onFinishGroup(grade, days, absentList, lateList, crossDayList);
    }

    // 1️⃣ Live Event Pipeline: Instant broadcast for absent and late students to `live_events/today`
    absentList.forEach((a) => {
      pushLiveAttendanceEvent(a.student.barcode, "غائب", Date.now());
      dispatchPushNotification({
        targetUserIds: [a.student.barcode, a.student.parentPhone || "", a.student.phone || ""].filter(Boolean),
        title: "🔴 تنبيه غياب عن الحصة",
        body: a.message || `نحيطكم علماً بأنه تم تسجيل غياب الطالب (${a.student.name}) عن موعد الحصة اليوم.`,
        type: "absence",
        tag: `abs-${a.student.barcode}-${Date.now()}`,
        eventId: `abs-${a.student.barcode}-${Date.now()}`,
        url: "/?tab=attendance",
      }).catch(() => {});
    });
    lateList.forEach((l) => {
      pushLiveAttendanceEvent(l.student.barcode, "تأخير", Date.now());
      dispatchPushNotification({
        targetUserIds: [l.student.barcode, l.student.parentPhone || "", l.student.phone || ""].filter(Boolean),
        title: "⚠️ تنبيه تأخير عن موعد الحصة",
        body: l.message || `تم تسجيل حضور الطالب (${l.student.name}) متأخراً عن موعد الحصة اليوم.`,
        type: "delay",
        tag: `late-${l.student.barcode}-${Date.now()}`,
        eventId: `late-${l.student.barcode}-${Date.now()}`,
        url: "/?tab=attendance",
      }).catch(() => {});
    });

    // 2. Direct Platform Notifications sent to Firebase platform_messages & notifications collections
    const combinedQueue = [...absentList, ...lateList, ...crossDayList];
    if (combinedQueue.length > 0) {
      enqueuePlatformMessagesBatch(
        combinedQueue.map((item) => ({
          studentBarcode: item.student.barcode,
          studentName: item.student.name,
          grade: item.student.groupGrade,
          phone: item.student.parentPhone || item.student.phone || "",
          messageType: item.type === "غائب" ? "غياب" : item.type === "تأخير" ? "تأخير" : "عكس_أيام",
          title:
            item.type === "غائب"
              ? `إشعار غياب - ${item.student.name}`
              : item.type === "تأخير"
              ? `إشعار تأخير - ${item.student.name}`
              : `إشعار تعويض أيام - ${item.student.name}`,
          message: item.message,
          channel: "in_app",
        }))
      );
    }

    // 3. Set finished banner info
    setFinishedBanner({
      grade,
      days,
      present: presentCount,
      late: lateList.length,
      absent: absentList.length,
      crossDay: crossDayList.length,
      queueItems: combinedQueue as any,
    });
    setScanAlert(null);
    setTableSearch("");
    setSelectedManualStudent(null);

    // إغلاق نافذة التأكيد بعد الاعتماد والإرسال
    setAbsenceConfirmData(null);
  };

  const currentMonthKey = getCurrentMonthKey();

  // Fast O(1) student lookup map to eliminate slow array searches
  const studentMap = useMemo(() => {
    const map = new Map<string, Student>();
    (students || []).forEach((s) => {
      if (s?.barcode) {
        map.set(String(s.barcode).trim(), s);
      }
    });
    return map;
  }, [students]);
  
  // Real-time group counts for active group
  const currentGroupStudents = useMemo(() => {
    return (students || []).filter(
      (s) => s.groupGrade === selectedGrade && s.groupDays === selectedDays
    );
  }, [students, selectedGrade, selectedDays]);

  // Students of the SAME grade but OTHER days (available for makeup attendance)
  const otherDaysSameGradeStudents = useMemo(() => {
    return (students || []).filter(
      (s) => s.groupGrade === selectedGrade && s.groupDays !== selectedDays
    );
  }, [students, selectedGrade, selectedDays]);

  const filteredOtherDaysStudents = useMemo(() => {
    if (!otherDaysSearchQuery.trim()) return otherDaysSameGradeStudents;
    const q = otherDaysSearchQuery.trim().toLowerCase();
    return otherDaysSameGradeStudents.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      s.barcode.toLowerCase().includes(q) ||
      s.parentPhone?.includes(q)
    );
  }, [otherDaysSameGradeStudents, otherDaysSearchQuery]);

  const totalGroupCount = currentGroupStudents.length;

  const currentGroupScanned = useMemo(() => {
    const scanSet = new Set(scanLogOrder || []);
    return currentGroupStudents.filter((s) => scanSet.has(s.barcode));
  }, [currentGroupStudents, scanLogOrder]);

  const currentGroupPresentCount = currentGroupScanned.filter(
    (s) => attendanceToday?.[s.barcode] === "حضور"
  ).length;

  const currentGroupLateCount = currentGroupScanned.filter(
    (s) => attendanceToday?.[s.barcode] === "تأخير"
  ).length;

  // Count makeup students of same grade who scanned today
  const makeupScannedStudents = useMemo(() => {
    return (scanLogOrder || [])
      .map((b) => studentMap.get(String(b).trim()))
      .filter((s): s is Student => !!s && s.groupGrade === selectedGrade && s.groupDays !== selectedDays);
  }, [scanLogOrder, studentMap, selectedGrade, selectedDays]);

  const currentGroupUnscannedCount = totalGroupCount - currentGroupScanned.length;

  // Real-time detection of scans performed in OTHER grades on other devices/phones
  const otherGradesActiveScans = useMemo(() => {
    const counts: Record<string, number> = {};
    (scanLogOrder || []).forEach((barcode) => {
      const s = studentMap.get(String(barcode).trim());
      if (s && s.groupGrade !== selectedGrade) {
        counts[s.groupGrade] = (counts[s.groupGrade] || 0) + 1;
      }
    });
    return Object.entries(counts).map(([grade, count]) => ({
      grade: grade as GradeName,
      count,
    }));
  }, [scanLogOrder, studentMap, selectedGrade]);

  const totalAllScannedToday = (scanLogOrder || []).length;

  // Active Scanned list in the scanner table - strictly for the selected grade only
  const displayedBarcodes = useMemo(() => {
    return (scanLogOrder || []).filter((barcode) => {
      const s = studentMap.get(String(barcode).trim());
      return s && s.groupGrade === selectedGrade;
    });
  }, [scanLogOrder, studentMap, selectedGrade]);

  const filteredBarcodes = useMemo(() => {
    if (!tableSearch.trim()) return displayedBarcodes;
    const q = tableSearch.trim().toLowerCase();
    return displayedBarcodes.filter((barcode) => {
      const s = studentMap.get(String(barcode).trim());
      if (!s) return false;
      return (
        s.name.toLowerCase().includes(q) ||
        s.barcode.toLowerCase().includes(q) ||
        s.parentPhone?.includes(q) ||
        s.groupGrade.toLowerCase().includes(q)
      );
    });
  }, [displayedBarcodes, tableSearch, studentMap]);

  return (
    <div className="space-y-6">
      
      {/* Top Group Selector & Action Bar with Live Multi-Device Sync Indicator */}
      {liveAssistantNotice && (
        <div className="p-3.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 rounded-2xl border border-emerald-400/40 text-white shadow-xl flex items-center justify-between gap-3 animate-fade-in font-tajawal">
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 bg-white/20 rounded-xl">
              <Sparkles className="w-5 h-5 text-amber-300 animate-pulse" />
            </span>
            <div>
              <span className="text-xs text-emerald-200 font-medium">
                ⚡ مسح وارد لحظياً من ({liveAssistantNotice.by}):
              </span>
              <p className="text-sm font-bold">
                تم تسجيل الطالب ({liveAssistantNotice.name}) بحالة [{liveAssistantNotice.status}] في تمام {liveAssistantNotice.time}
              </p>
            </div>
          </div>
          <button
            onClick={() => setLiveAssistantNotice(null)}
            className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded-xl transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="glass-panel p-4 md:p-6 rounded-3xl flex flex-wrap items-center justify-between gap-4 shadow-2xl">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-indigo-500/15 border border-indigo-400/30 px-4 py-2 rounded-2xl shadow-sm">
            <UserCheck className="w-4 h-4 text-indigo-400" />
            <span className="font-tajawal font-bold text-xs md:text-sm text-indigo-200">
              الصف والمجموعة الحالية:
            </span>
          </div>

          <select
            value={selectedGrade}
            onChange={(e) => handleGradeChange(e.target.value as GradeName)}
            className="bg-[#0b1226] border border-indigo-500/30 text-white text-xs md:text-sm font-bold px-4 py-2.5 rounded-2xl outline-none cursor-pointer focus:ring-2 focus:ring-amber-400 shadow-md transition-all font-tajawal"
          >
            {GRADE_ORDER.map((grade) => (
              <option key={grade} value={grade} className="bg-slate-900 text-white font-medium">
                {grade}
              </option>
            ))}
          </select>

          <select
            value={selectedDays}
            onChange={(e) => handleDaysChange(e.target.value as GroupDays)}
            className="bg-[#0b1226] border border-indigo-500/30 text-white text-xs md:text-sm font-bold px-4 py-2.5 rounded-2xl outline-none cursor-pointer focus:ring-2 focus:ring-amber-400 shadow-md transition-all font-tajawal"
          >
            <option value="سبت - إثنين - أربعاء" className="bg-slate-900 text-white">
              سبت - إثنين - أربعاء
            </option>
            <option value="أحد - ثلاثاء - خميس" className="bg-slate-900 text-white">
              أحد - ثلاثاء - خميس
            </option>
          </select>

          {/* Live Multi-Device Indicator Chip */}
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold font-tajawal shadow-sm" title="متصل عبر Supabase Realtime WebSockets: يتم تحديث شاشات كافة المساعدين في أجزاء من الثانية">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
            </span>
            <span className="font-extrabold text-emerald-200">بث حي فوري (Supabase Sub-50ms)</span>
          </div>

          {/* Zero-Quota Group Session Buffer Indicator */}
          <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs font-bold font-tajawal shadow-sm" title="يتم حفظ كل طالب فورياً في الجهاز بدون استهلاك كوتة السحابة، وتُرفع المجموعة كعملية واحدة">
            <span className="w-2 h-2 rounded-full bg-sky-400"></span>
            <span>حضور المجموعة: {displayedBarcodes.length} طالب (عملية واحدة للسحابة)</span>
          </div>
        </div>

        {/* Actions: Start New Session & Finish Group & Single-Op Group Sync */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleManualGroupSync}
            disabled={isSyncingGroup}
            className="px-3.5 py-2.5 rounded-2xl bg-gradient-to-r from-sky-600 via-indigo-600 to-blue-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs md:text-sm font-bold shadow-lg shadow-sky-600/20 flex items-center gap-2 transition-all transform hover:scale-[1.02] active:scale-95 cursor-pointer border border-sky-300/30 font-tajawal disabled:opacity-60"
            title="حفظ وتثبيت كل حضور طلاب هذه المجموعة في السحابة كعملية كتابة واحدة فقط"
          >
            {isSyncingGroup ? (
              <Loader2 className="w-4 h-4 animate-spin text-sky-200" />
            ) : (
              <CloudUpload className="w-4 h-4 text-sky-200" />
            )}
            <span>{isSyncingGroup ? "جاري المزامنة كعملية واحدة..." : "☁️ مزامنة الحصة كعملية واحدة"}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsNewSessionModalOpen(true)}
            className="px-4 py-2.5 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 text-slate-950 text-xs md:text-sm font-black shadow-lg shadow-amber-500/20 flex items-center gap-2 transition-all transform hover:scale-[1.02] active:scale-95 cursor-pointer border border-amber-300/40 font-tajawal"
            title="بدء حصة جديدة وتفريغ شاشة التحضير مع عزل تام عن الحصص السابقة"
          >
            <RotateCcw className="w-4 h-4" />
            <span>🆕 بدء حصة جديدة ({selectedGrade})</span>
          </button>

          <button
            type="button"
            onClick={handleFinishGroupClick}
            className="px-4 py-2.5 rounded-2xl bg-gradient-to-r from-rose-600 via-rose-500 to-amber-500 hover:from-rose-500 hover:to-amber-400 text-white text-xs md:text-sm font-bold shadow-xl shadow-rose-600/25 flex items-center gap-2 transition-all transform hover:scale-[1.02] active:scale-95 cursor-pointer border border-rose-300/30 font-tajawal"
          >
            <Send className="w-4 h-4" />
            <span>🔒 حفظ وإرسال الغياب للكل</span>
          </button>
        </div>
      </div>

      {/* Success Notice for Group Manual Sync */}
      {syncGroupNotice && (
        <div className="bg-sky-950/90 border border-sky-500/50 p-4 rounded-3xl shadow-xl flex items-center justify-between gap-3 text-sky-300 text-xs md:text-sm font-bold font-tajawal animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-sky-400 shrink-0" />
            <span>{syncGroupNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setSyncGroupNotice(null)}
            className="p-1 text-sky-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Success Notice for Session Reset */}
      {sessionResetSuccessNotice && (
        <div className="bg-emerald-950/90 border border-emerald-500/50 p-4 rounded-3xl shadow-xl flex items-center justify-between gap-3 text-emerald-300 text-xs md:text-sm font-bold font-tajawal animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>{sessionResetSuccessNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setSessionResetSuccessNotice(null)}
            className="p-1 text-emerald-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Active Class Session Isolation Bar */}
      <div className="bg-[#0b1224] border border-indigo-500/30 p-3.5 rounded-3xl flex flex-wrap items-center justify-between gap-3 text-xs font-tajawal shadow-lg">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="font-bold text-slate-200">
            الحصة النشطة بالقاعة: <span className="text-amber-300 font-black font-fancy text-sm">{selectedGrade}</span> • <span className="text-indigo-300">{selectedDays}</span>
          </span>
          <span className="bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 px-2.5 py-0.5 rounded-full text-[11px] font-bold">
            شاشة التحضير معزولة ومخصصة لهذا الصف فقط
          </span>
        </div>

        <div className="flex items-center gap-2">
          {displayedBarcodes.length > 0 && (
            <button
              type="button"
              onClick={() => handleClearSessionForCurrentGrade(false)}
              className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-400/30 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
              title="تفريغ شاشة الحضور الحالية لبدء الحصة بدون أي طلاب سابقين"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>تفريغ شاشة الحصة ({displayedBarcodes.length} ظاهر)</span>
            </button>
          )}
        </div>
      </div>

      {/* Finished Group Banner Notice */}
      {finishedBanner && (
        <div className="bg-gradient-to-r from-emerald-950/80 via-[#091e17] to-emerald-950/80 border border-emerald-500/40 p-5 rounded-3xl shadow-2xl flex flex-wrap items-center justify-between gap-4 animate-in fade-in zoom-in-95">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0 shadow-inner">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-base md:text-lg font-bold text-emerald-300 font-fancy">
                ✅ تم حفظ وترحيل سجلات ({finishedBanner.grade} - {finishedBanner.days}) إلى تقرير الحضور اليومي والتقارير السابقة!
              </h3>
              <p className="text-xs md:text-sm text-slate-300 mt-0.5 font-tajawal">
                تم تثبيت: <span className="text-emerald-400 font-bold">{finishedBanner.present} حاضر</span> •{" "}
                <span className="text-amber-400 font-bold">{finishedBanner.late} متأخر</span> •{" "}
                <span className="text-rose-400 font-bold">{finishedBanner.absent} غائب</span>
                {finishedBanner.crossDay ? (
                  <> • <span className="text-cyan-400 font-bold">{finishedBanner.crossDay} تعويض أيام</span></>
                ) : null}. وتم مسح قائمة الحاضرين بالقاعة بنجاح لتكون فارغة وجاهزة للحصة القادمة.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="px-3.5 py-2 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 text-indigo-200 text-xs md:text-sm font-bold flex items-center gap-2 shadow-sm font-tajawal">
              <Bell className="w-4 h-4 text-amber-400" />
              <span>تم إرسال إشعارات المنصة الفورية ({finishedBanner.queueItems?.length || 0} إشعار) بنجاح</span>
            </div>

            {onNavigateToReport && (
              <button
                type="button"
                onClick={onNavigateToReport}
                className="px-4 py-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs md:text-sm transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20 cursor-pointer font-tajawal"
              >
                <FileText className="w-4 h-4" />
                <span>عرض في تقرير الحضور اليومي والسابق</span>
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Live Group Real-time Stats Chips (Bento Grid) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3.5">
        <div className="glass-card p-4 rounded-3xl flex items-center justify-between shadow-lg hover:border-amber-400/40 transition-all duration-300 group">
          <div>
            <div className="text-[11px] text-slate-400 font-medium font-tajawal">إجمالي طلاب المجموعة</div>
            <div className="text-2xl md:text-3xl font-black text-amber-300 font-mono mt-1">{totalGroupCount} <span className="text-xs font-normal text-slate-400">طالب</span></div>
          </div>
          <div className="p-3 bg-amber-500/10 rounded-2xl border border-amber-500/20 group-hover:scale-110 transition-transform">
            <Users className="w-6 h-6 text-amber-400" />
          </div>
        </div>

        <div className="glass-card p-4 rounded-3xl flex items-center justify-between shadow-lg hover:border-emerald-400/40 transition-all duration-300 group">
          <div>
            <div className="text-[11px] text-emerald-400 font-medium font-tajawal">حاضرون من المجموعة</div>
            <div className="text-2xl md:text-3xl font-black text-emerald-400 font-mono mt-1">{currentGroupPresentCount} <span className="text-xs font-normal text-slate-400">طالب</span></div>
          </div>
          <div className="p-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 group-hover:scale-110 transition-transform">
            <CheckCircle2 className="w-6 h-6 text-emerald-400" />
          </div>
        </div>

        <div className="glass-card p-4 rounded-3xl flex items-center justify-between shadow-lg hover:border-cyan-400/40 transition-all duration-300 group">
          <div>
            <div className="text-[11px] text-cyan-400 font-medium font-tajawal">حضور تعويض (أيام أخرى)</div>
            <div className="text-2xl md:text-3xl font-black text-cyan-300 font-mono mt-1">{makeupScannedStudents.length} <span className="text-xs font-normal text-slate-400">طالب</span></div>
          </div>
          <div className="p-3 bg-cyan-500/10 rounded-2xl border border-cyan-500/20 group-hover:scale-110 transition-transform">
            <RefreshCw className="w-6 h-6 text-cyan-400" />
          </div>
        </div>

        <div className="glass-card p-4 rounded-3xl flex items-center justify-between shadow-lg hover:border-amber-400/40 transition-all duration-300 group">
          <div>
            <div className="text-[11px] text-amber-400 font-medium font-tajawal">متأخرون</div>
            <div className="text-2xl md:text-3xl font-black text-amber-400 font-mono mt-1">{currentGroupLateCount} <span className="text-xs font-normal text-slate-400">طالب</span></div>
          </div>
          <div className="p-3 bg-amber-500/10 rounded-2xl border border-amber-500/20 group-hover:scale-110 transition-transform">
            <Clock className="w-6 h-6 text-amber-400" />
          </div>
        </div>

        <div className="glass-card p-4 rounded-3xl flex items-center justify-between shadow-lg hover:border-rose-400/40 transition-all duration-300 group">
          <div>
            <div className="text-[11px] text-rose-400 font-medium font-tajawal">لم يسجلوا (غياب محتمل)</div>
            <div className="text-2xl md:text-3xl font-black text-rose-400 font-mono mt-1">{Math.max(0, currentGroupUnscannedCount)} <span className="text-xs font-normal text-slate-400">طالب</span></div>
          </div>
          <div className="p-3 bg-rose-500/10 rounded-2xl border border-rose-500/20 group-hover:scale-110 transition-transform">
            <XCircle className="w-6 h-6 text-rose-400" />
          </div>
        </div>
      </div>

      {/* Barcode Scanner Input Spotlight & Manual Actions */}
      <div className="max-w-3xl mx-auto text-center space-y-3.5">
        <label className="text-base md:text-lg font-bold text-amber-300 flex items-center justify-center gap-2 font-fancy">
          <Sparkles className="w-5 h-5 text-amber-400" />
          <span>مرر كارت الطالب أمام الإسكانر لتسجيل الحضور الفوري</span>
        </label>

        <form onSubmit={handleScanSubmit} className="flex flex-wrap sm:flex-nowrap gap-2.5">
          <div className="relative flex-1 group min-w-[260px]">
            <input
              ref={inputRef}
              type="text"
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              placeholder="انتظار قراءة الباركود الآلية..."
              autoFocus
              className="w-full bg-[#060a17] border-2 border-indigo-500/40 focus:border-amber-400 text-amber-300 text-center font-mono font-black text-2xl md:text-3xl px-4 py-4 rounded-3xl outline-none focus:ring-4 focus:ring-amber-400/20 shadow-2xl placeholder:text-slate-600 placeholder:text-base transition-all"
            />
            <ScanLine className="w-7 h-7 text-amber-400/70 absolute left-4 top-4 pointer-events-none animate-pulse" />
          </div>

          {/* Button 1: Smart Manual Search */}
          <button
            type="button"
            onClick={() => {
              setManualModalTab("manual_search");
              setIsManualModalOpen(true);
              setManualSearchQuery("");
              setSelectedManualStudent(null);
            }}
            className="px-4 py-3.5 bg-gradient-to-r from-sky-500 to-cyan-400 hover:from-sky-400 hover:to-cyan-300 text-slate-950 font-bold text-xs md:text-sm rounded-3xl shadow-xl shadow-cyan-500/20 transition-all flex items-center gap-2 shrink-0 cursor-pointer border border-cyan-300/40 transform hover:scale-[1.02] active:scale-95 font-tajawal"
            title="بحث بالاسم أو الكود للتحضير اليدوي"
          >
            <PlusCircle className="w-5 h-5" />
            <span>بحث يدوي ذكي</span>
          </button>

          {/* Button 2: Cross-Day Makeup Attendance for Same Grade */}
          <button
            type="button"
            onClick={() => {
              setManualModalTab("other_days");
              setIsManualModalOpen(true);
              setOtherDaysSearchQuery("");
              setSelectedManualStudent(null);
            }}
            className="px-4 py-3.5 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs md:text-sm rounded-3xl shadow-xl shadow-amber-500/20 transition-all flex items-center gap-2 shrink-0 cursor-pointer border border-amber-300/40 transform hover:scale-[1.02] active:scale-95 font-tajawal"
            title="حضور طالب من أيام أخرى لنفس الصف الدراسي"
          >
            <UserPlus className="w-5 h-5" />
            <span>👥 حضور طالب من يوم آخر (تعويض)</span>
          </button>
        </form>
      </div>

      {/* Manual Search & Cross-Day Attendance Modal */}
      {isManualModalOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f1728] border-2 border-amber-500/40 w-full max-w-2xl rounded-3xl p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 max-h-[90vh] flex flex-col">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-amber-500/20 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-amber-300 font-fancy">
                    تسجيل الحضور اليدوي والتعويضي
                  </h3>
                  <p className="text-xs text-slate-400 font-tajawal">
                    الحصة النشطة بالقاعة: <span className="text-amber-300 font-bold">{selectedGrade}</span> ({selectedDays})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsManualModalOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Tab Switcher */}
            <div className="grid grid-cols-2 gap-2 bg-[#080d1a] p-1.5 rounded-2xl border border-indigo-500/25 shrink-0 font-tajawal">
              <button
                type="button"
                onClick={() => {
                  setManualModalTab("manual_search");
                  setSelectedManualStudent(null);
                }}
                className={`py-2.5 px-3 rounded-xl font-bold text-xs md:text-sm flex items-center justify-center gap-2 transition-all ${
                  manualModalTab === "manual_search"
                    ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-md"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Search className="w-4 h-4" />
                <span>🔍 بحث يدوي ذكي (كل الطلاب)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setManualModalTab("other_days");
                  setSelectedManualStudent(null);
                }}
                className={`py-2.5 px-3 rounded-xl font-bold text-xs md:text-sm flex items-center justify-center gap-2 transition-all ${
                  manualModalTab === "other_days"
                    ? "bg-gradient-to-r from-orange-500 to-amber-500 text-slate-950 shadow-md font-black"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Users className="w-4 h-4" />
                <span>🔄 طلاب نفس الصف من الأيام الأخرى ({otherDaysSameGradeStudents.length})</span>
              </button>
            </div>

            {/* Tab 1: General Smart Search */}
            {manualModalTab === "manual_search" && (
              <div className="space-y-4 overflow-y-auto pr-1">
                <div className="space-y-2">
                  <label className="text-xs text-slate-300 font-bold block font-tajawal">
                    ابحث بالاسم (مثال: أحمد علي) أو برقم الهاتف أو الباركود:
                  </label>
                  <StudentSearchBox
                    students={students}
                    value={manualSearchQuery}
                    onChange={(val) => {
                      setManualSearchQuery(val);
                      if (!val) setSelectedManualStudent(null);
                    }}
                    onSelectStudent={(s) => setSelectedManualStudent(s)}
                    placeholder="اكتب اسم الطالب وتجاوز الأسماء الوسطى..."
                    autoFocus
                  />
                </div>

                {selectedManualStudent && (
                  <div className="bg-[#080d17] border border-amber-500/40 p-4 rounded-2xl space-y-3 shadow-lg font-tajawal animate-in fade-in">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="text-base font-black text-amber-300">{selectedManualStudent.name}</h4>
                        <div className="flex items-center gap-2 text-xs text-slate-300 mt-1">
                          <span className="flex items-center gap-1 text-indigo-300 font-bold">
                            <BookOpen className="w-3.5 h-3.5" />
                            {selectedManualStudent.groupGrade}
                          </span>
                          <span>•</span>
                          <span className="text-slate-400">{selectedManualStudent.groupDays}</span>
                        </div>
                      </div>
                      <span className="font-mono text-xs text-amber-300 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
                        #{selectedManualStudent.barcode}
                      </span>
                    </div>

                    {/* Grade & Day Validation Banner */}
                    {selectedManualStudent.groupGrade !== selectedGrade ? (
                      <div className="p-3 bg-rose-500/15 border border-rose-500/40 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                        <span>
                          🚫 <strong>غير مسموح:</strong> الطالب مقيد في [<strong>{selectedManualStudent.groupGrade}</strong>] بينما الحصة الحالية لـ [<strong>{selectedGrade}</strong>]. التحضير التعويضي مسموح فقط لطلاب نفس الصف الدراسي!
                        </span>
                      </div>
                    ) : selectedManualStudent.groupDays !== selectedDays ? (
                      <div className="p-3 bg-amber-500/15 border border-amber-500/40 rounded-xl text-amber-300 text-xs flex items-center gap-2">
                        <RefreshCw className="w-4 h-4 shrink-0 text-amber-400" />
                        <span>
                          🔄 <strong>حضور تعويضي:</strong> الطالب مقيد في أيام [<strong>{selectedManualStudent.groupDays}</strong>] لنفس الصف [<strong>{selectedGrade}</strong>]. سيتم تسجيل حضوره تعويضياً لحصة اليوم.
                        </span>
                      </div>
                    ) : (
                      <div className="p-2.5 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                        <span>طالب مقيد في نفس المجموعة النشطة حالياً.</span>
                      </div>
                    )}

                    {/* Action Buttons (Disabled if different grade) */}
                    {selectedManualStudent.groupGrade === selectedGrade ? (
                      <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-slate-800">
                        <button
                          type="button"
                          onClick={() => handleRecordManual("حضور")}
                          className="py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs md:text-sm transition-all flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/30 cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>
                            {selectedManualStudent.groupDays !== selectedDays
                              ? "تسجيل حضور تعويضي (حضور)"
                              : "تسجيل (حضور)"}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRecordManual("تأخير")}
                          className="py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 text-black font-black text-xs md:text-sm transition-all flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/30 cursor-pointer"
                        >
                          <Clock className="w-4 h-4" />
                          <span>
                            {selectedManualStudent.groupDays !== selectedDays
                              ? "تسجيل حضور تعويضي (تأخير)"
                              : "تسجيل (تأخير)"}
                          </span>
                        </button>
                      </div>
                    ) : (
                      <div className="text-center py-2 text-xs text-rose-400 font-bold bg-slate-900/60 rounded-xl">
                        لا يمكن تحضير طالب من صف دراسي آخر في هذه الحصة
                      </div>
                    )}
                  </div>
                )}

                <div className="text-[11px] text-slate-400 bg-slate-900/80 p-3 rounded-2xl border border-slate-800">
                  💡 يمكنك البحث بالاسم الأول والأخير معاً وسيقوم النظام بمطابقة الطالب فوراً.
                </div>
              </div>
            )}

            {/* Tab 2: Same Grade from Other Days (Direct Cross-Day List) */}
            {manualModalTab === "other_days" && (
              <div className="space-y-3 overflow-hidden flex flex-col flex-1">
                
                {/* Search Bar for Other Days Students */}
                <div className="relative shrink-0">
                  <input
                    type="text"
                    value={otherDaysSearchQuery}
                    onChange={(e) => setOtherDaysSearchQuery(e.target.value)}
                    placeholder={`بحث في طلاب (${selectedGrade}) المقيدين في أيام أخرى...`}
                    className="w-full bg-[#080d1a] border border-amber-500/30 text-xs md:text-sm text-white px-4 py-2.5 pr-9 rounded-2xl outline-none focus:border-amber-400 shadow-inner font-tajawal"
                    autoFocus
                  />
                  <Search className="w-4 h-4 text-amber-400/70 absolute right-3 top-3 pointer-events-none" />
                  {otherDaysSearchQuery && (
                    <button
                      onClick={() => setOtherDaysSearchQuery("")}
                      className="absolute left-3 top-2.5 text-slate-400 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* List of Other-Day Students */}
                <div className="overflow-y-auto space-y-2 flex-1 pr-1 max-h-[340px]">
                  {filteredOtherDaysStudents.length === 0 ? (
                    <div className="text-center p-8 text-slate-400 text-xs md:text-sm font-tajawal space-y-2">
                      <p className="font-bold text-slate-300">
                        {otherDaysSearchQuery
                          ? `لا توجد نتائج مطابقة لـ "${otherDaysSearchQuery}"`
                          : `لا يوجد طلاب مسجلين في الأيام الأخرى لـ (${selectedGrade})`}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        جميع الطلاب المعروضين هنا هم من نفس الصف الدراسي ({selectedGrade}) ومقيدون في أيام مختلفة لتمكين الحضور التعويضي بكل سهولة.
                      </p>
                    </div>
                  ) : (
                    filteredOtherDaysStudents.map((student) => {
                      const isAlreadyAttended = !!attendanceToday?.[student.barcode];
                      const currentStatus = attendanceToday?.[student.barcode];
                      const isPaid = isStudentPaid(payments?.[currentMonthKey], student.barcode);

                      return (
                        <div
                          key={student.barcode}
                          className="bg-[#080d17] border border-indigo-500/25 hover:border-amber-500/40 p-3.5 rounded-2xl flex flex-wrap items-center justify-between gap-3 transition-all font-tajawal"
                        >
                          <div className="flex items-center gap-3 min-w-[200px]">
                            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 font-bold text-xs">
                              #{student.barcode}
                            </div>
                            <div>
                              <h4 className="text-sm font-black text-white flex items-center gap-2">
                                <span>{student.name}</span>
                                {isPaid ? (
                                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.2 rounded">
                                    مدفوع
                                  </span>
                                ) : (
                                  <span className="text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/30 px-1.5 py-0.2 rounded">
                                    مستحق
                                  </span>
                                )}
                              </h4>
                              <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                                <span className="text-amber-300/90 font-medium">
                                  مجموعته الأصلية: {student.groupDays}
                                </span>
                                {student.parentPhone && (
                                  <>
                                    <span>•</span>
                                    <span className="flex items-center gap-1 font-mono text-slate-300">
                                      <Phone className="w-3 h-3 text-emerald-400" />
                                      {student.parentPhone}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Action Buttons / Attended Status */}
                          <div className="flex items-center gap-2 shrink-0">
                            {isAlreadyAttended ? (
                              <div className="flex items-center gap-2 bg-emerald-500/15 border border-emerald-500/30 px-3 py-1.5 rounded-xl text-emerald-300 text-xs font-bold">
                                <CheckCircle2 className="w-4 h-4" />
                                <span>مسجل حاضر اليوم ({currentStatus})</span>
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleRecordManual("حضور", student)}
                                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all flex items-center gap-1 shadow-md shadow-emerald-600/20 cursor-pointer"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>حضور تعويض</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRecordManual("تأخير", student)}
                                  className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-all flex items-center gap-1 shadow-md shadow-amber-500/20 cursor-pointer"
                                >
                                  <Clock className="w-3.5 h-3.5" />
                                  <span>تأخير تعويض</span>
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="text-[11px] text-amber-300/80 bg-amber-500/10 p-2.5 rounded-2xl border border-amber-500/20 text-center font-tajawal shrink-0">
                  ✨ يتيح لك هذا التبويب تحضير أي طالب من نفس الصف ({selectedGrade}) حضر في غير موعده لتعويض حصة سابقة بكل سلاسة ودون التأثير على قيد مجموعته الأصلية.
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* Live Scan Result Spotlight Card */}
      {scanAlert && (
        <div
          className={`max-w-2xl mx-auto p-4 md:p-6 rounded-3xl border transition-all duration-300 shadow-2xl ${
            scanAlert.type === "success"
              ? "glass-panel border-emerald-500/50 text-white"
              : scanAlert.type === "warning"
              ? "bg-amber-950/80 border-amber-500/60 text-amber-200"
              : "bg-rose-900/80 border-rose-500 text-rose-100"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1.5">
              <h3 className="text-lg md:text-xl font-bold font-fancy text-amber-300">{scanAlert.title}</h3>
              <p className="text-xs md:text-sm text-slate-300 font-tajawal">{scanAlert.message}</p>

              {scanAlert.student && (
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <span
                    className={`text-xs px-3 py-1 rounded-full font-bold border font-tajawal ${
                      scanAlert.isPaid
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                        : "bg-rose-500/20 text-rose-300 border-rose-500/40"
                    }`}
                  >
                    {scanAlert.isPaid ? "✅ اشتراك الشهر مدفوع" : "⚠️ اشتراك الشهر مستحق"}
                  </span>

                  {scanAlert.status && (
                    <span
                      className={`text-xs px-3 py-1 rounded-full font-bold border font-tajawal ${
                        scanAlert.status === "تأخير"
                          ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                          : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                      }`}
                    >
                      {scanAlert.status === "تأخير" ? "🟡 تأخير" : "🟢 حضور"}
                    </span>
                  )}

                  {scanAlert.student.customMonthlyFee !== undefined && (
                    <span className="text-xs px-3 py-1 rounded-full font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40 font-tajawal">
                      🏷️ اشتراك مخصص: {scanAlert.student.customMonthlyFee} ج.م
                    </span>
                  )}
                </div>
              )}

              {/* Inline Action for Makeup Acceptance when scanned via barcode */}
              {scanAlert.canAcceptMakeup && scanAlert.student && (
                <div className="pt-3 flex flex-wrap items-center gap-2 font-tajawal">
                  <button
                    type="button"
                    onClick={() => {
                      if (scanAlert.student) {
                        processAttendance(scanAlert.student, "حضور");
                      }
                    }}
                    className="px-4 py-2 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-600/30 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>قبول وتسجيل حضور تعويضي (حضور)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (scanAlert.student) {
                        processAttendance(scanAlert.student, "تأخير");
                      }
                    }}
                    className="px-4 py-2 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-amber-500/30 cursor-pointer"
                  >
                    <Clock className="w-4 h-4" />
                    <span>تسجيل تأخير تعويضي</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setScanAlert(null)}
                    className="px-3 py-2 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs cursor-pointer"
                  >
                    إلغاء
                  </button>
                </div>
              )}
            </div>

            {scanAlert.time && (
              <div className="text-left font-mono font-black text-2xl md:text-3xl text-amber-400 bg-slate-950/80 px-5 py-2.5 rounded-2xl border border-indigo-500/30 shadow-inner">
                {scanAlert.time}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Attendance Scanned Log Table */}
      <div className="glass-panel rounded-3xl p-4 md:p-6 shadow-2xl overflow-hidden space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-indigo-500/20">
          <div className="flex items-center gap-3">
            <h3 className="font-bold text-base md:text-lg text-amber-300 flex items-center gap-2 font-fancy">
              <span>📋 طابور حضور القاعة بالسكانر</span>
              <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs px-3 py-0.5 rounded-full font-bold">
                {filteredBarcodes.length} طالب حاضر
              </span>
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-tajawal">
            {/* Quick Search */}
            <div className="relative">
              <input
                type="text"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="بحث في الحاضرين..."
                className="bg-[#080d1e] border border-indigo-500/30 text-xs text-white px-3 py-2 pr-8 rounded-xl outline-none focus:border-amber-400"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-3 pointer-events-none" />
              {tableSearch && (
                <button
                  onClick={() => setTableSearch("")}
                  className="absolute left-2 top-2.5 text-slate-400 hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Isolated Grade Badge & Clear Session Action */}
            <div className="flex items-center gap-2 bg-[#080d1e] px-3.5 py-1.5 rounded-2xl border border-indigo-500/30 text-xs">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              <span className="font-bold text-slate-300">
                حاضرون حالياً في {selectedGrade}:
              </span>
              <span className="font-mono font-black text-amber-300 text-sm">
                {displayedBarcodes.length}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setIsNewSessionModalOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-slate-950 border border-amber-500/30 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
              title="بدء حصة جديدة وتصفير الشاشة"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>بدء حصة جديدة</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-xs md:text-sm font-tajawal">
            <thead>
              <tr className="bg-slate-900/90 text-amber-400 font-bold border-b border-indigo-500/30">
                <th className="p-3.5">الترتيب</th>
                <th className="p-3.5">الباركود</th>
                <th className="p-3.5">اسم الطالب</th>
                <th className="p-3.5">المرحلة والمجموعة</th>
                <th className="p-3.5">الاشتراك الشهري</th>
                <th className="p-3.5">حالة الدخول</th>
                <th className="p-3.5">وقت التسجيل</th>
                <th className="p-3.5 text-center">إجراءات ومراسلة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-indigo-950/50">
              {filteredBarcodes.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-10 text-center text-slate-400 space-y-2">
                    <p className="text-sm font-bold text-slate-300 font-fancy">
                      في انتظار قراءة أول كارت بالسكانر لهذه الحصة...
                    </p>
                    <p className="text-xs text-slate-500 font-tajawal">
                      مرر كارت الطالب أمام السكانر، أو استخدم "بحث يدوي ذكي" أو "حضور طالب من يوم آخر (تعويض)". وبمجرد الانتهاء اضغط على "حفظ وإرسال الغياب للكل" لترحيل البيانات لتقرير الحضور وتفريغ الشاشة للحصة التالية.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredBarcodes.map((barcode, idx) => {
                  const student = studentMap.get(String(barcode).trim());
                  if (!student) return null;
                  const isPaid = isStudentPaid(payments?.[currentMonthKey], barcode);
                  const statusToday = attendanceToday?.[barcode] || "حضور";
                  const orderNumber = filteredBarcodes.length - idx;
                  const scanTimeIso = scanLogTimes?.[barcode];
                  const formattedTime = scanTimeIso
                    ? new Date(scanTimeIso).toLocaleTimeString("ar-EG", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "--:--";

                  const isCrossDayMakeup = student.groupDays !== selectedDays;

                  return (
                    <tr
                      key={barcode + idx}
                      className="hover:bg-indigo-500/10 transition-colors font-medium"
                    >
                      <td className="p-3.5 font-black text-amber-400 font-mono">#{orderNumber}</td>
                      <td className="p-3.5 font-mono text-slate-300 font-bold">{student.barcode}</td>
                      <td className="p-3.5 font-bold text-white flex items-center gap-2">
                        <span>{student.name}</span>
                        {isCrossDayMakeup && (
                          <span className="text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-full">
                            🔄 تعويض ({student.groupDays})
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 text-slate-300 text-xs">
                        {student.groupGrade} • {student.groupDays}
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`font-bold text-xs px-2.5 py-1 rounded-full ${
                            isPaid
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                              : "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                          }`}
                        >
                          {isPaid ? "✅ مدفوع" : "❌ غير مدفوع"}
                          {student.customMonthlyFee !== undefined && ` (${student.customMonthlyFee} ج)`}
                        </span>
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`font-bold text-xs px-2.5 py-1 rounded-full ${
                            statusToday === "تأخير"
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                              : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                          }`}
                        >
                          {statusToday === "تأخير" ? "🟡 تأخير" : "🟢 حضور"}
                        </span>
                      </td>
                      <td className="p-3.5 font-mono text-slate-300">{formattedTime}</td>
                      <td className="p-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              if (isCrossDayMakeup) {
                                const timeStr = formattedTime !== "--:--" ? ` في تمام الساعة (${formattedTime})` : "";
                                const msg = `تنبيه من منظومة الأستاذة إيمان الدمشيتي 📐\n` +
                                  `نفيدكم بعلم أن الطالب/ة: (${student.name})\n` +
                                  `المقيد في مجموعة: [${student.groupGrade} - ${student.groupDays}]\n` +
                                  `قد حضر اليوم في مجموعة عكس الأيام: [${selectedGrade} - ${selectedDays}]\n` +
                                  `حالة التسجيل: (${statusToday})${timeStr}.\n` +
                                  `تم تسجيل حضوره تعويضياً بنجاح.`;
                                openWhatsApp(student.parentPhone, msg);
                              } else {
                                openWhatsApp(
                                  student.parentPhone,
                                  `السلام عليكم ورحمة الله، نفيدكم بتسجيل حضور الطالب/ة (${student.name}) في حصة الرياضيات.`
                                );
                              }
                            }}
                            className="px-2.5 py-1 rounded-xl bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-white border border-emerald-500/30 text-xs font-bold transition-all inline-flex items-center gap-1 cursor-pointer"
                            title="إرسال رسالة واتساب لولي الأمر"
                          >
                            📲 <span className="hidden sm:inline">واتساب</span>
                          </button>
                          {onRemoveFromScanner && (
                            <button
                              type="button"
                              onClick={() => onRemoveFromScanner(barcode)}
                              className="px-2 py-1 rounded-xl bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white border border-rose-500/30 text-xs font-bold transition-all inline-flex items-center gap-1 cursor-pointer"
                              title="إزالة من قائمة الاسكانر الحالية"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">إزالة</span>
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

        {/* Bottom Report Navigation Link */}
        {onNavigateToReport && (
          <div className="pt-3 border-t border-indigo-500/15 flex items-center justify-between font-tajawal">
            <span className="text-xs text-slate-400">
              💡 لمراجعة سجلات الحضور السابقة والكاملة لكل المجموعات والتواريخ:
            </span>
            <button
              type="button"
              onClick={onNavigateToReport}
              className="text-amber-400 hover:text-amber-300 text-xs font-bold flex items-center gap-1.5 hover:underline cursor-pointer"
            >
              <span>الانتقال إلى تقرير الحضور اليومي والسابق</span>
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* New Session Modal - Full Class & Session Isolation */}
      {isNewSessionModalOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-[#0c1322] border-2 border-amber-500/50 w-full max-w-lg rounded-3xl p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 font-tajawal">
            <div className="flex items-center justify-between pb-3 border-b border-amber-500/20">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-amber-300 font-fancy">
                    بدء حصة جديدة لـ [{selectedGrade}]
                  </h3>
                  <p className="text-xs text-slate-400 font-tajawal">
                    عزل تام لشاشة التحضير عن الحصص السابقة لتفادي أي تداخل أو تهنيج
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNewSessionModalOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-900/90 border border-indigo-500/30 p-4 rounded-2xl space-y-2 text-xs text-slate-300">
              <p className="font-bold text-amber-300">
                💡 كيف ترغب في تهيئة الحصة الحالية؟
              </p>
              <p>
                اختر الإجراء المناسب لضبط شاشة الحضور الخاصة بـ <strong className="text-white">[{selectedGrade}]</strong>:
              </p>
            </div>

            <div className="space-y-3">
              {/* Option 1: Clear screen only */}
              <button
                type="button"
                onClick={() => handleClearSessionForCurrentGrade(false)}
                className="w-full p-4 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950/60 to-slate-900 hover:from-slate-800 hover:to-indigo-900/80 border border-amber-400/40 text-right transition-all group cursor-pointer shadow-md"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-black text-amber-300 text-sm group-hover:text-amber-200">
                    🧹 تفريغ شاشة التحضير للحصة الجديدة (موصى به)
                  </div>
                  <span className="text-[11px] font-bold bg-amber-500/20 text-amber-300 px-2.5 py-0.5 rounded-full">
                    ابدأ من 0 طالب
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  يفرغ قائمة الطلاب الحاضرين على الشاشة الحالية لتبدأ بتمرير كروت هذه الحصة من الصفر، مع بقاء كافة سجلات الحضور السابقة محفوظة بأمان في التقارير.
                </p>
              </button>

              {/* Option 2: Full reset for group today */}
              <button
                type="button"
                onClick={() => handleClearSessionForCurrentGrade(true)}
                className="w-full p-4 rounded-2xl bg-gradient-to-r from-slate-900 via-rose-950/40 to-slate-900 hover:from-slate-800 hover:to-rose-900/60 border border-rose-500/40 text-right transition-all group cursor-pointer shadow-md"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-black text-rose-300 text-sm group-hover:text-rose-200">
                    🔄 تصفير حضور اليوم لطلاب هذا الصف بالكامل
                  </div>
                  <span className="text-[11px] font-bold bg-rose-500/20 text-rose-300 px-2.5 py-0.5 rounded-full">
                    إعادة تحضير
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  يفرغ الشاشة ويعيد حالة جميع طلاب [{selectedGrade}] إلى "غير مسجل"، حتى يمكنك تسجيل حضورهم من جديد اليوم في حال إعادة الحصة أو تصحيحها.
                </p>
              </button>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setIsNewSessionModalOpen(false)}
                className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal - مراجعة وتأكيد إرسال الغياب للكل وعرض الغائبين فقط */}
      {absenceConfirmData && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto font-tajawal">
          <div className="bg-[#0b1224] border-2 border-rose-500/50 w-full max-w-2xl rounded-3xl p-5 sm:p-6 shadow-2xl shadow-rose-950/60 space-y-4 animate-in fade-in zoom-in-95 my-auto max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-rose-500/20 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0 shadow-lg shadow-rose-950/50">
                  <UserX className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-rose-300 font-fancy flex items-center gap-2">
                    <span>مراجعة وتأكيد حصر الغياب</span>
                    <span className="text-xs bg-rose-500/20 text-rose-300 border border-rose-500/40 px-2.5 py-0.5 rounded-full font-bold">
                      {absenceConfirmData.absentList.length} غائب
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    الصف: <strong className="text-amber-300">{absenceConfirmData.grade}</strong> • مجموعة: <strong className="text-indigo-300">{absenceConfirmData.days}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCancelAbsenceConfirm}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                title="إغلاق والعودة للتعديل"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center shrink-0">
              <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-2xl">
                <div className="text-[11px] text-slate-400 font-bold">إجمالي المقيدين</div>
                <div className="text-base font-black text-white">{absenceConfirmData.totalStudents}</div>
              </div>
              <div className="bg-emerald-950/40 border border-emerald-500/30 p-2.5 rounded-2xl">
                <div className="text-[11px] text-emerald-300 font-bold">حاضرون بالطابور</div>
                <div className="text-base font-black text-emerald-400">{absenceConfirmData.presentCount}</div>
              </div>
              <div className="bg-amber-950/40 border border-amber-500/30 p-2.5 rounded-2xl">
                <div className="text-[11px] text-amber-300 font-bold">متأخرون</div>
                <div className="text-base font-black text-amber-400">{absenceConfirmData.lateList.length}</div>
              </div>
              <div className="bg-rose-950/50 border border-rose-500/40 p-2.5 rounded-2xl">
                <div className="text-[11px] text-rose-300 font-bold">الغياب المستحق</div>
                <div className="text-base font-black text-rose-400">{absenceConfirmData.absentList.length}</div>
              </div>
            </div>

            {/* Explanatory Notice */}
            <div className="bg-slate-900/90 border border-indigo-500/30 p-3 rounded-2xl text-xs text-slate-300 flex items-start gap-2.5 shrink-0">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <span className="font-bold text-amber-300">ملاحظة التدقيق: </span>
                الطلاب المعروضون بالأسفل هم فقط الذين <strong className="text-rose-300">لم يمر كارتهم أمام الإسكانر</strong> ولم يدخلوا طابور الحضور. لن يتم إرسال أي بيانات أو إغلاق الحصة حتى تضغط على "تأكيد وإرسال".
              </div>
            </div>

            {/* Absent Students List Header & Search */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-slate-200">
                  قائمة الطلاب الغائبين فقط:
                </span>
                <span className="text-[11px] font-bold text-slate-400">
                  ({absenceConfirmData.absentList.length} طالب)
                </span>
              </div>

              {absenceConfirmData.absentList.length > 3 && (
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    value={absenceSearchQuery}
                    onChange={(e) => setAbsenceSearchQuery(e.target.value)}
                    placeholder="بحث في أسماء الغائبين..."
                    className="w-full sm:w-56 bg-slate-900/90 border border-slate-700 text-white text-xs rounded-xl pr-8 pl-3 py-1.5 outline-none focus:border-rose-400"
                  />
                </div>
              )}
            </div>

            {/* List Body (Scrollable) */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[160px] max-h-[300px]">
              {absenceConfirmData.absentList.length === 0 ? (
                <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-2xl p-6 text-center text-emerald-300 space-y-2">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
                  <div className="font-black text-sm">🎉 رائع! جميع مقيدي هذه المجموعة حاضرون</div>
                  <div className="text-xs text-emerald-400/80">
                    لا يوجد أي طالب غائب اليوم في هذه المجموعة، يمكنك تأكيد الحضور فوراً.
                  </div>
                </div>
              ) : (
                (() => {
                  const filtered = absenceConfirmData.absentList.filter((item) => {
                    if (!absenceSearchQuery.trim()) return true;
                    const q = absenceSearchQuery.trim().toLowerCase();
                    return (
                      item.student.name.toLowerCase().includes(q) ||
                      String(item.student.barcode).includes(q) ||
                      (item.student.phone && item.student.phone.includes(q)) ||
                      (item.student.parentPhone && item.student.parentPhone.includes(q))
                    );
                  });

                  if (filtered.length === 0) {
                    return (
                      <div className="text-center py-6 text-xs text-slate-400">
                        لا توجد نتائج مطابقة لبحثك في قائمة الغائبين.
                      </div>
                    );
                  }

                  return filtered.map((item, idx) => {
                    const st = item.student;
                    return (
                      <div
                        key={st.barcode || idx}
                        className="bg-slate-900/80 hover:bg-slate-800/80 border border-rose-500/20 hover:border-rose-500/40 p-3 rounded-2xl flex flex-wrap items-center justify-between gap-2.5 transition-all shadow-sm"
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 rounded-lg bg-rose-500/20 text-rose-300 font-mono text-xs flex items-center justify-center font-bold">
                            {idx + 1}
                          </span>
                          <div>
                            <div className="font-bold text-white text-xs sm:text-sm flex items-center gap-2">
                              <span>{st.name}</span>
                              <span className="text-[10px] font-mono bg-slate-800 text-amber-300 px-1.5 py-0.5 rounded border border-slate-700">
                                {st.barcode}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                              {st.parentPhone ? (
                                <span className="flex items-center gap-1 font-mono">
                                  <Phone className="w-3 h-3 text-emerald-400" />
                                  ولي الأمر: {st.parentPhone}
                                </span>
                              ) : st.phone ? (
                                <span className="flex items-center gap-1 font-mono">
                                  <Phone className="w-3 h-3 text-slate-400" />
                                  الطالب: {st.phone}
                                </span>
                              ) : (
                                <span className="text-slate-500">لا يوجد هاتف مسجل</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Actions for this absent student */}
                        <div className="flex items-center gap-2 mr-auto">
                          {/* Quick Convert to Present */}
                          <button
                            type="button"
                            onClick={() => handleMarkAbsentStudentPresent(st)}
                            className="px-2.5 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500 text-emerald-300 hover:text-white border border-emerald-500/30 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                            title="تسجيل حضور هذا الطالب الآن واستبعاده من الغياب"
                          >
                            <UserCheck className="w-3.5 h-3.5" />
                            <span>تحويل لحاضر الآن</span>
                          </button>

                          {/* Quick WhatsApp message to parent */}
                          {st.parentPhone && (
                            <button
                              type="button"
                              onClick={() => openWhatsApp(st.parentPhone, item.message)}
                              className="p-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 transition-all cursor-pointer"
                              title="إرسال إشعار واتساب لولي الأمر"
                            >
                              📲
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()
              )}
            </div>

            {/* Footer with the 2 MANDATORY options */}
            <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
              {/* Option 2: إلغاء / العودة للتعديل */}
              <button
                type="button"
                onClick={handleCancelAbsenceConfirm}
                className="w-full sm:w-auto px-5 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs sm:text-sm transition-all cursor-pointer border border-slate-700 flex items-center justify-center gap-2"
              >
                <ArrowRight className="w-4 h-4" />
                <span>إلغاء / العودة للتعديل</span>
              </button>

              {/* Option 1: تأكيد وإرسال */}
              <button
                type="button"
                onClick={handleConfirmAndSendAbsence}
                className="w-full sm:w-auto px-6 py-2.5 rounded-2xl bg-gradient-to-r from-rose-600 via-rose-500 to-amber-500 hover:from-rose-500 hover:to-amber-400 text-white font-black text-xs sm:text-sm shadow-xl shadow-rose-600/30 flex items-center justify-center gap-2 transition-all transform hover:scale-[1.02] active:scale-95 cursor-pointer border border-rose-300/40"
              >
                <Send className="w-4 h-4" />
                <span>تأكيد وإرسال ({absenceConfirmData.absentList.length} غائب)</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
