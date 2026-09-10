import { useEffect, useState } from "react";

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export type BrowserEnvironment =
  | "chrome"
  | "safari"
  | "firefox"
  | "edge"
  | "samsung"
  | "telegram"
  | "whatsapp"
  | "facebook"
  | "inapp_generic"
  | "other";

export interface PWAInstallState {
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  isInAppBrowser: boolean;
  isTelegram: boolean;
  isInIframe: boolean;
  browserType: BrowserEnvironment;
  install: () => Promise<"accepted" | "dismissed" | "failed" | "not_supported">;
  openInExternalBrowser: () => void;
  openInNewTab: () => void;
  copyAppUrl: () => Promise<boolean>;
}

declare global {
  interface Window {
    __pwaDeferredPrompt?: BeforeInstallPromptEvent | null;
    __pwaPromptListeners?: Array<(e: BeforeInstallPromptEvent | null) => void>;
  }
}

// Capture beforeinstallprompt immediately at module evaluation time
if (typeof window !== "undefined") {
  if (!window.__pwaPromptListeners) {
    window.__pwaPromptListeners = [];
  }

  window.addEventListener("beforeinstallprompt", (e: Event) => {
    e.preventDefault();
    const promptEvt = e as BeforeInstallPromptEvent;
    window.__pwaDeferredPrompt = promptEvt;
    window.__pwaPromptListeners?.forEach((cb) => cb(promptEvt));
  });

  window.addEventListener("appinstalled", () => {
    window.__pwaDeferredPrompt = null;
    window.__pwaPromptListeners?.forEach((cb) => cb(null));
  });
}

export function usePWAInstall(): PWAInstallState {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() => {
    return typeof window !== "undefined" ? window.__pwaDeferredPrompt || null : null;
  });
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);
  const [isTelegram, setIsTelegram] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);
  const [browserType, setBrowserType] = useState<BrowserEnvironment>("other");

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Check if running inside iframe (e.g. AI Studio preview, embed)
    const inIframe = window.self !== window.top;
    setIsInIframe(inIframe);

    const ua = window.navigator.userAgent || "";
    const uaLower = ua.toLowerCase();

    // 1. Detect OS
    const iosDevice = /iphone|ipad|ipod/.test(uaLower);
    const androidDevice = /android/.test(uaLower);
    setIsIOS(iosDevice);
    setIsAndroid(androidDevice);

    // 2. Detect In-App Browsers (Telegram, WhatsApp, FB, Instagram, etc.)
    const telegramApp = /telegram|tg/i.test(uaLower);
    const whatsappApp = /whatsapp/i.test(uaLower);
    const fbApp = /fban|fbav|instagram|messenger/i.test(uaLower);
    const genericWebview =
      /wv|webview/.test(uaLower) ||
      (androidDevice && !/chrome\/[0-9]+/i.test(uaLower)) ||
      (iosDevice && !/safari/i.test(uaLower));

    const inApp = telegramApp || whatsappApp || fbApp || genericWebview;
    setIsInAppBrowser(inApp);
    setIsTelegram(telegramApp);

    // 3. Detect Browser Type
    if (telegramApp) {
      setBrowserType("telegram");
    } else if (whatsappApp) {
      setBrowserType("whatsapp");
    } else if (fbApp) {
      setBrowserType("facebook");
    } else if (inApp) {
      setBrowserType("inapp_generic");
    } else if (/samsungbrowser/i.test(uaLower)) {
      setBrowserType("samsung");
    } else if (/edg/i.test(uaLower)) {
      setBrowserType("edge");
    } else if (/firefox|fxios/i.test(uaLower)) {
      setBrowserType("firefox");
    } else if (/chrome|crios/i.test(uaLower)) {
      setBrowserType("chrome");
    } else if (iosDevice || /safari/i.test(uaLower)) {
      setBrowserType("safari");
    } else {
      setBrowserType("other");
    }

    // 4. Detect standalone mode (already installed as PWA)
    // NOTE: Inside iframes or in-app webviews, display-mode may be misinterpreted
    const isStandalone =
      !inApp &&
      !inIframe &&
      (window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
        document.referrer.includes("android-app://"));
    setIsInstalled(isStandalone);

    // Check if global prompt is already available
    if (window.__pwaDeferredPrompt) {
      setDeferredPrompt(window.__pwaDeferredPrompt);
    }

    // Register listener for prompt updates
    const promptCallback = (evt: BeforeInstallPromptEvent | null) => {
      setDeferredPrompt(evt);
    };

    if (!window.__pwaPromptListeners) {
      window.__pwaPromptListeners = [];
    }
    window.__pwaPromptListeners.push(promptCallback);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const p = e as BeforeInstallPromptEvent;
      window.__pwaDeferredPrompt = p;
      setDeferredPrompt(p);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      window.__pwaDeferredPrompt = null;
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      if (window.__pwaPromptListeners) {
        window.__pwaPromptListeners = window.__pwaPromptListeners.filter((cb) => cb !== promptCallback);
      }
    };
  }, []);

  const install = async (): Promise<"accepted" | "dismissed" | "failed" | "not_supported"> => {
    const promptEvent = deferredPrompt || (typeof window !== "undefined" ? window.__pwaDeferredPrompt : null);
    if (!promptEvent) {
      return "not_supported";
    }

    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;

      // Always clear promptEvent so it cannot be reused (calling prompt() twice throws DOMException)
      setDeferredPrompt(null);
      if (typeof window !== "undefined") {
        window.__pwaDeferredPrompt = null;
        window.__pwaPromptListeners?.forEach((cb) => cb(null));
      }

      if (choice.outcome === "accepted") {
        setIsInstalled(true);
        return "accepted";
      }
      return "dismissed";
    } catch (err) {
      console.warn("PWA prompt error:", err);
      setDeferredPrompt(null);
      if (typeof window !== "undefined") {
        window.__pwaDeferredPrompt = null;
      }
      return "failed";
    }
  };

  const openInExternalBrowser = () => {
    if (typeof window === "undefined") return;
    const currentUrl = window.location.href;

    if (isAndroid) {
      try {
        const cleanHost = window.location.host;
        const cleanPath = window.location.pathname + window.location.search;
        const intentUrl = `intent://${cleanHost}${cleanPath}#Intent;scheme=https;package=com.android.chrome;end`;
        window.location.href = intentUrl;
        return;
      } catch {
        // Fallback below
      }
    }

    try {
      window.open(currentUrl, "_blank");
    } catch {
      window.location.href = currentUrl;
    }
  };

  const openInNewTab = () => {
    if (typeof window === "undefined") return;
    try {
      window.open(window.location.href, "_blank");
    } catch {
      window.location.href = window.location.href;
    }
  };

  const copyAppUrl = async (): Promise<boolean> => {
    if (typeof window === "undefined") return false;
    try {
      const url = window.location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        return true;
      }
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      return true;
    } catch {
      return false;
    }
  };

  return {
    isInstallable: !!deferredPrompt || (typeof window !== "undefined" && !!window.__pwaDeferredPrompt),
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
  };
}
