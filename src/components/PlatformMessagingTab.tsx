import React, { useState, useMemo } from "react";
import { Student, PlatformMessage, PlatformMessageType, GradeName } from "../types";
import { openWhatsApp, cleanPhoneNumber } from "../utils/helpers";
import {
  enqueuePlatformMessage,
  markPlatformMessageRead,
  markAllPlatformMessagesRead,
  deletePlatformMessage,
  clearAllPlatformMessages,
} from "../utils/storage";
import { StudentSearchBox } from "./StudentSearchBox";
import { matchStudentSearch } from "../utils/search";
import { SmartStudentNotificationGenerator } from "./SmartStudentNotificationGenerator";
import { PaymentRecord } from "../types";
import {
  MessageSquare,
  Send,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  UserX,
  AlertTriangle,
  FileCheck2,
  CreditCard,
  Award,
  Sparkles,
  Trash2,
  Copy,
  ExternalLink,
  RotateCcw,
  CheckCheck,
  PlusCircle,
  X,
  Phone,
  Layers,
  ChevronDown,
} from "lucide-react";

interface PlatformMessagingTabProps {
  students: Student[];
  messages: PlatformMessage[];
  attendanceToday?: Record<string, string>;
  payments?: Record<string, Record<string, PaymentRecord>>;
  onOpenManualWhatsApp?: () => void;
}

const MESSAGE_TYPE_CONFIG: Record<
  PlatformMessageType,
  { label: string; icon: any; color: string; badgeBg: string }
> = {
  غياب: { label: "غياب", icon: UserX, color: "text-rose-400", badgeBg: "bg-rose-500/15 border-rose-500/30 text-rose-300" },
  تأخير: { label: "تأخير", icon: Clock, color: "text-amber-400", badgeBg: "bg-amber-500/15 border-amber-500/30 text-amber-300" },
  حضور: { label: "حضور", icon: CheckCircle2, color: "text-emerald-400", badgeBg: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300" },
  عكس_أيام: { label: "عكس أيام", icon: RotateCcw, color: "text-indigo-400", badgeBg: "bg-indigo-500/15 border-indigo-500/30 text-indigo-300" },
  درجات: { label: "درجات", icon: FileCheck2, color: "text-sky-400", badgeBg: "bg-sky-500/15 border-sky-500/30 text-sky-300" },
  مصاريف: { label: "مصاريف", icon: CreditCard, color: "text-emerald-400", badgeBg: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300" },
  تنبيه: { label: "تنبيه", icon: AlertTriangle, color: "text-orange-400", badgeBg: "bg-orange-500/15 border-orange-500/30 text-orange-300" },
  سلوك: { label: "سلوك", icon: AlertTriangle, color: "text-yellow-400", badgeBg: "bg-yellow-500/15 border-yellow-500/30 text-yellow-300" },
  تفوق: { label: "تفوق", icon: Award, color: "text-amber-300", badgeBg: "bg-amber-500/20 border-amber-400/40 text-amber-300" },
  عام: { label: "عام", icon: MessageSquare, color: "text-slate-300", badgeBg: "bg-slate-700/50 border-slate-600 text-slate-200" },
};

export const PlatformMessagingTab: React.FC<PlatformMessagingTabProps> = ({
  students,
  messages,
  attendanceToday = {},
  payments = {},
  onOpenManualWhatsApp,
}) => {
  const [activeTypeFilter, setActiveTypeFilter] = useState<string>("all");
  const [activeStatusFilter, setActiveStatusFilter] = useState<string>("all");
  const [activeGradeFilter, setActiveGradeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // New Message Composer State
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [newMessageType, setNewMessageType] = useState<PlatformMessageType>("تنبيه");
  const [newMessageTitle, setNewMessageTitle] = useState("");
  const [newMessageBody, setNewMessageBody] = useState("");
  const [composerFeedback, setComposerFeedback] = useState<string | null>(null);

  // Filtered messages list
  const filteredMessages = useMemo(() => {
    return messages.filter((m) => {
      if (activeTypeFilter !== "all" && m.messageType !== activeTypeFilter) return false;
      if (activeStatusFilter === "unread" && m.status !== "pending") return false;
      if (activeStatusFilter === "read" && m.status === "pending") return false;
      if (activeGradeFilter !== "all" && m.grade !== activeGradeFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const inName = (m.studentName || "").toLowerCase().includes(q);
        const inBarcode = (m.studentBarcode || "").includes(q);
        const inText = (m.message || "").toLowerCase().includes(q);
        const inTitle = (m.title || "").toLowerCase().includes(q);
        if (!inName && !inBarcode && !inText && !inTitle) return false;
      }

      return true;
    });
  }, [messages, activeTypeFilter, activeStatusFilter, activeGradeFilter, searchQuery]);

  // Statistics
  const stats = useMemo(() => {
    let unreadCount = 0;
    let absenceCount = 0;
    let gradesCount = 0;
    let paymentsCount = 0;

    messages.forEach((m) => {
      if (m.status === "pending") unreadCount++;
      if (m.messageType === "غياب" || m.messageType === "تأخير") absenceCount++;
      if (m.messageType === "درجات") gradesCount++;
      if (m.messageType === "مصاريف") paymentsCount++;
    });

    return {
      total: messages.length,
      unreadCount,
      absenceCount,
      gradesCount,
      paymentsCount,
    };
  }, [messages]);

  const handleCopyMessage = (m: PlatformMessage) => {
    navigator.clipboard.writeText(m.message);
    setCopiedId(m.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleManualWhatsAppSend = (m: PlatformMessage) => {
    const targetPhone = m.phone || "";
    openWhatsApp(targetPhone, m.message);
  };

  const handleSendNewMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent) {
      alert("⚠️ يرجى اختيار الطالب أولاً لإرسال الإشعار إليه.");
      return;
    }
    if (!newMessageBody.trim()) {
      alert("⚠️ يرجى كتابة نص الرسالة أو التنبيه.");
      return;
    }

    enqueuePlatformMessage({
      studentBarcode: selectedStudent.barcode,
      studentName: selectedStudent.name,
      grade: selectedStudent.groupGrade,
      phone: selectedStudent.parentPhone || selectedStudent.phone || "",
      messageType: newMessageType,
      title: newMessageTitle.trim() || `تنبيه أكاديمي: ${selectedStudent.name}`,
      message: newMessageBody.trim(),
      channel: "in_app",
    });

    setComposerFeedback(`✅ تم توثيق وإرسال الإشعار بنجاح للطالب (${selectedStudent.name}) داخل سجل المنصة!`);
    setSelectedStudent(null);
    setNewMessageTitle("");
    setNewMessageBody("");

    setTimeout(() => {
      setComposerFeedback(null);
      setIsComposerOpen(false);
    }, 2000);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header Banner */}
      <div className="glass-panel p-6 md:p-8 rounded-3xl shadow-2xl relative overflow-hidden border border-indigo-500/20 bg-gradient-to-br from-[#0d1627] via-[#101b30] to-[#0a1020]">
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-400/30 text-indigo-300 text-xs font-bold shadow-sm">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>منظومة التواصل والرسائل الأساسية داخل المنصة</span>
            </div>
            <h2 className="text-2xl md:text-3xl font-extrabold text-white font-fancy flex items-center gap-3">
              <span>سجل ورسائل المنصة الداخلية</span>
              <span className="text-sm font-sans font-bold px-3 py-1 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-400/30">
                {messages.length} رسالة وتنبيه
              </span>
            </h2>
            <p className="text-slate-300 text-sm max-w-2xl leading-relaxed">
              جميع الإشعارات، الغياب، التأخير، نتائج الامتحانات، وإيصالات المصروفات مسجلة وموثقة مباشرة داخل المنصة.
              يمكنك متابعتها وتصنيفها، أو استخدام المراسلة اليدوية عبر واتساب كخيار جانبي عند الحاجة فقط.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setIsComposerOpen(!isComposerOpen)}
              className="px-4 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer transform active:scale-95"
            >
              <PlusCircle className="w-4 h-4 text-amber-300" />
              <span>{isComposerOpen ? "إغلاق النموذج" : "إرسال إشعار جديد"}</span>
            </button>

            {onOpenManualWhatsApp && (
              <button
                type="button"
                onClick={onOpenManualWhatsApp}
                className="px-4 py-2.5 rounded-2xl bg-slate-800/90 hover:bg-slate-700/90 text-emerald-400 font-bold text-xs border border-emerald-500/30 flex items-center gap-2 shadow-md transition-all cursor-pointer transform active:scale-95"
                title="الانتقال إلى خيار مراسلة واتساب اليدوية"
              >
                <span>📲 المراسلة اليدوية عبر واتساب (خيار جانبي)</span>
              </button>
            )}

            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  markAllPlatformMessagesRead();
                }}
                className="px-3.5 py-2.5 rounded-2xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-700 flex items-center gap-2 transition-all cursor-pointer"
                title="تحديد جميع الإشعارات كمقروءة"
              >
                <CheckCheck className="w-4 h-4 text-emerald-400" />
                <span>قراءة الكل</span>
              </button>
            )}

            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                className="p-2.5 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-all cursor-pointer"
                title="مسح سجل الإشعارات بالكامل"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4 mt-6 pt-6 border-t border-indigo-500/15">
          <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800">
            <div className="text-[11px] font-bold text-slate-400">إجمالي الإشعارات</div>
            <div className="text-xl md:text-2xl font-black text-white mt-1 font-mono">{stats.total}</div>
          </div>
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20">
            <div className="text-[11px] font-bold text-amber-300">غياب وتأخير</div>
            <div className="text-xl md:text-2xl font-black text-amber-400 mt-1 font-mono">{stats.absenceCount}</div>
          </div>
          <div className="p-3.5 rounded-2xl bg-sky-500/10 border border-sky-500/20">
            <div className="text-[11px] font-bold text-sky-300">نتائج امتحانات</div>
            <div className="text-xl md:text-2xl font-black text-sky-400 mt-1 font-mono">{stats.gradesCount}</div>
          </div>
          <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
            <div className="text-[11px] font-bold text-emerald-300">إيصالات اشتراكات</div>
            <div className="text-xl md:text-2xl font-black text-emerald-400 mt-1 font-mono">{stats.paymentsCount}</div>
          </div>
        </div>
      </div>

      {/* Smart Platform Student Notification Generator (8 Templates with Interactive Actions) */}
      <SmartStudentNotificationGenerator
        students={students}
        attendanceToday={attendanceToday}
        payments={payments}
      />

      {/* Composer Section (Collapsible) */}
      {isComposerOpen && (
        <div className="glass-panel p-6 rounded-3xl border border-indigo-500/30 bg-slate-900/90 shadow-2xl space-y-4 animate-fadeIn">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Send className="w-4 h-4 text-amber-400" />
              <span>إرسال وتوثيق إشعار جديد داخل المنصة</span>
            </h3>
            <button
              onClick={() => setIsComposerOpen(false)}
              className="p-1 rounded-lg text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {composerFeedback && (
            <div className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
              {composerFeedback}
            </div>
          )}

          <form onSubmit={handleSendNewMessage} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">اختر الطالب المستهدف:</label>
                <StudentSearchBox
                  students={students}
                  onSelectStudent={(s) => setSelectedStudent(s)}
                  placeholder="ابحث باسم الطالب أو الباركود..."
                />
                {selectedStudent && (
                  <div className="mt-2 p-2.5 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-xs text-indigo-200 flex items-center justify-between">
                    <span>الطالب: <strong>{selectedStudent.name}</strong> ({selectedStudent.groupGrade})</span>
                    <button
                      type="button"
                      onClick={() => setSelectedStudent(null)}
                      className="text-rose-400 text-xs hover:underline"
                    >
                      إلغاء
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">نوع الإشعار:</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["تنبيه", "غياب", "تأخير", "درجات", "سلوك", "تفوق"] as PlatformMessageType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setNewMessageType(t)}
                      className={`p-2 rounded-xl text-xs font-bold border transition-all ${
                        newMessageType === t
                          ? "bg-indigo-600 text-white border-indigo-400"
                          : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">عنوان الإشعار (اختياري):</label>
              <input
                type="text"
                value={newMessageTitle}
                onChange={(e) => setNewMessageTitle(e.target.value)}
                placeholder="مثال: تنبيه بخصوص موعد المراجعة الأسبوعية"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-white text-xs focus:border-indigo-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">نص الإشعار:</label>
              <textarea
                rows={3}
                value={newMessageBody}
                onChange={(e) => setNewMessageBody(e.target.value)}
                placeholder="اكتب تفاصيل التنبيه أو الملاحظة الخاصة بالطالب..."
                className="w-full p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-white text-xs focus:border-indigo-500 outline-none resize-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 cursor-pointer shadow-md"
              >
                <Send className="w-3.5 h-3.5" />
                <span>حفظ وتوثيق الإشعار بالمنصة</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter and Search Toolbar */}
      <div className="glass-panel p-4 rounded-2xl border border-slate-800 bg-slate-900/60 flex flex-wrap items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث في الرسائل (اسم الطالب، الباركود، الكلمات)..."
            className="w-full pr-10 pl-4 py-2 rounded-xl bg-slate-950/80 border border-slate-800 text-white text-xs focus:border-indigo-500 outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Type Filter */}
          <select
            value={activeTypeFilter}
            onChange={(e) => setActiveTypeFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-200 text-xs font-bold outline-none cursor-pointer"
          >
            <option value="all">كل الأنواع</option>
            <option value="غياب">غياب</option>
            <option value="تأخير">تأخير</option>
            <option value="حضور">حضور</option>
            <option value="عكس_أيام">عكس أيام</option>
            <option value="درجات">درجات امتحانات</option>
            <option value="مصاريف">مصاريف واشتراكات</option>
            <option value="تنبيه">تنبيهات</option>
            <option value="تفوق">تفوق</option>
          </select>

          {/* Status Filter */}
          <select
            value={activeStatusFilter}
            onChange={(e) => setActiveStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-200 text-xs font-bold outline-none cursor-pointer"
          >
            <option value="all">كل الحالات</option>
            <option value="unread">غير مقروء / جديد</option>
            <option value="read">تم الاطلاع / مؤرشف</option>
          </select>
        </div>
      </div>

      {/* Messages List Feed */}
      <div className="space-y-3">
        {filteredMessages.length === 0 ? (
          <div className="glass-panel p-12 text-center rounded-3xl border border-slate-800/80 bg-slate-900/40 space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-slate-800 text-slate-500 mx-auto flex items-center justify-center">
              <MessageSquare className="w-8 h-8" />
            </div>
            <h4 className="text-base font-bold text-white">لا توجد رسائل مطابقة لخيارات البحث</h4>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              عند تسجيل الحضور، رصد الدرجات، أو سداد الاشتراكات، سيتم توثيق كافة الإشعارات هنا تلقائياً دون أي تشويش.
            </p>
          </div>
        ) : (
          filteredMessages.map((m) => {
            const config = MESSAGE_TYPE_CONFIG[m.messageType] || MESSAGE_TYPE_CONFIG["عام"];
            const Icon = config.icon;
            const isRead = m.status !== "pending";

            return (
              <div
                key={m.id}
                className={`p-4 md:p-5 rounded-2xl border transition-all ${
                  isRead
                    ? "bg-slate-900/50 border-slate-800/80 opacity-90"
                    : "bg-gradient-to-r from-[#0e172a] to-[#121d33] border-indigo-500/30 shadow-md"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {/* Student & Type Badges */}
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center border shadow-sm ${config.badgeBg}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-white">{m.studentName}</h4>
                        {m.grade && (
                          <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-[10px] font-bold text-slate-300 border border-slate-700">
                            {m.grade}
                          </span>
                        )}
                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${config.badgeBg}`}>
                          {config.label}
                        </span>
                        {!isRead && (
                          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" title="إشعار جديد" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                        {m.studentBarcode && <span>باركود: #{m.studentBarcode}</span>}
                        <span>•</span>
                        <span>{m.timeFormatted}</span>
                        {m.phone && (
                          <>
                            <span>•</span>
                            <span className="font-mono">{m.phone}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions Header */}
                  <div className="flex items-center gap-1.5">
                    {/* Manual WhatsApp Auxiliary Button */}
                    {m.phone && (
                      <button
                        type="button"
                        onClick={() => handleManualWhatsAppSend(m)}
                        className="px-2.5 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-white border border-emerald-500/30 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                        title="مراسلة واتساب يدوية (خيار جانبي يدوي عند الحاجة)"
                      >
                        <Phone className="w-3 h-3" />
                        <span className="hidden sm:inline">واتساب يدوي</span>
                      </button>
                    )}

                    {/* Copy Button */}
                    <button
                      type="button"
                      onClick={() => handleCopyMessage(m)}
                      className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs border border-slate-700 transition-all"
                      title="نسخ نص الإشعار"
                    >
                      {copiedId === m.id ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>

                    {/* Read Status Toggle */}
                    <button
                      type="button"
                      onClick={() => markPlatformMessageRead(m.id)}
                      className={`p-1.5 rounded-xl border transition-all ${
                        isRead
                          ? "bg-slate-800 text-slate-500 border-slate-700"
                          : "bg-indigo-600/30 text-indigo-300 border-indigo-500/40 hover:bg-indigo-600/50"
                      }`}
                      title={isRead ? "تم الاطلاع" : "تحديد كمقروء"}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </button>

                    {/* Delete */}
                    <button
                      type="button"
                      onClick={() => deletePlatformMessage(m.id)}
                      className="p-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition-all"
                      title="حذف من السجل"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Message Body */}
                <div className="mt-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs text-slate-200 leading-relaxed whitespace-pre-line font-tajawal">
                  {m.title && <div className="font-bold text-amber-300 mb-1">{m.title}</div>}
                  {m.message}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Clear Messages Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="glass-panel border-rose-500/50 p-6 rounded-3xl max-w-sm w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95 text-right">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold font-fancy text-white">تفريغ سجل الإشعارات</h3>
                <p className="text-xs text-rose-300">مسح كافة الرسائل السابقة</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              ⚠️ هل أنت متأكد من مسح جميع رسائل وإشعارات المنصة من السجل؟ هذا الإجراء لا يمكن التراجع عنه.
            </p>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  clearAllPlatformMessages();
                  setShowClearConfirm(false);
                }}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition cursor-pointer shadow-lg shadow-rose-600/30 flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                <span>نعم، مسح السجل بالكامل</span>
              </button>
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
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
