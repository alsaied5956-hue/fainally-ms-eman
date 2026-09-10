import React, { useState, useMemo, useEffect, useRef } from "react";
import { Student } from "../../types";
import {
  ParentAccount,
  ParentChatMessage,
  AdminPortalSettings,
  AdminPortalTab,
} from "../../types/portal";
import {
  getLocalParentAccounts,
  persistParentAccount,
  deleteParentAccount,
  getAdminPortalSettings,
  saveAdminPortalSettings,
  getLocalChatMessages,
  sendParentChatMessage,
  markChatThreadRead,
  subscribeToThreadChat,
  subscribeToAllChats,
  syncParentAccountsFromCloud,
  activateParentAccountDirectly,
  batchActivateParentAccounts,
} from "../../utils/portalStorage";
import { openWhatsApp } from "../../utils/helpers";
import {
  sendPortalNotification,
  playPortalAudioChime,
  requestNotificationPermission,
} from "../../utils/portalNotifications";
import { PWAInstallButton } from "./PWAInstallButton";
import {
  ShieldAlert,
  Users,
  MessageSquare,
  Settings,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Lock,
  KeyRound,
  Trash2,
  Edit,
  Send,
  Bell,
  BellRing,
  LogOut,
  Smartphone,
  Eye,
  EyeOff,
  UserX,
  UserCheck,
  Sparkles,
  Phone,
  Barcode,
  Save,
  Check,
  Zap,
  RotateCcw,
  GraduationCap,
  RefreshCw,
  ArrowRight,
  CheckCheck,
  MessageCircle,
  X,
} from "lucide-react";

interface AdminControlPanelProps {
  students: Student[];
  onLogout: () => void;
}

export const AdminControlPanel: React.FC<AdminControlPanelProps> = ({
  students,
  onLogout,
}) => {
  const [activeTab, setActiveTab] = useState<AdminPortalTab>("accounts");

  // Accounts state
  const [accounts, setAccounts] = useState<Record<string, ParentAccount>>(() =>
    getLocalParentAccounts()
  );
  const [isSyncingAccounts, setIsSyncingAccounts] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "unactivated" | "disabled">("all");
  const [gradeFilter, setGradeFilter] = useState<string>("all");

  // Passwords visibility toggle
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, boolean>>({});
  const [revealAllPasswords, setRevealAllPasswords] = useState(false);

  // Activate Modal State
  const [activatingItem, setActivatingItem] = useState<{
    barcode: string;
    studentName: string;
    grade: string;
    phone: string;
  } | null>(null);
  const [actPhone, setActPhone] = useState("");
  const [actPassword, setActPassword] = useState("1234");
  const [actFeedback, setActFeedback] = useState<string | null>(null);
  const [isActivating, setIsActivating] = useState(false);

  // Batch Activation Modal State
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchPassword, setBatchPassword] = useState("1234");
  const [batchFeedback, setBatchFeedback] = useState<string | null>(null);
  const [isBatchActivating, setIsBatchActivating] = useState(false);

  // Edit Account Modal State
  const [editingAccount, setEditingAccount] = useState<ParentAccount | null>(null);
  const [editingStudentName, setEditingStudentName] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editBarcode, setEditBarcode] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editFeedback, setEditFeedback] = useState<string | null>(null);

  // Delete Confirmation Modal State (Reliable in-app modal, replaces window.confirm)
  const [accountToDelete, setAccountToDelete] = useState<{ barcode: string; studentName: string } | null>(null);

  // Settings State
  const [adminSettings, setAdminSettings] = useState<AdminPortalSettings>(() =>
    getAdminPortalSettings()
  );
  const [newAdminBarcode, setNewAdminBarcode] = useState(adminSettings.adminBarcode);
  const [newAdminPassword, setNewAdminPassword] = useState(adminSettings.adminPassword);
  const [pushEnabled, setPushEnabled] = useState(adminSettings.pushNotificationsEnabled);
  const [soundEnabled, setSoundEnabled] = useState(adminSettings.soundAlertsEnabled);
  const [settingsFeedback, setSettingsFeedback] = useState<string | null>(null);

  // Messaging Center State (WhatsApp-Style Direct Experience)
  const [selectedChatBarcode, setSelectedChatBarcode] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ParentChatMessage[]>([]);
  const [adminChatText, setAdminChatText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [chatSearch, setChatSearch] = useState("");
  const [chatTabFilter, setChatTabFilter] = useState<"all" | "unread" | "active">("all");
  const [allChats, setAllChats] = useState<Record<string, ParentChatMessage[]>>(() => getLocalChatMessages());
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  // Live real-time action feedback for activate, disable, delete with remote logout notification
  const [liveActionFeedback, setLiveActionFeedback] = useState<string | null>(null);

  // Initial cloud sync
  useEffect(() => {
    handleCloudSync();
  }, []);

  const handleCloudSync = async () => {
    setIsSyncingAccounts(true);
    try {
      const synced = await syncParentAccountsFromCloud();
      setAccounts(synced);
    } catch (err) {
      console.warn("Could not sync cloud accounts:", err);
    } finally {
      setIsSyncingAccounts(false);
    }
  };

  // Reload accounts from storage
  const reloadAccounts = () => {
    setAccounts(getLocalParentAccounts());
  };

  // Extract unique grades from registered students
  const gradeOptions = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => {
      if (s.groupGrade) set.add(s.groupGrade);
    });
    return Array.from(set).sort();
  }, [students]);

  // Unified list of all enrolled students and their account state
  const unifiedAccountsList = useMemo(() => {
    const list: Array<{
      barcode: string;
      studentName: string;
      grade: string;
      parentPhone: string;
      status: "active" | "unactivated" | "disabled";
      account?: ParentAccount;
      password?: string;
      linkedCount: number;
      createdAt?: string;
      lastLoginAt?: string;
    }> = [];

    const handledBarcodes = new Set<string>();

    // 1. All enrolled students
    for (const st of students) {
      handledBarcodes.add(st.barcode);
      const acc = accounts[st.barcode];
      const status: "active" | "unactivated" | "disabled" = acc ? acc.status : "unactivated";
      const phone = acc?.parentPhone || st.parentPhone || st.phone || "";

      list.push({
        barcode: st.barcode,
        studentName: st.name,
        grade: st.groupGrade || "غير محدد",
        parentPhone: phone,
        status,
        account: acc,
        password: acc?.password,
        linkedCount: acc?.linkedBarcodes?.length || 0,
        createdAt: acc?.createdAt,
        lastLoginAt: acc?.lastLoginAt,
      });
    }

    // 2. Extra parent accounts not directly in students list (if any)
    for (const [bCode, acc] of Object.entries(accounts) as [string, ParentAccount][]) {
      if (!handledBarcodes.has(bCode) && acc) {
        list.push({
          barcode: bCode,
          studentName: `طالب (${bCode})`,
          grade: "غير محدد",
          parentPhone: acc.parentPhone,
          status: acc.status,
          account: acc,
          password: acc.password,
          linkedCount: acc.linkedBarcodes?.length || 0,
          createdAt: acc.createdAt,
          lastLoginAt: acc.lastLoginAt,
        });
      }
    }

    return list;
  }, [students, accounts]);

  // Summary counts
  const totalStudentsCount = unifiedAccountsList.length;
  const activeCount = useMemo(
    () => unifiedAccountsList.filter((a) => a.status === "active").length,
    [unifiedAccountsList]
  );
  const unactivatedCount = useMemo(
    () => unifiedAccountsList.filter((a) => a.status === "unactivated").length,
    [unifiedAccountsList]
  );
  const disabledCount = useMemo(
    () => unifiedAccountsList.filter((a) => a.status === "disabled").length,
    [unifiedAccountsList]
  );

  // Filtered accounts
  const filteredAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return unifiedAccountsList.filter((item) => {
      const matchesSearch =
        !q ||
        item.barcode.toLowerCase().includes(q) ||
        item.studentName.toLowerCase().includes(q) ||
        item.parentPhone.includes(q) ||
        (item.password && item.password.toLowerCase().includes(q));

      const matchesStatus =
        statusFilter === "all" || item.status === statusFilter;

      const matchesGrade =
        gradeFilter === "all" || item.grade === gradeFilter;

      return matchesSearch && matchesStatus && matchesGrade;
    });
  }, [unifiedAccountsList, searchQuery, statusFilter, gradeFilter]);

  // Realtime subscription for all chats across the system (WhatsApp-style instant updates)
  useEffect(() => {
    const unsub = subscribeToAllChats((updatedChats) => {
      setAllChats(updatedChats);
    });
    return () => unsub();
  }, []);

  // Realtime subscription for selected chat thread
  useEffect(() => {
    if (!selectedChatBarcode) {
      setChatMessages([]);
      return;
    }

    const unsub = subscribeToThreadChat(selectedChatBarcode, (msgs) => {
      setChatMessages(msgs);
      markChatThreadRead(selectedChatBarcode, "admin");
    });

    // Auto-focus input when entering chat
    const timer = setTimeout(() => {
      chatInputRef.current?.focus();
    }, 150);

    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, [selectedChatBarcode]);

  useEffect(() => {
    if (activeTab === "chats" && selectedChatBarcode) {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
      markChatThreadRead(selectedChatBarcode, "admin");
    }
  }, [chatMessages, activeTab, selectedChatBarcode]);

  // Total unread chat messages across all parents
  const totalUnreadChatCount = useMemo(() => {
    let count = 0;
    Object.values(allChats).forEach((msgs) => {
      if (Array.isArray(msgs)) {
        count += msgs.filter((m: ParentChatMessage) => m.sender === "parent" && !m.isRead).length;
      }
    });
    return count;
  }, [allChats]);

  // All chat threads summarized with strict WhatsApp-style sorting (Latest active on top)
  const chatThreadsSummary = useMemo(() => {
    const q = chatSearch.trim().toLowerCase();
    const barcodeSet = new Set([
      ...Object.keys(allChats),
      ...unifiedAccountsList.map((a) => a.barcode),
    ]);

    return Array.from(barcodeSet)
      .map((bCode) => {
        const student = students.find((s) => s.barcode === bCode);
        const msgs = allChats[bCode] || [];
        const unreadCount = msgs.filter((m) => m.sender === "parent" && !m.isRead).length;
        const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;

        return {
          barcode: bCode,
          studentName: student?.name || `طالب (${bCode})`,
          studentGrade: student?.groupGrade || "غير محدد",
          parentPhone: student?.parentPhone || student?.phone || "",
          unreadCount,
          lastMsg,
        };
      })
      .filter((th) => {
        // Quick tabs filtering
        if (chatTabFilter === "unread" && th.unreadCount === 0) return false;
        if (chatTabFilter === "active" && !th.lastMsg) return false;

        if (!q) return true;
        return (
          th.barcode.includes(q) ||
          th.studentName.toLowerCase().includes(q) ||
          th.parentPhone.includes(q) ||
          (th.lastMsg?.text || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const timeA = a.lastMsg?.timestamp || 0;
        const timeB = b.lastMsg?.timestamp || 0;

        // 1. WhatsApp Priority: Newest message at the very top (highest timestamp first)
        if (timeA > 0 && timeB > 0) {
          return timeB - timeA;
        }

        // 2. Active conversations with messages always appear before empty conversations
        if (timeA > 0 && timeB === 0) return -1;
        if (timeA === 0 && timeB > 0) return 1;

        // 3. Unread messages come before read messages
        if (a.unreadCount !== b.unreadCount) {
          return b.unreadCount - a.unreadCount;
        }

        // 4. Alphabetical by student name
        return a.studentName.localeCompare(b.studentName, "ar");
      });
  }, [unifiedAccountsList, allChats, students, chatSearch, chatTabFilter]);

  // Action: Open Activate Modal for Unactivated Student
  const handleOpenActivateModal = (item: {
    barcode: string;
    studentName: string;
    grade: string;
    parentPhone: string;
  }) => {
    setActivatingItem({
      barcode: item.barcode,
      studentName: item.studentName,
      grade: item.grade,
      phone: item.parentPhone,
    });
    setActPhone(item.parentPhone || "0");
    setActPassword("1234");
    setActFeedback(null);
  };

  // Action: Save Activation
  const handleConfirmActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activatingItem) return;
    if (!actPassword.trim()) {
      setActFeedback("يرجى إدخال كلمة مرور للحساب.");
      return;
    }
    setIsActivating(true);
    try {
      await activateParentAccountDirectly(
        activatingItem.barcode,
        actPhone.trim() || activatingItem.phone,
        actPassword.trim()
      );
      reloadAccounts();
      setActFeedback(`تم تفعيل حساب ولي أمر الطالب (${activatingItem.studentName}) بنجاح!`);
      setTimeout(() => {
        setActivatingItem(null);
        setActFeedback(null);
      }, 900);
    } catch (err) {
      setActFeedback("حدث خطأ أثناء التفعيل السحابي.");
    } finally {
      setIsActivating(false);
    }
  };

  // Action: Batch Activate All Unactivated
  const handleConfirmBatchActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    const unactivatedStudents = unifiedAccountsList
      .filter((a) => a.status === "unactivated")
      .map((a) => ({
        studentBarcode: a.barcode,
        phone: a.parentPhone,
      }));

    if (unactivatedStudents.length === 0) {
      setBatchFeedback("جميع حسابات الطلاب مفعلة بالفعل!");
      return;
    }

    setIsBatchActivating(true);
    try {
      const count = await batchActivateParentAccounts(
        unactivatedStudents,
        batchPassword.trim() || "1234"
      );
      reloadAccounts();
      setBatchFeedback(`تم تفعيل ${count} حساب طالب بنجاح بكلمة المرور الموحدة!`);
      setTimeout(() => {
        setShowBatchModal(false);
        setBatchFeedback(null);
      }, 1200);
    } catch (err) {
      setBatchFeedback("حدث خطأ أثناء التفعيل المجمع.");
    } finally {
      setIsBatchActivating(false);
    }
  };

  // Action: Toggle Disable/Enable
  const handleToggleStatus = async (item: {
    barcode: string;
    account?: ParentAccount;
    status: string;
    studentName?: string;
  }) => {
    if (!item.account) return;
    const nextStatus = item.status === "active" ? "disabled" : "active";
    const updated: ParentAccount = {
      ...item.account,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    };
    await persistParentAccount(updated);
    reloadAccounts();
    if (nextStatus === "disabled") {
      setLiveActionFeedback(
        `🔒 تم تعطيل حساب الطالب (${item.studentName || item.barcode}) بنجاح، وتم تسجيل خروج ولي الأمر تلقائياً من هاتفه.`
      );
    } else {
      setLiveActionFeedback(
        `✅ تم إعادة تفعيل حساب الطالب (${item.studentName || item.barcode}) بنجاح.`
      );
    }
    setTimeout(() => setLiveActionFeedback(null), 6000);
  };

  // Action: Delete / Reset Account (opens in-app confirmation modal, no window.confirm)
  const handleDeleteAccount = (barcode: string, studentName: string) => {
    setAccountToDelete({ barcode, studentName });
  };

  // Action: Execute deletion after modal confirmation - 0ms instant execution
  const handleConfirmDeleteAccount = () => {
    if (!accountToDelete) return;
    const { barcode, studentName } = accountToDelete;
    
    // 1. Close modal instantly
    setAccountToDelete(null);

    // 2. Immediate local delete & instant UI refresh
    deleteParentAccount(barcode).catch(() => {});
    reloadAccounts();

    // 3. Instant affirmative feedback
    setLiveActionFeedback(
      `🗑️ تم حذف حساب ولي أمر (${studentName}) بنجاح، وتم إرسال أمر تسجيل الخروج التلقائي إلى هاتفه فوراً.`
    );
    setTimeout(() => setLiveActionFeedback(null), 5000);
  };

  // Action: Quick Direct Activate with Default Credentials
  const handleQuickActivate = async (item: {
    barcode: string;
    studentName: string;
    parentPhone: string;
  }) => {
    try {
      await activateParentAccountDirectly(
        item.barcode,
        item.parentPhone || "0",
        "1234"
      );
      reloadAccounts();
      setLiveActionFeedback(
        `⚡ تم تفعيل حساب ولي أمر (${item.studentName}) بنجاح بكلمة المرور الافتراضية (1234).`
      );
      setTimeout(() => setLiveActionFeedback(null), 6000);
    } catch {
      setLiveActionFeedback("حدث خطأ أثناء التفعيل السريع.");
    }
  };

  // Action: Open Edit Credentials Modal
  const handleOpenEditModal = (item: {
    barcode: string;
    studentName: string;
    account?: ParentAccount;
    parentPhone: string;
  }) => {
    if (!item.account) return;
    setEditingAccount(item.account);
    setEditingStudentName(item.studentName);
    setEditBarcode(item.account.studentBarcode);
    setEditPhone(item.account.parentPhone || item.parentPhone);
    setEditPassword(item.account.password);
    setEditFeedback(null);
  };

  // Action: Save Edited Credentials
  const handleSaveEditedCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount) return;

    if (!editPassword.trim()) {
      setEditFeedback("لا يمكن ترك كلمة المرور فارغة.");
      return;
    }

    const updated: ParentAccount = {
      ...editingAccount,
      studentBarcode: editBarcode.trim(),
      parentPhone: editPhone.trim(),
      password: editPassword.trim(),
      updatedAt: new Date().toISOString(),
    };

    await persistParentAccount(updated);
    reloadAccounts();
    setEditFeedback("تم تحديث بيانات الاعتماد سحابياً بنجاح!");
    setTimeout(() => {
      setEditingAccount(null);
      setEditFeedback(null);
    }, 1000);
  };

  // Action: Save Admin Settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminBarcode.trim() || !newAdminPassword.trim()) {
      setSettingsFeedback("يرجى إدخال كود المشرف وكلمة المرور.");
      return;
    }

    const updated: AdminPortalSettings = {
      adminBarcode: newAdminBarcode.trim(),
      adminPassword: newAdminPassword.trim(),
      pushNotificationsEnabled: pushEnabled,
      soundAlertsEnabled: soundEnabled,
      updatedAt: new Date().toISOString(),
    };

    await saveAdminPortalSettings(updated);
    setAdminSettings(updated);
    setSettingsFeedback("تم حفظ وتحديث إعدادات المشرف بنجاح!");
    setTimeout(() => setSettingsFeedback(null), 3500);
  };

  // Action: Send Admin Chat Message (Instant 0ms Feedback + WhatsApp Top-Ranked Reorder)
  const handleSendAdminChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChatBarcode || !adminChatText.trim() || isSending) return;

    setIsSending(true);
    const text = adminChatText.trim();
    setAdminChatText("");

    try {
      const sentMsg = await sendParentChatMessage(
        selectedChatBarcode,
        "admin",
        "المشرف العام (أستاذة إيمان الدمشيتي)",
        text
      );

      // Instant local append for seamless 0-lag chat experience
      setChatMessages((prev) => {
        if (prev.some((m) => m.id === sentMsg.id)) return prev;
        return [...prev, sentMsg];
      });

      // Update allChats to instantly bring this thread to top of WhatsApp list
      setAllChats(getLocalChatMessages());

      setTimeout(() => {
        chatInputRef.current?.focus();
        chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    } catch (err) {
      console.warn("Error sending admin chat:", err);
    } finally {
      setIsSending(false);
    }
  };

  // Quick Chat Reply Template
  const handleQuickReply = (text: string) => {
    setAdminChatText(text);
  };

  // Test Notification & Chime
  const handleTestChimeAndNotification = async () => {
    playPortalAudioChime("grade");
    await sendPortalNotification(
      "منظومة الأستاذة إيمان الدمشيتي",
      "تجربة إشعار المشرف ورنين التنبيه الصوتي بنجاح!",
      "grade"
    );
  };

  return (
    <div className="min-h-screen bg-[#050711] text-slate-100 font-tajawal selection:bg-amber-500 selection:text-black">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-40 bg-slate-900/95 border-b border-indigo-500/30 backdrop-blur-md px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-500/40 text-indigo-400 flex items-center justify-center shadow-lg">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold font-fancy text-white">
                  لوحة تحكم المشرف العام
                </h1>
                <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-[10px] font-bold">
                  إدارة البوابة
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                إدارة حسابات أولياء الأمور، المحادثات المباشرة، وضبط الإشعارات
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <PWAInstallButton variant="compact" />

            <button
              type="button"
              onClick={onLogout}
              className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 transition cursor-pointer"
              title="تسجيل الخروج"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="max-w-7xl mx-auto mt-3 pt-2 border-t border-slate-800 flex items-center gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab("accounts")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer whitespace-nowrap ${
              activeTab === "accounts"
                ? "bg-indigo-600 text-white font-extrabold shadow-md"
                : "bg-slate-800/60 text-slate-400 hover:text-white"
            }`}
          >
            <Users className="w-4 h-4" />
            <span>إدارة ومتابعة حسابات أولياء الأمور</span>
            <span className="px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 text-[10px] font-mono">
              {activeCount} / {totalStudentsCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("chats")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer whitespace-nowrap ${
              activeTab === "chats"
                ? "bg-indigo-600 text-white font-extrabold shadow-md"
                : "bg-slate-800/60 text-slate-400 hover:text-white"
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>مركز المحادثات والتواصل</span>
            {totalUnreadChatCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-extrabold animate-pulse">
                {totalUnreadChatCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("settings")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer whitespace-nowrap ${
              activeTab === "settings"
                ? "bg-indigo-600 text-white font-extrabold shadow-md"
                : "bg-slate-800/60 text-slate-400 hover:text-white"
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>إعدادات المشرف والنظام</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">

        {/* TAB 1: PARENT ACCOUNTS MANAGEMENT */}
        {activeTab === "accounts" && (
          <div className="space-y-6 animate-fadeIn">
            {/* Summary Statistics Cards (4 Cards) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {/* Total Enrolled Students */}
              <div 
                onClick={() => setStatusFilter("all")}
                className={`bg-slate-900/90 border rounded-3xl p-4 sm:p-5 shadow-xl flex items-center gap-3 sm:gap-4 cursor-pointer transition ${
                  statusFilter === "all" ? "border-indigo-500 bg-indigo-950/20" : "border-slate-800 hover:border-slate-700"
                }`}
              >
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div>
                  <span className="text-[11px] sm:text-xs text-slate-400 block">إجمالي طلاب المنظومة</span>
                  <div className="text-xl sm:text-2xl font-extrabold text-white font-mono">{totalStudentsCount}</div>
                </div>
              </div>

              {/* Active Accounts */}
              <div 
                onClick={() => setStatusFilter("active")}
                className={`bg-slate-900/90 border rounded-3xl p-4 sm:p-5 shadow-xl flex items-center gap-3 sm:gap-4 cursor-pointer transition ${
                  statusFilter === "active" ? "border-emerald-500 bg-emerald-950/20" : "border-slate-800 hover:border-slate-700"
                }`}
              >
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                  <UserCheck className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div>
                  <span className="text-[11px] sm:text-xs text-slate-400 block">الحسابات المفعلة (النشطة)</span>
                  <div className="text-xl sm:text-2xl font-extrabold text-emerald-400 font-mono">
                    {activeCount}
                  </div>
                </div>
              </div>

              {/* Unactivated Accounts */}
              <div 
                onClick={() => setStatusFilter("unactivated")}
                className={`bg-slate-900/90 border rounded-3xl p-4 sm:p-5 shadow-xl flex items-center gap-3 sm:gap-4 cursor-pointer transition ${
                  statusFilter === "unactivated" ? "border-amber-500 bg-amber-950/20" : "border-slate-800 hover:border-slate-700"
                }`}
              >
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div>
                  <span className="text-[11px] sm:text-xs text-slate-400 block">غير المفعلة (بانتظار التفعيل)</span>
                  <div className="text-xl sm:text-2xl font-extrabold text-amber-400 font-mono">
                    {unactivatedCount}
                  </div>
                </div>
              </div>

              {/* Disabled Accounts */}
              <div 
                onClick={() => setStatusFilter("disabled")}
                className={`bg-slate-900/90 border rounded-3xl p-4 sm:p-5 shadow-xl flex items-center gap-3 sm:gap-4 cursor-pointer transition ${
                  statusFilter === "disabled" ? "border-rose-500 bg-rose-950/20" : "border-slate-800 hover:border-slate-700"
                }`}
              >
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center shrink-0">
                  <UserX className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div>
                  <span className="text-[11px] sm:text-xs text-slate-400 block">الحسابات المعطلة مؤقتاً</span>
                  <div className="text-xl sm:text-2xl font-extrabold text-rose-400 font-mono">
                    {disabledCount}
                  </div>
                </div>
              </div>
            </div>

            {/* Live Action Notification Banner */}
            {liveActionFeedback && (
              <div className="p-4 rounded-2xl bg-indigo-950/90 border-2 border-indigo-500/50 text-indigo-200 text-xs sm:text-sm font-bold flex items-center justify-between shadow-2xl animate-fadeIn font-tajawal">
                <div className="flex items-center gap-2.5">
                  <Sparkles className="w-5 h-5 text-amber-400 shrink-0" />
                  <span>{liveActionFeedback}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setLiveActionFeedback(null)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-indigo-900/50 transition cursor-pointer"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Actions Bar & Global Controls */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl flex flex-wrap items-center justify-between gap-3">
              {/* Search Bar */}
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث بالاسم، كود الباركود، رقم الهاتف، أو كلمة المرور..."
                  className="w-full pr-10 pl-4 py-2.5 rounded-2xl bg-slate-950/70 border border-slate-700/80 focus:border-indigo-400 focus:outline-none text-xs text-white"
                />
              </div>

              {/* Filters & Quick Actions */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Status Filter */}
                <div className="flex items-center gap-1.5">
                  <Filter className="w-4 h-4 text-slate-400" />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                    className="px-3 py-2 rounded-2xl bg-slate-950/80 border border-slate-700 text-xs text-white focus:outline-none"
                  >
                    <option value="all">كل الطلاب ({totalStudentsCount})</option>
                    <option value="active">المفعلة فقط ({activeCount})</option>
                    <option value="unactivated">غير المفعلة ({unactivatedCount})</option>
                    <option value="disabled">المعطلة فقط ({disabledCount})</option>
                  </select>
                </div>

                {/* Grade Filter */}
                {gradeOptions.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <GraduationCap className="w-4 h-4 text-slate-400" />
                    <select
                      value={gradeFilter}
                      onChange={(e) => setGradeFilter(e.target.value)}
                      className="px-3 py-2 rounded-2xl bg-slate-950/80 border border-slate-700 text-xs text-white focus:outline-none"
                    >
                      <option value="all">كل الصفوف الدراسية</option>
                      {gradeOptions.map((gr) => (
                        <option key={gr} value={gr}>{gr}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Password Visibility Toggle */}
                <button
                  type="button"
                  onClick={() => setRevealAllPasswords(!revealAllPasswords)}
                  className={`px-3 py-2 rounded-2xl border text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                    revealAllPasswords
                      ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                      : "bg-slate-800/80 border-slate-700 text-slate-300 hover:text-white"
                  }`}
                  title="إظهار / إخفاء كلمات المرور لجميع الحسابات"
                >
                  {revealAllPasswords ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  <span>{revealAllPasswords ? "إخفاء كلمات المرور" : "كشف كلمات المرور"}</span>
                </button>

                {/* Batch Activation Button */}
                {unactivatedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowBatchModal(true);
                      setBatchPassword("1234");
                      setBatchFeedback(null);
                    }}
                    className="px-3 py-2 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>تفعيل غير المفعلة ({unactivatedCount})</span>
                  </button>
                )}

                {/* Cloud Sync Button */}
                <button
                  type="button"
                  onClick={handleCloudSync}
                  disabled={isSyncingAccounts}
                  className="p-2 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition cursor-pointer"
                  title="مزامنة سحابية فورية للحسابات"
                >
                  <RefreshCw className={`w-4 h-4 ${isSyncingAccounts ? "animate-spin text-indigo-400" : ""}`} />
                </button>
              </div>
            </div>

            {/* Accounts Table */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl overflow-x-auto max-h-[72vh] overflow-y-auto custom-scrollbar">
              <table className="w-full text-right text-xs">
                <thead className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur-md">
                  <tr className="border-b border-slate-800 text-slate-400 font-bold">
                    <th className="py-3 px-3">كود الطالب</th>
                    <th className="py-3 px-3">اسم الطالب والصف</th>
                    <th className="py-3 px-3">هاتف ولي الأمر</th>
                    <th className="py-3 px-3">كلمة المرور</th>
                    <th className="py-3 px-3 text-center">حالة الحساب</th>
                    <th className="py-3 px-3 text-center">إجراءات التحكم والضبط</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-tajawal">
                  {filteredAccounts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        لا توجد حسابات تطابق معايير البحث والفلترة.
                      </td>
                    </tr>
                  ) : (
                    filteredAccounts.map((item) => {
                      const isRevealed = revealAllPasswords || revealedPasswords[item.barcode];
                      const isUnactivated = item.status === "unactivated";
                      const isActive = item.status === "active";
                      const isDisabled = item.status === "disabled";

                      return (
                        <tr key={item.barcode} className="hover:bg-slate-800/40 transition">
                          {/* Barcode */}
                          <td className="py-3.5 px-3 font-mono font-bold text-amber-300">
                            {item.barcode}
                          </td>

                          {/* Student Name and Grade */}
                          <td className="py-3.5 px-3">
                            <div className="font-bold text-white text-sm">{item.studentName}</div>
                            <div className="text-[11px] text-slate-400">{item.grade}</div>
                          </td>

                          {/* Parent Phone */}
                          <td className="py-3.5 px-3 font-mono text-slate-300">
                            {item.parentPhone ? (
                              <span dir="ltr">{item.parentPhone}</span>
                            ) : (
                              <span className="text-slate-600 text-[11px]">غير مسجل</span>
                            )}
                          </td>

                          {/* Password */}
                          <td className="py-3.5 px-3">
                            {item.password ? (
                              <div className="flex items-center gap-1.5 font-mono text-xs">
                                <span className={isRevealed ? "text-amber-400 font-bold" : "text-slate-400 tracking-widest"}>
                                  {isRevealed ? item.password : "••••••"}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRevealedPasswords((prev) => ({
                                      ...prev,
                                      [item.barcode]: !prev[item.barcode],
                                    }))
                                  }
                                  className="text-slate-500 hover:text-slate-300 p-0.5"
                                  title="إظهار / إخفاء كلمة المرور"
                                >
                                  {isRevealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-600 text-[11px]">لم تعين بعد</span>
                            )}
                          </td>

                          {/* Status Badge */}
                          <td className="py-3.5 px-3 text-center">
                            {isActive && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold text-[11px]">
                                <CheckCircle2 className="w-3 h-3" />
                                مفعل (نشط)
                              </span>
                            )}
                            {isUnactivated && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 font-bold text-[11px]">
                                <Clock className="w-3 h-3" />
                                غير مفعل
                              </span>
                            )}
                            {isDisabled && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 font-bold text-[11px]">
                                <XCircle className="w-3 h-3" />
                                معطل مؤقتاً
                              </span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="py-3.5 px-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {/* Unactivated State Actions */}
                              {isUnactivated && (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleQuickActivate(item)}
                                    className="px-2 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold text-xs transition shadow-sm flex items-center gap-1 cursor-pointer"
                                    title="تفعيل فوري بكلمة مرور (1234)"
                                  >
                                    <Zap className="w-3.5 h-3.5" />
                                    <span className="hidden sm:inline">سريع (1234)</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenActivateModal(item)}
                                    className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition shadow-md flex items-center gap-1 cursor-pointer"
                                    title="تفعيل مخصص وتعيين كلمة المرور"
                                  >
                                    <UserCheck className="w-3.5 h-3.5" />
                                    <span>تفعيل الحساب</span>
                                  </button>
                                </div>
                              )}

                              {/* Active State Actions */}
                              {isActive && (
                                <>
                                  {/* Edit Credentials */}
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditModal(item)}
                                    className="p-1.5 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 transition cursor-pointer"
                                    title="تعديل بيانات الاعتماد وكلمة المرور"
                                  >
                                    <Edit className="w-3.5 h-3.5" />
                                  </button>

                                  {/* Disable Account (Forces Remote Logout) */}
                                  <button
                                    type="button"
                                    onClick={() => handleToggleStatus(item)}
                                    className="p-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 hover:text-amber-200 transition cursor-pointer"
                                    title="تعطيل الحساب مؤقتاً وتسجيل خروج هاتف ولي الأمر تلقائياً"
                                  >
                                    <UserX className="w-3.5 h-3.5" />
                                  </button>

                                  {/* Delete / Reset to unactivated (Forces Remote Logout) */}
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteAccount(item.barcode, item.studentName)}
                                    className="p-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/25 text-rose-400 hover:text-rose-200 transition cursor-pointer"
                                    title="إزالة / حذف الحساب نهائياً وتسجيل خروج ولي الأمر تلقائياً"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}

                              {/* Disabled State Actions */}
                              {isDisabled && (
                                <>
                                  {/* Re-activate Account */}
                                  <button
                                    type="button"
                                    onClick={() => handleToggleStatus(item)}
                                    className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition shadow-md flex items-center gap-1 cursor-pointer"
                                    title="إعادة تفعيل الحساب للنشاط والسماح لولي الأمر بالدخول"
                                  >
                                    <UserCheck className="w-3.5 h-3.5" />
                                    <span>إعادة تفعيل</span>
                                  </button>

                                  {/* Edit Credentials */}
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditModal(item)}
                                    className="p-1.5 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 transition cursor-pointer"
                                    title="تعديل بيانات الاعتماد"
                                  >
                                    <Edit className="w-3.5 h-3.5" />
                                  </button>

                                  {/* Delete / Reset */}
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteAccount(item.barcode, item.studentName)}
                                    className="p-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 transition cursor-pointer"
                                    title="حذف الحساب نهائياً"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
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
          </div>
        )}

        {/* TAB 2: MESSAGING CENTER (WHATSAPP-STYLE DIRECT IMMERSIVE INTERFACE) */}
        {activeTab === "chats" && (
          <div className="bg-slate-900/95 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden h-[calc(100vh-190px)] min-h-[580px] max-h-[760px] flex animate-fadeIn relative">
            {/* 1. LEFT PANE: THREADS CONVERSATION LIST (Visible on mobile when no chat is selected, and always visible on lg screens) */}
            <div
              className={`${
                selectedChatBarcode ? "hidden lg:flex" : "flex"
              } flex-col h-full w-full lg:w-80 xl:w-96 shrink-0 border-l border-slate-800 bg-slate-950/60`}
            >
              {/* Top Header of Threads List */}
              <div className="p-3.5 sm:p-4 border-b border-slate-800 bg-slate-900/60 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                      <MessageSquare className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-xs sm:text-sm font-bold text-white">محادثات أولياء الأمور</h3>
                      <p className="text-[10px] text-slate-400">تواصل مباشر ولحظي</p>
                    </div>
                  </div>
                  {totalUnreadChatCount > 0 ? (
                    <span className="px-2.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold animate-pulse">
                      {totalUnreadChatCount} جديدة
                    </span>
                  ) : (
                    <span className="text-[11px] text-indigo-400 font-mono">
                      {chatThreadsSummary.length} محادثة
                    </span>
                  )}
                </div>

                {/* WhatsApp Search Bar */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={chatSearch}
                    onChange={(e) => setChatSearch(e.target.value)}
                    placeholder="بحث بالاسم أو الكود أو رقم الهاتف..."
                    className="w-full pr-8 pl-8 py-2 rounded-xl bg-slate-900/90 border border-slate-700/80 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition"
                  />
                  {chatSearch && (
                    <button
                      type="button"
                      onClick={() => setChatSearch("")}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* WhatsApp Filter Chips */}
                <div className="flex items-center gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setChatTabFilter("all")}
                    className={`px-3 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                      chatTabFilter === "all"
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "bg-slate-800/80 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    الكل ({chatThreadsSummary.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setChatTabFilter("unread")}
                    className={`px-3 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer flex items-center gap-1 ${
                      chatTabFilter === "unread"
                        ? "bg-rose-600 text-white shadow-sm"
                        : "bg-slate-800/80 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <span>غير مقروءة</span>
                    {totalUnreadChatCount > 0 && (
                      <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setChatTabFilter("active")}
                    className={`px-3 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                      chatTabFilter === "active"
                        ? "bg-emerald-600 text-white shadow-sm"
                        : "bg-slate-800/80 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    النشطة
                  </button>
                </div>
              </div>

              {/* Scrollable Threads List with WhatsApp-Style Avatars and Preview */}
              <div className="flex-1 overflow-y-auto divide-y divide-slate-800/50">
                {chatThreadsSummary.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400 space-y-2">
                    <MessageSquare className="w-8 h-8 mx-auto text-slate-600" />
                    <p className="font-bold text-white">لا توجد محادثات مطابقة</p>
                    <p className="text-[11px] text-slate-500">جرب البحث بكود أو اسم مختلف</p>
                  </div>
                ) : (
                  chatThreadsSummary.map((thread) => {
                    const isSelected = selectedChatBarcode === thread.barcode;
                    return (
                      <button
                        key={thread.barcode}
                        type="button"
                        onClick={() => setSelectedChatBarcode(thread.barcode)}
                        className={`w-full p-3 text-right transition cursor-pointer flex items-center gap-3 relative group ${
                          isSelected
                            ? "bg-indigo-600/20 border-r-4 border-indigo-500"
                            : "hover:bg-slate-900/80"
                        }`}
                      >
                        {/* Avatar with Status indicator */}
                        <div className="relative shrink-0">
                          <div
                            className={`w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-xs shadow-md ${
                              thread.unreadCount > 0
                                ? "bg-gradient-to-br from-rose-500 to-amber-600 text-white ring-2 ring-rose-500/40"
                                : "bg-gradient-to-br from-indigo-600 to-slate-800 text-indigo-200"
                            }`}
                          >
                            {thread.studentName.slice(0, 2)}
                          </div>
                          {thread.unreadCount > 0 && (
                            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-rose-500 rounded-full border-2 border-slate-950 animate-pulse" />
                          )}
                        </div>

                        {/* Middle Text: Name & Last Message snippet */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <h4 className="font-bold text-white text-xs truncate">
                              {thread.studentName}
                            </h4>
                            {thread.lastMsg && (
                              <span className="text-[10px] text-slate-400 font-mono shrink-0">
                                {thread.lastMsg.timeFormatted}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] text-slate-400 truncate flex items-center gap-1">
                              {thread.lastMsg ? (
                                <>
                                  {thread.lastMsg.sender === "admin" && (
                                    <CheckCheck className="w-3.5 h-3.5 text-indigo-400 shrink-0 inline" />
                                  )}
                                  <span>{thread.lastMsg.text}</span>
                                </>
                              ) : (
                                <span className="text-slate-500 italic">بدء محادثة جديدة...</span>
                              )}
                            </p>

                            {thread.unreadCount > 0 && (
                              <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-extrabold shrink-0 shadow">
                                {thread.unreadCount}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 font-mono">
                              #{thread.barcode}
                            </span>
                            <span className="text-[9px] text-slate-400 truncate">
                              {thread.studentGrade}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* 2. RIGHT PANE: ACTIVE CHAT CONVERSATION (Direct immersion on mobile, full side-by-side on lg) */}
            <div
              className={`${
                !selectedChatBarcode ? "hidden lg:flex" : "flex"
              } flex-col flex-1 h-full bg-slate-900/40 relative`}
            >
              {selectedChatBarcode ? (
                <>
                  {/* WhatsApp-Style Chat Top Bar with Back Button on Mobile */}
                  {(() => {
                    const activeStudent = students.find((s) => s.barcode === selectedChatBarcode);
                    const studentPhone = activeStudent?.parentPhone || activeStudent?.phone || "";
                    return (
                      <div className="p-3 sm:p-4 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between gap-3 shadow-md shrink-0">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {/* Back to Chats list button (Returns directly to list on Mobile) */}
                          <button
                            type="button"
                            onClick={() => setSelectedChatBarcode(null)}
                            title="العودة لقائمة المحادثات"
                            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white transition flex items-center gap-1.5 text-xs font-bold shrink-0 cursor-pointer lg:hidden"
                          >
                            <ArrowRight className="w-4 h-4" />
                            <span>المحادثات</span>
                            {totalUnreadChatCount > 0 && (
                              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                            )}
                          </button>

                          {/* Avatar */}
                          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow">
                            {(activeStudent?.name || selectedChatBarcode).slice(0, 2)}
                          </div>

                          {/* Student & Parent Info */}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <h3 className="text-xs sm:text-sm font-bold text-white truncate">
                                {activeStudent?.name || `طالب (${selectedChatBarcode})`}
                              </h3>
                              <span className="hidden sm:inline-block px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold">
                                متصل الآن
                              </span>
                            </div>
                            <div className="text-[10px] sm:text-[11px] text-slate-400 flex items-center gap-2 truncate">
                              <span className="font-mono text-indigo-300">كود: {selectedChatBarcode}</span>
                              {activeStudent?.groupGrade && (
                                <>
                                  <span>•</span>
                                  <span>{activeStudent.groupGrade}</span>
                                </>
                              )}
                              {studentPhone && (
                                <>
                                  <span>•</span>
                                  <span className="font-mono">{studentPhone}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Top Action Icons */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {studentPhone && (
                            <button
                              type="button"
                              onClick={() =>
                                openWhatsApp(
                                  studentPhone,
                                  `أهلاً بحضرتك ولي أمر الطالب ${activeStudent?.name || ""}`
                                )
                              }
                              title="فتح محادثة واتساب خارجية"
                              className="px-2.5 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">واتساب</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setSelectedChatBarcode(null)}
                            title="إغلاق المحادثة"
                            className="hidden lg:flex p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Messages Bubble Stream */}
                  <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 bg-[#080b16]/70">
                    {chatMessages.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 text-xs space-y-2 py-12">
                        <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
                          <MessageSquare className="w-6 h-6" />
                        </div>
                        <p className="font-bold text-white text-sm">بدء محادثة جديدة</p>
                        <p className="text-[11px] text-slate-400 max-w-xs">
                          لا توجد رسائل سابقة. أرسل رسالة لولي الأمر لبدء التواصل والمتابعة فورياً.
                        </p>
                      </div>
                    ) : (
                      chatMessages.map((msg) => {
                        const isAdmin = msg.sender === "admin";
                        return (
                          <div
                            key={msg.id}
                            className={`flex flex-col ${isAdmin ? "items-end" : "items-start"}`}
                          >
                            <div
                              className={`max-w-[88%] sm:max-w-[75%] rounded-3xl p-3 sm:p-3.5 text-xs shadow-md leading-relaxed ${
                                isAdmin
                                  ? "bg-indigo-600 text-white rounded-br-none shadow-indigo-900/30"
                                  : "bg-slate-800/95 border border-slate-700 text-white rounded-bl-none shadow-slate-950/40"
                              }`}
                            >
                              <div className="text-[10px] font-bold opacity-80 mb-1 flex items-center justify-between gap-4">
                                <span>{msg.senderName}</span>
                                {isAdmin && (
                                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-700/50 text-indigo-200">
                                    الإشراف
                                  </span>
                                )}
                              </div>
                              <div className="whitespace-pre-wrap break-words">{msg.text}</div>
                              <div className="text-[9px] text-slate-300 font-mono mt-1.5 opacity-75 flex items-center justify-end gap-1">
                                <span>{msg.timeFormatted}</span>
                                {isAdmin && <CheckCheck className="w-3 h-3 text-indigo-300 inline" />}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={chatBottomRef} />
                  </div>

                  {/* Quick Reply Presets Bar */}
                  <div className="px-3 py-2 border-t border-slate-800 bg-slate-900/90 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
                    <span className="text-[10px] text-slate-400 shrink-0 font-bold">رد سريع:</span>
                    <button
                      type="button"
                      onClick={() =>
                        handleQuickReply("أهلاً بحضرتك، تم استلام رسالتكم وجاري المتابعة فوراً مع الأستاذة.")
                      }
                      className="px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 whitespace-nowrap cursor-pointer transition border border-slate-700/60"
                    >
                      + تم استلام الرسالة
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleQuickReply("مستوى الطالب ممتاز وملتزم في الحصص وحل الواجبات كاملة.")
                      }
                      className="px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 whitespace-nowrap cursor-pointer transition border border-slate-700/60"
                    >
                      + إشادة بالمستوى
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleQuickReply("يرجى التنبيه على الطالب بضرورة مراجعة مسائل الدرس الأخير والواجب.")
                      }
                      className="px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 whitespace-nowrap cursor-pointer transition border border-slate-700/60"
                    >
                      + تنبيه بالواجب
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleQuickReply("نرجو التواصل هاتفياً للأهمية لمناقشة أمر دراسي يخص الطالب.")
                      }
                      className="px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 whitespace-nowrap cursor-pointer transition border border-slate-700/60"
                    >
                      + طلب اتصال
                    </button>
                  </div>

                  {/* Bottom WhatsApp-Style Sticky Input Bar */}
                  <form
                    onSubmit={handleSendAdminChat}
                    className="p-2.5 sm:p-3 bg-slate-900/95 border-t border-slate-800 flex items-center gap-2 shrink-0"
                  >
                    <input
                      ref={chatInputRef}
                      type="text"
                      value={adminChatText}
                      onChange={(e) => setAdminChatText(e.target.value)}
                      placeholder="اكتب رسالتك لولي الأمر هنا... (اضغط Enter للإرسال)"
                      className="flex-1 px-4 py-2.5 rounded-2xl bg-slate-950 border border-slate-700 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-400 transition"
                    />
                    <button
                      type="submit"
                      disabled={!adminChatText.trim() || isSending}
                      className="p-2.5 sm:px-4 sm:py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition shadow-md cursor-pointer flex items-center justify-center gap-1.5 shrink-0 font-bold text-xs"
                    >
                      <span className="hidden sm:inline">إرسال</span>
                      <Send className="w-4 h-4 -rotate-90" />
                    </button>
                  </form>
                </>
              ) : (
                /* Desktop Placeholder Screen when No Chat is Selected */
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 space-y-4 p-8">
                  <div className="w-20 h-20 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center shadow-xl">
                    <MessageSquare className="w-10 h-10" />
                  </div>
                  <div className="space-y-1.5 max-w-sm">
                    <h3 className="text-base sm:text-lg font-bold text-white font-fancy">
                      مركز المحادثات والتواصل المباشر
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      اختر محادثة من القائمة الجانبية لبدء التواصل الفوري مع ولي أمر الطالب والرد على الاستفسارات.
                    </p>
                  </div>
                  <div className="flex items-center gap-3 pt-2">
                    <div className="px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700 text-[11px] text-slate-300 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span>{chatThreadsSummary.length} محادثة مسجلة</span>
                    </div>
                    {totalUnreadChatCount > 0 && (
                      <div className="px-3 py-1.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-[11px] text-rose-300 font-bold flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                        <span>{totalUnreadChatCount} رسائل غير مقروءة</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: ADMIN CREDENTIALS & SYSTEM SETTINGS */}
        {activeTab === "settings" && (
          <div className="max-w-2xl mx-auto space-y-6 animate-fadeIn">
            <div className="bg-slate-900/90 border border-indigo-500/30 rounded-3xl p-6 shadow-xl space-y-6">
              <div className="flex items-center gap-3 pb-4 border-b border-slate-800">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
                  <Settings className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold font-fancy text-white">
                    إعدادات المشرف وبيانات الدخول
                  </h2>
                  <p className="text-xs text-slate-400">
                    تعديل كود باركود المشرف وكلمة المرور وضبط الإشعارات السحابية
                  </p>
                </div>
              </div>

              {settingsFeedback && (
                <div className="p-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>{settingsFeedback}</span>
                </div>
              )}

              <form onSubmit={handleSaveSettings} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center gap-1.5">
                      <Barcode className="w-4 h-4 text-amber-400" />
                      كود باركود المشرف (Admin ID)
                    </label>
                    <input
                      type="text"
                      required
                      dir="ltr"
                      value={newAdminBarcode}
                      onChange={(e) => setNewAdminBarcode(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-2xl bg-slate-950 border border-slate-700 text-xs font-mono text-white text-center"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center gap-1.5">
                      <Lock className="w-4 h-4 text-amber-400" />
                      كلمة مرور المشرف
                    </label>
                    <input
                      type="text"
                      required
                      dir="ltr"
                      value={newAdminPassword}
                      onChange={(e) => setNewAdminPassword(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-2xl bg-slate-950 border border-slate-700 text-xs font-mono text-white text-center"
                    />
                  </div>
                </div>

                {/* Push Notification Controls */}
                <div className="pt-4 border-t border-slate-800 space-y-3">
                  <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Bell className="w-4 h-4 text-amber-400" />
                    إعدادات الإشعارات والتنبيه الصوتي
                  </h3>

                  <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                    <div>
                      <span className="text-xs font-bold text-slate-200 block">إشعارات الويب ودفع الإشعارات (Push Notifications)</span>
                      <span className="text-[11px] text-slate-400">تفعيل وصول الإشعارات لأولياء الأمور حتى أثناء عدم فتح التطبيق</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={pushEnabled}
                      onChange={(e) => setPushEnabled(e.target.checked)}
                      className="w-5 h-5 accent-indigo-600 rounded cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                    <div>
                      <span className="text-xs font-bold text-slate-200 block">رنين التنبيهات الصوتية الحية (Web Audio Chimes)</span>
                      <span className="text-[11px] text-slate-400">تشغيل نغمات موسيقية فورية عند رصد الحضور أو تسجيل الدرجات</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={soundEnabled}
                      onChange={(e) => setSoundEnabled(e.target.checked)}
                      className="w-5 h-5 accent-indigo-600 rounded cursor-pointer"
                    />
                  </div>

                  {/* Test notification button */}
                  <div className="pt-2 flex items-center justify-between">
                    <span className="text-xs text-slate-400">اختبار وصول التنبيه الصوتي والإشعار:</span>
                    <button
                      type="button"
                      onClick={handleTestChimeAndNotification}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-amber-400 transition cursor-pointer flex items-center gap-1.5"
                    >
                      <BellRing className="w-3.5 h-3.5" />
                      <span>تجربة الإشعار والرنين الآن</span>
                    </button>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-800">
                  <button
                    type="submit"
                    className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition shadow-lg cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    <span>حفظ وتطبيق الإعدادات</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>

      {/* MODAL 1: EDIT CREDENTIALS */}
      {editingAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm overflow-y-auto animate-fadeIn">
          <div className="relative w-full max-w-sm rounded-3xl bg-slate-900 border border-indigo-500/30 p-6 shadow-2xl space-y-4 text-right max-h-[90vh] overflow-y-auto custom-scrollbar my-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white font-fancy">
                  تعديل بيانات حساب ولي الأمر
                </h3>
                {editingStudentName && (
                  <p className="text-xs text-indigo-300 font-bold mt-0.5">{editingStudentName}</p>
                )}
              </div>
              <button
                onClick={() => setEditingAccount(null)}
                className="text-slate-400 hover:text-white p-1 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {editFeedback && (
              <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                <span>{editFeedback}</span>
              </div>
            )}

            <form onSubmit={handleSaveEditedCredentials} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  كود باركود الطالب
                </label>
                <input
                  type="text"
                  required
                  dir="ltr"
                  value={editBarcode}
                  onChange={(e) => setEditBarcode(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono text-white text-center"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  رقم هاتف ولي الأمر
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="مثال: 01012345678"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono text-white text-center"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  كلمة المرور
                </label>
                <input
                  type="text"
                  required
                  dir="ltr"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono text-white text-center font-bold text-amber-300"
                />
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition cursor-pointer"
                >
                  حفظ التعديل
                </button>
                <button
                  type="button"
                  onClick={() => setEditingAccount(null)}
                  className="px-3 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold transition cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: DIRECT SINGLE STUDENT ACTIVATION */}
      {activatingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm overflow-y-auto animate-fadeIn">
          <div className="relative w-full max-w-sm rounded-3xl bg-slate-900 border border-emerald-500/40 p-6 shadow-2xl space-y-4 text-right max-h-[90vh] overflow-y-auto custom-scrollbar my-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white font-fancy">
                    تفعيل حساب ولي الأمر
                  </h3>
                  <p className="text-[11px] text-slate-400">للطالب: {activatingItem.studentName}</p>
                </div>
              </div>
              <button
                onClick={() => setActivatingItem(null)}
                className="text-slate-400 hover:text-white p-1 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60 text-xs space-y-1">
              <div className="flex justify-between text-slate-300">
                <span>كود الطالب:</span>
                <span className="font-mono font-bold text-amber-300">{activatingItem.barcode}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>الصف الدراسي:</span>
                <span className="text-white font-bold">{activatingItem.grade}</span>
              </div>
            </div>

            {actFeedback && (
              <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                <span>{actFeedback}</span>
              </div>
            )}

            <form onSubmit={handleConfirmActivate} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  رقم هاتف ولي الأمر (للدخول به)
                </label>
                <input
                  type="text"
                  required
                  dir="ltr"
                  value={actPhone}
                  onChange={(e) => setActPhone(e.target.value)}
                  placeholder="مثال: 01012345678"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono text-white text-center"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  كلمة المرور المحددة للحساب
                </label>
                <input
                  type="text"
                  required
                  dir="ltr"
                  value={actPassword}
                  onChange={(e) => setActPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono text-white text-center font-bold text-amber-300"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  الافتراضية: 1234 (يمكن لولي الأمر تغييرها بعد الدخول)
                </span>
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={isActivating}
                  className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs transition cursor-pointer shadow-lg flex items-center justify-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{isActivating ? "جارِ التفعيل..." : "تأكيد وتفعيل الحساب"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActivatingItem(null)}
                  className="px-3 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold transition cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: BATCH ACTIVATION FOR ALL UNACTIVATED STUDENTS */}
      {showBatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm overflow-y-auto animate-fadeIn">
          <div className="relative w-full max-w-sm rounded-3xl bg-slate-900 border border-emerald-500/40 p-6 shadow-2xl space-y-4 text-right max-h-[90vh] overflow-y-auto custom-scrollbar my-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white font-fancy">
                    التفعيل الجماعي لحسابات الطلاب
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    تفعيل {unactivatedCount} حساب طالب غير مفعل دفعة واحدة
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowBatchModal(false)}
                className="text-slate-400 hover:text-white p-1 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              سيتم تفعيل حسابات جميع أولياء الأمور غير المفعلة حالياً باستخدام أرقام هواتفهم المسجلة وكلمة المرور الموحدة المحددة بالأسفل، مع مزامنتها تلقائياً على السحابة.
            </p>

            {batchFeedback && (
              <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                <span>{batchFeedback}</span>
              </div>
            )}

            <form onSubmit={handleConfirmBatchActivate} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  كلمة المرور الموحدة لجميع الحسابات
                </label>
                <input
                  type="text"
                  required
                  dir="ltr"
                  value={batchPassword}
                  onChange={(e) => setBatchPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono text-white text-center font-bold text-amber-300"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  الافتراضية: 1234
                </span>
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={isBatchActivating}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs transition cursor-pointer shadow-lg flex items-center justify-center gap-1.5"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>{isBatchActivating ? "جارِ التفعيل السحابي..." : `تفعيل ${unactivatedCount} حساب الآن`}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowBatchModal(false)}
                  className="px-3 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold transition cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: DELETE PARENT ACCOUNT CONFIRMATION */}
      {accountToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto animate-fadeIn">
          <div className="relative w-full max-w-sm rounded-3xl bg-slate-900 border border-rose-500/50 p-6 shadow-2xl space-y-4 text-right my-auto">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white font-fancy">
                  تأكيد حذف وإلغاء تفعيل الحساب
                </h3>
                <p className="text-xs text-rose-300/90 font-bold">
                  {accountToDelete.studentName}
                </p>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 text-xs space-y-2 leading-relaxed text-slate-300">
              <div className="flex justify-between text-slate-400">
                <span>كود الباركود:</span>
                <span className="font-mono text-amber-300 font-bold">#{accountToDelete.barcode}</span>
              </div>
              <p className="text-rose-300 text-[11px] pt-1.5 border-t border-slate-800">
                ⚠️ سيتم إرجاع الحساب إلى حالة (غير مفعل)، وسيتم <strong>تسجيل خروج هاتف ولي الأمر فوراً وتلقائياً</strong> عن بُعد ولن يتمكن من الدخول إلا بإعادة تفعيله.
              </p>
            </div>

            <div className="pt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={handleConfirmDeleteAccount}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs transition cursor-pointer shadow-lg shadow-rose-600/30 flex items-center justify-center gap-1.5 active:scale-95"
              >
                <Trash2 className="w-4 h-4" />
                <span>نعم، حذف الحساب فوراً</span>
              </button>
              <button
                type="button"
                onClick={() => setAccountToDelete(null)}
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
