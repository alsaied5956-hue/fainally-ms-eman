import React, { useMemo } from "react";
import { TabType, UserAccount, PermissionKey } from "../types";
import {
  ScanLine,
  UserPlus,
  CalendarCheck,
  Award,
  CreditCard,
  Coins,
  FileSpreadsheet,
  AlertTriangle,
  FileText,
  FileDown,
  MessageSquare,
  Users2,
  KeyRound,
  FileSignature,
  FileCheck2,
  X,
  Sparkles,
  Layers,
  ChevronLeft,
  PanelRightClose,
  Send,
  Bell,
  BookOpen,
} from "lucide-react";

interface SidebarProps {
  activeTab: TabType;
  onSelectTab: (tab: TabType) => void;
  currentUser: UserAccount | null;
  isOpen: boolean;
  onToggleSidebar?: () => void;
  onCloseMobile: () => void;
  onOpenPdfModal: (type: "attendance" | "exams" | "all" | "unpaid") => void;
  onOpenPrintCards?: () => void;
  onOpenBulkHomework?: () => void;
}

interface NavItem {
  id: TabType;
  label: string;
  icon: any;
  show: boolean;
  badge?: string;
  alert?: boolean;
  gold?: boolean;
}

interface NavCategory {
  title: string;
  items: NavItem[];
}

export const Sidebar: React.FC<SidebarProps> = React.memo(({
  activeTab,
  onSelectTab,
  currentUser,
  isOpen,
  onToggleSidebar,
  onCloseMobile,
  onOpenPdfModal,
  onOpenPrintCards,
  onOpenBulkHomework,
}) => {
  const hasPerm = (perm: PermissionKey): boolean => {
    if (!currentUser) return false;
    if (currentUser.role === "admin") return true;
    return currentUser.permissions?.includes(perm) ?? false;
  };

  const isAdmin = currentUser?.role === "admin";

  const categories: NavCategory[] = useMemo(() => [
    {
      title: "العمليات والحضور اليومي",
      items: [
        { id: "attendance-scan" as TabType, label: "سكانر الحضور والتأخير", icon: ScanLine, show: true, badge: "مباشر" },
        { id: "homework-tracker" as TabType, label: "متابعة الواجبات والإشعارات", icon: BookOpen, show: true, badge: "جديد" },
        { id: "add-student" as TabType, label: "إضافة طالب جديد ومجموعة", icon: UserPlus, show: hasPerm("add_student") },
        { id: "stats" as TabType, label: "تقرير الحضور اليومي والسابق", icon: CalendarCheck, show: true },
      ],
    },
    {
      title: "الدرجات والتقييم الأكاديمي",
      items: [
        { id: "cumulative-report" as TabType, label: "سجل الدرجات ونسب الطلاب", icon: FileSpreadsheet, show: true },
        { id: "grades" as TabType, label: "رصد درجات الامتحانات", icon: FileCheck2, show: hasPerm("add_grades") },
        { id: "early-warning" as TabType, label: "الإنذار المبكر للأداء والغياب", icon: AlertTriangle, show: hasPerm("early_warning"), alert: true },
        { id: "certificates" as TabType, label: "شهادات التفوق الأكاديمي", icon: Award, show: hasPerm("certificates"), gold: true },
      ],
    },
    {
      title: "المالية والمصروفات",
      items: [
        { id: "pay-expenses" as TabType, label: "دفع مصاريف واشتراكات الطلاب", icon: CreditCard, show: hasPerm("pay_expenses") },
        { id: "expenses" as TabType, label: "الإيرادات والإحصاء المالي", icon: Coins, show: hasPerm("view_revenues") },
      ],
    },
    {
      title: "التواصل والرسائل",
      items: [
        {
          id: "platform-messages" as TabType,
          label: "مركز إشعارات ورسائل المنصة",
          icon: Bell,
          show: hasPerm("send_messages"),
          badge: "المنصة",
        },
        {
          id: "whatsapp-engine" as TabType,
          label: "مراسلة واتساب فردية (يدوي)",
          icon: Send,
          show: hasPerm("send_messages"),
        },
        {
          id: "excel-integration" as TabType,
          label: "استيراد وتصدير شيتات Excel",
          icon: FileDown,
          show: hasPerm("excel_integration"),
        },
      ],
    },
    {
      title: "لوحة التحكم والإدارة",
      items: [
        { id: "manage-students" as TabType, label: "إدارة وتعديل بيانات الطلاب", icon: Users2, show: isAdmin },
        { id: "users" as TabType, label: "حسابات المساعدين والصلاحيات", icon: FileSignature, show: isAdmin },
        { id: "settings" as TabType, label: "إعدادات الأسعار وكلمة المرور", icon: KeyRound, show: isAdmin },
      ],
    },
  ], [currentUser, isAdmin]);

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-black/75 z-40 md:hidden transition-opacity"
          aria-hidden="true"
        />
      )}

      {/* Sidebar Aside element with dedicated independent scrolling */}
      <aside
        className={`no-print fixed md:static top-0 right-0 h-screen md:h-full bg-[#070c1e] border-l border-indigo-500/15 flex flex-col z-50 md:z-20 shrink-0 ${
          isOpen
            ? "w-80 block"
            : "hidden w-0"
        }`}
      >
        {/* Sidebar Header with Quick Hide Button */}
        <div className="p-3.5 border-b border-indigo-500/20 flex items-center justify-between bg-slate-900/95 sticky top-0 z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-yellow-300 text-slate-950 font-black flex items-center justify-center text-sm font-fancy shadow-md">
              إ
            </div>
            <span className="text-sm font-bold text-amber-300 font-fancy">قائمة المنظومة 📐</span>
          </div>
          <button
            onClick={onToggleSidebar || onCloseMobile}
            className="p-1.5 px-2.5 rounded-xl bg-slate-800/90 border border-slate-700/60 text-slate-300 hover:text-amber-400 hover:bg-slate-700/80 transition-all cursor-pointer flex items-center gap-1.5 text-xs active:scale-95"
            title="إخفاء القائمة الجانبية لتوسيع الشاشة"
          >
            <PanelRightClose className="w-4 h-4" />
            <span className="text-[11px] font-tajawal font-medium">إخفاء</span>
          </button>
        </div>

        {/* Scrollable Body containing Printable Quick Hub and Main Nav Items */}
        <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col">
          {/* Printable Quick Hub */}
          <div className="p-4 border-b border-indigo-500/15 bg-gradient-to-b from-indigo-500/10 via-[#0a122e]/40 to-transparent">
            <div className="text-[11px] font-bold text-amber-300 mb-2.5 px-1 flex items-center justify-between font-tajawal">
              <span className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-amber-400" />
                <span>تصدير وطباعة PDF مقسم:</span>
              </span>
              <span className="text-[10px] text-slate-400 bg-white/5 px-2 py-0.5 rounded-full border border-white/5">A4 جاهز</span>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button
                onClick={() => onOpenPdfModal("attendance")}
                className="px-3 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-400/25 hover:border-amber-400/40 text-amber-300 text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer transform active:scale-95 font-tajawal"
              >
                <span>📄 تقرير الغياب</span>
              </button>
              <button
                onClick={() => onOpenPdfModal("exams")}
                className="px-3 py-2 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-400/25 hover:border-sky-400/40 text-sky-300 text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer transform active:scale-95 font-tajawal"
              >
                <span>📊 سجل الدرجات</span>
              </button>
            </div>
            <button
              onClick={() => onOpenPdfModal("unpaid")}
              className="w-full px-3 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/30 hover:border-rose-400/50 text-rose-300 text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer transform active:scale-95 font-tajawal mb-2"
            >
              <span>🔴 كشف غير المسددين (الذين لم يدفعوا فقط)</span>
            </button>
            {onOpenPrintCards && (
              <button
                onClick={onOpenPrintCards}
                className="w-full px-3 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-400/25 hover:border-emerald-400/40 text-emerald-300 text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer transform active:scale-95 font-tajawal mb-2"
              >
                <span>🪪 طباعة كروت الباركود الذكية (ID Cards)</span>
              </button>
            )}
            <button
              onClick={() => {
                onSelectTab("homework-tracker");
                onCloseMobile();
              }}
              className="w-full px-3 py-2 rounded-xl bg-gradient-to-r from-amber-500/15 via-indigo-500/20 to-purple-500/15 hover:from-amber-500/25 hover:to-purple-500/25 border border-amber-400/35 hover:border-amber-400/55 text-amber-300 text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer transform active:scale-95 font-tajawal"
            >
              <BookOpen className="w-3.5 h-3.5 text-amber-400" />
              <span>📚 رصد واجبات المجموعة بالباركود</span>
            </button>
          </div>

          {/* Main Nav Items Categorized */}
          <nav className="flex-1 p-3.5 space-y-4">
            {categories.map((cat, idx) => {
              const visibleItems = cat.items.filter((it) => it.show);
              if (visibleItems.length === 0) return null;

              return (
                <div key={idx} className="space-y-1">
                  <div className="text-[11px] font-bold text-slate-400 px-3 mb-1.5 font-fancy flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block shadow-sm shadow-amber-400/50" />
                    <span>{cat.title}</span>
                  </div>

                  <div className="space-y-1">
                    {visibleItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => onSelectTab(item.id)}
                          className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs font-bold text-right cursor-pointer font-tajawal ${
                            isActive
                              ? "bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-200 text-slate-950 font-black shadow-sm"
                              : item.alert
                              ? "bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20"
                              : item.gold
                              ? "bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20"
                              : "text-slate-300 hover:bg-white/5 hover:text-white"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Icon
                              className={`w-4 h-4 shrink-0 ${
                                isActive
                                  ? "text-slate-950"
                                  : item.alert
                                  ? "text-rose-400"
                                  : item.gold
                                  ? "text-amber-400"
                                  : "text-slate-400"
                              }`}
                            />
                            <span className="truncate">{item.label}</span>
                          </div>

                          {item.badge && !isActive && (
                            <span className="text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                              {item.badge}
                            </span>
                          )}

                          {isActive && (
                            <ChevronLeft className="w-3.5 h-3.5 text-slate-950 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          {/* Bottom System Info */}
          <div className="p-3.5 border-t border-indigo-500/15 bg-[#050917] text-center mt-auto">
            <div className="text-[12px] font-bold text-slate-200 font-fancy">
              منظومة إدارة الرياضيات الذكية
            </div>
            <div className="text-[10px] text-amber-400/90 font-mono font-bold mt-0.5">
              الأستاذة إيمان الدمشيتي • v3.5
            </div>
          </div>
        </div>
      </aside>
    </>
  );
});
