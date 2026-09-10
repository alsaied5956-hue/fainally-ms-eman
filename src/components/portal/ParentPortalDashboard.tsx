import React, { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Student, PaymentRecord, GroupDays, GradeName } from "../../types";
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
import { markEventProcessed, SESSION_START_TIME } from "../../utils/notificationTracker";
import { registerPushSubscription } from "../../services/pushNotificationService";
import {
  getTodayKey,
  getArabicDayName,
  DEFAULT_GRADE_PRICES,
  isOfficialGroupDay,
  generateScheduledDateSeries,
  resolveEffectiveGroupForDate,
} from "../../utils/helpers";
import { printElement } from "../../utils/print";
import { loadLocalData } from "../../utils/storage";
import { PWAInstallButton } from "./PWAInstallButton";
import { NotificationPermissionModal } from "./NotificationPermissionModal";
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
  Printer,
  FileText,
  Filter,
  Eye,
  X,
} from "lucide-react";

interface ParentPortalDashboardProps {
  account: ParentAccount;
  students: Student[];
  attendanceHistory: Record<string, Record<string, string>>;
  attendanceToday: Record<string, string>;
  payments: Record<string, Record<string, PaymentRecord>>;
  scanLogTimes: Record<string, string>;
  groupPrices?: Record<GradeName, number>;
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
  groupPrices,
  onLogout,
  onUpdateAccount,
}) => {
  // Active child barcode state
  const [selectedStudentBarcode, setSelectedStudentBarcode] = useState<string>(
    account.studentBarcode
  );

  // Active navigation tab (reads ?tab=... from notification click if present)
  const [activeTab, setActiveTab] = useState<ParentPortalTab>(() => {
    if (typeof window !== "undefined") {
      try {
        const urlTab = new URLSearchParams(window.location.search).get("tab");
        const validTabs: ParentPortalTab[] = [
          "dashboard",
          "attendance",
          "financials",
          "exams",
          "homework",
          "chat",
          "profile",
        ];
        if (urlTab && validTabs.includes(urlTab as ParentPortalTab)) {
          return urlTab as ParentPortalTab;
        }
      } catch {}
    }
    return "dashboard";
  });

  // Listen to popstate / location changes from notification clicks
  useEffect(() => {
    const handleUrlChange = () => {
      try {
        const urlTab = new URLSearchParams(window.location.search).get("tab");
        const validTabs: ParentPortalTab[] = [
          "dashboard",
          "attendance",
          "financials",
          "exams",
          "homework",
          "chat",
          "profile",
        ];
        if (urlTab && validTabs.includes(urlTab as ParentPortalTab)) {
          setActiveTab(urlTab as ParentPortalTab);
        }
      } catch {}
    };

    window.addEventListener("popstate", handleUrlChange);
    return () => window.removeEventListener("popstate", handleUrlChange);
  }, []);

  // Emergency safety listener: if account is remotely revoked/deleted, logout immediately
  useEffect(() => {
    const handleRemoteRevoke = (ev: Event) => {
      const customEv = ev as CustomEvent;
      const myBarcode = String(account.studentBarcode).trim();
      const targetBarcode = String(customEv.detail?.barcode || "").trim();
      if (!targetBarcode || targetBarcode === myBarcode) {
        onLogout();
      }
    };

    window.addEventListener("eman_account_revoked", handleRemoteRevoke);
    return () => {
      window.removeEventListener("eman_account_revoked", handleRemoteRevoke);
    };
  }, [account.studentBarcode, onLogout]);

  // Financial Sub-Tab: "ledger" (full academic year) vs "receipts" (recorded receipts)
  const [activeFinancialSubTab, setActiveFinancialSubTab] = useState<"ledger" | "receipts">("ledger");

  // Printable / Viewable Receipt Modal State
  const [selectedReceiptForModal, setSelectedReceiptForModal] = useState<{
    monthLabel: string;
    monthKey: string;
    payRecord: PaymentRecord;
  } | null>(null);

  // Attendance filter state: "all", "present", "absent", "substitute"
  const [attendanceFilter, setAttendanceFilter] = useState<"all" | "present" | "absent" | "substitute">("all");

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

  // Mandatory Notification Onboarding Modal (pops up at runtime if permission is not granted)
  const [showNotifModal, setShowNotifModal] = useState<boolean>(() => {
    if (typeof window === "undefined" || !isNotificationSupported()) return false;
    const dismissed = sessionStorage.getItem("eman_notif_modal_dismissed");
    return Notification.permission !== "granted" && dismissed !== "true";
  });

  // All linked student barcodes (primary + linked)
  const allChildBarcodes = useMemo(() => {
    return Array.from(new Set([account.studentBarcode, ...(account.linkedBarcodes || [])]));
  }, [account]);

  // Current active child student object
  const activeStudent = useMemo(() => {
    const target = String(selectedStudentBarcode || account.studentBarcode).trim();
    let s =
      students.find((item) => String(item.barcode).trim() === target) ||
      students.find((item) => String(item.barcode).trim() === String(account.studentBarcode).trim());

    if (!s) {
      const local = loadLocalData();
      if (local?.students) {
        s =
          local.students.find((item) => String(item.barcode).trim() === target) ||
          local.students.find((item) => String(item.barcode).trim() === String(account.studentBarcode).trim());
      }
    }

    if (!s && !isNaN(Number(target))) {
      const num = Number(target);
      s = students.find((item) => Number(item.barcode) === num);
      if (!s) {
        const local = loadLocalData();
        if (local?.students) {
          s = local.students.find((item) => Number(item.barcode) === num);
        }
      }
    }

    return (
      s || {
        barcode: target,
        name: account.studentName || "طالب مسجل",
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

  // Auto-subscribe to Web Push in background if permission is already granted
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      const allAliases = Array.from(
        new Set([
          account.studentBarcode,
          ...(account.linkedBarcodes || []),
          account.parentPhone,
          activeStudent.barcode,
          activeStudent.parentPhone,
          activeStudent.phone,
        ])
      ).filter(Boolean) as string[];

      const targetId = activeStudent.barcode || account.parentPhone;
      if (targetId) {
        registerPushSubscription(targetId, "parent", allAliases).catch(() => {});
      }
    }
  }, [activeStudent.barcode, account.parentPhone, account.studentBarcode, account.linkedBarcodes]);

  // Request push notification permission from modal
  const handleRequestPermissionFromModal = async (): Promise<NotificationPermission> => {
    const allAliases = Array.from(
      new Set([
        account.studentBarcode,
        ...(account.linkedBarcodes || []),
        account.parentPhone,
        activeStudent.barcode,
        activeStudent.parentPhone,
        activeStudent.phone,
      ])
    ).filter(Boolean) as string[];

    const targetId = activeStudent.barcode || account.parentPhone;
    const perm = await requestNotificationPermission(targetId, "parent", allAliases);
    if (perm === "granted") {
      setHasNotifPerm(true);
      sessionStorage.removeItem("eman_notif_modal_dismissed");
    }
    return perm;
  };

  const handleCloseNotifModal = () => {
    setShowNotifModal(false);
    sessionStorage.setItem("eman_notif_modal_dismissed", "true");
  };

  // Request push notification permission / open onboarding modal
  const handleEnableNotifications = () => {
    setShowNotifModal(true);
  };

  // Pre-seed and silence historical records on initial session startup
  // This completely stops past messages, payments, or attendance from spamming on app open!
  const hasPreSeededSessionRef = useRef(false);
  useEffect(() => {
    if (hasPreSeededSessionRef.current) return;
    hasPreSeededSessionRef.current = true;

    const todayStr = getTodayKey();

    // 1. Mark existing today's attendance as seen
    allChildBarcodes.forEach((b) => {
      const status = attendanceToday[b];
      if (status) {
        const time = scanLogTimes[b] || "";
        markEventProcessed(`att-${b}-${todayStr}-${status}-${time}`);
      }
    });

    // 2. Mark existing payments as seen
    allChildBarcodes.forEach((b) => {
      Object.keys(payments || {}).forEach((mKey) => {
        const rec = payments[mKey]?.[b];
        if (rec) {
          markEventProcessed(`pay-${b}-${rec.month || rec.monthKey || mKey}-${rec.amount}-${rec.date || ""}`);
        }
      });
    });

    // 3. Mark existing exams as seen
    students.forEach((s) => {
      (s.totalExamScores || []).forEach((score, idx) => {
        markEventProcessed(`exam-${s.barcode}-${s.lastExamTitle || "exam"}-${score}-${idx}`);
      });
    });

    // 4. Mark existing chat messages as seen for audio notification
    chatMessages.forEach((msg) => {
      markEventProcessed(`chat-${msg.id}`);
    });
  }, [allChildBarcodes, attendanceToday, scanLogTimes, payments, students, chatMessages]);

  // 1. Live Attendance Status Alert Tracking (Genuine real-time scans only)
  const prevAttendanceRef = useRef<Record<string, string>>({});
  const isInitialAttendanceMount = useRef(true);

  useEffect(() => {
    if (isInitialAttendanceMount.current) {
      isInitialAttendanceMount.current = false;
      const initialMap: Record<string, string> = {};
      allChildBarcodes.forEach((b) => {
        initialMap[b] = attendanceToday[b] || "";
      });
      prevAttendanceRef.current = initialMap;
      return;
    }

    const todayKey = getTodayKey();

    allChildBarcodes.forEach((barcode) => {
      const currentStatus = attendanceToday[barcode] || "";
      const prevStatus = prevAttendanceRef.current[barcode] || "";

      if (currentStatus && currentStatus !== prevStatus) {
        const studentObj = students.find((s) => s.barcode === barcode);
        const sName = studentObj?.name || "الطالب";
        const scanTime = scanLogTimes[barcode] || "";
        const eventId = `att-${barcode}-${todayKey}-${currentStatus}-${scanTime}`;

        if (currentStatus === "حضور") {
          sendPortalNotification(
            "🟢 تسجيل حضور في المركز",
            `تم تسجيل وصول وحضور الطالب (${sName}) في المركز بنجاح! ${scanTime ? `(الوقت: ${scanTime})` : ""}`,
            "attendance",
            { eventId, url: "/?tab=attendance" }
          );
        } else if (currentStatus === "تأخير") {
          sendPortalNotification(
            "⚠️ تنبيه تأخير عن موعد الحصة",
            `تم تسجيل حضور الطالب (${sName}) متأخراً عن موعد بداية الحصة الرسمي. ${scanTime ? `(الوقت: ${scanTime})` : ""}`,
            "delay",
            { eventId, url: "/?tab=attendance" }
          );
        } else if (currentStatus === "غياب") {
          sendPortalNotification(
            "🔴 تنبيه غياب عن الحصة",
            `نحيطكم علماً بأنه تم تسجيل غياب الطالب (${sName}) عن موعد حصة اليوم.`,
            "absence",
            { eventId, url: "/?tab=attendance" }
          );
        }
      }

      prevAttendanceRef.current[barcode] = currentStatus;
    });
  }, [attendanceToday, allChildBarcodes, students, scanLogTimes]);

  // 2. Live Payment Alert Tracking (Genuine new receipts only)
  const prevPaymentsMapRef = useRef<Record<string, number>>({});
  const isInitialPaymentsMount = useRef(true);

  useEffect(() => {
    const countStudentPaidMonths = (bCode: string) => {
      let count = 0;
      Object.keys(payments || {}).forEach((mKey) => {
        if (payments[mKey]?.[bCode]) count++;
      });
      return count;
    };

    if (isInitialPaymentsMount.current) {
      isInitialPaymentsMount.current = false;
      const initialMap: Record<string, number> = {};
      allChildBarcodes.forEach((b) => {
        initialMap[b] = countStudentPaidMonths(b);
      });
      prevPaymentsMapRef.current = initialMap;
      return;
    }

    allChildBarcodes.forEach((barcode) => {
      const currentCount = countStudentPaidMonths(barcode);
      const prevCount = prevPaymentsMapRef.current[barcode] || 0;

      if (currentCount > prevCount) {
        const studentObj = students.find((s) => s.barcode === barcode);
        const sName = studentObj?.name || "الطالب";

        let latestRec: PaymentRecord | undefined;
        Object.keys(payments || {}).forEach((mKey) => {
          const rec = payments[mKey]?.[barcode];
          if (rec) {
            if (!latestRec || (rec.date && rec.date > (latestRec.date || ""))) {
              latestRec = rec;
            }
          }
        });

        if (latestRec) {
          const monthTitle = latestRec.month || latestRec.monthKey;
          const eventId = `pay-${barcode}-${monthTitle}-${latestRec.amount}-${latestRec.date || ""}`;
          sendPortalNotification(
            "💳 تأكيد سداد المصروفات",
            `تم استلام سداد اشتراك شهر (${monthTitle}) للطالب (${sName}) بمبلغ ${latestRec.amount} ج.م بنجاح.`,
            "fee",
            { eventId, url: "/?tab=payments" }
          );
        }
      }

      prevPaymentsMapRef.current[barcode] = currentCount;
    });
  }, [payments, allChildBarcodes, students]);

  // 3. Live Exam Grade Alert Tracking (Genuine newly published results only)
  const prevExamCountRef = useRef<Record<string, number>>({});
  const isInitialExamsMount = useRef(true);

  useEffect(() => {
    if (isInitialExamsMount.current) {
      isInitialExamsMount.current = false;
      const initialMap: Record<string, number> = {};
      allChildBarcodes.forEach((b) => {
        const s = students.find((st) => st.barcode === b);
        initialMap[b] = s?.totalExamScores?.length || 0;
      });
      prevExamCountRef.current = initialMap;
      return;
    }

    allChildBarcodes.forEach((barcode) => {
      const studentObj = students.find((s) => s.barcode === barcode);
      const scores = studentObj?.totalExamScores || [];
      const currentCount = scores.length;
      const prevCount = prevExamCountRef.current[barcode] || 0;

      if (currentCount > prevCount && scores.length > 0) {
        const latestExam = scores[scores.length - 1];
        const sName = studentObj?.name || "الطالب";
        const examTitle = studentObj?.lastExamTitle || "امتحان الرياضيات";
        const eventId = `exam-${barcode}-${examTitle}-${latestExam}-${Date.now()}`;

        sendPortalNotification(
          "📝 نتيجة اختبار جديدة",
          `حصل الطالب (${sName}) على نتيجة اختبار: ${studentObj?.lastExamScore || `${latestExam}%`}`,
          "grade",
          { eventId, url: "/?tab=exams" }
        );
      }

      prevExamCountRef.current[barcode] = currentCount;
    });
  }, [students, allChildBarcodes]);

  // 4. Live Chat Alert Tracking:
  // Pre-seeds existing messages on initial thread load so historical/already-read messages NEVER replay!
  // Only genuine, fresh incoming admin messages arriving while app is active will trigger a notification.
  const knownMsgIdsRef = useRef<Set<string>>(new Set());
  const isInitialChatLoadDoneRef = useRef(false);

  // Reset thread message tracker when switching between child barcodes
  useEffect(() => {
    isInitialChatLoadDoneRef.current = false;
    knownMsgIdsRef.current = new Set();
  }, [activeStudent.barcode]);

  useEffect(() => {
    // When thread first loads, silently mark all present messages as already known & processed
    if (!isInitialChatLoadDoneRef.current) {
      if (chatMessages.length > 0) {
        chatMessages.forEach((m) => {
          knownMsgIdsRef.current.add(m.id);
          markEventProcessed(m.id);
          markEventProcessed(`chat-${m.id}`);
        });
        isInitialChatLoadDoneRef.current = true;
      }
      return;
    }

    // Subsequent updates: only inspect brand new incoming messages
    chatMessages.forEach((msg) => {
      if (!knownMsgIdsRef.current.has(msg.id)) {
        knownMsgIdsRef.current.add(msg.id);
        markEventProcessed(msg.id);
        markEventProcessed(`chat-${msg.id}`);

        // Only alert if sent by admin and parent is not actively viewing the chat tab
        if (msg.sender === "admin" && !msg.isRead && activeTab !== "chat") {
          sendPortalNotification(
            "💬 رسالة جديدة من إدارة المركز",
            `الأستاذة إيمان الدمشيتي: "${msg.text.slice(0, 75)}"`,
            "chat",
            {
              eventId: msg.id,
              timestamp: msg.timestamp,
              url: "/?tab=chat",
            }
          );
        }
      }
    });
  }, [chatMessages, activeTab]);

  // ----------------------------------------------------
  // CALCULATED METRICS FOR DASHBOARD
  // ----------------------------------------------------

  // 1. Approved Original Monthly Fee for Student
  const studentGrade = (activeStudent.groupGrade || activeStudent.grade || "الصف الرابع الابتدائي") as GradeName;
  const standardMonthlyFee = useMemo(() => {
    if (activeStudent.customMonthlyFee !== undefined && activeStudent.customMonthlyFee !== null && activeStudent.customMonthlyFee > 0) {
      return activeStudent.customMonthlyFee;
    }
    if (groupPrices && groupPrices[studentGrade] !== undefined) {
      return groupPrices[studentGrade];
    }
    if (DEFAULT_GRADE_PRICES[studentGrade] !== undefined) {
      return DEFAULT_GRADE_PRICES[studentGrade];
    }
    return 100;
  }, [activeStudent.customMonthlyFee, groupPrices, studentGrade]);

  // 2. Current Month Key
  const currentMonthKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const currentMonthPayment = useMemo(() => {
    const monthMap = payments[currentMonthKey] || {};
    return monthMap[activeStudent.barcode];
  }, [payments, currentMonthKey, activeStudent.barcode]);

  // 3. Payment History (All recorded payments for this student)
  const paymentHistoryList = useMemo(() => {
    const list: PaymentRecord[] = [];
    Object.keys(payments || {}).forEach((mKey) => {
      const rec = payments[mKey]?.[activeStudent.barcode];
      if (rec) {
        list.push(rec);
      }
    });
    // Sort descending by date or monthKey
    return list.sort((a, b) => {
      const dateA = a.date || a.monthKey || a.month || "";
      const dateB = b.date || b.monthKey || b.month || "";
      return dateB.localeCompare(dateA);
    });
  }, [payments, activeStudent.barcode]);

  // 4. Academic Months (Full 12-Month Academic Ledger: August -> July)
  const academicMonths = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12
    const startYear = currentMonth >= 8 ? currentYear : currentYear - 1;
    const endYear = startYear + 1;

    const list: { key: string; label: string; monthNumber: number; year: number }[] = [
      { key: `${startYear}-08`, label: `أغسطس ${startYear}`, monthNumber: 8, year: startYear },
      { key: `${startYear}-09`, label: `سبتمبر ${startYear}`, monthNumber: 9, year: startYear },
      { key: `${startYear}-10`, label: `أكتوبر ${startYear}`, monthNumber: 10, year: startYear },
      { key: `${startYear}-11`, label: `نوفمبر ${startYear}`, monthNumber: 11, year: startYear },
      { key: `${startYear}-12`, label: `ديسمبر ${startYear}`, monthNumber: 12, year: startYear },
      { key: `${endYear}-01`, label: `يناير ${endYear}`, monthNumber: 1, year: endYear },
      { key: `${endYear}-02`, label: `فبراير ${endYear}`, monthNumber: 2, year: endYear },
      { key: `${endYear}-03`, label: `مارس ${endYear}`, monthNumber: 3, year: endYear },
      { key: `${endYear}-04`, label: `أبريل ${endYear}`, monthNumber: 4, year: endYear },
      { key: `${endYear}-05`, label: `مايو ${endYear}`, monthNumber: 5, year: endYear },
      { key: `${endYear}-06`, label: `يونيو ${endYear}`, monthNumber: 6, year: endYear },
      { key: `${endYear}-07`, label: `يوليو ${endYear}`, monthNumber: 7, year: endYear },
    ];

    // Also include any payment months that exist in payments for this student outside standard list
    Object.keys(payments || {}).forEach((mKey) => {
      if (payments[mKey]?.[activeStudent.barcode] && !list.some((item) => item.key === mKey)) {
        list.push({
          key: mKey,
          label: mKey,
          monthNumber: parseInt(mKey.split("-")[1] || "1", 10),
          year: parseInt(mKey.split("-")[0] || String(currentYear), 10),
        });
      }
    });

    return list;
  }, [payments, activeStudent.barcode]);

  // 5. Full Academic Ledger Entries
  const ledgerEntries = useMemo(() => {
    return academicMonths.map((m) => {
      const pay = payments[m.key]?.[activeStudent.barcode];
      const isPaid = !!pay;
      const paidAmount = pay ? pay.amount : 0;
      const requiredAmount = standardMonthlyFee;
      const balance = isPaid ? paidAmount - requiredAmount : -requiredAmount;
      const isPastOrCurrent = m.key <= currentMonthKey;

      return {
        monthKey: m.key,
        monthLabel: m.label,
        isPaid,
        paidAmount,
        requiredAmount,
        balance,
        payRecord: pay,
        isPastOrCurrent,
      };
    });
  }, [academicMonths, payments, activeStudent.barcode, standardMonthlyFee, currentMonthKey]);

  // Full Ledger Totals
  const totalRequiredAnnual = useMemo(() => ledgerEntries.reduce((acc, curr) => acc + curr.requiredAmount, 0), [ledgerEntries]);
  const totalPaidAnnual = useMemo(() => ledgerEntries.reduce((acc, curr) => acc + curr.paidAmount, 0), [ledgerEntries]);
  const paidMonthsCount = useMemo(() => ledgerEntries.filter((e) => e.isPaid).length, [ledgerEntries]);
  const unpaidMonthsPastCurrent = useMemo(() => ledgerEntries.filter((e) => !e.isPaid && e.isPastOrCurrent).length, [ledgerEntries]);
  const totalOverdueAmount = useMemo(() => unpaidMonthsPastCurrent * standardMonthlyFee, [unpaidMonthsPastCurrent, standardMonthlyFee]);

  // 6. Attendance & Absence Logs with Dynamic Date Series & Schedule Isolation (Group A: Sat/Mon/Wed, Group B: Sun/Tue/Thu)
  const attendanceScheduleLogs = useMemo(() => {
    const studentGroupDays = activeStudent.groupDays || "سبت - إثنين - أربعاء";
    const logs: AttendanceScheduleLog[] = [];
    const todayKey = getTodayKey();

    // 1. Gather all real dates where attendance was explicitly recorded in database/history for this student
    const recordedDatesMap: Record<string, string> = {};
    Object.keys(attendanceHistory || {}).forEach((dateStr) => {
      const st = attendanceHistory[dateStr]?.[activeStudent.barcode];
      if (st) {
        recordedDatesMap[dateStr] = st;
      }
    });

    // Also include today's live scan if active
    if (attendanceToday[activeStudent.barcode]) {
      recordedDatesMap[todayKey] = attendanceToday[activeStudent.barcode];
    }

    // 2. Determine start date for generating the official schedule series:
    // Determine the earliest boundary between: student creation, earliest recorded attendance, or current month cycle
    const allMatchingRecordedDates = Object.keys(recordedDatesMap).filter((d) =>
      isOfficialGroupDay(studentGroupDays, d)
    );

    let startDate = "";
    if (allMatchingRecordedDates.length > 0) {
      startDate = allMatchingRecordedDates.reduce((min, d) => (d < min ? d : min), todayKey);
    }

    // If student has createdAt date, ensure the timeline covers from enrollment
    if (activeStudent.createdAt && activeStudent.createdAt.length >= 10) {
      const createdDateKey = activeStudent.createdAt.slice(0, 10);
      if (!startDate || createdDateKey < startDate) {
        startDate = createdDateKey;
      }
    }

    // Fallback: at minimum, generate the schedule from the start of the current month (up to 30 days back)
    if (!startDate) {
      const [curYear, curMonth] = todayKey.split("-");
      startDate = `${curYear}-${curMonth}-01`;
    }

    // 3. Generate unbroken series of scheduled dates matching the student's group schedule (with groupHistory support)
    const scheduledDates = generateScheduledDateSeries(
      startDate,
      todayKey,
      studentGroupDays,
      activeStudent.groupHistory
    );

    // Combine all unique dates: all scheduled dates + any historical recorded dates that match group schedule
    const allDatesSet = new Set<string>([...scheduledDates, ...allMatchingRecordedDates]);
    const sortedDates = Array.from(allDatesSet).sort((a, b) => b.localeCompare(a));

    sortedDates.forEach((dateStr) => {
      // Determine what group schedule was active on this specific date (accounts for mid-term transfers)
      const effectiveGroupOnDate = resolveEffectiveGroupForDate(
        dateStr,
        studentGroupDays,
        activeStudent.groupHistory
      );

      // Secondary safety check: strictly skip any cross-day or off-schedule entries
      if (!isOfficialGroupDay(effectiveGroupOnDate, dateStr)) {
        return;
      }

      const rawStatus = dateStr === todayKey
        ? (attendanceToday[activeStudent.barcode] || recordedDatesMap[dateStr])
        : recordedDatesMap[dateStr];

      // Timezone-safe Arabic day name calculation
      const parts = dateStr.split("-").map(Number);
      let dayName = getArabicDayName(dateStr);
      if (parts.length === 3) {
        const safeDate = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
        const dayNames = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
        dayName = dayNames[safeDate.getDay()];
      }

      if (rawStatus) {
        // Normalize status: "حضور", "حاضر", "تأخير", "غائب", "غياب", "إذن"
        let finalStatus: "حضور" | "تأخير" | "غائب" | "إذن" = "حضور";
        if (rawStatus === "حاضر" || rawStatus === "حضور") finalStatus = "حضور";
        else if (rawStatus === "تأخير") finalStatus = "تأخير";
        else if (rawStatus === "غائب" || rawStatus === "غياب") finalStatus = "غائب";
        else if (rawStatus === "إذن") finalStatus = "إذن";

        logs.push({
          date: dateStr,
          dayName,
          status: finalStatus,
          timeRecorded: dateStr === todayKey ? scanLogTimes[activeStudent.barcode] : undefined,
          isOfficialScheduledDay: true,
          isSubstituteDay: false,
          isAutoGenerated: false,
          note: `حصة رسمية مسجلة - ${effectiveGroupOnDate}`,
        });
      } else {
        // Scheduled day with unrecorded attendance slot (preserves slot and eliminates data gaps)
        const isToday = dateStr === todayKey;
        logs.push({
          date: dateStr,
          dayName,
          status: "لم ترصد",
          isOfficialScheduledDay: true,
          isSubstituteDay: false,
          isAutoGenerated: true,
          note: isToday
            ? `حصة اليوم المجدولة (${effectiveGroupOnDate}) - بانتظار تسجيل الحضور`
            : `حصة رسمية مجدولة (${effectiveGroupOnDate}) - لم يرصد غياب أو حضور`,
        });
      }
    });

    return logs;
  }, [activeStudent, attendanceHistory, attendanceToday, scanLogTimes]);

  // Filtered attendance logs based on tab selection
  const filteredAttendanceLogs = useMemo(() => {
    if (attendanceFilter === "all") return attendanceScheduleLogs;
    if (attendanceFilter === "present") return attendanceScheduleLogs.filter((l) => l.status === "حضور");
    if (attendanceFilter === "absent") return attendanceScheduleLogs.filter((l) => l.status === "غائب");
    if (attendanceFilter === "substitute") return attendanceScheduleLogs.filter((l) => l.isSubstituteDay || l.status === "تأخير" || l.status === "إذن" || l.status === "لم ترصد");
    return attendanceScheduleLogs;
  }, [attendanceScheduleLogs, attendanceFilter]);

  // Attendance counts & rates
  const realAttendanceCount = useMemo(() => {
    const listCount = attendanceScheduleLogs.filter((l) => l.status === "حضور" || l.status === "تأخير").length;
    return Math.max(activeStudent.totalAttendanceDays || 0, listCount);
  }, [attendanceScheduleLogs, activeStudent.totalAttendanceDays]);

  const realAbsentCount = useMemo(() => {
    const listCount = attendanceScheduleLogs.filter((l) => l.status === "غائب").length;
    return activeStudent.totalAbsentDays !== undefined ? activeStudent.totalAbsentDays : listCount;
  }, [attendanceScheduleLogs, activeStudent.totalAbsentDays]);

  const attendanceRate = useMemo(() => {
    const total = realAttendanceCount + realAbsentCount;
    if (total === 0) return 100;
    return Math.round((realAttendanceCount / total) * 100);
  }, [realAttendanceCount, realAbsentCount]);

  const absenceRate = useMemo(() => {
    return 100 - attendanceRate;
  }, [attendanceRate]);

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
      {/* MANDATORY / ESSENTIAL NOTIFICATION SETUP MODAL AT STARTUP */}
      <NotificationPermissionModal
        isOpen={showNotifModal && !hasNotifPerm && isNotificationSupported()}
        studentName={activeStudent.name}
        onClose={handleCloseNotifModal}
        onPermissionGranted={() => {
          setHasNotifPerm(true);
        }}
        onRequestPermission={handleRequestPermissionFromModal}
      />

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
                      حضور: <strong className="text-emerald-400">{realAttendanceCount} يوم</strong> | غياب: <strong className="text-rose-400">{realAbsentCount} يوم</strong>
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
                        قيمة الاشتراك الشهري المقررة: <strong className="text-amber-400">{standardMonthlyFee} ج.م</strong>
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
            <div className="bg-slate-900/90 border border-emerald-500/30 rounded-3xl p-6 shadow-xl space-y-4">
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
                      مجموعة الطالب المعتمدة: <strong className="text-amber-400">{activeStudent.groupDays}</strong> • الصف: <strong className="text-white">{studentGrade}</strong>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-3.5 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    حضور وتأخير: {realAttendanceCount}
                  </span>
                  <span className="px-3.5 py-1.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-bold flex items-center gap-1.5">
                    <XCircle className="w-3.5 h-3.5" />
                    غياب: {realAbsentCount}
                  </span>
                  <span className="px-3.5 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold">
                    نسبة الالتزام: {attendanceRate}%
                  </span>
                </div>
              </div>

              {/* Attendance Filter Tabs */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80">
                <span className="text-xs text-slate-400 flex items-center gap-1 ml-1">
                  <Filter className="w-3.5 h-3.5 text-amber-400" />
                  تصفية السجل:
                </span>
                <button
                  type="button"
                  onClick={() => setAttendanceFilter("all")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                    attendanceFilter === "all"
                      ? "bg-amber-500 text-slate-950 font-black shadow-md"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  جميع الأيام ({attendanceScheduleLogs.length})
                </button>
                <button
                  type="button"
                  onClick={() => setAttendanceFilter("present")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                    attendanceFilter === "present"
                      ? "bg-emerald-500 text-slate-950 font-black shadow-md"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  أيام الحضور ({attendanceScheduleLogs.filter((l) => l.status === "حضور").length})
                </button>
                <button
                  type="button"
                  onClick={() => setAttendanceFilter("absent")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                    attendanceFilter === "absent"
                      ? "bg-rose-500 text-white font-black shadow-md"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  أيام الغياب ({attendanceScheduleLogs.filter((l) => l.status === "غائب").length})
                </button>
                <button
                  type="button"
                  onClick={() => setAttendanceFilter("substitute")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                    attendanceFilter === "substitute"
                      ? "bg-indigo-500 text-white font-black shadow-md"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  حصص إضافية وتعويضية ({attendanceScheduleLogs.filter((l) => l.isSubstituteDay || l.status === "تأخير" || l.status === "إذن").length})
                </button>
              </div>

              {/* Schedule explanation banner */}
              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 text-xs text-slate-300 leading-relaxed flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  <strong>جدول الحضور المعتمد:</strong> يعرض هذا السجل الأيام الموثقة لحضور وغياب الطالب في منظومة الرياضيات. الحصص المقامة في الأيام الرسمية لمجموعة الطالب ({activeStudent.groupDays}) تُميّز بوسم <strong className="text-slate-200">يوم رسمي للمجموعة</strong>، بينما تُميّز الحصص المنعقدة في مواعيد إضافية أو تعويضية بوسم <strong className="text-indigo-400">حضور إضافي / تعويضي</strong>.
                </span>
              </div>
            </div>

            {/* Attendance Records Table */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-bold">
                    <th className="py-3 px-3">اليوم والتاريخ</th>
                    <th className="py-3 px-3">نوع الحصة في الجدول</th>
                    <th className="py-3 px-3 text-center">حالة الحضور</th>
                    <th className="py-3 px-3">وقت التسجيل</th>
                    <th className="py-3 px-3">ملاحظات والتفاصيل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-tajawal">
                  {filteredAttendanceLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        لا توجد سجلات حضور مطابقة للتصفية المختارة حتى الآن.
                      </td>
                    </tr>
                  ) : (
                    filteredAttendanceLogs.map((log, idx) => {
                      const isPresent = log.status === "حضور";
                      const isAbsent = log.status === "غائب";
                      const isDelay = log.status === "تأخير";
                      const isExcuse = log.status === "إذن";
                      const isUnrecorded = log.status === "لم ترصد" || log.status === "غير محدد";

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
                                حضور إضافي / تعويضي
                              </span>
                            ) : log.isOfficialScheduledDay ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-800 text-slate-300 text-[11px]">
                                حصة في اليوم الرسمي
                              </span>
                            ) : (
                              <span className="text-slate-500 text-[11px]">حصة خاصة / إضافية</span>
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
                            {isUnrecorded && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-800 border border-amber-500/30 text-amber-300 font-bold text-xs">
                                <AlertTriangle className="w-3 h-3 text-amber-400" />
                                لم ترصد بعد
                              </span>
                            )}
                            {!isPresent && !isAbsent && !isDelay && !isExcuse && !isUnrecorded && (
                              <span className="text-slate-500 font-mono">-</span>
                            )}
                          </td>

                          <td className="py-3.5 px-3 font-mono text-slate-300">
                            {log.timeRecorded || "-"}
                          </td>

                          <td className="py-3.5 px-3 text-slate-400 text-[11px]">
                            {log.note || (isPresent ? "حضر الحصة بانتظام" : isAbsent ? "لم يحضر الحصة" : "-")}
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

        {/* TAB 3: FINANCIAL LOGS & COMPLETE ACADEMIC LEDGER */}
        {activeTab === "financials" && (
          <div className="space-y-6 animate-fadeIn">
            {/* Top Financial Status Box */}
            <div className="bg-slate-900/90 border border-amber-500/30 rounded-3xl p-6 shadow-xl space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-13 h-13 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                    <Receipt className="w-7 h-7" />
                  </div>
                  <div>
                    <h2 className="text-lg md:text-xl font-bold font-fancy text-white">
                      السجل المالي وكشف حساب المصروفات
                    </h2>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className="text-xs text-slate-300">
                        قيمة الاشتراك الشهري المعتمدة للطالب:{" "}
                        <strong className="text-amber-400 font-black text-sm">{standardMonthlyFee} ج.م</strong>
                      </span>
                      {activeStudent.customMonthlyFee ? (
                        <span className="px-2 py-0.5 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-[11px] font-bold">
                          اشتراك مخصص معتمد
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-400 text-[11px]">
                          السعر الرسمي للصف ({studentGrade})
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 text-center min-w-[190px]">
                  <span className="text-[11px] text-slate-400 block mb-0.5">حالة شهر ({currentMonthKey})</span>
                  {currentMonthPayment ? (
                    <span className="text-xs font-bold text-emerald-400 flex items-center justify-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      تم السداد بنجاح ({currentMonthPayment.amount} ج.م)
                    </span>
                  ) : (
                    <span className="text-xs font-bold text-rose-400 flex items-center justify-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-rose-400" />
                      مستحق السداد حتى الآن
                    </span>
                  )}
                </div>
              </div>

              {/* 4 Financial Summary Stat Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800">
                  <span className="text-[11px] text-slate-400 block">قيمة الاشتراك الأصلي</span>
                  <div className="text-base md:text-lg font-black font-mono text-amber-400 mt-1">
                    {standardMonthlyFee} <span className="text-xs font-normal text-slate-400">ج.م/شهر</span>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800">
                  <span className="text-[11px] text-slate-400 block">إجمالي المسدد فعلياً</span>
                  <div className="text-base md:text-lg font-black font-mono text-emerald-400 mt-1">
                    {totalPaidAnnual} <span className="text-xs font-normal text-slate-400">ج.م ({paidMonthsCount} شهور)</span>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800">
                  <span className="text-[11px] text-slate-400 block">الشهور المسددة</span>
                  <div className="text-base md:text-lg font-black font-mono text-indigo-300 mt-1">
                    {paidMonthsCount} <span className="text-xs font-normal text-slate-400">من أصل {academicMonths.length} شهور</span>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800">
                  <span className="text-[11px] text-slate-400 block">المتأخرات حتى الشهر الحالي</span>
                  <div className={`text-base md:text-lg font-black font-mono mt-1 ${unpaidMonthsPastCurrent > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                    {totalOverdueAmount} <span className="text-xs font-normal text-slate-400">ج.م ({unpaidMonthsPastCurrent} شهور)</span>
                  </div>
                </div>
              </div>

              {/* Sub-Tab Switcher: Full Academic Ledger vs Receipts List */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveFinancialSubTab("ledger")}
                    className={`px-4 py-2 rounded-xl text-xs md:text-sm font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      activeFinancialSubTab === "ledger"
                        ? "bg-amber-500 text-slate-950 font-black shadow-md"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    <CalendarDays className="w-4 h-4" />
                    <span>السجل المالي السنوي الكامل (كشف الحساب)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveFinancialSubTab("receipts")}
                    className={`px-4 py-2 rounded-xl text-xs md:text-sm font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      activeFinancialSubTab === "receipts"
                        ? "bg-emerald-500 text-slate-950 font-black shadow-md"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    <Receipt className="w-4 h-4" />
                    <span>إيصالات السداد الموثقة ({paymentHistoryList.length})</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    printElement("parent-portal-full-ledger-table-print", {
                      title: `كشف حساب ومصروفات الطالب - ${activeStudent.name}`,
                    });
                  }}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs flex items-center gap-1.5 border border-slate-700 cursor-pointer transition shadow"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>طباعة كشف الحساب</span>
                </button>
              </div>
            </div>

            {/* SUB-VIEW 1: FULL ACADEMIC LEDGER (ALL MONTHS) */}
            {activeFinancialSubTab === "ledger" && (
              <div
                id="parent-portal-full-ledger-table-print"
                className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl overflow-x-auto space-y-4"
              >
                <div className="flex items-center justify-between gap-3 pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-amber-400" />
                    <h3 className="text-sm md:text-base font-bold text-white">
                      كشف الحساب المالي لشهور العام الدراسي كاملة
                    </h3>
                  </div>
                  <span className="text-xs text-slate-400 font-mono">
                    الاشتراك المعتمد: {standardMonthlyFee} ج.م / شهر
                  </span>
                </div>

                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-bold">
                      <th className="py-3 px-3">الشهر والسنة الدراسية</th>
                      <th className="py-3 px-3">القيمة المعتمدة</th>
                      <th className="py-3 px-3">المبلغ المسدد</th>
                      <th className="py-3 px-3 text-center">حالة السداد</th>
                      <th className="py-3 px-3">تاريخ ووقت السداد</th>
                      <th className="py-3 px-3 text-center">إيصال السداد</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-tajawal">
                    {ledgerEntries.map((entry, idx) => {
                      const isCurrent = entry.monthKey === currentMonthKey;
                      const isFuture = entry.monthKey > currentMonthKey;

                      return (
                        <tr
                          key={idx}
                          className={`hover:bg-slate-800/40 transition ${
                            isCurrent ? "bg-amber-500/5 font-semibold" : ""
                          }`}
                        >
                          <td className="py-3.5 px-3">
                            <div className="font-bold text-white text-sm flex items-center gap-2">
                              <span>{entry.monthLabel}</span>
                              {isCurrent && (
                                <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[10px] font-bold">
                                  الشهر الحالي
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">{entry.monthKey}</div>
                          </td>

                          <td className="py-3.5 px-3 font-mono font-bold text-slate-200 text-sm">
                            {entry.requiredAmount} ج.م
                          </td>

                          <td className="py-3.5 px-3 font-mono font-extrabold text-sm">
                            {entry.isPaid ? (
                              <span className="text-emerald-400">{entry.paidAmount} ج.م</span>
                            ) : (
                              <span className="text-slate-500">0 ج.م</span>
                            )}
                          </td>

                          <td className="py-3.5 px-3 text-center">
                            {entry.isPaid ? (
                              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 font-bold text-xs">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                مدفوع وموثق
                              </span>
                            ) : isFuture ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-800 text-slate-400 text-xs">
                                مستحق قادم
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-400 font-bold text-xs">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                غير مسدد (مستحق)
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-3 font-mono text-slate-300">
                            {entry.payRecord ? (
                              <div>
                                <span>{entry.payRecord.date || "-"}</span>
                                {entry.payRecord.time && (
                                  <span className="text-[11px] text-slate-400 block">{entry.payRecord.time}</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-600">-</span>
                            )}
                          </td>

                          <td className="py-3.5 px-3 text-center">
                            {entry.isPaid && entry.payRecord ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedReceiptForModal({
                                    monthLabel: entry.monthLabel,
                                    monthKey: entry.monthKey,
                                    payRecord: entry.payRecord!,
                                  })
                                }
                                className="px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 font-bold text-xs inline-flex items-center gap-1.5 transition cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>معاينة الإيصال</span>
                              </button>
                            ) : (
                              <span className="text-slate-600 text-xs">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* SUB-VIEW 2: VERIFIED RECEIPTS LIST */}
            {activeFinancialSubTab === "receipts" && (
              <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl overflow-x-auto space-y-4">
                <div className="flex items-center justify-between gap-3 pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <Receipt className="w-5 h-5 text-emerald-400" />
                    <h3 className="text-sm md:text-base font-bold text-white">
                      إيصالات السداد الموثقة لدى الإدارة ({paymentHistoryList.length})
                    </h3>
                  </div>
                </div>

                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-bold">
                      <th className="py-3 px-3">الشهر المستحق</th>
                      <th className="py-3 px-3">المبلغ المسدد</th>
                      <th className="py-3 px-3">تاريخ الدفع</th>
                      <th className="py-3 px-3">وقت الإيصال</th>
                      <th className="py-3 px-3">البيان والملاحظات</th>
                      <th className="py-3 px-3 text-center">الحالة</th>
                      <th className="py-3 px-3 text-center">الإيصال المعتمد</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-tajawal">
                    {paymentHistoryList.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-400">
                          لا توجد إيصالات أو دفعات مسجلة لهذا الطالب حتى الآن.
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
                          <td className="py-3.5 px-3 text-center">
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedReceiptForModal({
                                  monthLabel: pay.month || pay.monthKey || "اشتراك شهري",
                                  monthKey: pay.monthKey || pay.month || "",
                                  payRecord: pay,
                                })
                              }
                              className="px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 font-bold text-xs inline-flex items-center gap-1.5 transition cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>معاينة وطباعة</span>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* PRINTABLE / VIEWABLE OFFICIAL RECEIPT MODAL */}
        {selectedReceiptForModal && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overflow-y-auto no-print-backdrop">
            <div className="bg-[#0b1224] border-2 border-emerald-500/40 w-full max-w-lg rounded-3xl p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 font-tajawal text-slate-100">
              {/* Modal Top Bar */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                  <Receipt className="w-5 h-5" />
                  <span>معاينة إيصال السداد المعتمد</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedReceiptForModal(null)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Printable Receipt Card */}
              <div
                id="parent-portal-official-receipt-print"
                className="bg-white text-slate-900 p-6 rounded-2xl shadow-md border border-slate-300 space-y-4 print-container"
              >
                {/* Header */}
                <div className="text-center pb-3 border-b-2 border-emerald-700">
                  <h2 className="text-base font-black text-emerald-900">
                    منظومة الأستاذة إيمان الدمشيتي - مادة الرياضيات
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5">
                    إيصال سداد اشتراك شهري معتمد وموثق 🧾
                  </p>
                </div>

                {/* Receipt Details Grid */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500 block">اسم الطالب:</span>
                    <strong className="text-slate-900 text-sm">{activeStudent.name}</strong>
                  </div>

                  <div>
                    <span className="text-slate-500 block">كود الباركود:</span>
                    <strong className="text-slate-900 font-mono text-sm">#{activeStudent.barcode}</strong>
                  </div>

                  <div>
                    <span className="text-slate-500 block">الصف الدراسي:</span>
                    <strong className="text-slate-800">{studentGrade}</strong>
                  </div>

                  <div>
                    <span className="text-slate-500 block">المجموعة المعتمدة:</span>
                    <strong className="text-slate-800">{activeStudent.groupDays}</strong>
                  </div>

                  <div>
                    <span className="text-slate-500 block">عن شهر:</span>
                    <strong className="text-emerald-800 text-sm font-mono">
                      {selectedReceiptForModal.monthLabel}
                    </strong>
                  </div>

                  <div>
                    <span className="text-slate-500 block">تاريخ السداد:</span>
                    <strong className="text-slate-800 font-mono">
                      {selectedReceiptForModal.payRecord.date || "مسجل"}
                    </strong>
                  </div>
                </div>

                {/* Amount Box */}
                <div className="p-4 rounded-xl bg-emerald-50 border-2 border-emerald-500 text-center my-3">
                  <span className="text-xs text-emerald-800 block font-bold">المبلغ المسدد نقداً</span>
                  <div className="text-2xl font-black text-emerald-900 font-mono mt-1">
                    {selectedReceiptForModal.payRecord.amount} ج.م
                  </div>
                  <span className="text-[11px] text-emerald-700 block mt-0.5">
                    (فقط وقدره {selectedReceiptForModal.payRecord.amount} جنيهاً مصرياً لا غير)
                  </span>
                </div>

                {/* Footer Notes & Seal */}
                <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
                  <div>
                    <span>توقيت القيد: {selectedReceiptForModal.payRecord.time || "معتمد"}</span>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      البيان: {selectedReceiptForModal.payRecord.note || "اشتراك شهري"}
                    </div>
                  </div>
                  <div className="text-left font-bold text-emerald-900">
                    <div>إدارة منظومة الرياضيات</div>
                    <div className="text-[10px] text-emerald-700">أ/ إيمان الدمشيتي ✨</div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    printElement("parent-portal-official-receipt-print", {
                      title: `إيصال سداد - ${activeStudent.name} - ${selectedReceiptForModal.monthLabel}`,
                    });
                  }}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition shadow cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>طباعة الإيصال الرسمي</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedReceiptForModal(null)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition cursor-pointer"
                >
                  إغلاق
                </button>
              </div>
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
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      sendPortalNotification(
                        "🔔 تجربة رنين وإشعار الهاتف",
                        "رائع! الإشعارات والصوت والاهتزاز تعمل بنجاح وبأعلى كفاءة على هاتفك.",
                        "grade"
                      );
                    }}
                    className="px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-bold transition cursor-pointer"
                  >
                    تجربة رنين الهاتف 🔊
                  </button>
                  <button
                    type="button"
                    onClick={handleEnableNotifications}
                    className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-bold border border-slate-700 transition cursor-pointer"
                  >
                    {hasNotifPerm ? "الإشعارات مفعلة ✓" : "تفعيل الإشعارات"}
                  </button>
                </div>
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
      {showAddChildModal && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[999990] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md overflow-y-auto animate-fadeIn"
          style={{ zIndex: 999990 }}
          dir="rtl"
        >
          <div className="relative w-full max-w-md rounded-3xl bg-slate-900 border-2 border-amber-500/40 p-6 shadow-2xl space-y-4 text-right max-h-[90vh] overflow-y-auto custom-scrollbar my-auto">
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
        </div>,
        document.body
      )}
    </div>
  );
};
