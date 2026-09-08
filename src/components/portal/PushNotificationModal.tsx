import React, { useState, useEffect } from "react";
import {
  Bell,
  BellRing,
  CheckCircle2,
  AlertTriangle,
  Smartphone,
  Sparkles,
  Volume2,
  X,
  Clock,
  ShieldCheck,
  Send,
} from "lucide-react";
import {
  registerPushSubscription,
  scheduleTestBackgroundPush,
  getActivePushSubscription,
} from "../../services/pushNotificationService";

interface PushNotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  userRole?: "parent" | "admin" | "student";
  barcodes?: string[];
  phone?: string;
  userName?: string;
}

export const PushNotificationModal: React.FC<PushNotificationModalProps> = ({
  isOpen,
  onClose,
  userId,
  userRole = "parent",
  barcodes = [],
  phone = "",
  userName = "",
}) => {
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPermission(Notification.permission);
      getActivePushSubscription().then((sub) => {
        setIsSubscribed(!!sub);
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleEnable = async () => {
    setIsLoading(true);
    setTestStatus(null);
    try {
      const sub = await registerPushSubscription(userId, userRole, barcodes, phone);
      if (typeof window !== "undefined" && "Notification" in window) {
        setPermission(Notification.permission);
      }
      if (sub) {
        setIsSubscribed(true);
        setTestStatus("✅ تم تفعيل الإشعارات وتسجيل هاتفك في خدمة التنبيهات بالخلفية بنجاح!");
      } else {
        setTestStatus("⚠️ تعذر إتمام التفعيل. تأكد من الضغط على (سماح / Allow) في نافذة المتصفح.");
      }
    } catch (err: any) {
      setTestStatus("❌ حدث خطأ: " + (err.message || ""));
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestPush = async () => {
    setIsLoading(true);
    setTestStatus(null);
    setCountdown(5);

    try {
      // If not yet subscribed, try registering first
      if (!isSubscribed) {
        await registerPushSubscription(userId, userRole, barcodes, phone);
        setIsSubscribed(true);
      }

      const res = await scheduleTestBackgroundPush(5);
      if (res.success) {
        setTestStatus("🚀 تم إرسال الأمر! اقفل شاشة هاتفك الآن أو اخرج من المتصفح للتأكد من وصوله.");
        // Countdown timer
        let current = 5;
        const interval = setInterval(() => {
          current -= 1;
          if (current <= 0) {
            clearInterval(interval);
            setCountdown(null);
            setTestStatus("🔔 تم إرسال الإشعار إلى هاتفك الآن! تحقق من شاشة القفل وستارة الإشعارات.");
          } else {
            setCountdown(current);
          }
        }, 1000);
      } else {
        setTestStatus(res.message);
        setCountdown(null);
      }
    } catch (err: any) {
      setTestStatus("❌ فشل الاختبار: " + (err.message || ""));
      setCountdown(null);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn"
      dir="rtl"
    >
      <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500/20 via-slate-800 to-indigo-600/20 px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/30 text-amber-400 flex items-center justify-center shadow-md">
              <BellRing className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white font-fancy">
                إشعارات الهاتف والتطبيق مقفول
              </h2>
              <p className="text-[11px] text-slate-400">
                استلام رنين وتنبيهات الحضور والغياب والدرجات والمحادثات
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar text-xs sm:text-sm">
          {/* Status Box */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-slate-300 font-medium">صلاحية إشعارات النظام:</span>
              {permission === "granted" ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  مفعّلة بنجاح
                </span>
              ) : permission === "denied" ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-bold">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  محظورة بالمتصفح
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-bold">
                  <Clock className="w-3.5 h-3.5" />
                  في انتظار السماح
                </span>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
              <span className="text-slate-300 font-medium">مستقبل تنبيهات الخلفية (Web Push):</span>
              {isSubscribed ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
                  <Smartphone className="w-3.5 h-3.5" />
                  هاتفك مسجل وجاهز
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800 text-slate-400 text-xs font-medium">
                  غير مسجل
                </span>
              )}
            </div>
          </div>

          {/* Test Status Banner */}
          {testStatus && (
            <div
              className={`p-3.5 rounded-2xl text-xs font-medium leading-relaxed border ${
                testStatus.includes("✅") || testStatus.includes("🚀") || testStatus.includes("🔔")
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                  : "bg-amber-500/10 border-amber-500/30 text-amber-200"
              }`}
            >
              {testStatus}
            </div>
          )}

          {/* Countdown indicator */}
          {countdown !== null && (
            <div className="bg-gradient-to-r from-amber-500/20 via-indigo-600/20 to-amber-500/20 border border-amber-500/40 rounded-2xl p-4 text-center space-y-2 animate-pulse">
              <div className="text-2xl font-black font-mono text-amber-400">
                {countdown} ثوانٍ
              </div>
              <p className="text-xs text-amber-200 font-bold">
                📱 اقفل شاشة هاتفك الآن أو اخرج من المتصفح! سيصلك الإشعار والصوت عند الصفر.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              onClick={handleEnable}
              disabled={isLoading}
              className="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold text-xs flex items-center justify-center gap-2 border border-slate-700 transition cursor-pointer disabled:opacity-50"
            >
              <Bell className="w-4 h-4 text-amber-400" />
              <span>{isSubscribed ? "تحديث وتأكيد الاشتراك" : "تفعيل الإشعارات بالمتصفح"}</span>
            </button>

            <button
              type="button"
              onClick={handleTestPush}
              disabled={isLoading || countdown !== null}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition cursor-pointer disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              <span>اختبر هاتفك والتطبيق مقفول (بعد 5ث)</span>
            </button>
          </div>

          {/* Device Tips & Instructions */}
          <div className="bg-slate-950/50 border border-slate-800/80 rounded-2xl p-4 space-y-2.5 text-[11px] text-slate-400 leading-relaxed">
            <div className="flex items-center gap-1.5 text-amber-400 font-bold text-xs">
              <Sparkles className="w-4 h-4" />
              <span>تعليمات مهمة لضمان استلام الإشعار وشاشتك مقفولة:</span>
            </div>

            <div className="space-y-2 pr-1">
              <div className="flex items-start gap-2">
                <span className="font-bold text-slate-300">📱 هواتف أندرويد (Android):</span>
                <span>
                  اضغط &quot;سماح&quot;، وتأكد من عدم إدراج المتصفح في قائمة &quot;تطبيقات النوم العميق&quot; بموفر الطاقة.
                </span>
              </div>

              <div className="flex items-start gap-2">
                <span className="font-bold text-slate-300">🍎 هواتف آيفون (iPhone / iOS):</span>
                <span>
                  وفقاً لنظام Apple، تتطلب الإشعارات والشاشة مقفولة فتح الرابط في Safari، ثم الضغط على زر المشاركة ⎋ واختيار &quot;إضافة إلى الشاشة الرئيسية&quot; (Add to Home Screen).
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-950 px-5 py-3 border-t border-slate-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
