import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
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
  browserType: BrowserEnvironment;
  install: () => Promise<boolean>;
  openInExternalBrowser: () => void;
  copyAppUrl: () => Promise<boolean>;
}

export function usePWAInstall(): PWAInstallState {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);
  const [isTelegram, setIsTelegram] = useState(false);
  const [browserType, setBrowserType] = useState<BrowserEnvironment>("other");

  useEffect(() => {
    if (typeof window === "undefined") return;

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
    // NOTE: Inside iframes or in-app webviews, display-mode may be misinterpreted, so check !inApp
    const isStandalone =
      !inApp &&
      (window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
        document.referrer.includes("android-app://"));
    setIsInstalled(isStandalone);

    // 5. Global prompt capturing
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const install = async (): Promise<boolean> => {
    if (!deferredPrompt) {
      return false;
    }
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setIsInstalled(true);
        setDeferredPrompt(null);
        return true;
      }
    } catch (err) {
      console.warn("PWA prompt error:", err);
    }
    return false;
  };

  const openInExternalBrowser = () => {
    if (typeof window === "undefined") return;
    const currentUrl = window.location.href;

    if (isAndroid) {
      // Android Intent to open directly in Google Chrome
      try {
        const cleanHost = window.location.host;
        const cleanPath = window.location.pathname + window.location.search;
        const intentUrl = `intent://${cleanHost}${cleanPath}#Intent;scheme=https;package=com.android.chrome;end`;
        window.location.href = intentUrl;
        return;
      } catch {
        // Fallback
      }
    }

    // Standard external window trigger
    try {
      window.open(currentUrl, "_system");
    } catch {
      window.open(currentUrl, "_blank");
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
      // Fallback
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
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    isAndroid,
    isInAppBrowser,
    isTelegram,
    browserType,
    install,
    openInExternalBrowser,
    copyAppUrl,
  };
}
