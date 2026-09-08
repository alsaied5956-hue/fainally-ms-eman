import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Student,
  PaymentRecord,
  UserAccount,
  GradeName,
  GroupDays,
  TabType,
  PendingWhatsAppMessage,
  PlatformMessage,
} from "./types";
import {
  loadInitialData,
  saveStudentsData,
  saveAttendanceTodayData,
  saveAttendanceAndStudentsBatch,
  saveAttendanceHistoryData,
  saveClearSessionScansForGrade,
  saveScanLogData,
  savePaymentsData,
  saveGroupPricesData,
  saveUsersData,
  savePendingWhatsAppMessages,
  saveSingleGradeWhatsAppLink,
  markWhatsAppMessageSent,
  markAllWhatsAppMessagesSent,
  deletePendingWhatsAppMessage,
  clearAllPendingWhatsAppMessages,
  subscribeToCloudData,
  subscribeToSyncStatus,
  flushPendingSyncToCloud,
  forceCloudFullRefresh,
  getSyncStatus,
  clearAllSystemData,
  autoPushLocalDiskOnStartup,
  pullLatestCloudDataImmediately,
  SyncStatus,
} from "./utils/storage";
import {
  getTodayKey,
  getCurrentMonthKey,
  formatArabicDate,
  formatTimeArabic,
} from "./utils/helpers";
import {
  broadcastGroupFinished,
  broadcastPaymentChange,
  broadcastStudentChange,
  subscribeToGroupFinished,
  subscribeToPaymentChanges,
  subscribeToStudentChanges,
  saveBulkAttendanceToSupabase,
  savePaymentToSupabase,
  deletePaymentFromSupabase,
  saveStudentToSupabase,
  deleteStudentFromSupabase,
} from "./utils/supabaseClient";
import { Navbar } from "./components/Navbar";
import { Sidebar } from "./components/Sidebar";
import { AttendanceScanner } from "./components/AttendanceScanner";
import { AddStudentTab } from "./components/AddStudentTab";
import { DailyAttendanceReport } from "./components/DailyAttendanceReport";
import { CumulativeGradesReport } from "./components/CumulativeGradesReport";
import { PayExpensesTab } from "./components/PayExpensesTab";
import { FinancialsTab } from "./components/FinancialsTab";
import { ExamGradesTab } from "./components/ExamGradesTab";
import { EarlyWarningTab } from "./components/EarlyWarningTab";
import { CertificatesTab } from "./components/CertificatesTab";
import { ExcelIntegrationTab } from "./components/ExcelIntegrationTab";
import { PlatformMessagingTab } from "./components/PlatformMessagingTab";
import { WhatsAppDirectTab } from "./components/WhatsAppDirectTab";
import { ManageStudentsTab } from "./components/ManageStudentsTab";
import { UsersTab } from "./components/UsersTab";
import { SettingsTab } from "./components/SettingsTab";
import { AuthOverlay } from "./components/AuthOverlay";
import { PrintPDFModal } from "./components/PrintPDFModal";
import { PrintCardsModal } from "./components/PrintCardsModal";
import { PendingWhatsAppOutboxModal } from "./components/PendingWhatsAppOutboxModal";
import { MultiDeviceSyncModal } from "./components/MultiDeviceSyncModal";
import { BulkHomeworkModal } from "./components/BulkHomeworkModal";
import { HomeworkTrackerTab } from "./components/HomeworkTrackerTab";
import { pushLiveAttendanceEvent, pushLiveAttendanceBatch } from "./utils/liveEventStream";
import { CheckCircle2, WifiOff, RefreshCw, X, MessageSquare, Send } from "lucide-react";
import { PortalMasterApp } from "./components/portal/PortalMasterApp";

export default function App() {
  const [appViewMode, setAppViewMode] = useState<"portal" | "teacher">(() => {
    if (typeof window !== "undefined") {
      const search = window.location.search.toLowerCase();
      const hash = window.location.hash.toLowerCase();
      if (search.includes("teacher") || hash.includes("teacher")) {
        return "teacher";
      }
      if (search.includes("portal") || search.includes("parent") || hash.includes("portal")) {
        return "portal";
      }
      const saved = localStorage.getItem("app_view_mode");
      if (saved === "teacher") return "teacher";
    }
    return "portal";
  });

  // Support URL search and hash switching
  useEffect(() => {
    const handleUrlChange = () => {
      const search = window.location.search.toLowerCase();
      const hash = window.location.hash.toLowerCase();
      if (search.includes("teacher") || hash.includes("teacher")) {
        setAppViewMode("teacher");
        localStorage.setItem("app_view_mode", "teacher");
      } else if (search.includes("portal") || hash.includes("portal")) {
        setAppViewMode("portal");
        localStorage.setItem("app_view_mode", "portal");
      }
    };
    window.addEventListener("popstate", handleUrlChange);
    window.addEventListener("hashchange", handleUrlChange);
    return () => {
      window.removeEventListener("popstate", handleUrlChange);
      window.removeEventListener("hashchange", handleUrlChange);
    };
  }, []);

  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("attendance-scan");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isOnline: true,
    isSyncing: false,
    hasPendingSync: false,
    lastSyncTime: null,
  });
  const [syncBanner, setSyncBanner] = useState<{
    show: boolean;
    type: "online-synced" | "offline-mode";
    message: string;
  } | null>(null);

  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth >= 1024;
    }
    return true;
  });

  // Dedicated per-tab isolated scroll positions
  const mainScrollRef = useRef<HTMLElement>(null);
  const tabScrollPositions = useRef<Record<string, number>>({});

  // Tab switcher that saves scroll position and preserves sidebar state
  const handleSelectTab = useCallback((tab: TabType) => {
    if (mainScrollRef.current) {
      tabScrollPositions.current[activeTab] = mainScrollRef.current.scrollTop;
    }
    setActiveTab(tab);
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTop = tabScrollPositions.current[tab] || 0;
    }
  }, [activeTab]);

  const [activeSessionSlotId, setActiveSessionSlotId] = useState<string>("auto");
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(true);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("app_theme");
      if (saved === "light" || saved === "dark") return saved;
    }
    return "dark";
  });
  const [isCardsModalOpen, setIsCardsModalOpen] = useState(false);
  const [isMultiDeviceSyncModalOpen, setIsMultiDeviceSyncModalOpen] = useState(false);
  const [isBulkHomeworkModalOpen, setIsBulkHomeworkModalOpen] = useState(false);

  // Sync theme to root DOM and localStorage
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", theme);
      document.body.setAttribute("data-theme", theme);
      if (theme === "light") {
        document.documentElement.classList.remove("dark");
        document.documentElement.classList.add("light");
        document.body.classList.remove("dark");
        document.body.classList.add("light");
      } else {
        document.documentElement.classList.remove("light");
        document.documentElement.classList.add("dark");
        document.body.classList.remove("light");
        document.body.classList.add("dark");
      }
      localStorage.setItem("app_theme", theme);
    }
  }, [theme]);

  // Core Datasets with guaranteed initial default arrays/objects
  const [students, setStudents] = useState<Student[]>([]);
  const [attendanceToday, setAttendanceToday] = useState<Record<string, string>>({});
  const [attendanceHistory, setAttendanceHistory] = useState<Record<string, Record<string, string>>>({});
  const [scanLogOrder, setScanLogOrder] = useState<string[]>([]);
  const [scanLogTimes, setScanLogTimes] = useState<Record<string, string>>({});
  const [payments, setPayments] = useState<Record<string, Record<string, PaymentRecord>>>({});
  const [groupPrices, setGroupPrices] = useState<Record<GradeName, number>>({} as Record<GradeName, number>);
  const [usersList, setUsersList] = useState<UserAccount[]>([]);
  const [platformMessages, setPlatformMessages] = useState<PlatformMessage[]>([]);
  const [pendingWhatsAppMessages, setPendingWhatsAppMessages] = useState<PendingWhatsAppMessage[]>([]);
  const [gradeWhatsAppLinks, setGradeWhatsAppLinks] = useState<Record<string, string>>({});
  const [isWhatsAppOutboxOpen, setIsWhatsAppOutboxOpen] = useState<boolean>(false);

  // Print PDF Modal State
  const [printModal, setPrintModal] = useState<{
    open: boolean;
    type: "attendance" | "exams" | "all" | "unpaid";
  }>({
    open: false,
    type: "all",
  });

  // 1. Initial Local Data Load (Instant Speed 0ms) + Guaranteed Auto-Push of Local Disk Data to Cloud
  useEffect(() => {
    const data = loadInitialData();
    if (data) {
      setStudents(data.students || []);
      setAttendanceToday(data.attendanceToday || {});
      setAttendanceHistory(data.attendanceHistory || {});
      setScanLogOrder(data.scanLogOrder || []);
      setScanLogTimes(data.scanLogTimes || {});
      setPayments(data.payments || {});
      setGroupPrices(data.groupPrices || ({} as Record<GradeName, number>));
      setUsersList(data.usersList || []);
      setPlatformMessages(data.platformMessages || []);
      setPendingWhatsAppMessages(data.pendingWhatsAppMessages || []);
      setGradeWhatsAppLinks(data.gradeWhatsAppLinks || {});
      if (data.activeSessionSlotId) {
        setActiveSessionSlotId(data.activeSessionSlotId);
      }
    }

    // 1. Immediately pull latest cloud state if device was turned off/offline
    pullLatestCloudDataImmediately().catch(() => {});
    // 2. Automatically send whatever was saved on local disk to Cloud if pending
    autoPushLocalDiskOnStartup().catch(() => {});
  }, []);

  // 2. Subscribe to sync status & offline/online events
  useEffect(() => {
    const unsubscribeSync = subscribeToSyncStatus((status) => {
      setSyncStatus(status);
    });

    const handleSyncCompleted = () => {
      setSyncBanner({
        show: true,
        type: "online-synced",
        message: "تم الاتصال بالسحابة ومزامنة كافة التعديلات بنجاح!",
      });
      setTimeout(() => {
        setSyncBanner(null);
      }, 5000);
    };

    const handleOffline = () => {
      setSyncBanner({
        show: true,
        type: "offline-mode",
        message: "أنت الآن في وضع الأوفلاين (بدون نت) - المنظومة تعمل بالكامل وسيتم المزامنة تلقائياً عند عودة النت.",
      });
    };

    const handleQueueUpdated = () => {
      const local = loadInitialData();
      setPendingWhatsAppMessages(local.pendingWhatsAppMessages || []);
    };

    const handlePlatformMessagesUpdated = () => {
      const local = loadInitialData();
      setPlatformMessages(local.platformMessages || []);
    };

    window.addEventListener("cloud-sync-completed", handleSyncCompleted);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("whatsapp-queue-updated", handleQueueUpdated);
    window.addEventListener("platform-messages-updated", handlePlatformMessagesUpdated);

    return () => {
      unsubscribeSync();
      window.removeEventListener("cloud-sync-completed", handleSyncCompleted);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("whatsapp-queue-updated", handleQueueUpdated);
      window.removeEventListener("platform-messages-updated", handlePlatformMessagesUpdated);
    };
  }, []);

  // 3. Real-time Firebase Sync in background
  useEffect(() => {
    const unsubscribe = subscribeToCloudData(
      (cloudData) => {
        if (cloudData) {
          if (cloudData.students) setStudents(cloudData.students);
          if (cloudData.attendanceToday) setAttendanceToday(cloudData.attendanceToday);
          if (cloudData.attendanceHistory) setAttendanceHistory(cloudData.attendanceHistory);
          if (Array.isArray(cloudData.scanLogOrder)) setScanLogOrder(cloudData.scanLogOrder);
          if (cloudData.scanLogTimes) setScanLogTimes(cloudData.scanLogTimes);
          if (cloudData.payments) setPayments(cloudData.payments);
          if (cloudData.groupPrices) setGroupPrices(cloudData.groupPrices);
          if (cloudData.usersList) setUsersList(cloudData.usersList);
          if (cloudData.platformMessages) setPlatformMessages(cloudData.platformMessages);
          if (cloudData.pendingWhatsAppMessages) setPendingWhatsAppMessages(cloudData.pendingWhatsAppMessages);
          if (cloudData.gradeWhatsAppLinks) setGradeWhatsAppLinks(cloudData.gradeWhatsAppLinks);
          if (cloudData.activeSessionSlotId) setActiveSessionSlotId(cloudData.activeSessionSlotId);
        }
      },
      () => {
        // Ignored in offline fallback
      }
    );

    const handleLocalBroadcast = (e: Event) => {
      const customEvent = e as CustomEvent<any>;
      if (customEvent.detail) {
        // Prevent infinite re-render loop on mutations initiated within the same window
        if (customEvent.detail._originLocal) {
          return;
        }
        const d = customEvent.detail;
        if (d.students) setStudents(d.students);
        if (d.attendanceToday) setAttendanceToday(d.attendanceToday);
        if (d.attendanceHistory) setAttendanceHistory(d.attendanceHistory);
        if (Array.isArray(d.scanLogOrder)) setScanLogOrder(d.scanLogOrder);
        if (d.scanLogTimes) setScanLogTimes(d.scanLogTimes);
        if (d.payments) setPayments(d.payments);
        if (d.groupPrices) setGroupPrices(d.groupPrices);
        if (d.usersList) setUsersList(d.usersList);
        if (d.platformMessages) setPlatformMessages(d.platformMessages);
        if (d.pendingWhatsAppMessages) setPendingWhatsAppMessages(d.pendingWhatsAppMessages);
        if (d.gradeWhatsAppLinks) setGradeWhatsAppLinks(d.gradeWhatsAppLinks);
        if (d.activeSessionSlotId) setActiveSessionSlotId(d.activeSessionSlotId);
      }
    };

    window.addEventListener("center-data-updated", handleLocalBroadcast);

    return () => {
      unsubscribe();
      window.removeEventListener("center-data-updated", handleLocalBroadcast);
    };
  }, []);

  // Manual Trigger for Cloud Sync
  const handleManualSync = async () => {
    const result = await forceCloudFullRefresh();
    if (result.success) {
      setSyncBanner({
        show: true,
        type: "online-synced",
        message: result.message,
      });
      setTimeout(() => setSyncBanner(null), 4000);
    } else {
      setSyncBanner({
        show: true,
        type: "offline-mode",
        message: result.message,
      });
      setTimeout(() => setSyncBanner(null), 6000);
    }
  };

  // ⚡ Central Supabase Realtime Hub: Listen to Group Finalization, Payments, and Students across all devices (<20ms)
  useEffect(() => {
    const unsubGroup = subscribeToGroupFinished((payload) => {
      setSyncBanner({
        show: true,
        type: "online-synced",
        message: `⚡ تم تقفيل وحفظ غياب وحضور [${payload.grade} - ${payload.days}] بواسطة (${payload.finishedBy}) وتحديث جهازك فورياً!`,
      });
      setTimeout(() => setSyncBanner(null), 5000);

      setAttendanceToday((prev) => {
        const next = { ...prev };
        payload.absentBarcodes.forEach((b) => (next[b] = "غائب"));
        payload.lateBarcodes.forEach((b) => (next[b] = "تأخير"));
        payload.presentBarcodes.forEach((b) => (next[b] = "حضور"));
        return next;
      });

      setAttendanceHistory((prev) => {
        const dayMap = { ...(prev[payload.dateKey] || {}) };
        payload.absentBarcodes.forEach((b) => (dayMap[b] = "غائب"));
        payload.lateBarcodes.forEach((b) => (dayMap[b] = "تأخير"));
        payload.presentBarcodes.forEach((b) => (dayMap[b] = "حضور"));
        return { ...prev, [payload.dateKey]: dayMap };
      });

      // Clear the finished grade from active scanner list
      setScanLogOrder((prev) => {
        const gradeMap = new Map<string, string>();
        students.forEach((s) => s.barcode && gradeMap.set(String(s.barcode).trim(), s.groupGrade));
        return prev.filter((b) => gradeMap.get(String(b).trim()) !== payload.grade);
      });
      setScanLogTimes((prev) => {
        const next = { ...prev };
        students.forEach((s) => {
          if (s.groupGrade === payload.grade) delete next[String(s.barcode).trim()];
        });
        return next;
      });
    });

    const unsubPayment = subscribeToPaymentChanges((payload) => {
      setSyncBanner({
        show: true,
        type: "online-synced",
        message: `⚡ تحديث مالي فوري: تم تسجيل سداد شهر (${payload.monthKey}) للطالب (${payload.barcode})!`,
      });
      setTimeout(() => setSyncBanner(null), 4000);

      setPayments((prev) => {
        const updated = { ...prev };
        if (payload.action === "delete") {
          if (updated[payload.monthKey]) {
            const m = { ...updated[payload.monthKey] };
            delete m[payload.barcode];
            updated[payload.monthKey] = m;
          }
        } else {
          const m = { ...(updated[payload.monthKey] || {}) };
          m[payload.barcode] = {
            barcode: payload.barcode,
            month: payload.monthKey,
            monthKey: payload.monthKey,
            amount: payload.amount,
            date: payload.date,
            time: payload.time,
            note: payload.note,
            recordedBy: payload.recordedBy,
          };
          updated[payload.monthKey] = m;
        }
        return updated;
      });
    });

    const unsubStudent = subscribeToStudentChanges((payload) => {
      if (payload.action === "add" && payload.studentData) {
        setStudents((prev) => {
          if (prev.some((s) => s.barcode === payload.barcode)) return prev;
          return [payload.studentData, ...prev];
        });
      } else if (payload.action === "update" && payload.studentData) {
        setStudents((prev) =>
          prev.map((s) => (s.barcode === payload.barcode ? payload.studentData : s))
        );
      } else if (payload.action === "delete") {
        setStudents((prev) => prev.filter((s) => s.barcode !== payload.barcode));
      }
    });

    return () => {
      unsubGroup();
      unsubPayment();
      unsubStudent();
    };
  }, [students]);

  // Handler: Scan Attendance Record
  const handleRecordAttendance = useCallback((
    barcode: string,
    status: "حضور" | "تأخير",
    timeIso: string,
    student: Student
  ) => {
    const updatedToday = { ...attendanceToday, [barcode]: status };
    const todayKey = getTodayKey();
    const updatedHistory = {
      ...attendanceHistory,
      [todayKey]: updatedToday,
    };
    const updatedOrder = scanLogOrder.includes(barcode)
      ? scanLogOrder
      : [barcode, ...scanLogOrder];
    const updatedTimes = { ...scanLogTimes, [barcode]: timeIso };

    const prevStatus = attendanceToday[barcode];
    let updatedStudents = students;
    
    // Only update student record if attendance state actually newly increments
    if (!prevStatus) {
      updatedStudents = students.map((s) => {
        if (s.barcode === barcode) {
          return {
            ...s,
            totalAttendanceDays: (s.totalAttendanceDays || 0) + 1,
          };
        }
        return s;
      });
      setStudents(updatedStudents);
    }

    setAttendanceToday(updatedToday);
    setAttendanceHistory(updatedHistory);
    setScanLogOrder(updatedOrder);
    setScanLogTimes(updatedTimes);

    // 1️⃣ Live Event Pipeline: Instant broadcast via local zero-quota channel
    pushLiveAttendanceEvent(barcode, status, Date.now(), false);

    // Instant local save with 0 cloud writes; entire group attendance is synced as ONE single operation
    saveAttendanceAndStudentsBatch(updatedToday, updatedOrder, updatedTimes, updatedStudents, false, true);
  }, [attendanceToday, attendanceHistory, scanLogOrder, scanLogTimes, students]);

  // Handler: Manual sync for group attendance session in one single operation
  const handleSyncGroupSession = useCallback(async () => {
    return await flushPendingSyncToCloud(true);
  }, []);

  // Handler: Finish and Lock Group Session
  const handleFinishGroup = useCallback((
    grade: GradeName,
    days: GroupDays,
    absentList: { student: Student; message: string; type?: "غائب" }[],
    lateList: { student: Student; message: string; type?: "تأخير" }[],
    crossDayList?: { student: Student; message: string; type?: "عكس_أيام" }[]
  ) => {
    // 1️⃣ Live Event Pipeline: Coordinated batch push to `live_events/today` without document write collisions
    const batchEvents = [
      ...(absentList || []).map((a) => ({
        studentId: a.student.barcode,
        status: "غائب" as const,
        timestamp: Date.now(),
      })),
      ...(lateList || []).map((l) => ({
        studentId: l.student.barcode,
        status: "تأخير" as const,
        timestamp: Date.now(),
      })),
    ];
    if (batchEvents.length > 0) {
      pushLiveAttendanceBatch(batchEvents);
    }

    const groupStudents = students.filter(
      (s) => s.groupGrade === grade && s.groupDays === days
    );

    const updatedToday = { ...attendanceToday };
    const absentBarcodes = new Set((absentList || []).map((a) => String(a.student.barcode).trim()));
    const lateBarcodes = new Set((lateList || []).map((l) => String(l.student.barcode).trim()));
    
    // 1. Explicitly update status for EVERY student registered in this group:
    // Anyone not in queue (absentBarcodes) becomes "غائب"
    // Anyone in lateBarcodes becomes "تأخير"
    // All scanned queue students in this group become "حضور"
    groupStudents.forEach((student) => {
      const b = String(student.barcode).trim();
      if (absentBarcodes.has(b)) {
        updatedToday[b] = "غائب";
      } else if (lateBarcodes.has(b)) {
        updatedToday[b] = "تأخير";
      } else {
        updatedToday[b] = "حضور";
      }
    });

    // 2. Also ensure makeup cross-day students are marked in today's attendance
    (crossDayList || []).forEach((item) => {
      const b = String(item.student.barcode).trim();
      updatedToday[b] = attendanceToday[b] === "تأخير" ? "تأخير" : "حضور";
    });

    const todayKey = getTodayKey();
    const updatedHistory = {
      ...attendanceHistory,
      [todayKey]: updatedToday,
    };

    const updatedStudents = students.map((s) => {
      const b = String(s.barcode).trim();
      if (absentBarcodes.has(b)) {
        const wasAbsent = attendanceToday[b] === "غائب";
        const wasPresent = attendanceToday[b] === "حضور" || attendanceToday[b] === "تأخير";
        if (!wasAbsent) {
          return {
            ...s,
            totalAbsentDays: (s.totalAbsentDays || 0) + 1,
            totalAttendanceDays: wasPresent ? Math.max(0, (s.totalAttendanceDays || 0) - 1) : (s.totalAttendanceDays || 0),
          };
        }
      }
      return s;
    });

    // Clear the finished group's barcodes AND all students of this grade from the active room scanner screen
    const studentGradeMap = new Map<string, GradeName>();
    students.forEach((s) => {
      if (s?.barcode) studentGradeMap.set(String(s.barcode).trim(), s.groupGrade);
    });

    const remainingScanOrder = scanLogOrder.filter((b) => {
      const g = studentGradeMap.get(String(b).trim());
      // Remove all students belonging to this grade from the active scanner room
      return g ? g !== grade : false;
    });

    const remainingScanTimes = { ...scanLogTimes };
    scanLogOrder.forEach((b) => {
      const g = studentGradeMap.get(String(b).trim());
      if (g === grade) {
        delete remainingScanTimes[b];
      }
    });

    setScanLogOrder(remainingScanOrder);
    setScanLogTimes(remainingScanTimes);

    setAttendanceToday(updatedToday);
    setAttendanceHistory(updatedHistory);
    setStudents(updatedStudents);

    // Save and immediately sync to cloud and local storage
    saveAttendanceAndStudentsBatch(updatedToday, remainingScanOrder, remainingScanTimes, updatedStudents, true);

    // ⚡ Supabase Realtime Hub: Broadcast Group Finalized to ALL assistant screens in <20ms
    broadcastGroupFinished({
      grade,
      days,
      absentBarcodes: Array.from(absentBarcodes),
      lateBarcodes: Array.from(lateBarcodes),
      presentBarcodes: groupStudents
        .map((s) => String(s.barcode).trim())
        .filter((b) => !absentBarcodes.has(b) && !lateBarcodes.has(b)),
      dateKey: todayKey,
      finishedBy: currentUser?.username || "الماسح",
      timestamp: Date.now(),
    }).catch(console.warn);

    // ⚡ Supabase Direct Persistence: Bulk save all attendance statuses in parallel
    const bulkAttendanceRecords = groupStudents.map((s) => {
      const b = String(s.barcode).trim();
      const st = absentBarcodes.has(b) ? "غياب" : lateBarcodes.has(b) ? "تأخير" : "حضور";
      return {
        barcode: b,
        studentName: s.name,
        status: st as "حضور" | "تأخير" | "غياب",
        dateKey: todayKey,
        scannedBy: currentUser?.username || "admin",
      };
    });
    saveBulkAttendanceToSupabase(bulkAttendanceRecords).catch(console.warn);
  }, [students, attendanceToday, attendanceHistory, scanLogOrder, scanLogTimes, currentUser]);

  // Handler: Remove single student from active scanner screen
  const handleRemoveFromScanner = useCallback((barcode: string) => {
    const updatedOrder = scanLogOrder.filter((b) => b !== barcode);
    const updatedTimes = { ...scanLogTimes };
    delete updatedTimes[barcode];

    setScanLogOrder(updatedOrder);
    setScanLogTimes(updatedTimes);
    saveScanLogData(updatedOrder, updatedTimes);
  }, [scanLogOrder, scanLogTimes]);

  // Handler: Clear current session scans for a grade with full isolation from previous classes
  const handleClearSessionScans = useCallback((grade: GradeName, resetTodayAttendance = false) => {
    const { updatedToday, remainingScanOrder, remainingScanTimes } = saveClearSessionScansForGrade(
      grade,
      resetTodayAttendance
    );
    setScanLogOrder(remainingScanOrder);
    setScanLogTimes(remainingScanTimes);
    if (resetTodayAttendance) {
      setAttendanceToday(updatedToday);
      const todayKey = getTodayKey();
      setAttendanceHistory((prev) => ({ ...prev, [todayKey]: updatedToday }));
    }
  }, []);

  // Handler: Add Single Student
  const handleAddStudent = useCallback((newStudent: Student, cardFee = 0) => {
    const updated = [newStudent, ...students];
    setStudents(updated);
    saveStudentsData(updated);

    // ⚡ Supabase Realtime: Broadcast new student across all assistant devices
    broadcastStudentChange({
      action: "add",
      barcode: newStudent.barcode,
      studentData: newStudent,
      timestamp: Date.now(),
    }).catch(console.warn);

    saveStudentToSupabase(newStudent).catch(console.warn);

    if (cardFee > 0) {
      const today = getTodayKey();
      const monthKey = getCurrentMonthKey();
      const newPayment: PaymentRecord = {
        barcode: newStudent.barcode,
        month: monthKey,
        monthKey,
        amount: cardFee,
        date: today,
        time: formatTimeArabic(),
        note: "رسوم استخراج كارت الباركود الذكي",
        isCardFee: true,
        recordedBy: currentUser?.username || "admin",
      };
      const monthData = payments[monthKey] || {};
      const updatedPayments = {
        ...payments,
        [monthKey]: {
          ...monthData,
          [`card_${newStudent.barcode}`]: newPayment,
        },
      };
      setPayments(updatedPayments);
      savePaymentsData(updatedPayments);
    }
  }, [students, payments, currentUser]);

  // Handler: Save WhatsApp Group Link per Grade
  const handleSaveGradeWhatsAppLink = useCallback((grade: string, link: string) => {
    setGradeWhatsAppLinks((prev) => ({ ...prev, [grade]: link.trim() }));
    saveSingleGradeWhatsAppLink(grade, link.trim());
  }, []);

  // Handler: Bulk Import Students from Excel
  const handleBulkImport = useCallback((newStudentsList: Student[]) => {
    const updated = [...newStudentsList, ...students];
    setStudents(updated);
    saveStudentsData(updated);
  }, [students]);

  // Handler: Update Student Info (with full barcode migration)
  const handleUpdateStudent = useCallback((oldBarcode: string, updatedStudent: Student) => {
    const updated = students.map((s) => (s.barcode === oldBarcode ? updatedStudent : s));
    setStudents(updated);

    if (oldBarcode !== updatedStudent.barcode) {
      // Migrate attendance today
      const newAttToday = { ...attendanceToday };
      if (newAttToday[oldBarcode]) {
        newAttToday[updatedStudent.barcode] = newAttToday[oldBarcode];
        delete newAttToday[oldBarcode];
        setAttendanceToday(newAttToday);
      }

      // Migrate scan log
      const newScanOrder = scanLogOrder.map((b) => (b === oldBarcode ? updatedStudent.barcode : b));
      const newScanTimes = { ...scanLogTimes };
      if (newScanTimes[oldBarcode]) {
        newScanTimes[updatedStudent.barcode] = newScanTimes[oldBarcode];
        delete newScanTimes[oldBarcode];
      }
      setScanLogOrder(newScanOrder);
      setScanLogTimes(newScanTimes);

      saveAttendanceAndStudentsBatch(newAttToday, newScanOrder, newScanTimes, updated);
    } else {
      saveStudentsData(updated);
    }

    // ⚡ Supabase Realtime: Broadcast student update
    broadcastStudentChange({
      action: "update",
      barcode: updatedStudent.barcode,
      studentData: updatedStudent,
      timestamp: Date.now(),
    }).catch(console.warn);

    saveStudentToSupabase(updatedStudent).catch(console.warn);
  }, [students, attendanceToday, scanLogOrder, scanLogTimes]);

  // Handler: Delete Single Student
  const handleDeleteStudent = useCallback((barcode: string) => {
    const updated = students.filter((s) => s.barcode !== barcode);
    setStudents(updated);
    saveStudentsData(updated, barcode);

    // ⚡ Supabase Realtime: Broadcast student deletion
    broadcastStudentChange({
      action: "delete",
      barcode,
      timestamp: Date.now(),
    }).catch(console.warn);

    deleteStudentFromSupabase(barcode).catch(console.warn);
  }, [students]);

  // Handler: Clear All Data
  const handleClearAllData = useCallback(() => {
    setStudents([]);
    setAttendanceToday({});
    setScanLogOrder([]);
    setScanLogTimes({});
    clearAllSystemData();
    alert("تم مسح كافة البيانات بنجاح وتحديث السحابة.");
  }, []);

  // Handler: Manual Status Change in Attendance Report or Scanner
  const handleChangeAttendanceStatus = useCallback((barcode: string, dateKey: string, newStatus: string) => {
    const todayKey = getTodayKey();
    const isToday = dateKey === todayKey;
    
    const prevStatus = isToday ? attendanceToday[barcode] : (attendanceHistory[dateKey]?.[barcode]);
    if (prevStatus === newStatus) return;

    const dateMap = attendanceHistory[dateKey] || {};
    const updatedDateMap = { ...dateMap, [barcode]: newStatus };
    const updatedHistory = { ...attendanceHistory, [dateKey]: updatedDateMap };

    setAttendanceHistory(updatedHistory);

    let updatedToday = attendanceToday;
    if (isToday) {
      updatedToday = { ...attendanceToday, [barcode]: newStatus };
      setAttendanceToday(updatedToday);
    }

    const updatedStudents = students.map((s) => {
      if (s.barcode === barcode) {
        let attCount = s.totalAttendanceDays || 0;
        let absCount = s.totalAbsentDays || 0;

        // Undo previous status count
        if (prevStatus === "حضور" || prevStatus === "تأخير") {
          attCount = Math.max(0, attCount - 1);
        } else if (prevStatus === "غائب") {
          absCount = Math.max(0, absCount - 1);
        }

        // Apply new status count
        if (newStatus === "حضور" || newStatus === "تأخير") {
          attCount += 1;
        } else if (newStatus === "غائب") {
          absCount += 1;
        }

        return {
          ...s,
          totalAttendanceDays: attCount,
          totalAbsentDays: absCount,
        };
      }
      return s;
    });

    setStudents(updatedStudents);

    // Save and sync atomically for both today and historical date changes
    if (isToday) {
      saveAttendanceAndStudentsBatch(updatedToday, scanLogOrder, scanLogTimes, updatedStudents, true);
    } else {
      saveAttendanceHistoryData(updatedHistory, updatedStudents);
    }
  }, [attendanceToday, attendanceHistory, scanLogOrder, scanLogTimes, students]);

  // Handler: Record Payment
  const handleRecordPayment = useCallback((
    barcode: string,
    amount: number,
    monthKey: string,
    note?: string
  ) => {
    const today = getTodayKey();
    const time = formatTimeArabic();

    const monthData = payments[monthKey] || {};
    const newRecord: PaymentRecord = {
      barcode,
      month: monthKey,
      monthKey,
      amount,
      date: today,
      time,
      note: note || `اشتراك شهر ${monthKey}`,
      recordedBy: currentUser?.username || "admin",
    };

    const updatedPayments = {
      ...payments,
      [monthKey]: {
        ...monthData,
        [barcode]: newRecord,
      },
    };

    setPayments(updatedPayments);
    savePaymentsData(updatedPayments);

    // ⚡ Supabase Realtime: Broadcast Payment to all assistant devices in <20ms
    broadcastPaymentChange({
      action: "record",
      barcode,
      monthKey,
      amount,
      date: today,
      time,
      note: note || `اشتراك شهر ${monthKey}`,
      recordedBy: currentUser?.username || "admin",
      timestamp: Date.now(),
    }).catch(console.warn);

    // ⚡ Supabase Direct Persistence: Save payment
    savePaymentToSupabase({
      barcode,
      monthKey,
      amount,
      date: today,
      note,
      recordedBy: currentUser?.username || "admin",
    }).catch(console.warn);
  }, [payments, currentUser]);

  // Handler: Update / Move Payment (e.g. change month from 8 to 9, or correct amount/notes)
  const handleUpdatePayment = useCallback((
    oldMonthKey: string,
    barcode: string,
    newMonthKey: string,
    newAmount: number,
    newNote: string,
    newDate?: string
  ) => {
    const existing = payments[oldMonthKey]?.[barcode];
    const today = getTodayKey();
    const time = formatTimeArabic();

    const updatedPayments = { ...payments };

    // Remove from old month
    if (updatedPayments[oldMonthKey]) {
      const oldMonthMap = { ...updatedPayments[oldMonthKey] };
      delete oldMonthMap[barcode];
      updatedPayments[oldMonthKey] = oldMonthMap;
    }

    // Add to new month
    const newMonthMap = { ...(updatedPayments[newMonthKey] || {}) };
    newMonthMap[barcode] = {
      barcode,
      month: newMonthKey,
      monthKey: newMonthKey,
      amount: newAmount,
      date: newDate || existing?.date || today,
      time: existing?.time || time,
      note: newNote || `اشتراك شهر ${newMonthKey}`,
      recordedBy: existing?.recordedBy || currentUser?.username || "admin",
      isCardFee: existing?.isCardFee,
    };
    updatedPayments[newMonthKey] = newMonthMap;

    setPayments(updatedPayments);
    savePaymentsData(updatedPayments);

    // ⚡ Supabase Realtime: Broadcast payment update to all devices in <20ms
    broadcastPaymentChange({
      action: "update",
      barcode,
      monthKey: newMonthKey,
      amount: newAmount,
      date: newDate || existing?.date || today,
      time: existing?.time || time,
      note: newNote || `اشتراك شهر ${newMonthKey}`,
      recordedBy: existing?.recordedBy || currentUser?.username || "admin",
      timestamp: Date.now(),
    }).catch(console.warn);

    savePaymentToSupabase({
      barcode,
      monthKey: newMonthKey,
      amount: newAmount,
      date: newDate || existing?.date || today,
      note: newNote,
      recordedBy: existing?.recordedBy || currentUser?.username || "admin",
    }).catch(console.warn);
  }, [payments, currentUser]);

  // Handler: Delete Payment (revert student to unpaid for this month)
  const handleDeletePayment = useCallback((monthKey: string, barcode: string) => {
    if (!payments[monthKey]?.[barcode]) return;

    const updatedPayments = { ...payments };
    const monthMap = { ...updatedPayments[monthKey] };
    delete monthMap[barcode];
    updatedPayments[monthKey] = monthMap;

    setPayments(updatedPayments);
    savePaymentsData(updatedPayments);

    // ⚡ Supabase Realtime: Broadcast payment deletion
    broadcastPaymentChange({
      action: "delete",
      barcode,
      monthKey,
      amount: 0,
      date: "",
      time: "",
      note: "",
      recordedBy: "",
      timestamp: Date.now(),
    }).catch(console.warn);

    deletePaymentFromSupabase(barcode, monthKey).catch(console.warn);
  }, [payments]);

  // Handler: Record Exam Grade
  const handleRecordExamGrade = useCallback((
    barcode: string,
    examTitle: string,
    score: number,
    maxScore: number
  ) => {
    const pct = Math.round((score / maxScore) * 100);
    const scoreFormatted = `${score}/${maxScore} (${pct}%)`;

    const updated = students.map((s) => {
      if (s.barcode === barcode) {
        const scores = s.totalExamScores ? [...s.totalExamScores, pct] : [pct];
        const pointsBonus = pct === 100 ? 20 : pct >= 90 ? 10 : pct >= 75 ? 5 : 0;

        return {
          ...s,
          lastExamTitle: examTitle,
          lastExamScore: scoreFormatted,
          totalExamScores: scores,
          points: (s.points || 0) + pointsBonus,
        };
      }
      return s;
    });

    setStudents(updated);
    saveStudentsData(updated);
  }, [students]);

  // Handler: Update Grade Record from Cumulative Table
  const handleUpdateGradeRecord = (
    barcode: string,
    lastTitle: string,
    lastScore: string,
    newPoints: number,
    updatedScores: number[]
  ) => {
    const updated = students.map((s) => {
      if (s.barcode === barcode) {
        return {
          ...s,
          lastExamTitle: lastTitle,
          lastExamScore: lastScore,
          points: newPoints,
          totalExamScores: updatedScores,
        };
      }
      return s;
    });
    setStudents(updated);
    saveStudentsData(updated);
  };

  // Handler: Manage Users
  const handleAddUser = (newUser: UserAccount) => {
    const updated = [...usersList, newUser];
    setUsersList(updated);
    saveUsersData(updated);
  };

  const handleUpdateUser = (originalUsername: string, updatedUser: UserAccount) => {
    const updated = usersList.map((u) =>
      u.username === originalUsername ? updatedUser : u
    );
    setUsersList(updated);
    saveUsersData(updated);
    if (currentUser?.username === originalUsername) {
      setCurrentUser(updatedUser);
    }
  };

  const handleDeleteUser = (username: string) => {
    const updated = usersList.filter((u) => u.username !== username);
    setUsersList(updated);
    saveUsersData(updated);
  };

  // Handler: Change Password
  const handleChangePassword = (newPass: string) => {
    if (!currentUser) return;
    const updated = usersList.map((u) =>
      u.username === currentUser.username ? { ...u, pass: newPass } : u
    );
    setUsersList(updated);
    saveUsersData(updated);
    setCurrentUser({ ...currentUser, pass: newPass });
  };

  // Handler: Update Group Default Price
  const handleUpdateGroupPrice = (grade: GradeName, newPrice: number) => {
    const updated = { ...groupPrices, [grade]: newPrice };
    setGroupPrices(updated);
    saveGroupPricesData(updated);
  };

  // Handlers for WhatsApp Outbox
  const handleMarkWhatsAppSent = (id: string) => {
    markWhatsAppMessageSent(id);
    const nowStr = formatTimeArabic();
    setPendingWhatsAppMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, status: "sent", sentAt: nowStr } : m))
    );
  };

  const handleMarkAllWhatsAppSent = () => {
    markAllWhatsAppMessagesSent();
    const nowStr = formatTimeArabic();
    setPendingWhatsAppMessages((prev) =>
      prev.map((m) => (m.status === "pending" ? { ...m, status: "sent", sentAt: nowStr } : m))
    );
  };

  const handleDeleteWhatsAppMessage = (id: string) => {
    deletePendingWhatsAppMessage(id);
    setPendingWhatsAppMessages((prev) => prev.filter((m) => m.id !== id));
  };

  const handleClearAllWhatsAppMessages = () => {
    clearAllPendingWhatsAppMessages();
    setPendingWhatsAppMessages([]);
  };

  const handleUpdateWhatsAppMessageText = (id: string, newText: string) => {
    const updated = pendingWhatsAppMessages.map((m) =>
      m.id === id ? { ...m, message: newText } : m
    );
    savePendingWhatsAppMessages(updated);
    setPendingWhatsAppMessages(updated);
  };

  const pendingWhatsAppCount = pendingWhatsAppMessages.filter(
    (m) => m.status === "pending"
  ).length;

  const unreadPlatformMessagesCount = useMemo(() => {
    return platformMessages.filter((m) => m.status === "pending").length;
  }, [platformMessages]);

  // If Portal Mode is active, render the dedicated Parents & Admins Portal
  if (appViewMode === "portal") {
    return (
      <div dir="rtl">
        <PortalMasterApp
          students={students}
          attendanceToday={attendanceToday}
          attendanceHistory={attendanceHistory}
          payments={payments}
          scanLogTimes={scanLogTimes}
        />
      </div>
    );
  }

  return (
    <div
      dir="rtl"
      data-theme={theme}
      className={`min-h-screen ${
        theme === "light"
          ? "bg-slate-100 text-slate-900"
          : "bg-[#070b14] text-slate-100"
      } font-['Readex_Pro','Cairo',sans-serif] selection:bg-amber-500 selection:text-black`}
    >
      {/* 1. Auth Overlay (Login) */}
      {!currentUser && (
        <AuthOverlay
          usersList={usersList}
          onLoginSuccess={(user) => setCurrentUser(user)}
        />
      )}

      {currentUser && (
        <div className="flex flex-col h-screen overflow-hidden">
          {/* Top Navbar */}
          <Navbar
            currentUser={currentUser}
            currentDateText={formatArabicDate()}
            isOnline={syncStatus.isOnline}
            isSyncing={syncStatus.isSyncing}
            hasPendingSync={syncStatus.hasPendingSync}
            isQuotaExceeded={syncStatus.isQuotaExceeded}
            onManualSync={handleManualSync}
            onOpenMultiDeviceSync={() => setIsMultiDeviceSyncModalOpen(true)}
            unreadPlatformMessagesCount={unreadPlatformMessagesCount}
            onNavigateToPlatformMessages={() => handleSelectTab("platform-messages")}
            pendingWhatsAppCount={pendingWhatsAppCount}
            onOpenWhatsAppOutbox={() => setIsWhatsAppOutboxOpen(true)}
            theme={theme}
            onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
            voiceEnabled={voiceEnabled}
            onToggleVoice={() => setVoiceEnabled(!voiceEnabled)}
            onLogout={() => setCurrentUser(null)}
            activeSessionSlotId={activeSessionSlotId}
            onChangeSessionSlot={(slotId) => setActiveSessionSlotId(slotId)}
            onOpenQuickScan={() => setActiveTab("attendance-scan")}
            onOpenPrintAllPDF={() => setPrintModal({ open: true, type: "all" })}
            isSidebarOpen={isSidebarOpen}
            onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
            onOpenPortal={() => {
              const url = `${window.location.origin}${window.location.pathname}?portal=true`;
              const win = window.open(url, "_blank");
              if (!win || win.closed || typeof win.closed === "undefined") {
                setAppViewMode("portal");
                localStorage.setItem("app_view_mode", "portal");
              }
            }}
          />

          {/* Floating Synchronization Notification Banner */}
          {syncBanner?.show && (
            <div className="px-4 py-2 max-w-5xl mx-auto w-full no-print">
              <div
                className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-2xl text-xs md:text-sm font-black border shadow-lg transition-all animate-fadeIn ${
                  syncBanner.type === "online-synced"
                    ? "bg-emerald-950/90 text-emerald-300 border-emerald-500/40 shadow-emerald-950/40"
                    : "bg-amber-950/90 text-amber-300 border-amber-500/40 shadow-amber-950/40"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {syncBanner.type === "online-synced" ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  ) : (
                    <WifiOff className="w-5 h-5 text-amber-400 shrink-0" />
                  )}
                  <span>{syncBanner.message}</span>
                </div>
                <button
                  onClick={() => setSyncBanner(null)}
                  className="p-1 rounded-lg hover:bg-white/10 text-white/70 hover:text-white cursor-pointer"
                  title="إغلاق التنبيه"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Pending WhatsApp Outbox Global Notice Banner */}
          {pendingWhatsAppCount > 0 && (
            <div className="px-4 py-1.5 max-w-5xl mx-auto w-full no-print">
              <div className="bg-gradient-to-r from-emerald-950/90 via-[#0a1a16] to-emerald-950/90 border border-emerald-500/50 p-3 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-xl">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-xl bg-emerald-500/20 text-emerald-400">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-black text-emerald-300">
                    توجد لديك <span className="font-mono text-white underline">{pendingWhatsAppCount}</span> رسائل واتساب معلقة (غياب / تأخير / درجات / مصاريف) بانتظار الإرسال!
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setIsWhatsAppOutboxOpen(true)}
                  className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 text-black text-xs font-black shadow-md shadow-emerald-500/20 transition-all flex items-center gap-1.5 cursor-pointer transform hover:scale-105"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>إرسال كافة رسائل الواتساب الآن 🚀</span>
                </button>
              </div>
            </div>
          )}

          {/* Main Layout Area: Separated into isolated scrolling Sidebar & isolated Main Container */}
          <div className="flex flex-1 min-w-0 overflow-hidden relative">
            {/* Sidebar Navigation */}
            <Sidebar
              activeTab={activeTab}
              currentUser={currentUser}
              isOpen={isSidebarOpen}
              onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
              onSelectTab={handleSelectTab}
              onCloseMobile={() => setIsSidebarOpen(false)}
              onOpenPdfModal={(type) => setPrintModal({ open: true, type })}
              onOpenPrintCards={() => setIsCardsModalOpen(true)}
              onOpenBulkHomework={() => setIsBulkHomeworkModalOpen(true)}
            />

            {/* Tab Body View Container with dedicated independent scrolling */}
            <main
              ref={mainScrollRef}
              className="flex-1 overflow-y-auto h-full p-3 md:p-6 lg:p-8 max-w-full min-w-0 custom-scrollbar relative"
            >
              <div className="max-w-7xl mx-auto w-full min-w-0 pb-16">
                {activeTab === "attendance-scan" && (
                <AttendanceScanner
                  students={students}
                  attendanceToday={attendanceToday}
                  scanLogOrder={scanLogOrder}
                  scanLogTimes={scanLogTimes}
                  payments={payments}
                  activeSessionSlotId={activeSessionSlotId}
                  voiceEnabled={voiceEnabled}
                  onRecordAttendance={handleRecordAttendance}
                  onFinishGroup={handleFinishGroup}
                  onRemoveFromScanner={handleRemoveFromScanner}
                  onClearSessionScans={handleClearSessionScans}
                  onChangeStatus={handleChangeAttendanceStatus}
                  onSyncGroupSession={handleSyncGroupSession}
                  onNavigateToReport={() => setActiveTab("stats")}
                />
              )}

              {activeTab === "homework-tracker" && (
                <HomeworkTrackerTab
                  students={students}
                  attendanceToday={attendanceToday}
                  onGoToMessages={() => handleSelectTab("platform-messages")}
                />
              )}

              {activeTab === "add-student" && (
                <AddStudentTab
                  students={students}
                  groupPrices={groupPrices}
                  onAddStudent={handleAddStudent}
                />
              )}

              {activeTab === "stats" && (
                <DailyAttendanceReport
                  students={students}
                  attendanceHistory={attendanceHistory}
                  onUpdateStatus={handleChangeAttendanceStatus}
                  onOpenPdfModal={(type) => setPrintModal({ open: true, type })}
                />
              )}

              {activeTab === "cumulative-report" && (
                <CumulativeGradesReport
                  students={students}
                  onUpdateGradeRecord={handleUpdateGradeRecord}
                  onOpenPdfModal={(type) => setPrintModal({ open: true, type })}
                />
              )}

              {activeTab === "pay-expenses" && (
                <PayExpensesTab
                  students={students}
                  payments={payments}
                  groupPrices={groupPrices}
                  onRecordPayment={handleRecordPayment}
                  onUpdatePayment={handleUpdatePayment}
                  onDeletePayment={handleDeletePayment}
                />
              )}

              {activeTab === "expenses" && (
                <FinancialsTab
                  students={students}
                  payments={payments}
                  groupPrices={groupPrices}
                  onOpenMultiDeviceSync={() => setIsMultiDeviceSyncModalOpen(true)}
                  onRecordPayment={handleRecordPayment}
                  onUpdatePayment={handleUpdatePayment}
                  onDeletePayment={handleDeletePayment}
                />
              )}

              {activeTab === "grades" && (
                <ExamGradesTab
                  students={students}
                  onRecordGrade={handleRecordExamGrade}
                />
              )}

              {activeTab === "early-warning" && (
                <EarlyWarningTab
                  students={students}
                  payments={payments}
                />
              )}

              {activeTab === "certificates" && (
                <CertificatesTab students={students} />
              )}

              {activeTab === "excel-integration" && (
                <ExcelIntegrationTab
                  students={students}
                  payments={payments}
                  attendanceHistory={attendanceHistory}
                  onBulkImportStudents={handleBulkImport}
                />
              )}

              {activeTab === "platform-messages" && (
                <PlatformMessagingTab
                  students={students}
                  messages={platformMessages}
                  attendanceToday={attendanceToday}
                  payments={payments}
                  onOpenManualWhatsApp={() => handleSelectTab("whatsapp-engine")}
                />
              )}

              {activeTab === "whatsapp-engine" && (
                <WhatsAppDirectTab
                  students={students}
                  onOpenWhatsAppOutbox={() => setIsWhatsAppOutboxOpen(true)}
                  pendingWhatsAppCount={pendingWhatsAppCount}
                />
              )}

              {activeTab === "manage-students" && (
                <ManageStudentsTab
                  students={students}
                  payments={payments}
                  groupPrices={groupPrices}
                  onUpdateStudent={handleUpdateStudent}
                  onDeleteStudent={handleDeleteStudent}
                  onClearAllData={handleClearAllData}
                  onOpenPrintCards={() => setIsCardsModalOpen(true)}
                  onOpenMultiDeviceSync={() => setIsMultiDeviceSyncModalOpen(true)}
                  onRecordPayment={handleRecordPayment}
                  onUpdatePayment={handleUpdatePayment}
                  onDeletePayment={handleDeletePayment}
                />
              )}

              {activeTab === "users" && (
                <UsersTab
                  usersList={usersList}
                  currentUser={currentUser}
                  onAddUser={handleAddUser}
                  onUpdateUser={handleUpdateUser}
                  onDeleteUser={handleDeleteUser}
                />
              )}

              {activeTab === "settings" && (
                <SettingsTab
                  currentUser={currentUser}
                  groupPrices={groupPrices}
                  theme={theme}
                  onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
                  onChangePassword={handleChangePassword}
                  onUpdateGroupPrice={handleUpdateGroupPrice}
                />
              )}
              </div>
            </main>
          </div>
        </div>
      )}

      {/* Grade-by-Grade Independent PDF Multi-Page Modal */}
      {printModal.open && (
        <PrintPDFModal
          type={printModal.type}
          students={students}
          attendanceToday={attendanceToday}
          payments={payments}
          groupPrices={groupPrices}
          onClose={() => setPrintModal({ ...printModal, open: false })}
        />
      )}

      {/* Student Barcode ID Cards Grid Modal */}
      {isCardsModalOpen && (
        <PrintCardsModal
          students={students}
          onClose={() => setIsCardsModalOpen(false)}
        />
      )}

      {/* Offline WhatsApp Outbox Queue Modal */}
      {isWhatsAppOutboxOpen && (
        <PendingWhatsAppOutboxModal
          isOpen={isWhatsAppOutboxOpen}
          onClose={() => setIsWhatsAppOutboxOpen(false)}
          pendingMessages={pendingWhatsAppMessages}
          isOnline={syncStatus.isOnline}
          onMarkSent={handleMarkWhatsAppSent}
          onMarkAllSent={handleMarkAllWhatsAppSent}
          onDeleteMessage={handleDeleteWhatsAppMessage}
          onClearAll={handleClearAllWhatsAppMessages}
          onUpdateMessageText={handleUpdateWhatsAppMessageText}
        />
      )}

      {/* Multi-Device Cloud Sync & Backup Modal */}
      {isMultiDeviceSyncModalOpen && (
        <MultiDeviceSyncModal
          isOpen={isMultiDeviceSyncModalOpen}
          onClose={() => setIsMultiDeviceSyncModalOpen(false)}
          students={students}
          payments={payments}
          groupPrices={groupPrices}
          isOnline={syncStatus.isOnline}
          onRecordPayment={handleRecordPayment}
        />
      )}

      {/* Bulk Group Homework Platform Notifications Modal */}
      {isBulkHomeworkModalOpen && (
        <BulkHomeworkModal
          isOpen={isBulkHomeworkModalOpen}
          onClose={() => setIsBulkHomeworkModalOpen(false)}
          students={students}
          attendanceToday={attendanceToday}
          targetDate={getTodayKey()}
        />
      )}
    </div>
  );
}
