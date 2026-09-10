import React, { useState, useEffect } from "react";
import { Sparkles, RefreshCw, X, ArrowUpCircle } from "lucide-react";

export const PWAUpdateNotification: React.FC = () => {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [showNotification, setShowNotification] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    let refreshing = false;
    // When the controlling service worker changes, reload page to activate new code
    const onControllerChange = () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Get registration and listen for updates
    navigator.serviceWorker.ready
      .then((reg) => {
        // 1. If a worker is already waiting, prompt immediately
        if (reg.waiting) {
          setWaitingWorker(reg.waiting);
          setShowNotification(true);
        }

        // 2. Listen for newly discovered updates
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            // Has the new worker finished installing and is there already an active controller?
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              setWaitingWorker(newWorker);
              setShowNotification(true);
            }
          });
        });

        // 3. Check for updates periodically (every 10 minutes) and when window gains focus
        const checkUpdate = () => {
          try {
            reg.update().catch(() => {});
          } catch {}
        };

        const focusHandler = () => checkUpdate();
        window.addEventListener("focus", focusHandler);
        const interval = setInterval(checkUpdate, 10 * 60 * 1000);

        return () => {
          window.removeEventListener("focus", focusHandler);
          clearInterval(interval);
        };
      })
      .catch(() => {});

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  const handleUpdate = () => {
    setIsUpdating(true);
    if (waitingWorker) {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    }
    // Fallback reload if controllerchange doesn't fire within 1.2s
    setTimeout(() => {
      window.location.reload();
    }, 1200);
  };

  if (!showNotification) return null;

  return (
    <aside
      aria-label="إشعار توفر تحديث جديد للتطبيق"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[999999] w-[94%] max-w-lg animate-fadeIn font-tajawal select-none"
    >
      <div className="relative flex flex-col sm:flex-row items-center justify-between gap-3 p-3.5 sm:p-4 rounded-3xl bg-slate-900/95 border border-amber-500/50 shadow-2xl shadow-amber-500/10 backdrop-blur-md text-right text-white">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
              <span>تحديث جديد متوفر للمنظومة</span>
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            </h4>
            <p className="text-xs text-slate-300 line-clamp-1 sm:line-clamp-none">
              تم إطلاق نسخة أحدث. اضغط للتحديث فوراً بدون مسح التطبيق أو فقد البيانات.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
          <button
            type="button"
            onClick={handleUpdate}
            disabled={isUpdating}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 py-2 px-4 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/20 transition cursor-pointer active:scale-95 whitespace-nowrap"
          >
            {isUpdating ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-950" />
                <span>جارٍ التحديث...</span>
              </>
            ) : (
              <>
                <ArrowUpCircle className="w-3.5 h-3.5 text-slate-950" />
                <span>تحديث الآن ⚡</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowNotification(false)}
            className="p-2 rounded-2xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
            title="تذكيري لاحقاً"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};
