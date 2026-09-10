import React from "react";
import { UserAccount } from "../types";
import { TEACHER_NAME, PREDEFINED_SESSION_SLOTS } from "../utils/helpers";
import { PWAInstallButton } from "./portal/PWAInstallButton";
import {
  Shield,
  User,
  Sun,
  Moon,
  Volume2,
  VolumeX,
  Clock,
  Wifi,
  WifiOff,
  RefreshCw,
  LogOut,
  Menu,
  Printer,
  Sparkles,
  CheckCircle2,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Bell,
} from "lucide-react";

interface NavbarProps {
  currentUser: UserAccount | null;
  currentDateText?: string;
  isOnline?: boolean;
  isSyncing?: boolean;
  hasPendingSync?: boolean;
  isQuotaExceeded?: boolean;
  onManualSync?: () => void;
  onOpenMultiDeviceSync?: () => void;
  unreadPlatformMessagesCount?: number;
  onNavigateToPlatformMessages?: () => void;
  pendingWhatsAppCount?: number;
  onOpenWhatsAppOutbox?: () => void;
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
  voiceEnabled?: boolean;
  onToggleVoice?: () => void;
  onLogout: () => void;
  activeSessionSlotId?: string;
  onChangeSessionSlot?: (slotId: string) => void;
  onOpenQuickScan?: () => void;
  onOpenPrintAllPDF?: () => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onOpenPortal?: () => void;
}

export const Navbar: React.FC<NavbarProps> = React.memo(({
  currentUser,
  currentDateText = "",
  isOnline = true,
  isSyncing = false,
  hasPendingSync = false,
  isQuotaExceeded = false,
  onManualSync,
  onOpenMultiDeviceSync,
  unreadPlatformMessagesCount = 0,
  onNavigateToPlatformMessages,
  pendingWhatsAppCount = 0,
  onOpenWhatsAppOutbox,
  theme = "dark",
  onToggleTheme,
  voiceEnabled = true,
  onToggleVoice,
  onLogout,
  activeSessionSlotId = "auto",
  onChangeSessionSlot,
  onOpenPrintAllPDF,
  isSidebarOpen = true,
  onToggleSidebar,
  onOpenPortal,
}) => {
  return (
    <header className="no-print bg-[#070c1e] border-b border-indigo-500/15 px-4 md:px-8 py-3 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-30 shadow-2xl">
      {/* Brand & Teacher Logo */}
      <div className="flex items-center gap-3.5">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className={`p-2.5 rounded-2xl border shadow-md cursor-pointer flex items-center gap-2 text-xs font-bold ${
              isSidebarOpen
                ? "bg-slate-800/90 border-slate-700/70 text-slate-300 hover:text-amber-400 hover:bg-slate-700/80"
                : "bg-amber-500/20 border-amber-400/40 text-amber-300 hover:bg-amber-500/30 shadow-amber-500/10"
            }`}
            title={isSidebarOpen ? "إخفاء القائمة الجانبية (توسيع الشاشة)" : "إظهار القائمة الجانبية"}
          >
            {isSidebarOpen ? (
              <PanelRightClose className="w-5 h-5 text-amber-400" />
            ) : (
              <PanelRightOpen className="w-5 h-5 text-amber-400 animate-pulse" />
            )}
            <span className="hidden xl:inline font-tajawal text-[11px]">
              {isSidebarOpen ? "إخفاء القائمة" : "القائمة الجانبية"}
            </span>
          </button>
        )}

        <div className="relative group flex items-center gap-3">
          <div className="relative">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 via-amber-400 to-yellow-200 flex items-center justify-center shadow-lg shadow-amber-500/25 text-slate-950 font-black text-2xl tracking-tighter border-2 border-white/20 transition-all duration-300 group-hover:scale-105 group-hover:rotate-3">
              <span className="font-fancy font-bold">إ</span>
            </div>
            <div
              className={`absolute -bottom-1 -left-1 w-4 h-4 rounded-full border-2 border-[#080d1f] flex items-center justify-center shadow-md ${
                isOnline ? "bg-emerald-500 shadow-emerald-500/50" : "bg-amber-500 shadow-amber-500/50"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-fancy text-xl md:text-2xl text-white leading-tight tracking-normal flex items-center gap-1.5">
                <span className="font-medium text-slate-300">منظومة</span>
                <span className="gold-gradient-text font-bold tracking-wide">{TEACHER_NAME}</span>
              </h1>
              <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-amber-500/20 to-indigo-500/20 border border-amber-400/30 text-[10px] font-bold text-amber-300 shadow-sm">
                <Sparkles className="w-2.5 h-2.5 text-amber-400" />
                <span>الرياضيات الذكية</span>
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium flex items-center gap-2 mt-0.5">
              <span className="text-amber-400/90 font-tajawal">أستاذة الرياضيات المتخصصة</span>
              <span className="text-slate-600 font-mono">•</span>
              <span className="font-mono text-slate-300 tracking-wider">01070642904</span>
            </p>
          </div>
        </div>
      </div>

      {/* Middle: Session Time Slot Selector */}
      {onChangeSessionSlot && (
        <div className="flex items-center gap-2.5 bg-gradient-to-r from-[#0d152f] to-[#0a1024] border border-indigo-500/20 hover:border-indigo-400/40 px-4 py-2 rounded-2xl shadow-inner transition-colors">
          <Clock className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
          <label className="text-xs font-bold text-amber-300/90 whitespace-nowrap hidden lg:inline font-tajawal">
            موعد الحصة المعتمد:
          </label>
          <select
            value={activeSessionSlotId}
            onChange={(e) => onChangeSessionSlot(e.target.value)}
            className="bg-transparent text-xs font-bold text-white outline-none cursor-pointer pr-1 font-fancy"
          >
            {PREDEFINED_SESSION_SLOTS.map((slot) => (
              <option key={slot.id} value={slot.id} className="bg-slate-900 text-white font-medium">
                {slot.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Right Controls & Quick Utilities */}
      <div className="flex items-center gap-2 sm:gap-2.5">
        {/* Quick Print PDF Action */}
        {onOpenPrintAllPDF && (
          <button
            onClick={onOpenPrintAllPDF}
            className="hidden lg:flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-bold transition-all shadow-sm transform hover:scale-[1.02] active:scale-95 cursor-pointer font-tajawal"
            title="طباعة وتصدير تقارير PDF مقسمة لكل صف"
          >
            <Printer className="w-4 h-4 text-amber-400" />
            <span>طباعة PDF مقسم</span>
          </button>
        )}

        {/* Date Tag */}
        {currentDateText && (
          <span className="hidden xl:inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 bg-slate-900/70 px-3.5 py-2 rounded-2xl border border-slate-800 shadow-sm font-tajawal">
            <span>📅</span>
            <span>{currentDateText}</span>
          </span>
        )}

        {/* In-App Platform Messaging Button (Primary) */}
        {onNavigateToPlatformMessages && (
          <button
            onClick={onNavigateToPlatformMessages}
            className="relative flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-bold border transition-all cursor-pointer transform active:scale-95 bg-indigo-600/20 hover:bg-indigo-600/35 text-indigo-200 border-indigo-500/40 shadow-sm"
            title="مركز المراسلة والتنبيهات بالمنصة (الأساسي)"
          >
            <Bell className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden md:inline font-tajawal">رسائل المنصة</span>
            {unreadPlatformMessagesCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-indigo-500 text-white text-[10px] font-black font-mono shadow-sm">
                {unreadPlatformMessagesCount}
              </span>
            )}
          </button>
        )}


        {/* Live Cloud Status Indicator with Sync Button */}
        <div className="flex items-center gap-1.5">
          {onOpenPortal && (
            <button
              onClick={onOpenPortal}
              className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 shadow-sm transition-all cursor-pointer transform active:scale-95"
              title="الانتقال إلى بوابة أولياء الأمور والإشراف"
            >
              <Shield className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-tajawal">بوابة أولياء الأمور</span>
            </button>
          )}

          {onOpenMultiDeviceSync && (
            <button
              onClick={onOpenMultiDeviceSync}
              className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-bold bg-indigo-600/30 hover:bg-indigo-600/50 text-amber-300 border border-indigo-500/40 shadow-sm transition-all cursor-pointer transform active:scale-95"
              title="مركز توحيد ومزامنة جميع الأجهزة لدمج الأسماء والاشتراكات"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-tajawal">توحيد الأجهزة</span>
            </button>
          )}

          <button
            onClick={onManualSync}
            disabled={isSyncing}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-2xl text-xs font-bold border transition-all cursor-pointer transform active:scale-95 ${
              isSyncing
                ? "bg-amber-500/15 text-amber-300 border-amber-500/40 animate-pulse"
                : isQuotaExceeded
                ? "bg-amber-500/15 text-amber-300 border-amber-500/40 shadow-sm hover:bg-amber-500/25"
                : hasPendingSync
                ? "bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-md shadow-amber-500/20 hover:bg-amber-500/30"
                : isOnline
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20 shadow-sm shadow-emerald-500/10"
                : "bg-slate-800 text-amber-300 border-amber-500/30"
            }`}
            title={
              isSyncing
                ? "جارٍ مزامنة وتحديث البيانات مع السحابة..."
                : isQuotaExceeded
                ? "بياناتك محفوظة بالكامل محلياً على جهازك 100% (تم الوصول للحد اليومي المجاني لكوتة السحابة) - انقر لمحاولة المزامنة يدوياً"
                : hasPendingSync
                ? "توجد بيانات مسجلة أوفلاين بانتظار المزامنة - اضغط للمزامنة فوراً"
                : isOnline
                ? "متصل سحابياً (أونلاين) - انقر للمزامنة الفورية الآن"
                : "وضع الأوفلاين - البيانات محفوظة محلياً وتتزامن فور توفر النت"
            }
          >
            {isSyncing ? (
              <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
            ) : isQuotaExceeded ? (
              <Shield className="w-3.5 h-3.5 text-amber-400" />
            ) : hasPendingSync ? (
              <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
            ) : isOnline ? (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-amber-400" />
            )}

            <span className="hidden sm:inline font-tajawal">
              {isSyncing
                ? "جارٍ المزامنة..."
                : isQuotaExceeded
                ? "محفوظ محلياً"
                : hasPendingSync
                ? "مزامنة المعلق"
                : isOnline
                ? "سحابي متزامن"
                : "وضع الأوفلاين"}
            </span>
          </button>
        </div>

        {/* PWA Install Button (Works on all browsers, mobiles & desktop) */}
        <PWAInstallButton variant="compact" />

        {/* Voice Announcement Audio Toggle */}
        {onToggleVoice && (
          <button
            onClick={onToggleVoice}
            className={`p-2.5 rounded-2xl border transition-all cursor-pointer transform active:scale-95 ${
              voiceEnabled
                ? "bg-amber-500/20 border-amber-500/40 text-amber-300 shadow-md shadow-amber-500/10"
                : "bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200"
            }`}
            title={voiceEnabled ? "النطق الصوتي الترحيبي للطلاب مفعل" : "النطق الصوتي معطل"}
          >
            {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
        )}

        {/* Theme Switcher (Dark / Light) */}
        {onToggleTheme && (
          <button
            onClick={onToggleTheme}
            className="p-2.5 rounded-2xl bg-slate-900/80 border border-slate-800 text-slate-300 hover:text-amber-400 hover:border-amber-500/30 transition-all cursor-pointer transform active:scale-95 shadow-sm"
            title={theme === "dark" ? "التبديل إلى الوضع النهاري الفاتح" : "التبديل إلى الوضع المظلم الفاخر"}
          >
            {theme === "dark" ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
          </button>
        )}

        {/* Current User Badge */}
        {currentUser && (
          <div className="flex items-center gap-2 bg-gradient-to-r from-slate-900/90 to-indigo-950/70 border border-indigo-500/30 px-3.5 py-1.5 rounded-2xl shadow-sm">
            {currentUser.role === "admin" ? (
              <Shield className="w-4 h-4 text-amber-400" />
            ) : (
              <User className="w-4 h-4 text-cyan-400" />
            )}
            <span className="text-xs font-bold text-slate-200 font-fancy">
              {currentUser.username}
            </span>
          </div>
        )}

        {/* Sign Out Button */}
        <button
          onClick={onLogout}
          className="p-2.5 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 hover:text-rose-300 transition-all cursor-pointer transform active:scale-95 shadow-sm"
          title="تسجيل الخروج الآمن"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
});
