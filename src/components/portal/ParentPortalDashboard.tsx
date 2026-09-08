import React, { useState, useMemo, useEffect, useRef } from "react";
import { Student, PaymentRecord, GroupDays } from "../../types";
import {
  ParentAccount,
  ParentChatMessage,
  ParentPortalTab,
  AttendanceScheduleLog,
} from "../../types/portal";
import {
  linkChildToParent,
  sendParentChatMessage,
  markChatThreadRead,
  subscribeToThreadChat,
} from "../../utils/portalStorage";
import {
  sendPortalNotification,
  playPortalAudioChime,
  requestNotificationPermission,
  isNotificationSupported,
} from "../../utils/portalNotifications";
import { getTodayKey, getArabicDayName } from "../../utils/helpers";
import { PWAInstallButton } from "./PWAInstallButton";
import {
  User,
  Users,
  CalendarCheck2,
  CalendarDays,
  CreditCard,
  FileCheck2,
  BookOpen,
  MessageSquare,
  Send,
  Sparkles,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  LogOut,
  PlusCircle,
  ChevronDown,
  Award,
  Bell,
  BellRing,
  RotateCcw,
  Receipt,
  Smartphone,
  ExternalLink,
  ShieldCheck,
  Check,
} from "lucide-react";

interface ParentPortalDashboardProps {
  account: ParentAccount;
  students: Student[];
  attendanceHistory: Record<string, Record<string, string>>;
  attendanceToday: Record<string, string>;
  payments: Record<string, Record<string, PaymentRecord>>;
  scanLogTimes: Record<string, string>;
  onLogout: () => void;
  onUpdateAccount: (updated: ParentAccount) => void;
}

export const ParentPortalDashboard: React.FC<ParentPortalDashboardProps> = ({
  account,
  students,
  attendanceHistory,
  attendanceToday,
  payments,
  scanLogTimes,
  onLogout,
  onUpdateAccount,
}) => {
  // Active child barcode state
  const [selectedStudentBarcode, setSelectedStudentBarcode] = useState<string>(
    account.studentBarcode
  );

  // Active navigation tab
  const [activeTab, setActiveTab] = useState<ParentPortalTab>("dashboard");

  // Multi-student modal state
  const [showAddChildModal, setShowAddChildModal] = useState(false);
  const [newChildBarcode, setNewChildBarcode] = useState("");
  const [newChildPhoneOrPass, setNewChildPhoneOrPass] = useState("");
  const [linkFeedback, setLinkFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [isLinking, setIsLinking] = useState(false);

  // Direct Chat states
  const [chatMessages, setChatMessages] = useState<ParentChatMessage[]>([]);
  const [newChatText, setNewChatText] = useState("");
  const [isSendingChat, setIsSendingChat] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Push notification state
  const [hasNotifPerm, setHasNotifPerm] = useState<boolean>(() => {
    return isNotificationSupported() && Notification.permission === "granted";
  });

  // All linked student barcodes (primary + linked)
  const allChildBarcodes = useMemo(() => {
    return Array.from(new Set([account.studentBarcode, ...(account.linkedBarcodes || [])]));
  }, [account]);

  // Current active child student object
  const activeStudent = useMemo(() => {
    return (
      students.find((s) => s.barcode === selectedStudentBarcode) ||
      students.find((s) => s.barcode === account.studentBarcode) || {
        barcode: selectedStudentBarcode,
        name: "طالب مسجل",
        phone: "",
        parentPhone: account.parentPhone,
        groupGrade: "الصف الرابع الابتدائي" as any,
        groupDays: "سبت - إثنين - أربعاء" as GroupDays,
        points: 0,
        totalAttendanceDays: 0,
        totalAbsentDays: 0,
        totalExamScores: [],
      }
    );
  }, [students, selectedStudentBarcode, account]);

  // Real-time chat subscription for the active student's thread
  useEffect(() => {
    const unsub = subscribeToThreadChat(activeStudent.barcode, (msgs) => {
      setChatMessages(msgs);
      // If parent is viewing chat tab, mark admin messages as read
      if (activeTab === "chat") {
        markChatThreadRead(activeStudent.barcode, "parent");
      }
    });

    return () => {
      unsub();
    };
  }, [activeStudent.barcode, activeTab]);

  // Scroll chat to bottom when messages update
  useEffect(() => {
    if (activeTab === "chat") {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
      markChatThreadRead(activeStudent.barcode, "parent");
    }
  }, [chatMessages, activeTab, activeStudent.barcode]);

  // Unread chat messages count from admin
  const unreadChatCount = useMemo(() => {
    return chatMessages.filter((m) => m.sender === "admin" && !m.isRead).length;
  }, [chatMessages]);

  // Request push notification permission
  const handleEnableNotifications = async () => {
    const perm = await requestNotificationPermission();
    if (perm === "granted") {
      setHasNotifPerm(true);
      await sendPortalNotification(
        "منظومة الأستاذة إيمان الدمشيتي",
        `تم تفعيل الإشعارات الصوتية والمباشرة بنجاح لمتابعة الطالب (${activeStudent.name})!`,
        "grade"
      );
    }
  };

  // ----------------------------------------------------
  // CALCULATED METRICS FOR DASHBOARD
  // ----------------------------------------------------

  // 1. Attendance & Absence Rates
  const attendanceRate = useMemo(() => {
    const pres = activeStudent.totalAttendanceDays || 0;
    const abs = activeStudent.totalAbsentDays || 0;
    const total = pres + abs;
    if (total === 0) return 100;
    return Math.round((pres / total) * 100);
  }, [activeStudent]);

  const absenceRate = useMemo(() => {
    return 100 - attendanceRate;
  }, [attendanceRate]);

  // 2. Current Month Payment Status
  const currentMonthKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const currentMonthPayment = useMemo(() => {
    const monthMap = payments[currentMonthKey] || {};
    return monthMap[activeStudent.barcode];
  }, [payments, currentMonthKey, activeStudent.barcode]);

  // 3. Payment History
  const paymentHistoryList = useMemo(() => {
    const list: PaymentRecord[] = [];
    Object.keys(payments).forEach((mKey) => {
      const rec = payments[mKey]?.[activeStudent.barcode];
      if (rec) {
        list.push(rec);
      }
    });
    // Sort descending by date
    return list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [payments, activeStudent.barcode]);

  // 4. Attendance & Absence Logs with Group Schedule Filtering
  // Group A = "سبت - إثنين - أربعاء" (Saturdays, Mondays, Wednesdays)
  // Group B = "أحد - ثلاثاء - خميس" (Sundays, Tuesdays, Thursdays)
  const attendanceScheduleLogs = useMemo(() => {
    const studentGroupDays = activeStudent.groupDays || "سبت - إثنين - أربعاء";
    const isGroupA = studentGroupDays.includes("سبت") || studentGroupDays.includes("إثنين");

    // Helper: is this date an official schedule day for this group?
    const isOfficialDay = (dateStr: string) => {
      const d = new Date(dateStr);
      const dayNum = d.getDay(); // 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
      if (isGroupA) {
        // Sat (6), Mon (1), Wed (3)
        return dayNum === 6 || dayNum === 1 || dayNum === 3;
      } else {
        // Sun (0), Tue (2), Thu (4)
        return dayNum === 0 || dayNum === 2 || dayNum === 4;
      }
    };

    const logs: AttendanceScheduleLog[] = [];

    // Combine history dates and today
    const allDates = new Set<string>([
      ...Object.keys(attendanceHistory),
      getTodayKey(),
    ]);

    const sortedDates = Array.from(allDates).sort((a, b) => b.localeCompare(a));

    sortedDates.forEach((dateStr) => {
      const statusFromHistory = attendanceHistory[dateStr]?.[activeStudent.barcode];
      const statusToday = dateStr === getTodayKey() ? attendanceToday[activeStudent.barcode] : undefined;
      const finalStatus = (statusToday || statusFromHistory) as "حضور" | "تأخير" | "غائب" | "إذن" | undefined;

      const official = isOfficialDay(dateStr);

      // If student attended on a day that is NOT their official schedule, it's a cross-group substitute attendance!
      const isSubstitute = !official && (finalStatus === "حضور" || finalStatus === "تأخير");

      // Show log if:
      // 1. It's an official schedule day (even if status is present or absent)
      // 2. OR it's a cross-group substitute attendance day that the student attended!
      if (official || isSubstitute) {
        logs.push({
          date: dateStr,
          dayName: getArabicDayName(dateStr),
          status: finalStatus || (official ? "غائب" : "غير محدد"),
          timeRecorded: dateStr === getTodayKey() ? scanLogTimes[activeStudent.barcode] : undefined,
          isOfficialScheduledDay: official,
          isSubstituteDay: isSubstitute,
          note: isSubstitute
            ? "حضور تعويضي / بديل (عكس أيام المجموعة الرسمية)"
            : official
            ? "يوم رسمي لجدول المجموعة"
            : undefined,
        });
      }
    });

    return logs;
  }, [activeStudent, attendanceHistory, attendanceToday, scanLogTimes]);

  // 5. Exams and Evaluation Scores
  const examHistoryList = useMemo(() => {
    const list: { title: string; scoreStr: string; pct: number; isLatest?: boolean }[] = [];
    if (activeStudent.lastExamTitle && activeStudent.lastExamScore) {
      // Parse percentage if possible
      const match = activeStudent.lastExamScore.match(/\((\d+)%\)/);
      const pct = match ? parseInt(match[1], 10) : 100;
      list.push({
        title: activeStudent.lastExamTitle,
        scoreStr: activeStudent.lastExamScore,
        pct,
        isLatest: true,
      });
    }

    if (activeStudent.totalExamScores && activeStudent.totalExamScores.length > 0) {
      activeStudent.totalExamScores.forEach((pct, idx) => {
        // Only add historical if not identical latest
        if (list.length === 0 || idx < activeStudent.totalExamScores.length - 1) {
          list.push({
            title: `تقييم دوري #${idx + 1}`,
            scoreStr: `${pct}%`,
            pct,
            isLatest: false,
          });
        }
      });
    }

    return list;
  }, [activeStudent]);

  // 6. Handle Linking another child
  const handleLinkChildSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLinkFeedback(null);
    setIsLinking(true);

    try {
      const res = await linkChildToParent(
        account.studentBarcode,
        newChildBarcode,
        newChildPhoneOrPass,
        students
      );

      if (res.success && res.updatedAccount) {
        setLinkFeedback({ type: "success", msg: res.message });
        onUpdateAccount(res.updatedAccount);
        setSelectedStudentBarcode(newChildBarcode.trim());
        setTimeout(() => {
          setShowAddChildModal(false);
          setNewChildBarcode("");
          setNewChildPhoneOrPass("");
          setLinkFeedback(null);
        }, 1500);
      } else {
        setLinkFeedback({ type: "error", msg: res.message });
      }
    } catch {
      setLinkFeedback({ type: "error", msg: "حدث خطأ أثناء ربط الطالب." });
    } finally {
      setIsLinking(false);
    }
  };

  // 7. Handle sending direct chat message
  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatText.trim() || isSendingChat) return;

    setIsSendingChat(true);
    const text = newChatText.trim();
    setNewChatText("");

    try {
      await sendParentChatMessage(
        activeStudent.barcode,
        "parent",
        `ولي أمر (${activeStudent.name})`,
        text
      );
    } catch (err) {
      console.warn("Failed to send chat:", err);
    } finally {
      setIsSendingChat(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#060812] text-slate-100 font-tajawal selection:bg-amber-500 selection:text-black">
      {/* TOP PORTAL NAVIGATION BAR */}
      <header className="sticky top-0 z-40 bg-slate-900/95 border-b border-amber-500/25 backdrop-blur-md px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Brand & Active Student Badge */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/40 text-amber-400 flex items-center justify-center shadow-lg">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold font-fancy text-white">
                  بوابة أولياء الأمور
                </h1>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[10px] font-bold font-mono">
                  منظومة إيمان
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                الطالب النشط: <strong className="text-amber-300">{activeStudent.name}</strong> ({activeStudent.groupGrade})
              </p>
            </div>
          </div>

          {/* Child Switcher & Actions */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Multi-Student Switcher Pills */}
            {allChildBarcodes.length > 1 ? (
              <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-slate-950/80 border border-slate-800">
                {allChildBarcodes.map((bCode) => {
                  const sObj = students.find((s) => s.barcode === bCode);
                  const isSelected = bCode === selectedStudentBarcode;
                  return (
                    <button
                      key={bCode}
                      type="button"
                      onClick={() => setSelectedStudentBarcode(bCode)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                        isSelected
                          ? "bg-amber-500 text-slate-950 shadow-md font-extrabold"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      <User className="w-3.5 h-3.5" />
                      <span>{sObj?.name?.split(" ")[0] || `طالب ${bCode}`}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {/* Add Another Child Button */}
            <button
              type="button"
              onClick={() => setShowAddChildModal(true)}
              className="px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
              title="ربط ابن آخر بحساب ولي الأمر"
            >
              <PlusCircle className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">إضافة ابن</span>
            </button>

            {/* PWA Install Button */}
            <PWAInstallButton variant="compact" />

            {/* Logout */}
            <button
              type="button"
              onClick={onLogout}
              className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 hover:text-rose-300 transition cursor-pointer"
              title="تسجيل الخروج من البوابة"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* NAVIGATION TABS SCROLLER */}
        <div className="max-w-7xl mx-auto mt-3 pt-2 border-t border-slate-800/80 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          <button
            type="button"
            onClick={() => setActiveTab("dashboard")}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "dashboard"
                ? "bg-amber-500 text-slate-950 font-extrabold shadow-md"
                : "bg-slate-800/60 text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
          >
            <CalendarCheck2 className="w-4 h-4" />
            <span>نظرة عامة والملخص</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("attendance")}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "attendance"
                ? "bg-amber-500 text-slate-950 font-extrabold shadow-md"
                : "bg-slate-800/60 text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
          >
            <CalendarDays className="w-4 h-4" />
            <span>سجل الحضور والغياب</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("financials")}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "financials"
                ? "bg-amber-500 text-slate-950 font-extrabold shadow-md"
                : "bg-slate-800/60 text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
          >
            <CreditCard className="w-4 h-4" />
            <span>السجل المالي والمصروفات</span>
            {currentMonthPayment ? (
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-rose-400" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("exams")}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "exams"
                ? "bg-amber-500 text-slate-950 font-extrabold shadow-md"
                : "bg-slate-800/60 text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
          >
            <FileCheck2 className="w-4 h-4" />
            <span>الاختبارات والتقييمات</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("homework")}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "homework"
                ? "bg-amber-500 text-slate-950 font-extrabold shadow-md"
                : "bg-slate-800/60 text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>الواجبات والتأخيرات</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("chat")}
            className={`relative px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "chat"
                ? "bg-amber-500 text-slate-950 font-extrabold shadow-md"
                : "bg-slate-800/60 text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>محادثة المشرف والإدارة</span>
            {unreadChatCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold animate-bounce">
                {unreadChatCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("profile")}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "profile"
                ? "bg-amber-500 text-slate-950 font-extrabold shadow-md"
                : "bg-slate-800/60 text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
          >
            <User className="w-4 h-4" />
            <span>الملف وإدارة الأبناء</span>
          </button>
        </div>
      </header>

      {/* NOTIFICATION ENABLE BANNER (IF NOT GRANTED) */}
      {!hasNotifPerm && isNotificationSupported() && (
        <div className="bg-gradient-to-r from-amber-500/20 via-indigo-600/20 to-amber-500/20 border-b border-amber-500/30 px-4 py-2.5">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-amber-300">
              <BellRing className="w-4 h-4 text-amber-400 animate-pulse" />
              <span>فعل الإشعارات الفورية والصوتية ليصلك إشعار فوري بحضور أو غياب أو درجات ابنك!</span>
            </div>
            <button
              type="button"
              onClick={handleEnableNotifications}
              className="px-3 py-1 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition cursor-pointer shadow-sm"
            >
              تفعيل الإشعارات الصوتية الآن
            </button>
          </div>
        </div>
      )}

      {/* MAIN CONTENT CONTAINER */}
      <main className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">

        {/* TAB 1: SUMMARY DASHBOARD */}
        {activeTab === "dashboard" && (
          <div className="space-y-6 animate-fadeIn">
            {/* Student Hero Card */}
            <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/40 border border-amber-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
              <div className="absolute -top-12 -left-12 w-48 h-48 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />

              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-3xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-xl">
                    <User className="w-8 h-8" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl sm:text-2xl font-bold font-fancy text-white">
                        {activeStudent.name}
                      </h2>
                      <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-mono font-bold">
                        كود: {activeStudent.barcode}
                      </span>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-300 mt-1">
                      {activeStudent.groupGrade} | المجموعة: <strong className="text-amber-400">{activeStudent.groupDays}</strong>
                    </p>
                  </div>
                </div>

                {/* Points & Excellence Badge */}
                <div className="flex items-center gap-3">
                  <div className="p-3.5 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-center min-w-[100px]">
                    <div className="flex items-center justify-center gap-1 text-amber-400 font-bold text-xs mb-0.5">
                      <Award className="w-4 h-4" />
                      <span>نقاط التميز</span>
                    </div>
                    <span className="text-2xl font-extrabold text-amber-300 font-mono">
                      {activeStudent.points || 0}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* THREE PRIMARY SUMMARY CARDS (Dashboard Required Metrics) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {/* Card 1: Attendance Rate & Absence Rate */}
              <div className="bg-slate-900/90 border border-slate-800 hover:border-emerald-500/40 rounded-3xl p-6 shadow-xl space-y-4 transition">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
                    <CalendarCheck2 className="w-4 h-4 text-emerald-400" />
                    معدل الحضور والالتزام
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono font-bold">
                    {attendanceRate}%
                  </span>
                </div>

                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-3xl font-extrabold text-white font-mono">
                      {attendanceRate}%
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      حضور: <strong className="text-emerald-400">{activeStudent.totalAttendanceDays || 0} يوم</strong> | غياب: <strong className="text-rose-400">{activeStudent.totalAbsentDays || 0} يوم</strong>
                    </p>
                  </div>

                  {/* Circular or pill representation */}
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden flex">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
                    style={{ width: `${attendanceRate}%` }}
                  />
                  <div
                    className="h-full bg-rose-500 transition-all duration-500"
                    style={{ width: `${absenceRate}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>نسبة الغياب: <strong className="text-rose-400">{absenceRate}%</strong></span>
                  <button
                    type="button"
                    onClick={() => setActiveTab("attendance")}
                    className="text-amber-400 hover:underline cursor-pointer"
                  >
                    عرض السجل الكامل ←
                  </button>
                </div>
              </div>

              {/* Card 2: Monthly Payment Status */}
              <div className="bg-slate-900/90 border border-slate-800 hover:border-amber-500/40 rounded-3xl p-6 shadow-xl space-y-4 transition">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
                    <CreditCard className="w-4 h-4 text-amber-400" />
                    حالة اشتراك الشهر الحالي ({currentMonthKey})
                  </span>
                  {currentMonthPayment ? (
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      مدفوع
                    </span>
                  ) : (
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-400 font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      معلق / غير مسجل
                    </span>
                  )}
                </div>

                <div className="space-y-1">
                  {currentMonthPayment ? (
                    <>
                      <div className="text-2xl sm:text-3xl font-extrabold text-emerald-400 font-mono">
                        {currentMonthPayment.amount} ج.م
                      </div>
                      <p className="text-xs text-slate-300">
                        تم السداد بتاريخ: <strong className="text-white">{currentMonthPayment.date}</strong> ({currentMonthPayment.time})
                      </p>
                      {currentMonthPayment.note && (
                        <p className="text-[11px] text-slate-400">
                          ملاحظات: {currentMonthPayment.note}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="text-2xl sm:text-3xl font-extrabold text-rose-400 font-mono">
                        غير مدفوع
                      </div>
                      <p className="text-xs text-slate-300">
                        قيمة الاشتراك الشهري المقررة: <strong className="text-amber-400">{activeStudent.customMonthlyFee || 200} ج.م</strong>
                      </p>
                      <p className="text-[11px] text-slate-400">
                        يرجى السداد مع المساعد أثناء الحصة القادمة لتأكيد الحجز.
                      </p>
                    </>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">سجل المدفوعات السابقة</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab("financials")}
                    className="text-amber-400 hover:underline cursor-pointer"
                  >
                    عرض الفواتير ←
                  </button>
                </div>
              </div>

              {/* Card 3: Latest Exam Grade */}
              <div className="bg-slate-900/90 border border-slate-800 hover:border-sky-500/40 rounded-3xl p-6 shadow-xl space-y-4 transition sm:col-span-2 lg:col-span-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
                    <FileCheck2 className="w-4 h-4 text-sky-400" />
                    آخر درجة تقييم / اختبار
                  </span>
                  {activeStudent.lastExamScore && (
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-400 font-bold">
                      أحدث اختبار
                    </span>
                  )}
                </div>

                <div className="space-y-1">
                  {activeStudent.lastExamScore ? (
                    <>
                      <div className="text-2xl sm:text-3xl font-extrabold text-sky-400 font-mono">
                        {activeStudent.lastExamScore}
                      </div>
                      <p className="text-xs text-slate-300">
                        عنوان الاختبار: <strong className="text-white">{activeStudent.lastExamTitle || "تقييم الرياضيات الأخير"}</strong>
                      </p>
                      <p className="text-[11px] text-slate-400">
                        تم احتساب نقاط تفوق إضافية لحساب الطالب بناء على درجته.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="text-xl font-bold text-slate-400">
                        لم يتم رصد درجات بعد
                      </div>
                      <p className="text-xs text-slate-400">
                        سيتم إشعاركم فورياً عند رصد المعلمة للدرجة القادمة.
                      </p>
                    </>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">إجمالي الاختبارات: {activeStudent.totalExamScores?.length || 0}</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab("exams")}
                    className="text-amber-400 hover:underline cursor-pointer"
                  >
                    كشف الدرجات ←
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Actions & Contact Strip */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Direct message shortcut */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center shrink-0">
                    <MessageSquare className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">تواصل مباشر مع الإدارة والمشرف</h3>
                    <p className="text-xs text-slate-400">راسل معلمة المادة وإدارة المنظومة مباشرة واستلم الردود فورياً.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab("chat")}
                  className="px-4 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition shadow-md whitespace-nowrap cursor-pointer"
                >
                  فتح المحادثة
                </button>
              </div>

              {/* Install PWA Prompt Banner */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                    <Smartphone className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">تطبيق الهاتف الخفيف (PWA)</h3>
                    <p className="text-xs text-slate-400">ثبت المنظومة على الشاشة الرئيسية لتصلك الإشعارات كأي تطبيق أصلي.</p>
                  </div>
                </div>
                <PWAInstallButton variant="compact" />
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: ATTENDANCE & ABSENCE LOGS */}
        {activeTab === "attendance" && (
          <div className="space-y-6 animate-fadeIn">
            {/* Header with Group Schedule Rule Banner */}
            <div className="bg-slate-900/90 border border-amber-500/30 rounded-3xl p-6 shadow-xl space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                    <CalendarDays className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold font-fancy text-white">
                      سجل الحضور والغياب المفلتر لجدول الطالب
                    </h2>
                    <p className="text-xs text-slate-400">
                      مجموعة الطالب: <strong className="text-amber-400">{activeStudent.groupDays}</strong>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
                    حضور: {activeStudent.totalAttendanceDays || 0}
                  </span>
                  <span className="px-3 py-1 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-bold">
                    غياب: {activeStudent.totalAbsentDays || 0}
                  </span>
                </div>
              </div>

              {/* Schedule explanation banner */}
              <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800 text-xs text-slate-300 leading-relaxed flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  <strong>قواعد الجدول المعتمدة:</strong> يتم تصفية السجل آلياً وفقاً لأيام الحضور الرسمية لمجموعة الطالب. وفي حال حضور الطالب في يوم مختلف لتعويض حصة، يتم تمييزه فورياً بوسم <strong>(حضور تعويضي / بديل)</strong> دون الإخلال بجدول مجموعته الرسمي.
                </span>
              </div>
            </div>

            {/* Attendance Records Table */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-bold">
                    <th className="py-3 px-3">اليوم والتاريخ</th>
                    <th className="py-3 px-3">نوع اليوم في الجدول</th>
                    <th className="py-3 px-3 text-center">حالة الحضور</th>
                    <th className="py-3 px-3">وقت التسجيل</th>
                    <th className="py-3 px-3">ملاحظات والتفاصيل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-tajawal">
                  {attendanceScheduleLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        لا توجد سجلات حضور مسجلة حتى الآن لهذا الطالب.
                      </td>
                    </tr>
                  ) : (
                    attendanceScheduleLogs.map((log, idx) => {
                      const isPresent = log.status === "حضور";
                      const isAbsent = log.status === "غائب";
                      const isDelay = log.status === "تأخير";
                      const isExcuse = log.status === "إذن";

                      return (
                        <tr key={idx} className="hover:bg-slate-800/40 transition">
                          <td className="py-3.5 px-3">
                            <div className="font-bold text-white text-sm">{log.dayName}</div>
                            <div className="text-[11px] text-slate-400 font-mono">{log.date}</div>
                          </td>

                          <td className="py-3.5 px-3">
                            {log.isSubstituteDay ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 font-bold text-[11px]">
                                <RotateCcw className="w-3 h-3" />
                                حضور تعويضي (عكس أيام)
                              </span>
                            ) : log.isOfficialScheduledDay ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-800 text-slate-300 text-[11px]">
                                يوم رسمي للمجموعة
                              </span>
                            ) : (
                              <span className="text-slate-500 text-[11px]">يوم خارجي</span>
                            )}
                          </td>

                          <td className="py-3.5 px-3 text-center">
                            {isPresent && (
                              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 font-bold text-xs">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                حضور
                              </span>
                            )}
                            {isAbsent && (
                              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-400 font-bold text-xs">
                                <XCircle className="w-3.5 h-3.5" />
                                غائب
                              </span>
                            )}
                            {isDelay && (
                              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 font-bold text-xs">
                                <Clock className="w-3.5 h-3.5" />
                                تأخير
                              </span>
                            )}
                            {isExcuse && (
                              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-sky-500/20 border border-sky-500/40 text-sky-400 font-bold text-xs">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                إذن مسبق
                              </span>
                            )}
                            {!isPresent && !isAbsent && !isDelay && !isExcuse && (
                              <span className="text-slate-500 font-mono">-</span>
                            )}
                          </td>

                          <td className="py-3.5 px-3 font-mono text-slate-300">
                            {log.timeRecorded || "-"}
                          </td>

                          <td className="py-3.5 px-3 text-slate-400 text-[11px]">
                            {log.note || (isPresent ? "حضر الحصة بانتظام" : isAbsent ? "لم يحضر ولم يقدم عذراً مسبقاً" : "-")}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: FINANCIAL LOGS */}
        {activeTab === "financials" && (
          <div className="space-y-6 animate-fadeIn">
            {/* Top Financial Status Box */}
            <div className="bg-slate-900/90 border border-amber-500/30 rounded-3xl p-6 shadow-xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center">
                    <Receipt className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold font-fancy text-white">
                      السجل المالي وإيصالات الاشتراكات الشهرية
                    </h2>
                    <p className="text-xs text-slate-400">
                      قيمة الاشتراك الشهري المعتمدة للطالب: <strong className="text-amber-400">{activeStudent.customMonthlyFee || 200} ج.م</strong>
                    </p>
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800 text-center">
                  <span className="text-[11px] text-slate-400 block mb-0.5">حالة الشهر الحالي ({currentMonthKey})</span>
                  {currentMonthPayment ? (
                    <span className="text-xs font-bold text-emerald-400 flex items-center justify-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      تم السداد ({currentMonthPayment.amount} ج.م)
                    </span>
                  ) : (
                    <span className="text-xs font-bold text-rose-400 flex items-center justify-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      غير مسدد حتى الآن
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Payments List Table */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-bold">
                    <th className="py-3 px-3">الشهر المستحق</th>
                    <th className="py-3 px-3">المبلغ المسدد</th>
                    <th className="py-3 px-3">تاريخ الدفع</th>
                    <th className="py-3 px-3">وقت الإيصال</th>
                    <th className="py-3 px-3">البيان والملاحظات</th>
                    <th className="py-3 px-3 text-center">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-tajawal">
                  {paymentHistoryList.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        لا توجد إيصالات أو دفعات مسجلة لهذا الطالب بعد.
                      </td>
                    </tr>
                  ) : (
                    paymentHistoryList.map((pay, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40 transition">
                        <td className="py-3.5 px-3 font-mono font-bold text-amber-300 text-sm">
                          {pay.month || pay.monthKey}
                        </td>
                        <td className="py-3.5 px-3 font-mono font-extrabold text-emerald-400 text-sm">
                          {pay.amount} ج.م
                        </td>
                        <td className="py-3.5 px-3 font-mono text-slate-300">
                          {pay.date || "-"}
                        </td>
                        <td className="py-3.5 px-3 font-mono text-slate-400 text-[11px]">
                          {pay.time || "-"}
                        </td>
                        <td className="py-3.5 px-3 text-slate-300 text-xs">
                          {pay.note || "اشتراك شهري"}
                        </td>
                        <td className="py-3.5 px-3 text-center">
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 font-bold text-xs">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            مدفوع وموثق
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: EXAMS & EVALUATIONS */}
        {activeTab === "exams" && (
          <div className="space-y-6 animate-fadeIn">
            {/* Header Card */}
            <div className="bg-slate-900/90 border border-sky-500/30 rounded-3xl p-6 shadow-xl flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/30 text-sky-400 flex items-center justify-center">
                  <FileCheck2 className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold font-fancy text-white">
                    سجل درجات الاختبارات والتقييمات الدورية
                  </h2>
                  <p className="text-xs text-slate-400">
                    رصد فوري لدرجات اختبارات الرياضيات وحساب النسب المئوية آلياً
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="px-4 py-2 rounded-2xl bg-sky-500/10 border border-sky-500/30 text-center">
                  <span className="text-[10px] text-slate-400 block">نقاط التميز</span>
                  <span className="text-xl font-bold text-sky-400 font-mono">{activeStudent.points || 0}</span>
                </div>
              </div>
            </div>

            {/* Exam Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {examHistoryList.length === 0 ? (
                <div className="col-span-full py-12 text-center text-slate-400 bg-slate-900/60 border border-slate-800 rounded-3xl">
                  لا توجد اختبارات مسجلة للطالب حتى الآن.
                </div>
              ) : (
                examHistoryList.map((exam, idx) => {
                  const isHigh = exam.pct >= 90;
                  const isMed = exam.pct >= 75 && exam.pct < 90;

                  return (
                    <div
                      key={idx}
                      className={`bg-slate-900/90 border rounded-3xl p-5 shadow-xl space-y-3 transition ${
                        exam.isLatest
                          ? "border-sky-500/40 shadow-sky-500/10"
                          : "border-slate-800"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white font-fancy">
                          {exam.title}
                        </span>
                        {exam.isLatest && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-400 text-[10px] font-bold">
                            التقييم الأخير
                          </span>
                        )}
                      </div>

                      <div className="flex items-baseline justify-between pt-2">
                        <div className="text-3xl font-extrabold text-sky-400 font-mono">
                          {exam.scoreStr}
                        </div>
                        <span
                          className={`text-xs px-2.5 py-1 rounded-xl font-bold ${
                            isHigh
                              ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-300"
                              : isMed
                              ? "bg-amber-500/20 border border-amber-500/30 text-amber-300"
                              : "bg-rose-500/20 border border-rose-500/30 text-rose-300"
                          }`}
                        >
                          {isHigh ? "ممتاز جداً" : isMed ? "جيد جداً" : "يحتاج متابعة"}
                        </span>
                      </div>

                      {/* Percentage progress bar */}
                      <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-sky-500 to-indigo-500"
                          style={{ width: `${exam.pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 5: HOMEWORK & DELAYS */}
        {activeTab === "homework" && (
          <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="bg-slate-900/90 border border-indigo-500/30 rounded-3xl p-6 shadow-xl flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
                  <BookOpen className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold font-fancy text-white">
                    متابعة الواجبات المدرسية ودقائق التأخير
                  </h2>
                  <p className="text-xs text-slate-400">
                    سجل إنجاز التكليفات المنزلية والالتزام بموعد بدء الحصة
                  </p>
                </div>
              </div>
            </div>

            {/* Info Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Homework Status Card */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-amber-400" />
                    حالة الواجبات المنزلية
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                    منتظم
                  </span>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  يتم التحقق من أداء الواجب المنزلي في بداية كل حصة دراسية. الطلاب الملتزمون يحصلون على نقاط تميز إضافية، بينما يتم إرسال تنبيه في حال عدم إنجاز التكليف.
                </p>

                <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">الواجب الأخير:</span>
                    <span className="font-bold text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      تم الحل بالكامل
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">ملاحظات المعلمة:</span>
                    <span className="text-slate-300">مستوى دقة وتنسيق ممتاز في حل المسائل.</span>
                  </div>
                </div>
              </div>

              {/* Delays Card */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-400" />
                    الالتزام بمواعيد الحصص
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs font-mono">
                    حضور منتظم
                  </span>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  تسجيل وقت الحضور الدقيق عبر سكانر الباركود عند بوابة المركز لتوثيق وقت وصول الطالب بالدقيقة والثانية.
                </p>

                <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">وقت تسجيل اليوم:</span>
                    <span className="font-mono text-amber-300">
                      {scanLogTimes[activeStudent.barcode] || "لم يتم المسح اليوم بعد"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">حالة التأخيرات:</span>
                    <span className="text-emerald-400 font-bold">لا يوجد تأخيرات مسجلة</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: DIRECT CHAT WITH SUPERVISOR / ADMIN */}
        {activeTab === "chat" && (
          <div className="space-y-4 animate-fadeIn">
            {/* Chat Header */}
            <div className="bg-slate-900/95 border border-indigo-500/30 rounded-3xl p-4 sm:p-5 shadow-xl flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    محادثة مباشرة مع المشرف العام والأستاذة إيمان
                  </h3>
                  <p className="text-xs text-slate-400">
                    بخصوص الطالب: <strong className="text-amber-400">{activeStudent.name}</strong>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  مباشر
                </span>
              </div>
            </div>

            {/* Chat Box */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-2xl flex flex-col h-[500px]">
              {/* Messages Scroll Area */}
              <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 pl-1">
                {chatMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400 space-y-2">
                    <MessageSquare className="w-10 h-10 text-slate-600 mb-1" />
                    <p className="text-sm font-bold text-slate-300">لا توجد رسائل سابقة في هذه المحادثة</p>
                    <p className="text-xs text-slate-500 max-w-sm">
                      يمكنك كتابة أي استفسار أو ملاحظة للمعلمة أو الإدارة وسيرد المشرف في أقرب وقت.
                    </p>
                  </div>
                ) : (
                  chatMessages.map((msg) => {
                    const isParent = msg.sender === "parent";
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${
                          isParent ? "items-end" : "items-start"
                        }`}
                      >
                        <div
                          className={`max-w-[85%] sm:max-w-[75%] rounded-3xl p-3.5 sm:p-4 text-xs sm:text-sm shadow-md leading-relaxed ${
                            isParent
                              ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-medium rounded-br-none"
                              : "bg-slate-800/90 border border-slate-700/80 text-white rounded-bl-none"
                          }`}
                        >
                          <div className="text-[10px] font-bold opacity-75 mb-1">
                            {msg.senderName}
                          </div>
                          <div className="whitespace-pre-wrap">{msg.text}</div>
                          <div
                            className={`text-[9px] mt-1.5 flex items-center justify-end gap-1 opacity-70 ${
                              isParent ? "text-slate-900 font-mono" : "text-slate-400 font-mono"
                            }`}
                          >
                            <span>{msg.timeFormatted}</span>
                            {isParent && (
                              <span>{msg.isRead ? "✓✓ تمت القراءة" : "✓ مرسلة"}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={chatBottomRef} />
              </div>

              {/* Chat Input Bar */}
              <form onSubmit={handleSendChat} className="pt-3 border-t border-slate-800 flex items-center gap-2">
                <input
                  type="text"
                  value={newChatText}
                  onChange={(e) => setNewChatText(e.target.value)}
                  placeholder="اكتب رسالتك للمشرف والمعلمة هنا..."
                  className="flex-1 px-4 py-3 rounded-2xl bg-slate-950/80 border border-slate-700/80 focus:border-amber-400 focus:outline-none text-white text-xs sm:text-sm"
                />
                <button
                  type="submit"
                  disabled={!newChatText.trim() || isSendingChat}
                  className="p-3 rounded-2xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 transition shadow-md cursor-pointer flex items-center justify-center shrink-0"
                  title="إرسال الرسالة"
                >
                  <Send className="w-5 h-5 -rotate-90" />
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 7: PROFILE & MULTI-CHILDREN MANAGEMENT */}
        {activeTab === "profile" && (
          <div className="space-y-6 animate-fadeIn max-w-2xl mx-auto">
            <div className="bg-slate-900/90 border border-amber-500/30 rounded-3xl p-6 shadow-xl space-y-6">
              <div className="flex items-center gap-4 pb-4 border-b border-slate-800">
                <div className="w-14 h-14 rounded-3xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center">
                  <User className="w-7 h-7" />
                </div>
                <div>
                  <h2 className="text-lg font-bold font-fancy text-white">
                    الملف الشخصي لولي الأمر
                  </h2>
                  <p className="text-xs text-slate-400">
                    رقم الهاتف المسجل: <strong className="text-white font-mono">{account.parentPhone}</strong>
                  </p>
                </div>
              </div>

              {/* Linked Children List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Users className="w-4 h-4 text-amber-400" />
                    الأبناء المرتبطون بهذا الحساب ({allChildBarcodes.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowAddChildModal(true)}
                    className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>إضافة ابن آخر</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {allChildBarcodes.map((bCode) => {
                    const st = students.find((s) => s.barcode === bCode);
                    const isCurrent = bCode === selectedStudentBarcode;
                    return (
                      <div
                        key={bCode}
                        className={`p-4 rounded-2xl border flex items-center justify-between gap-3 ${
                          isCurrent
                            ? "bg-amber-500/10 border-amber-500/40"
                            : "bg-slate-950/60 border-slate-800"
                        }`}
                      >
                        <div>
                          <div className="text-sm font-bold text-white flex items-center gap-2">
                            <span>{st?.name || `طالب ${bCode}`}</span>
                            {bCode === account.studentBarcode && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
                                الطالب الأساسي
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            كود: <span className="font-mono text-slate-300">{bCode}</span> | {st?.groupGrade}
                          </p>
                        </div>

                        {isCurrent ? (
                          <span className="text-xs font-bold text-amber-400">النشط حالياً</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedStudentBarcode(bCode);
                              setActiveTab("dashboard");
                            }}
                            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition cursor-pointer"
                          >
                            عرض بياناته
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Notification Settings in Profile */}
              <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Bell className="w-4 h-4 text-amber-400" />
                    الإشعارات والتنبيهات الصوتية
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    تلقي رنين صوتي وإشعار فوري عند مسح الحضور أو إضافة درجات
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleEnableNotifications}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-bold border border-slate-700 transition cursor-pointer"
                >
                  {hasNotifPerm ? "الإشعارات مفعلة ✓" : "تفعيل الإشعارات"}
                </button>
              </div>

              {/* PWA App Install in Profile */}
              <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Smartphone className="w-4 h-4 text-amber-400" />
                    تطبيق PWA للأجهزة الذكية
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    يعمل كتطبيق أصلي سريع بدون الحاجة لفتح المتصفح
                  </p>
                </div>
                <PWAInstallButton variant="compact" />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* MODAL: ADD / LINK ANOTHER CHILD */}
      {showAddChildModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-md rounded-3xl bg-slate-900 border border-amber-500/30 p-6 shadow-2xl space-y-4 text-right">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white font-fancy">
                ربط ابن آخر بحسابك
              </h3>
              <button
                onClick={() => {
                  setShowAddChildModal(false);
                  setLinkFeedback(null);
                }}
                className="text-slate-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              أدخل كود باركود الابن الإضافي ورقم هاتف ولي الأمر المسجل له للتحقق وربط حسابه بحسابك لتتنقل بينهما بنقرة واحدة.
            </p>

            {linkFeedback && (
              <div
                className={`p-3 rounded-2xl text-xs flex items-start gap-2 ${
                  linkFeedback.type === "success"
                    ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-300"
                    : "bg-rose-500/15 border border-rose-500/30 text-rose-300"
                }`}
              >
                {linkFeedback.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                )}
                <span>{linkFeedback.msg}</span>
              </div>
            )}

            <form onSubmit={handleLinkChildSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  كود باركود الطالب المراد ربطه
                </label>
                <input
                  type="text"
                  required
                  dir="ltr"
                  value={newChildBarcode}
                  onChange={(e) => setNewChildBarcode(e.target.value)}
                  placeholder="مثال: 1005"
                  className="w-full px-4 py-2.5 rounded-2xl bg-slate-950/70 border border-slate-700 focus:border-amber-400 focus:outline-none text-white text-xs font-mono text-center"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  رقم هاتف ولي الأمر المسجل للطالب (أو كلمة مرور حسابه)
                </label>
                <input
                  type="text"
                  required
                  dir="ltr"
                  value={newChildPhoneOrPass}
                  onChange={(e) => setNewChildPhoneOrPass(e.target.value)}
                  placeholder="رقم الهاتف أو كلمة المرور"
                  className="w-full px-4 py-2.5 rounded-2xl bg-slate-950/70 border border-slate-700 focus:border-amber-400 focus:outline-none text-white text-xs font-mono text-center"
                />
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={isLinking}
                  className="flex-1 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition shadow-md cursor-pointer disabled:opacity-50"
                >
                  {isLinking ? "جاري التحقق والربط..." : "تأكيد الربط"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddChildModal(false);
                    setLinkFeedback(null);
                  }}
                  className="px-4 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
