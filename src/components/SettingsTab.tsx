import React, { useState, useEffect } from "react";
import { UserAccount, GradeName, GRADE_ORDER } from "../types";
import { DEFAULT_GRADE_PRICES, getWhatsAppMode, setWhatsAppMode } from "../utils/helpers";
import { KeyRound, Tag, ShieldCheck, CheckCircle, MessageSquare, Globe, Smartphone, Sun, Moon, Palette, ExternalLink, Sparkles } from "lucide-react";

interface SettingsTabProps {
  currentUser: UserAccount;
  groupPrices: Record<GradeName, number>;
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
  onChangePassword: (newPass: string) => void;
  onUpdateGroupPrice: (grade: GradeName, newPrice: number) => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  currentUser,
  groupPrices,
  theme = "dark",
  onToggleTheme,
  onChangePassword,
  onUpdateGroupPrice,
}) => {
  // Password Change State
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");

  // WhatsApp Mode State
  const [waMode, setWaMode] = useState<"web" | "app">("web");

  useEffect(() => {
    setWaMode(getWhatsAppMode());
  }, []);

  const handleWhatsAppModeChange = (mode: "web" | "app") => {
    setWaMode(mode);
    setWhatsAppMode(mode);
  };

  // Group Price State
  const [selectedGrade, setSelectedGrade] = useState<GradeName>("الصف الرابع الابتدائي");
  const [priceInput, setPriceInput] = useState<number>(
    groupPrices["الصف الرابع الابتدائي"] ?? DEFAULT_GRADE_PRICES["الصف الرابع الابتدائي"] ?? 100
  );

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentPass !== currentUser.pass) {
      alert("❌ كلمة المرور الحالية غير صحيحة!");
      return;
    }
    if (newPass !== confirmPass) {
      alert("⚠️ كلمة المرور الجديدة وتأكيدها غير متطابقين!");
      return;
    }
    if (!newPass.trim()) {
      alert("⚠️ لا يمكن ترك كلمة المرور فارغة!");
      return;
    }

    onChangePassword(newPass.trim());
    alert("✅ تم تغيير كلمة المرور بنجاح ومزامنتها سحابياً!");
    setCurrentPass("");
    setNewPass("");
    setConfirmPass("");
  };

  const handleGradeSelect = (grade: GradeName) => {
    setSelectedGrade(grade);
    setPriceInput(groupPrices[grade] ?? DEFAULT_GRADE_PRICES[grade] ?? 100);
  };

  const handleSavePrice = (e: React.FormEvent) => {
    e.preventDefault();
    if (priceInput <= 0) {
      alert("⚠️ يرجى إدخال سعر اشتراك صحيح!");
      return;
    }

    onUpdateGroupPrice(selectedGrade, priceInput);
    alert(`✅ تم تحديث سعر الاشتراك الافتراضي لـ (${selectedGrade}) بـ ${priceInput} ج.م بنجاح!`);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Theme Settings Card (Dark / Light Mode) */}
      <div className="glass-panel p-6 md:p-8 rounded-3xl shadow-2xl space-y-5">
        <div className="flex items-center gap-3.5 pb-4 border-b border-indigo-500/20">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shadow-md">
            <Palette className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold font-fancy text-amber-300">
              مظهر المنظومة (الوضع المظلم / الوضع الفاتح)
            </h2>
            <p className="text-xs text-slate-400 font-tajawal mt-0.5">
              اختر المظهر المريح لعينيك أثناء العمل والمتابعة
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1 font-tajawal">
          {/* Dark Mode Card */}
          <button
            type="button"
            onClick={() => {
              if (theme !== "dark" && onToggleTheme) onToggleTheme();
            }}
            className={`p-4.5 rounded-2xl border text-right transition-all flex flex-col justify-between cursor-pointer ${
              theme === "dark"
                ? "bg-slate-900/90 border-amber-400 shadow-lg ring-2 ring-amber-400/30"
                : "bg-slate-900/40 border-indigo-500/20 opacity-70 hover:opacity-100 hover:border-amber-400/40"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-slate-950 text-amber-400 border border-amber-500/20">
                  <Moon className="w-5 h-5" />
                </div>
                <span className="font-bold text-sm text-slate-100">الوضع المظلم (Dark)</span>
              </div>
              {theme === "dark" && (
                <span className="text-[10px] bg-amber-400 text-slate-950 font-black px-2.5 py-0.5 rounded-full">
                  المفعل حالياً
                </span>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-slate-400">
              مظهر ليلي كلاسيكي فاخر بألوان كحلية وذهبية مريحة للعين.
            </p>
          </button>

          {/* Light Mode Card */}
          <button
            type="button"
            onClick={() => {
              if (theme !== "light" && onToggleTheme) onToggleTheme();
            }}
            className={`p-4.5 rounded-2xl border text-right transition-all flex flex-col justify-between cursor-pointer ${
              theme === "light"
                ? "bg-amber-50 border-amber-500 shadow-lg ring-2 ring-amber-500/40 text-slate-900"
                : "bg-slate-900/40 border-indigo-500/20 opacity-70 hover:opacity-100 hover:border-amber-400/40"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-500 text-slate-900">
                  <Sun className="w-5 h-5" />
                </div>
                <span className="font-bold text-sm text-slate-900 dark:text-slate-100">الوضع الفاتح (Light)</span>
              </div>
              {theme === "light" && (
                <span className="text-[10px] bg-amber-500 text-black font-black px-2.5 py-0.5 rounded-full">
                  المفعل حالياً
                </span>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
              مظهر نهاري ناصع وفائق الوضوح ومثالي للقاعات والطباعة.
            </p>
          </button>
        </div>
      </div>

      {/* Change Password Card */}
      <div className="glass-panel p-6 md:p-8 rounded-3xl shadow-2xl space-y-5">
        <div className="flex items-center gap-3.5 pb-4 border-b border-indigo-500/20">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shadow-md">
            <KeyRound className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold font-fancy text-amber-300">
              تغيير كلمة مرور الحساب الحالي ({currentUser.username})
            </h2>
            <p className="text-xs text-slate-400 font-tajawal mt-0.5">
              تحديث كلمة المرور مع الحفظ الفوري والتزامن السحابي
            </p>
          </div>
        </div>

        <form onSubmit={handlePasswordSubmit} className="space-y-4 text-xs font-bold font-tajawal">
          <div className="space-y-1.5">
            <label className="text-slate-300">كلمة المرور الحالية *</label>
            <input
              type="password"
              required
              value={currentPass}
              onChange={(e) => setCurrentPass(e.target.value)}
              placeholder="أدخل كلمة المرور الحالية"
              className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-100 px-4 py-3 rounded-2xl outline-none focus:border-amber-400 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-slate-300">كلمة المرور الجديدة *</label>
            <input
              type="password"
              required
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              placeholder="أدخل كلمة المرور الجديدة"
              className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-100 px-4 py-3 rounded-2xl outline-none focus:border-amber-400 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-slate-300">تأكيد كلمة المرور الجديدة *</label>
            <input
              type="password"
              required
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value)}
              placeholder="أعد إدخال كلمة المرور الجديدة"
              className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-100 px-4 py-3 rounded-2xl outline-none focus:border-amber-400 transition-all"
            />
          </div>

          <button
            type="submit"
            className="px-6 py-3 rounded-2xl bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-200 hover:from-amber-300 hover:to-yellow-100 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/20 transition-all cursor-pointer"
          >
            تحديث كلمة المرور 🔒
          </button>
        </form>
      </div>

      {/* WhatsApp Sending Engine Target */}
      <div className="glass-panel p-6 md:p-8 rounded-3xl shadow-2xl space-y-5">
        <div className="flex items-center gap-3.5 pb-4 border-b border-indigo-500/20">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shadow-md">
            <MessageSquare className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold font-fancy text-emerald-300">
              طريقة فتح وإرسال رسائل WhatsApp
            </h2>
            <p className="text-xs text-slate-400 font-tajawal mt-0.5">
              اختر بين فتح WhatsApp Web على المتصفح أو فتح تطبيق الواتساب المثبت
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1 font-tajawal">
          {/* Mode Web */}
          <button
            type="button"
            onClick={() => handleWhatsAppModeChange("web")}
            className={`p-4.5 rounded-2xl border text-right transition-all flex flex-col justify-between cursor-pointer ${
              waMode === "web"
                ? "bg-emerald-500/20 border-emerald-400 shadow-lg ring-2 ring-emerald-400/30"
                : "bg-slate-900/40 border-indigo-500/20 hover:border-emerald-400/40"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  <Globe className="w-5 h-5" />
                </div>
                <span className="font-bold text-sm text-slate-100">WhatsApp Web (الموصى به)</span>
              </div>
              {waMode === "web" && (
                <span className="text-[10px] bg-emerald-400 text-slate-950 font-black px-2.5 py-0.5 rounded-full">
                  المفعل حالياً
                </span>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-slate-300">
              يفتح متصفح Google Chrome تلقائياً مع تجهيز المحادثة ورقم ولي الأمر ونص الرسالة بالكامل للضغط على إرسال فورا.
            </p>
          </button>

          {/* Mode App */}
          <button
            type="button"
            onClick={() => handleWhatsAppModeChange("app")}
            className={`p-4.5 rounded-2xl border text-right transition-all flex flex-col justify-between cursor-pointer ${
              waMode === "app"
                ? "bg-emerald-500/20 border-emerald-400 shadow-lg ring-2 ring-emerald-400/30"
                : "bg-slate-900/40 border-indigo-500/20 hover:border-emerald-400/40"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30">
                  <Smartphone className="w-5 h-5" />
                </div>
                <span className="font-bold text-sm text-slate-100">تطبيق WhatsApp للكمبيوتر</span>
              </div>
              {waMode === "app" && (
                <span className="text-[10px] bg-emerald-400 text-slate-950 font-black px-2.5 py-0.5 rounded-full">
                  المفعل حالياً
                </span>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-slate-300">
              يقوم بفتح تطبيق WhatsApp المثبت على جهازك مباشرة (<span className="font-mono text-sky-400">wa.me</span>).
            </p>
          </button>
        </div>
      </div>

      {/* Default Grade Prices Card */}
      <div className="glass-panel p-6 md:p-8 rounded-3xl shadow-2xl space-y-5">
        <div className="flex items-center gap-3.5 pb-4 border-b border-indigo-500/20">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shadow-md">
            <Tag className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold font-fancy text-amber-300">
              تحديد أسعار الاشتراكات الشهرية الافتراضية لكل صف
            </h2>
            <p className="text-xs text-slate-400 font-tajawal mt-0.5">
              هذه الأسعار تطبق تلقائياً عند إضافة طالب جديد مالم يتم تحديد سعر مخصص له
            </p>
          </div>
        </div>

        <form onSubmit={handleSavePrice} className="space-y-4 text-xs font-bold font-tajawal">
          <div className="space-y-1.5">
            <label className="text-slate-300">اختر الصف الدراسي:</label>
            <select
              value={selectedGrade}
              onChange={(e) => handleGradeSelect(e.target.value as GradeName)}
              className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-100 px-4 py-3 rounded-2xl outline-none"
            >
              {GRADE_ORDER.map((grade) => (
                <option key={grade} value={grade} className="bg-slate-900 text-white">
                  {grade}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-slate-300">
              سعر الاشتراك الشهري الافتراضي للصف (بالجنيه المصري):
            </label>
            <input
              type="number"
              min={1}
              required
              value={priceInput}
              onChange={(e) => setPriceInput(Number(e.target.value))}
              className="w-full bg-[#080d1e] border border-amber-400 text-amber-300 font-black px-4 py-3 rounded-2xl text-lg outline-none font-mono"
            />
          </div>

          <button
            type="submit"
            className="px-6 py-3 rounded-2xl bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-200 hover:from-amber-300 hover:to-yellow-100 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/20 cursor-pointer transition-all"
          >
            حفظ وتثبيت سعر الصف 💵
          </button>
        </form>
      </div>

      {/* External System Link Card */}
      <div className="glass-panel border border-amber-500/40 p-6 md:p-8 rounded-3xl shadow-2xl space-y-4">
        <div className="flex items-center justify-between pb-4 border-b border-indigo-500/20">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 bg-gradient-to-br from-amber-500/30 to-amber-600/20 text-amber-400 border border-amber-500/40 rounded-2xl flex items-center justify-center shadow-inner">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold font-fancy text-amber-300">
                منظومة الأستاذة إيمان الدمشيتي (الرابط الخارجي)
              </h2>
              <p className="text-xs text-slate-400 font-tajawal mt-0.5">
                الانتقال المباشر للمنظومة الخارجية بضغطة زر واحدة
              </p>
            </div>
          </div>
        </div>

        <div className="pt-2">
          <a
            href="https://the-system-for-ms-eman-eldamshity-p.vercel.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-200 hover:from-amber-300 hover:to-yellow-100 text-slate-950 font-black text-sm shadow-xl shadow-amber-500/25 transition-all flex items-center justify-center gap-3 transform hover:-translate-y-0.5 cursor-pointer no-underline font-tajawal"
          >
            <ExternalLink className="w-5 h-5 text-slate-950 stroke-[2.5]" />
            <span className="text-sm font-black tracking-wide">
              فتح منظومة الأستاذة إيمان الدمشيتي 🚀
            </span>
          </a>
        </div>
      </div>
    </div>
  );
};
