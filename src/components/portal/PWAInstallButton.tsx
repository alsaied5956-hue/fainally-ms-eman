import React, { useState, useEffect } from "react";
import { usePWAInstall } from "../../hooks/usePWAInstall";
import {
  Download,
  Smartphone,
  Share,
  PlusSquare,
  Check,
  X,
  ExternalLink,
  Copy,
  Globe,
  RefreshCw,
  Sparkles,
  Layers,
} from "lucide-react";

interface PWAInstallButtonProps {
  className?: string;
  variant?: "primary" | "compact" | "badge";
  showAlways?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  className = "",
  variant = "primary",
}) => {
  const {
    isInstallable,
    isInstalled,
    isIOS,
    isAndroid,
    isInAppBrowser,
    isTelegram,
    isInIframe,
    browserType,
    install,
    openInExternalBrowser,
    openInNewTab,
    copyAppUrl,
  } = usePWAInstall();

  const [activeModal, setActiveModal] = useState<
    "inapp" | "ios" | "firefox" | "desktop" | "iframe" | "already-installed" | null
  >(null);
  const [copied, setCopied] = useState(false);
  const [installSuccess, setInstallSuccess] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Close modals on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveModal(null);
      }
    };
    if (activeModal) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeModal]);

  const handleCopy = async () => {
    const ok = await copyAppUrl();
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  const handleInstallClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Prevent re-entry if already working
    if (isProcessing) return;

    // If already installed, show confirmation modal
    if (isInstalled) {
      setActiveModal("already-installed");
      return;
    }

    // 1. If running inside an iframe (like AI Studio preview or embed), browser blocks install prompts
    if (isInIframe) {
      setActiveModal("iframe");
      return;
    }

    // 2. If inside Telegram or in-app webview
    if (isInAppBrowser || isTelegram) {
      setActiveModal("inapp");
      return;
    }

    // 3. iOS Safari (Apple WebKit does not support beforeinstallprompt)
    if (isIOS) {
      setActiveModal("ios");
      return;
    }

    // 4. Firefox
    if (browserType === "firefox") {
      setActiveModal("firefox");
      return;
    }

    // 5. Native install prompt available (Chrome, Edge, Samsung Internet)
    if (isInstallable) {
      setIsProcessing(true);
      // Failsafe auto-reset after 3s so the button NEVER hangs
      const safetyTimer = setTimeout(() => setIsProcessing(false), 3000);

      try {
        const outcome = await install();
        clearTimeout(safetyTimer);
        setIsProcessing(false);

        if (outcome === "accepted") {
          setInstallSuccess(true);
          setTimeout(() => setInstallSuccess(false), 5000);
          return;
        }
        if (outcome === "dismissed") {
          // User closed the browser prompt, return cleanly
          return;
        }
      } catch (err) {
        clearTimeout(safetyTimer);
        setIsProcessing(false);
        console.warn("PWA install error:", err);
      }
    }

    // 6. Desktop or other browsers where prompt hasn't triggered yet
    setActiveModal("desktop");
  };

  // If already installed, show a neat badge that remains clickable for info
  if (isInstalled) {
    return (
      <>
        <button
          type="button"
          onClick={() => setActiveModal("already-installed")}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-tajawal font-medium hover:bg-emerald-500/25 transition cursor-pointer whitespace-nowrap select-none shrink-0 ${className}`}
          title="التطبيق مثبت ويعمل كبرنامج أصلي على جهازك"
        >
          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>التطبيق مثبت ✓</span>
        </button>

        {activeModal === "already-installed" && (
          <div
            onClick={() => setActiveModal(null)}
            className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fadeIn"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-sm rounded-3xl bg-slate-900 border border-emerald-500/40 p-6 shadow-2xl text-right"
            >
              <button
                onClick={() => setActiveModal(null)}
                className="absolute top-4 left-4 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-4">
                <Check className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-white font-fancy mb-2">
                التطبيق مثبت بنجاح على جهازك
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed font-tajawal mb-5">
                المنظومة تعمل بالفعل كتطبيق أصلي سريع (PWA) مع ميزة العمل بدون إنترنت وتلقي الإشعارات اللحظية. يمكنك فتحها مباشرة من شاشة جهازك الرئيسية.
              </p>
              <button
                onClick={() => setActiveModal(null)}
                className="w-full py-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition shadow-lg cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        id="pwa-install-button"
        onClick={handleInstallClick}
        disabled={isProcessing}
        className={`group relative inline-flex items-center gap-2 rounded-2xl font-tajawal font-bold transition-all shadow-lg active:scale-95 cursor-pointer whitespace-nowrap select-none shrink-0 ${
          variant === "badge"
            ? "px-3 py-1.5 text-xs bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30"
            : variant === "compact"
            ? "px-3.5 py-2 text-xs bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 hover:from-amber-400 hover:to-amber-500 shadow-amber-500/20"
            : "px-4 py-2.5 text-sm bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 text-slate-950 hover:from-amber-400 hover:to-amber-300 shadow-amber-500/25 hover:shadow-amber-500/40"
        } ${isProcessing ? "opacity-80" : ""} ${className}`}
        title="تثبيت التطبيق على هاتفك أو حاسوبك للعمل كتطبيق أصلي سريع"
      >
        {isProcessing ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin text-slate-950 shrink-0" />
            <span>جارٍ فتح التثبيت...</span>
          </>
        ) : installSuccess ? (
          <>
            <Check className="w-4 h-4 text-slate-950 shrink-0" />
            <span>تم التثبيت بنجاح!</span>
          </>
        ) : (
          <>
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-slate-950 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-950"></span>
            </span>
            <Download className="w-4 h-4 transition-transform group-hover:-translate-y-0.5 shrink-0" />
            <span>تثبيت التطبيق (PWA)</span>
          </>
        )}
      </button>

      {/* 1. iFrame Preview Modal (When opened in AI Studio or Embed) */}
      {activeModal === "iframe" && (
        <div
          onClick={() => setActiveModal(null)}
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto animate-fadeIn"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md rounded-3xl bg-slate-900 border border-amber-500/40 p-6 shadow-2xl text-right max-h-[92vh] overflow-y-auto custom-scrollbar my-auto"
          >
            <button
              onClick={() => setActiveModal(null)}
              className="absolute top-4 left-4 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white font-fancy">
                  تثبيت المنظومة كتطبيق أصلي سريع
                </h3>
                <p className="text-xs text-amber-400 font-tajawal">
                  خطوة واحدة للتثبيت على هاتفك أو حاسوبك
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 mb-4 text-xs text-amber-200/90 leading-relaxed font-tajawal">
              نظراً لتصفحك المنظومة داخل إطار معاينة، فإن حماية المتصفحات (مثل Chrome و Safari) تتطلب فتحها في نافذة مستقلة ليتم تثبيتها بنقرة واحدة كبرنامج أصلي على جهازك.
            </div>

            <div className="space-y-2.5 mb-5">
              <button
                type="button"
                onClick={() => {
                  setActiveModal(null);
                  openInNewTab();
                }}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-lg shadow-amber-500/20 transition cursor-pointer active:scale-95"
              >
                <ExternalLink className="w-4 h-4" />
                <span>فتح في نافذة كاملة للتثبيت الفوري 🚀</span>
              </button>

              <button
                type="button"
                onClick={handleCopy}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs border border-slate-700 transition cursor-pointer active:scale-95"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span className="text-emerald-400 font-bold">تم نسخ رابط المنظومة بنجاح!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-slate-300" />
                    <span>نسخ رابط المنظومة لفتحه في متصفحك</span>
                  </>
                )}
              </button>
            </div>

            <button
              onClick={() => setActiveModal(null)}
              className="w-full py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs transition cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        </div>
      )}

      {/* 2. In-App Browser / Telegram Modal */}
      {activeModal === "inapp" && (
        <div
          onClick={() => setActiveModal(null)}
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto animate-fadeIn"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md rounded-3xl bg-slate-900 border border-amber-500/40 p-6 shadow-2xl text-right max-h-[92vh] overflow-y-auto custom-scrollbar my-auto"
          >
            <button
              onClick={() => setActiveModal(null)}
              className="absolute top-4 left-4 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                <Globe className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white font-fancy">
                  {isTelegram
                    ? "تثبيت التطبيق من داخل تليجرام"
                    : "فتح المنظومة في المتصفح الرئيسي"}
                </h3>
                <p className="text-xs text-amber-400 font-tajawal">
                  خطوة واحدة بسيطة لتثبيت المنظومة كتطبيق أصلي
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 mb-4 text-xs text-amber-200/90 leading-relaxed font-tajawal">
              متصفحات تطبيقات التواصل (مثل <strong>تليجرام وواتساب</strong>) تمنع تثبيت التطبيقات مباشرة داخلها للحماية. للتثبيت على هاتفك فوراً اتبع الخيارات التالية:
            </div>

            {/* Quick Action Buttons */}
            <div className="space-y-2.5 mb-5">
              <button
                type="button"
                onClick={openInExternalBrowser}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-lg shadow-amber-500/20 transition cursor-pointer active:scale-95"
              >
                <ExternalLink className="w-4 h-4" />
                <span>
                  {isAndroid
                    ? "فتح الرابط في متصفح Chrome الآن"
                    : "فتح الرابط في متصفح سفاري / الهاتف"}
                </span>
              </button>

              <button
                type="button"
                onClick={handleCopy}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs border border-slate-700 transition cursor-pointer active:scale-95"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span className="text-emerald-400 font-bold">تم نسخ الرابط! افتح كروم والصقه</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-slate-300" />
                    <span>نسخ رابط المنظومة لفتحه في المتصفح</span>
                  </>
                )}
              </button>
            </div>

            {/* Step-by-step visual guidance */}
            <div className="space-y-2.5 text-xs text-slate-300 font-tajawal">
              <p className="font-bold text-white text-xs mb-1">
                أو التثبيت اليدوي من شاشة تليجرام الحالية:
              </p>

              <div className="flex items-start gap-3 p-3 rounded-2xl bg-slate-800/60 border border-slate-700/50">
                <div className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 font-bold text-[11px]">
                  1
                </div>
                <span>اضغط على النقاط الثلاث <strong>(⋮)</strong> أو زر المشاركة في الزاوية العلوية لشاشة تليجرام.</span>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-2xl bg-slate-800/60 border border-slate-700/50">
                <div className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 font-bold text-[11px]">
                  2
                </div>
                <span>
                  اختر <strong>"فتح في المتصفح"</strong> (أو <strong>Open in Chrome / Safari</strong>).
                </span>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-2xl bg-slate-800/60 border border-slate-700/50">
                <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 font-bold text-[11px]">
                  3
                </div>
                <span>فور الفتح في المتصفح، اضغط زر <strong>"تثبيت التطبيق"</strong> وسيتم تثبيته فوراً على شاشة جهازك!</span>
              </div>
            </div>

            <button
              onClick={() => setActiveModal(null)}
              className="mt-5 w-full py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs transition cursor-pointer"
            >
              إغلاق النافذة
            </button>
          </div>
        </div>
      )}

      {/* 3. iOS Safari Installation Guide Modal */}
      {activeModal === "ios" && (
        <div
          onClick={() => setActiveModal(null)}
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto animate-fadeIn"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm rounded-3xl bg-slate-900 border border-amber-500/40 p-6 shadow-2xl text-right max-h-[92vh] overflow-y-auto custom-scrollbar my-auto"
          >
            <button
              onClick={() => setActiveModal(null)}
              className="absolute top-4 left-4 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                <Smartphone className="w-6 h-6" />
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

            <div className="space-y-3 my-5 text-xs text-slate-300 font-tajawal">
              <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-800/60 border border-slate-700/50">
                <div className="w-8 h-8 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
                  <Share className="w-4 h-4" />
                </div>
                <span>
                  1. اضغط على زر <strong>المشاركة (Share)</strong> في شريط متصفح سفاري بالأسفل.
                </span>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-800/60 border border-slate-700/50">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                  <PlusSquare className="w-4 h-4" />
                </div>
                <span>
                  2. مرر للأسفل واختر <strong>إضافة إلى الصفحة الرئيسية (Add to Home Screen)</strong>.
                </span>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-800/60 border border-slate-700/50">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                  <Check className="w-4 h-4" />
                </div>
                <span>
                  3. اضغط على <strong>إضافة (Add)</strong> بالأعلى لتجد أيقونة التطبيق على شاشة هاتفك فوراً.
                </span>
              </div>
            </div>

            <button
              onClick={() => setActiveModal(null)}
              className="w-full py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition shadow-lg cursor-pointer active:scale-95"
            >
              تم، فهمت الخطوات
            </button>
          </div>
        </div>
      )}

      {/* 4. Firefox Guide Modal */}
      {activeModal === "firefox" && (
        <div
          onClick={() => setActiveModal(null)}
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto animate-fadeIn"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm rounded-3xl bg-slate-900 border border-amber-500/40 p-6 shadow-2xl text-right max-h-[92vh] overflow-y-auto custom-scrollbar my-auto"
          >
            <button
              onClick={() => setActiveModal(null)}
              className="absolute top-4 left-4 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-orange-500/20 text-orange-400 flex items-center justify-center shrink-0">
                <Download className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white font-fancy">
                  تثبيت التطبيق على متصفح فايرفوكس
                </h3>
                <p className="text-xs text-slate-400 font-tajawal">Firefox Browser</p>
              </div>
            </div>

            <div className="space-y-3 my-4 text-xs text-slate-300 font-tajawal">
              <div className="p-3 rounded-2xl bg-slate-800/60 border border-slate-700/50">
                1. اضغط على زر القائمة <strong>(⋮)</strong> بجوار شريط العنوان.
              </div>
              <div className="p-3 rounded-2xl bg-slate-800/60 border border-slate-700/50">
                2. اختر <strong>تثبيت (Install)</strong> أو <strong>إضافة إلى الشاشة الرئيسية</strong>.
              </div>
              <div className="p-3 rounded-2xl bg-slate-800/60 border border-slate-700/50">
                3. ستظهر أيقونة المنظومة كتطبيق مستقل على جهازك.
              </div>
            </div>

            <button
              onClick={() => setActiveModal(null)}
              className="w-full py-2.5 rounded-2xl bg-orange-500 hover:bg-orange-400 text-slate-950 font-bold text-xs transition shadow-lg cursor-pointer active:scale-95"
            >
              فهمت الخطوات
            </button>
          </div>
        </div>
      )}

      {/* 5. Desktop / Chrome / Edge Universal Browser Guide Modal */}
      {activeModal === "desktop" && (
        <div
          onClick={() => setActiveModal(null)}
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto animate-fadeIn"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm rounded-3xl bg-slate-900 border border-indigo-500/40 p-6 shadow-2xl text-right max-h-[92vh] overflow-y-auto custom-scrollbar my-auto"
          >
            <button
              onClick={() => setActiveModal(null)}
              className="absolute top-4 left-4 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
                <Download className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white font-fancy">
                  تثبيت المنظومة كتطبيق على جهازك
                </h3>
                <p className="text-xs text-indigo-300 font-tajawal">
                  متصفح كروم / إيدج / الهاتف
                </p>
              </div>
            </div>

            <div className="space-y-3 my-4 text-xs text-slate-300 font-tajawal">
              <div className="p-3 rounded-2xl bg-slate-800/60 border border-slate-700/50 leading-relaxed">
                اضغط على أيقونة <strong>التثبيت (⊕ Install)</strong> الموجودة في نهاية شريط العنوان بالمتصفح بجوار الرابط.
              </div>
              <div className="p-3 rounded-2xl bg-slate-800/60 border border-slate-700/50 leading-relaxed">
                أو من قائمة خيارات المتصفح <strong>(⋮)</strong> اختر <strong>"تثبيت التطبيق" (Install app)</strong> أو <strong>"إضافة إلى الشاشة الرئيسية"</strong>.
              </div>
            </div>

            {/* Quick Action Button to re-try direct install if available */}
            {isInstallable && (
              <button
                type="button"
                onClick={async () => {
                  setActiveModal(null);
                  setIsProcessing(true);
                  try {
                    const outcome = await install();
                    setIsProcessing(false);
                    if (outcome === "accepted") {
                      setInstallSuccess(true);
                      setTimeout(() => setInstallSuccess(false), 5000);
                    }
                  } catch {
                    setIsProcessing(false);
                  }
                }}
                className="w-full mb-2.5 flex items-center justify-center gap-2 py-2.5 px-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-bold text-xs shadow-lg transition cursor-pointer active:scale-95"
              >
                <RefreshCw className="w-4 h-4" />
                <span>إعادة محاولة التثبيت الفوري ⚡</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleCopy}
              className="w-full mb-3 flex items-center justify-center gap-2 py-2.5 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs border border-slate-700 transition cursor-pointer active:scale-95"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400 font-bold">تم نسخ الرابط! الصقه في المتصفح</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-slate-300" />
                  <span>نسخ رابط المنظومة المباشر</span>
                </>
              )}
            </button>

            <button
              onClick={() => setActiveModal(null)}
              className="w-full py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition cursor-pointer"
            >
              حسناً، فهمت
            </button>
          </div>
        </div>
      )}
    </>
  );
};

