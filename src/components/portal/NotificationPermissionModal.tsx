import React, { useState } from "react";
import {
  BellRing,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Smartphone,
  Volume2,
  ShieldCheck,
  X,
} from "lucide-react";
import { playPortalAudioChime, sendPortalNotification } from "../../utils/portalNotifications";

interface NotificationPermissionModalProps {
  isOpen: boolean;
  studentName: string;
  onClose: () => void;
  onPermissionGranted: () => void;
  onRequestPermission: () => Promise<NotificationPermission>;
}

export const NotificationPermissionModal: React.FC<NotificationPermissionModalProps> = ({
  isOpen,
  studentName,
  onClose,
  onPermissionGranted,
  onRequestPermission,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "denied">("idle");

  if (!isOpen) return null;

  const handleActivate = async () => {
    setIsProcessing(true);
    setStatus("idle");

    try {
      // 1. Play initial gentle chime to unlock audio context
      playPortalAudioChime("grade");

      // 2. Request browser permission (browser displays native Allow / Block prompt)
      const perm = await onRequestPermission();

      if (perm === "granted") {
        setStatus("success");
        onPermissionGranted();

        // 3. Send direct confirmation push with sound and phone vibration
        setTimeout(async () => {
          await sendPortalNotification(
            "🔔 تم تفعيل التنبيهات بنجاح!",
            `ستصلك الآن كافة رسائل المشرف وتنبيهات حضور وغياب الطالب (${studentName}) بصوت واهتزاز حتى والتطبيق مقفول.`,
            "grade",
            { force: true, sound: true }
          );
        }, 300);

        // Auto close modal after brief success presentation
        setTimeout(() => {
          onClose();
        }, 1800);
      } else if (perm === "denied") {
        setStatus("denied");
      }
    } catch (err) {
      console.warn("Notification activation failed:", err);
      setStatus("denied");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      id="notification-permission-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn"
      dir="rtl"
    >
      <div className="relative w-full max-w-lg bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 border-2 border-amber-500/40 rounded-3xl p-6 sm:p-8 shadow-2xl overflow-hidden">
        {/* Glowing background decor */}
        <div className="absolute -top-16 -right-16 w-48 h-48 bg-amber-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 left-4 p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          title="إغلاق"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Badge & Icon */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-bold mb-4">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>خطوة تشغيل أساسية ومهمة</span>
          </div>

          <div className="relative mx-auto w-20 h-20 rounded-3xl bg-gradient-to-tr from-amber-500/20 to-indigo-600/20 border-2 border-amber-500/40 flex items-center justify-center shadow-xl shadow-amber-500/10 mb-4">
            <BellRing className="w-10 h-10 text-amber-400 animate-pulse" />
            <span className="absolute -top-1 -right-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-4 w-4 bg-amber-500" />
            </span>
          </div>

          <h3 className="text-xl sm:text-2xl font-bold text-white font-fancy">
            تفعيل الإشعارات الفورية والصوتية
          </h3>
          <p className="text-xs sm:text-sm text-slate-300 mt-2 leading-relaxed">
            لتصلك رسائل المشرف وتنبيهات حضور وغياب الطالب{" "}
            <strong className="text-amber-400 underline decoration-amber-500/50">({studentName})</strong>{" "}
            بصوت رنين واهتزاز مباشر <span className="text-white font-bold">حتى والتطبيق مقفول</span> مثل واتساب.
          </p>
        </div>

        {/* Benefit Items */}
        <div className="space-y-2.5 mb-6 text-xs sm:text-sm">
          <div className="flex items-start gap-3 p-3 rounded-2xl bg-slate-800/60 border border-slate-700/60 text-slate-200">
            <div className="p-1.5 rounded-xl bg-indigo-500/20 text-indigo-400 shrink-0 mt-0.5">
              <Volume2 className="w-4 h-4" />
            </div>
            <div>
              <span className="font-bold text-white">رسائل المشرف المباشرة:</span>
              <p className="text-xs text-slate-400 mt-0.5">
                أي توجيه أو رسالة من المشرف العام تصلك كإشعار خارجي فوري على شاشة القفل.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-2xl bg-slate-800/60 border border-slate-700/60 text-slate-200">
            <div className="p-1.5 rounded-xl bg-emerald-500/20 text-emerald-400 shrink-0 mt-0.5">
              <Smartphone className="w-4 h-4" />
            </div>
            <div>
              <span className="font-bold text-white">رصد الحضور والانصراف:</span>
              <p className="text-xs text-slate-400 mt-0.5">
                رنين واهتزاز في جيبك لحظة مسح كود باركود الطالب في سنتر الحصة.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-2xl bg-slate-800/60 border border-slate-700/60 text-slate-200">
            <div className="p-1.5 rounded-xl bg-amber-500/20 text-amber-400 shrink-0 mt-0.5">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <span className="font-bold text-white">نتائج الاختبارات والدرجات:</span>
              <p className="text-xs text-slate-400 mt-0.5">
                تنبيه فوري عند رصد درجة امتحان أو تسجيل سداد مصاريف دراسية.
              </p>
            </div>
          </div>
        </div>

        {/* State Feedback Alerts */}
        {status === "success" && (
          <div className="mb-5 p-3.5 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs sm:text-sm flex items-center gap-3 animate-fadeIn">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <span className="font-bold">تم تفعيل الإشعارات بنجاح!</span>
              <p className="text-xs text-emerald-400/90 mt-0.5">
                ستصلك رسائل المشرف والتنبيهات فوراً مع صوت الرنين والاهتزاز.
              </p>
            </div>
          </div>
        )}

        {status === "denied" && (
          <div className="mb-5 p-3.5 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs sm:text-sm flex items-start gap-3 animate-fadeIn">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">إذن الإشعارات مقيد في متصفحك:</span>
              <p className="text-xs text-rose-200/90 mt-1 leading-relaxed">
                يرجى الضغط على علامة <strong>القفل 🔒</strong> أو <strong>الإعدادات ⚙️</strong> بجوار عنوان الموقع في شريط المتصفح، واختيار <strong>«سماح / Allow»</strong> للإشعارات، ثم إعادة تحميل الصفحة.
              </p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-3">
          <button
            type="button"
            id="btn-activate-notifications-modal"
            disabled={isProcessing || status === "success"}
            onClick={handleActivate}
            className={`w-full py-3.5 px-6 rounded-2xl font-bold text-sm sm:text-base flex items-center justify-center gap-3 transition cursor-pointer shadow-lg ${
              status === "success"
                ? "bg-emerald-600 text-white"
                : "bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 hover:to-amber-300 text-slate-950 shadow-amber-500/20 active:scale-[0.98]"
            }`}
          >
            {isProcessing ? (
              <>
                <span className="animate-spin rounded-full h-5 w-5 border-2 border-slate-950 border-t-transparent" />
                <span>جاري فتح إذن المتصفح...</span>
              </>
            ) : status === "success" ? (
              <>
                <CheckCircle2 className="w-5 h-5 text-white" />
                <span>الإشعارات الصوتية مفعلة ✓</span>
              </>
            ) : (
              <>
                <BellRing className="w-5 h-5 text-slate-950" />
                <span>السماح وتفعيل الإشعارات الآن (اضغط هنا)</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 text-xs text-slate-400 hover:text-slate-200 transition text-center cursor-pointer"
          >
            سأقوم بالتفعيل لاحقاً
          </button>
        </div>
      </div>
    </div>
  );
};
