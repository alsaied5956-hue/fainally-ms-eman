import React, { useState, useEffect, useCallback, useRef } from "react";
import { PendingWhatsAppMessage, WhatsAppMessageType } from "../types";
import { openWhatsApp, cleanPhoneNumber } from "../utils/helpers";
import { playBeep } from "../utils/audio";
import confetti from "canvas-confetti";
import {
  Send,
  CheckCircle2,
  Clock,
  UserX,
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  Copy,
  ExternalLink,
  Sparkles,
  Phone,
  MessageSquare,
  X,
  Trash2,
  AlertCircle,
  Wifi,
  WifiOff,
  Filter,
  CheckCheck,
  Edit3,
  Flame,
  FileCheck2,
  CreditCard,
  AlertTriangle,
} from "lucide-react";

interface PendingWhatsAppOutboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  pendingMessages: PendingWhatsAppMessage[];
  isOnline: boolean;
  onMarkSent: (id: string) => void;
  onMarkAllSent: () => void;
  onDeleteMessage: (id: string) => void;
  onClearAll: () => void;
  onUpdateMessageText?: (id: string, newText: string) => void;
}

export const PendingWhatsAppOutboxModal: React.FC<PendingWhatsAppOutboxModalProps> = ({
  isOpen,
  onClose,
  pendingMessages,
  isOnline,
  onMarkSent,
  onMarkAllSent,
  onDeleteMessage,
  onClearAll,
  onUpdateMessageText,
}) => {
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState<string>("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Auto Sequential Dispatch State
  const [isAutoSending, setIsAutoSending] = useState<boolean>(false);
  const [autoIndex, setAutoIndex] = useState<number>(0);
  const [countdown, setCountdown] = useState<number>(2.5);
  const [dispatchDelay, setDispatchDelay] = useState<number>(2.5); // seconds
  const autoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pendingOnlyList = pendingMessages.filter((m) => m.status === "pending");
  const sentOnlyList = pendingMessages.filter((m) => m.status === "sent");

  const filteredMessages = pendingMessages.filter((m) => {
    if (activeFilter === "pending" && m.status !== "pending") return false;
    if (activeFilter === "sent" && m.status !== "sent") return false;
    if (
      activeFilter !== "all" &&
      activeFilter !== "pending" &&
      activeFilter !== "sent" &&
      m.messageType !== activeFilter
    ) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = m.studentName.toLowerCase().includes(q);
      const matchPhone = m.phone.includes(q);
      const matchType = m.messageType.includes(q);
      const matchText = m.message.toLowerCase().includes(q);
      return matchName || matchPhone || matchType || matchText;
    }
    return true;
  });

  // Single Message Send Handler
  const handleSendMessage = (msg: PendingWhatsAppMessage) => {
    openWhatsApp(msg.phone, msg.message);
    playBeep("success");
    onMarkSent(msg.id);
  };

  // Copy Message Text
  const handleCopyText = (msg: PendingWhatsAppMessage) => {
    navigator.clipboard.writeText(msg.message);
    setCopiedId(msg.id);
    playBeep("success");
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Start Sequential Auto-Dispatch
  const handleStartAutoDispatch = () => {
    if (!isOnline) {
      alert("⚠️ لا يوجد اتصال بالإنترنت حالياً! يرجى التأكد من تشغيل الواي فاي أو الباقة أولاً.");
      return;
    }

    if (pendingOnlyList.length === 0) {
      alert("⚠️ لا توجد رسائل معلقة بانتظار الإرسال!");
      return;
    }

    setIsAutoSending(true);
    setAutoIndex(0);
    setCountdown(dispatchDelay);
  };

  const handleStopAutoDispatch = () => {
    setIsAutoSending(false);
    if (autoIntervalRef.current) {
      clearInterval(autoIntervalRef.current);
    }
  };

  // Next Step in Auto Dispatch
  const sendCurrentAndAdvance = useCallback(() => {
    const currentList = pendingMessages.filter((m) => m.status === "pending");
    if (currentList.length === 0) {
      setIsAutoSending(false);
      try {
        confetti({
          particleCount: 100,
          spread: 80,
          origin: { y: 0.6 },
        });
      } catch {
        // ignore
      }
      return;
    }

    const currentMsg = currentList[0];
    if (currentMsg) {
      openWhatsApp(currentMsg.phone, currentMsg.message);
      playBeep("success");
      onMarkSent(currentMsg.id);
      setCountdown(dispatchDelay);
    }
  }, [pendingMessages, dispatchDelay, onMarkSent]);

  // Countdown timer effect for auto dispatch (pure timer, no side-effects in state setter)
  useEffect(() => {
    if (!isAutoSending) {
      if (autoIntervalRef.current) clearInterval(autoIntervalRef.current);
      return;
    }

    autoIntervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 0.1) {
          return 0;
        }
        return Number((prev - 0.1).toFixed(1));
      });
    }, 100);

    return () => {
      if (autoIntervalRef.current) clearInterval(autoIntervalRef.current);
    };
  }, [isAutoSending]);

  // Safe side-effect execution when countdown reaches 0
  useEffect(() => {
    if (isAutoSending && countdown === 0) {
      sendCurrentAndAdvance();
    }
  }, [isAutoSending, countdown, sendCurrentAndAdvance]);

  // Cancel auto sending when modal closes
  useEffect(() => {
    if (!isOpen) {
      setIsAutoSending(false);
      if (autoIntervalRef.current) clearInterval(autoIntervalRef.current);
    }
  }, [isOpen]);

  const getTypeBadge = (type: WhatsAppMessageType) => {
    switch (type) {
      case "غياب":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-400 text-xs font-black">
            <UserX className="w-3.5 h-3.5" />
            <span>غياب</span>
          </span>
        );
      case "تأخير":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-black">
            <Clock className="w-3.5 h-3.5" />
            <span>تأخير</span>
          </span>
        );
      case "درجات":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-400 text-xs font-black">
            <FileCheck2 className="w-3.5 h-3.5" />
            <span>درجات امتحان</span>
          </span>
        );
      case "مصاريف":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-black">
            <CreditCard className="w-3.5 h-3.5" />
            <span>إيصال سداد</span>
          </span>
        );
      case "عكس_أيام":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 text-xs font-black">
            <RotateCcw className="w-3.5 h-3.5" />
            <span>حضور عكس الأيام</span>
          </span>
        );
      case "تنبيه":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-400 text-xs font-black">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>تنبيه واجب</span>
          </span>
        );
      case "سلوك":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-400 text-xs font-black">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>تنبيه سلوك</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-700 border border-slate-600 text-slate-300 text-xs font-black">
            <MessageSquare className="w-3.5 h-3.5" />
            <span>رسالة عامة</span>
          </span>
        );
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/80 animate-fadeIn">
      <div className="bg-[#0b1220] border border-amber-500/30 rounded-3xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Top Header */}
        <div className="p-5 md:p-6 border-b border-amber-500/20 bg-gradient-to-r from-[#0d1627] to-[#121c32] flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="relative p-3 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30 shadow-inner">
              <MessageSquare className="w-6 h-6" />
              {pendingOnlyList.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 px-2 py-0.5 rounded-full bg-rose-500 text-white text-[11px] font-black animate-pulse shadow-md">
                  {pendingOnlyList.length}
                </span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg md:text-xl font-black text-white">
                  طابور رسائل الواتساب المعلقة
                </h2>
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                    isOnline
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                  }`}
                >
                  {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                  <span>{isOnline ? "الإنترنت متصل" : "وضع الأوفلاين"}</span>
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                إرسال رسائل الغياب، التأخير، نتائج الامتحانات، وإيصالات السداد المسجلة أوفلاين دفعة واحدة فور عودة الشبكة
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              className="p-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-all cursor-pointer"
              title="إغلاق النافذة"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Global Action Banner & Auto-Dispatch Trigger */}
        <div className="p-4 bg-[#080d17] border-b border-amber-500/15 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-300">
              إجمالي الرسائل: <span className="font-mono text-amber-400">{pendingMessages.length}</span>
            </span>
            <span className="text-slate-600">•</span>
            <span className="text-xs font-bold text-amber-300 bg-amber-500/10 border border-amber-500/25 px-2.5 py-1 rounded-xl">
              ⏳ بانتظار الإرسال: <span className="font-mono">{pendingOnlyList.length}</span>
            </span>
            <span className="text-slate-600">•</span>
            <span className="text-xs font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1 rounded-xl">
              ✅ تم إرسالها: <span className="font-mono">{sentOnlyList.length}</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Auto Dispatch Button */}
            {!isAutoSending ? (
              <button
                type="button"
                onClick={handleStartAutoDispatch}
                disabled={pendingOnlyList.length === 0}
                className={`px-4 py-2 rounded-2xl text-xs font-black flex items-center gap-2 shadow-lg transition-all cursor-pointer ${
                  pendingOnlyList.length > 0
                    ? "bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 text-black shadow-emerald-500/20 transform hover:scale-[1.02] active:scale-95"
                    : "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed opacity-60"
                }`}
                title="إرسال كافة الرسائل المعلقة تلقائياً وبشكل متتابع ومريح"
              >
                <Flame className="w-4 h-4 text-black animate-bounce" />
                <span>🚀 إرسال كافة الرسائل المعلقة تلقائياً ({pendingOnlyList.length})</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-amber-500/20 border border-amber-500/40 px-4 py-1.5 rounded-2xl animate-pulse">
                <span className="text-xs font-black text-amber-300">
                  جارٍ الإرسال التلقائي... التالي خلال: <span className="font-mono text-white text-sm">{countdown} ث</span>
                </span>
                <button
                  type="button"
                  onClick={sendCurrentAndAdvance}
                  className="px-2.5 py-1 rounded-xl bg-amber-500 text-black text-xs font-black hover:bg-amber-400 cursor-pointer"
                >
                  إرسال فوري وتخطي
                </button>
                <button
                  type="button"
                  onClick={handleStopAutoDispatch}
                  className="p-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/40 text-rose-300 border border-rose-500/30 cursor-pointer"
                  title="إيقاف مؤقت"
                >
                  <Pause className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Mark All Sent */}
            {pendingOnlyList.length > 0 && (
              <button
                type="button"
                onClick={onMarkAllSent}
                className="px-3 py-2 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-bold transition-all cursor-pointer"
                title="تعليم كافة الرسائل في الطابور كمكتملة الإرسال"
              >
                <CheckCheck className="w-3.5 h-3.5 inline mr-1 text-emerald-400" />
                <span>تعليم الكل كمرسل</span>
              </button>
            )}

            {/* Clear All Outbox */}
            {pendingMessages.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  handleStopAutoDispatch();
                  playBeep("success");
                  onClearAll();
                }}
                className="px-3 py-2 rounded-2xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 hover:text-rose-200 text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 shadow-sm"
                title="مسح كافة الرسائل من الطابور فوراً"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                <span>مسح الكل ({pendingMessages.length})</span>
              </button>
            )}
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="p-4 bg-[#0d1525] border-b border-amber-500/15 flex flex-wrap items-center justify-between gap-3">
          {/* Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: "all", label: `الكل (${pendingMessages.length})` },
              { id: "pending", label: `⏳ معلق (${pendingOnlyList.length})` },
              { id: "غياب", label: "🔴 غياب" },
              { id: "تأخير", label: "🟡 تأخير" },
              { id: "عكس_أيام", label: "🔄 عكس الأيام" },
              { id: "درجات", label: "📊 درجات" },
              { id: "مصاريف", label: "💵 مصاريف" },
              { id: "تنبيه", label: "📢 واجب" },
              { id: "سلوك", label: "⚠️ سلوك" },
              { id: "sent", label: `✅ مرسل (${sentOnlyList.length})` },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveFilter(tab.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                  activeFilter === tab.id
                    ? "bg-amber-500 text-black shadow-md shadow-amber-500/20"
                    : "bg-slate-900/80 text-slate-300 hover:bg-slate-800 border border-slate-800"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Quick Search Input */}
          <div className="relative w-full sm:w-64">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث بالاسم أو الهاتف أو النص..."
              className="w-full bg-[#080d17] border border-slate-700 text-slate-200 text-xs px-3 py-2 rounded-xl outline-none focus:border-amber-400"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute left-2.5 top-2 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Message Items Scrollable Container */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3.5">
          {filteredMessages.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <div className="w-16 h-16 rounded-full bg-slate-800/80 border border-slate-700 flex items-center justify-center mx-auto text-slate-500">
                <MessageSquare className="w-8 h-8" />
              </div>
              <h3 className="text-base font-black text-slate-300">
                طابور الرسائل فارغ حالياً
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                عند تسجيل غياب، تأخير، درجات امتحان، أو سداد اشتراكات أثناء انقطاع الإنترنت، ستظهر جميع الرسائل هنا تلقائياً بانتظار الإرسال فور عودة الشبكة.
              </p>
            </div>
          ) : (
            filteredMessages.map((msg) => {
              const isSent = msg.status === "sent";
              const isEditing = editingId === msg.id;

              return (
                <div
                  key={msg.id}
                  className={`p-4 rounded-2xl border transition-all duration-200 ${
                    isSent
                      ? "bg-slate-900/40 border-slate-800/80 opacity-70"
                      : "bg-[#10192a] border-amber-500/30 hover:border-amber-500/60 shadow-lg shadow-black/20"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-slate-800/80">
                    <div className="flex flex-wrap items-center gap-2.5">
                      {getTypeBadge(msg.messageType)}
                      <h4 className="text-sm font-black text-white flex items-center gap-1.5">
                        <span>{msg.studentName}</span>
                        {msg.grade && (
                          <span className="text-[11px] font-normal text-slate-400">
                            ({msg.grade})
                          </span>
                        )}
                      </h4>
                      <span className="text-xs font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-800">
                        📱 {msg.phone}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                        <Clock className="w-3 h-3 text-amber-400/80" />
                        <span>{msg.timeFormatted}</span>
                      </span>

                      {isSent ? (
                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-black flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>تم الإرسال {msg.sentAt ? `(${msg.sentAt})` : ""}</span>
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[11px] font-black flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>بانتظار الإرسال</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Message Content Preview or Edit Box */}
                  <div className="py-3">
                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          rows={3}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="w-full bg-[#080d17] border border-amber-400 text-slate-100 p-2.5 rounded-xl text-xs outline-none leading-relaxed"
                        />
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (onUpdateMessageText && editText.trim()) {
                                onUpdateMessageText(msg.id, editText.trim());
                              }
                              setEditingId(null);
                            }}
                            className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-black text-xs font-black rounded-lg cursor-pointer"
                          >
                            حفظ التعديل ✓
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-lg cursor-pointer"
                          >
                            إلغاء ✕
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-200 whitespace-pre-line leading-relaxed bg-[#080d17]/80 p-3 rounded-xl border border-slate-800/80 font-medium select-text">
                        {msg.message}
                      </p>
                    )}
                  </div>

                  {/* Message Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopyText(msg)}
                        className="px-2.5 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-[11px] font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                        title="نسخ نص الرسالة للحافظة"
                      >
                        <Copy className="w-3.5 h-3.5 text-amber-400" />
                        <span>{copiedId === msg.id ? "تم النسخ بنجاح ✓" : "نسخ النص"}</span>
                      </button>

                      {!isEditing && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(msg.id);
                            setEditText(msg.message);
                          }}
                          className="px-2.5 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-[11px] font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                          title="تعديل نص الرسالة قبل الإرسال"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-slate-400" />
                          <span>تعديل</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          playBeep("warning");
                          onDeleteMessage(msg.id);
                        }}
                        className="p-1.5 rounded-xl hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 transition-all cursor-pointer"
                        title="حذف هذه الرسالة من الطابور"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      {!isSent && (
                        <button
                          type="button"
                          onClick={() => handleSendMessage(msg)}
                          className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 text-black text-xs font-black shadow-md shadow-emerald-500/20 transition-all transform hover:scale-[1.02] active:scale-95 flex items-center gap-1.5 cursor-pointer"
                          title="فتح الواتساب وإرسال الرسالة الآن لولي الأمر"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>إرسال الآن عبر الواتساب 📲</span>
                        </button>
                      )}

                      {isSent && (
                        <button
                          type="button"
                          onClick={() => handleSendMessage(msg)}
                          className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                          title="إعادة فتح الواتساب وإرسال الرسالة مجدداً"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>إعادة إرسال</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Bottom Footer */}
        <div className="p-4 bg-[#0a101d] border-t border-amber-500/20 flex items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span>يتم فتح واتساب ويب في نافذة المتصفح لتأكيد الإرسال بدون حظر الحسابات</span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold transition-all cursor-pointer"
          >
            إغلاق النافذة
          </button>
        </div>
      </div>
    </div>
  );
};
