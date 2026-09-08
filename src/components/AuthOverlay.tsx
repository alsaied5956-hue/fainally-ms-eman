import React, { useState } from "react";
import { UserAccount } from "../types";
import { TEACHER_NAME } from "../utils/helpers";
import { Lock, Shield, KeyRound, ArrowLeft, Sparkles, CheckCircle2 } from "lucide-react";
import { PWAInstallButton } from "./portal/PWAInstallButton";

interface AuthOverlayProps {
  usersList: UserAccount[];
  onLoginSuccess: (user: UserAccount) => void;
}

export const AuthOverlay: React.FC<AuthOverlayProps> = ({
  usersList,
  onLoginSuccess,
}) => {
  const [selectedUsername, setSelectedUsername] = useState(
    usersList[0]?.username || "admin"
  );
  const [passwordInput, setPasswordInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    const targetUser = usersList.find((u) => u.username === selectedUsername);
    if (!targetUser) {
      setErrorMsg("❌ اسم المستخدم غير موجود بالقائمة!");
      return;
    }

    if (targetUser.pass !== passwordInput.trim()) {
      setErrorMsg("❌ كلمة المرور غير صحيحة! يرجى إعادة المحاولة.");
      return;
    }

    onLoginSuccess(targetUser);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#060a14] flex flex-col items-center justify-between p-4 overflow-y-auto">
      {/* Background Decorative Gradients */}
      <div className="absolute top-1/4 -right-24 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute bottom-1/4 -left-24 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-sky-500/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Top action bar */}
      <div className="w-full max-w-md flex items-center justify-end z-10 pt-2">
        <PWAInstallButton variant="compact" />
      </div>

      <div className="max-w-md w-full glass-panel border-2 border-amber-500/30 p-8 md:p-10 rounded-3xl shadow-2xl relative z-10 space-y-7 animate-in fade-in zoom-in-95 duration-300 my-auto">
        {/* Brand Showcase */}
        <div className="text-center space-y-3">
          <div className="relative inline-block">
            <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-tr from-amber-600 via-amber-400 to-yellow-200 flex items-center justify-center text-slate-950 font-black text-4xl shadow-2xl shadow-amber-500/30 border-2 border-amber-300/60 transform hover:scale-105 transition-transform">
              إ
            </div>
            <div className="absolute -bottom-1 -left-1 w-6 h-6 rounded-full bg-emerald-500 border-2 border-[#090e1a] flex items-center justify-center shadow-md">
              <Sparkles className="w-3.5 h-3.5 text-slate-950" />
            </div>
          </div>

          <div>
            <h1 className="text-2xl font-black text-white tracking-tight flex items-center justify-center gap-2">
              <span>منظومة</span>
              <span className="gold-gradient-text">{TEACHER_NAME}</span>
            </h1>
            <p className="text-xs text-slate-400 font-semibold mt-1">
              المنصة السحابية لإدارة طلاب الرياضيات والحضور الذكي
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs font-bold">
          {errorMsg && (
            <div className="p-3.5 bg-rose-500/15 border border-rose-500/40 text-rose-300 rounded-2xl text-center font-bold shadow-lg animate-in fade-in">
              {errorMsg}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-slate-300 font-black flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-amber-400" />
              <span>اختر الحساب المصرح له:</span>
            </label>
            <div className="relative">
              <select
                value={selectedUsername}
                onChange={(e) => setSelectedUsername(e.target.value)}
                className="w-full bg-[#070c17] border-2 border-amber-500/30 text-white px-4 py-3.5 rounded-2xl outline-none font-black text-sm cursor-pointer focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 transition-all shadow-inner"
              >
                {usersList.map((u) => (
                  <option key={u.username} value={u.username} className="bg-slate-900 text-white">
                    {u.username} ({u.role === "admin" ? "👑 المسؤول المعتمد" : "👤 مساعد سكرتارية"})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-slate-300 font-black flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-amber-400" />
              <span>كلمة المرور السرية:</span>
            </label>
            <div className="relative">
              <input
                type="password"
                required
                autoFocus
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#070c17] border-2 border-amber-500/30 focus:border-amber-400 text-white px-4 py-3.5 rounded-2xl outline-none font-mono text-base pr-11 shadow-inner focus:ring-2 focus:ring-amber-400/20 transition-all placeholder:text-slate-600"
              />
              <Lock className="w-4 h-4 text-amber-400/60 absolute right-4 top-4 pointer-events-none" />
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-4 bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-300 hover:from-amber-400 hover:to-yellow-200 text-slate-950 font-black text-sm rounded-2xl shadow-xl shadow-amber-500/25 transition-all flex items-center justify-center gap-2 transform hover:scale-[1.02] active:scale-95 cursor-pointer border border-amber-300/40 mt-2"
          >
            <span>تسجيل الدخول إلى المنظومة</span>
            <ArrowLeft className="w-4 h-4" />
          </button>
        </form>

        <div className="text-center pt-3 border-t border-slate-800/80 space-y-3">
          <div className="inline-flex items-center gap-2 text-xs text-slate-400 bg-slate-900/90 px-3.5 py-1.5 rounded-full border border-slate-800">
            <span>حساب المسؤول:</span>
            <span className="text-amber-400 font-mono font-black">admin</span>
            <span>/</span>
            <span className="text-amber-400 font-mono font-black">2468</span>
          </div>
        </div>
      </div>
    </div>
  );
};
