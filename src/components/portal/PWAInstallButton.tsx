import React, { useState } from "react";
import { usePWAInstall } from "../../hooks/usePWAInstall";
import { Download, Smartphone, Share, PlusSquare, Check, X, Sparkles } from "lucide-react";

interface PWAInstallButtonProps {
  className?: string;
  variant?: "primary" | "compact" | "badge";
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  className = "",
  variant = "primary",
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [showDesktopGuide, setShowDesktopGuide] = useState(false);
  const [installedSuccess, setInstalledSuccess] = useState(false);

  // If already running as installed standalone PWA, hide the button
  if (isInstalled) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-tajawal">
        <Check className="w-3.5 h-3.5" />
        <span>التطبيق مثبت</span>
      </div>
    );
  }

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIOSGuide(true);
      return;
    }

    if (isInstallable) {
      const success = await install();
      if (success) {
        setInstalledSuccess(true);
        setTimeout(() => setInstalledSuccess(false), 4000);
      }
    } else {
      setShowDesktopGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        id="pwa-install-button"
        onClick={handleInstallClick}
        className={`group relative inline-flex items-center gap-2 rounded-2xl font-tajawal font-bold transition-all shadow-lg active:scale-95 cursor-pointer ${
          variant === "badge"
            ? "px-3 py-1.5 text-xs bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30"
            : variant === "compact"
            ? "px-3.5 py-2 text-xs bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 hover:from-amber-400 hover:to-amber-500 shadow-amber-500/20"
            : "px-4 py-2.5 text-sm bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 text-slate-950 hover:from-amber-400 hover:to-amber-300 shadow-amber-500/25 hover:shadow-amber-500/40"
        } ${className}`}
        title="تثبيت التطبيق على هاتفك أو حاسوبك للعمل كتطبيق أصلي سريع"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-slate-950 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-950"></span>
        </span>
        <Download className="w-4 h-4 transition-transform group-hover:-translate-y-0.5" />
        <span>تثبيت التطبيق (PWA)</span>
      </button>

      {/* iOS Installation Guide Modal */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-sm rounded-3xl bg-gradient-to-b from-slate-900 to-slate-950 border border-amber-500/30 p-6 shadow-2xl text-right">
            <button
              onClick={() => setShowIOSGuide(false)}
              className="absolute top-4 left-4 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white font-fancy">
                  تثبيت التطبيق على آيفون / آيباد
                </h3>
                <p className="text-xs text-slate-400 font-tajawal">
                  متصفح سفاري (Safari)
                </p>
              </div>
            </div>

            <div className="space-y-3.5 my-5 text-xs text-slate-300 font-tajawal">
              <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-800/60 border border-slate-700/50">
                <div className="w-8 h-8 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
                  <Share className="w-4 h-4" />
                </div>
                <span>1. اضغط على زر <strong>المشاركة (Share)</strong> في شريط متصفح سفاري بالأسفل.</span>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-800/60 border border-slate-700/50">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                  <PlusSquare className="w-4 h-4" />
                </div>
                <span>2. مرر للأسفل واختر <strong>إضافة إلى الصفحة الرئيسية (Add to Home Screen)</strong>.</span>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-800/60 border border-slate-700/50">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                  <Check className="w-4 h-4" />
                </div>
                <span>3. اضغط على <strong>إضافة (Add)</strong> بالأعلى لتجد التطبيق على شاشتك الرئيسية فوراً.</span>
              </div>
            </div>

            <button
              onClick={() => setShowIOSGuide(false)}
              className="w-full py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition shadow-lg cursor-pointer"
            >
              تم، فهمت الخطوات
            </button>
          </div>
        </div>
      )}

      {/* Desktop / Manual Guide Modal */}
      {showDesktopGuide && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-sm rounded-3xl bg-slate-900 border border-indigo-500/30 p-6 shadow-2xl text-right">
            <button
              onClick={() => setShowDesktopGuide(false)}
              className="absolute top-4 left-4 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                <Download className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white font-fancy">
                  تثبيت التطبيق على جهازك
                </h3>
                <p className="text-xs text-slate-400 font-tajawal">
                  من متصفح كروم أو إيدج أو الهاتف
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed font-tajawal mb-4">
              يمكنك تثبيت المنظومة كتطبيق أصلي بالضغط على أيقونة <strong>التثبيت (Install)</strong> الموجودة في شريط العنوان بالمتصفح بجوار الرابط، أو عبر القائمة الرئيسية (⋮) ثم اختيار <strong>تثبيت التطبيق</strong>.
            </p>

            <button
              onClick={() => setShowDesktopGuide(false)}
              className="w-full py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition shadow-lg cursor-pointer font-tajawal"
            >
              حسناً، فهمت
            </button>
          </div>
        </div>
      )}
    </>
  );
};
