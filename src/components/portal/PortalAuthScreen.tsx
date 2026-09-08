import React, { useState } from "react";
import { Student } from "../../types";
import { registerParentAccount, authenticatePortalLogin } from "../../utils/portalStorage";
import { ParentAccount } from "../../types/portal";
import { PWAInstallButton } from "./PWAInstallButton";
import {
  ShieldCheck,
  UserCheck,
  KeyRound,
  Phone,
  Barcode,
  Sparkles,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  QrCode,
  BellRing,
} from "lucide-react";

interface PortalAuthScreenProps {
  students: Student[];
  onLoginSuccess: (role: "parent" | "admin", account?: ParentAccount, barcode?: string) => void;
  revocationNotice?: string | null;
  onClearRevocationNotice?: () => void;
}

export const PortalAuthScreen: React.FC<PortalAuthScreenProps> = ({
  students,
  onLoginSuccess,
  revocationNotice,
  onClearRevocationNotice,
}) => {
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");

  // Login form state
  const [loginBarcode, setLoginBarcode] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Register form state
  const [regBarcode, setRegBarcode] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);

  // Status & Feedback
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Submit Login
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsLoading(true);

    try {
      const res = await authenticatePortalLogin(loginBarcode, loginPassword, students);
      if (res.success && res.role) {
        setSuccessMsg(res.message);
        setTimeout(() => {
          onLoginSuccess(res.role!, res.account, loginBarcode.trim());
        }, 500);
      } else {
        setErrorMsg(res.message);
      }
    } catch (err) {
      setErrorMsg("حدث خطأ غير متوقع أثناء تسجيل الدخول. يرجى المحاولة ثانية.");
    } finally {
      setIsLoading(false);
    }
  };

  // Submit Register
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (regPassword !== regConfirmPassword) {
      setErrorMsg("كلمتا المرور غير متطابقتين. يرجى التأكد وإعادة الإدخال.");
      return;
    }

    if (regPassword.length < 4) {
      setErrorMsg("يجب ألا تقل كلمة المرور عن 4 خانات لضمان أمان حسابكم.");
      return;
    }

    setIsLoading(true);

    try {
      const res = await registerParentAccount(regBarcode, regPhone, regPassword, students);
      if (res.success && res.account) {
        setSuccessMsg(res.message);
        setTimeout(() => {
          onLoginSuccess("parent", res.account, res.account!.studentBarcode);
        }, 800);
      } else {
        setErrorMsg(res.message);
      }
    } catch (err) {
      setErrorMsg("تعذر إتمام التسجيل السحابي. يرجى التحقق من اتصال الإنترنت.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-gradient-to-br from-[#060812] via-[#090d1f] to-[#04060c] text-slate-100 p-4 sm:p-6 md:p-8 font-tajawal relative overflow-y-auto">
      {/* Background ambient lighting */}
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Top Header Bar */}
      <header className="w-full max-w-5xl mx-auto flex items-center justify-between gap-3 py-2 z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-400 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <span className="text-xs font-bold text-slate-300 font-fancy">
            منظومة الأستاذة إيمان الدمشيتي
          </span>
        </div>

        {/* PWA Install Button (Top-Right / Explicit) */}
        <div className="flex items-center gap-2">
          <PWAInstallButton variant="primary" />
        </div>
      </header>

      {/* Main Form Center Box */}
      <main className="w-full max-w-md mx-auto my-auto py-6 z-10">
        <div className="bg-slate-900/90 border border-amber-500/25 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl space-y-6">
          {/* Logo & Portal Title */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-gradient-to-br from-amber-500/20 via-amber-400/10 to-transparent border border-amber-500/40 text-amber-400 shadow-xl shadow-amber-500/10 mb-1">
              <ShieldCheck className="w-9 h-9" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold font-fancy text-white tracking-wide">
              بوابة أولياء الأمور والإشراف
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 font-tajawal">
              منظومة الأستاذة إيمان الدمشيتي للرياضيات
            </p>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="grid grid-cols-2 p-1.5 rounded-2xl bg-slate-950/80 border border-slate-800">
            <button
              type="button"
              onClick={() => {
                setActiveTab("login");
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className={`py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                activeTab === "login"
                  ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-md font-extrabold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <KeyRound className="w-4 h-4" />
              <span>تسجيل الدخول</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("register");
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className={`py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                activeTab === "register"
                  ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-md font-extrabold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <UserCheck className="w-4 h-4" />
              <span>تفعيل حساب جديد (أول مرة)</span>
            </button>
          </div>

          {/* Remote Logout Revocation Notice */}
          {revocationNotice && (
            <div className="p-4 rounded-2xl bg-rose-950/80 border-2 border-rose-500/60 text-rose-200 text-xs shadow-xl animate-fadeIn flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-400 mt-0.5" />
              <div className="flex-1 space-y-1">
                <p className="font-black text-rose-300 text-sm">
                  ⚠️ تم تسجيل الخروج التلقائي من حساب ولي الأمر
                </p>
                <p className="text-slate-300 leading-relaxed font-tajawal">
                  {revocationNotice}
                </p>
              </div>
              {onClearRevocationNotice && (
                <button
                  type="button"
                  onClick={onClearRevocationNotice}
                  className="text-rose-400 hover:text-white p-1 rounded-lg hover:bg-rose-500/20 transition cursor-pointer"
                  title="إغلاق التنبيه"
                >
                  ✕
                </button>
              )}
            </div>
          )}

          {/* Feedback Messages */}
          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5 animate-fadeIn">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span className="leading-relaxed">{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-2.5 animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
              <span className="leading-relaxed">{successMsg}</span>
            </div>
          )}

          {/* TAB 1: LOGIN FORM */}
          {activeTab === "login" ? (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Barcode className="w-4 h-4 text-amber-400" />
                  <span>كود الباركود الخاص بك</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    dir="ltr"
                    value={loginBarcode}
                    onChange={(e) => setLoginBarcode(e.target.value)}
                    placeholder="أدخل كود الباركود"
                    className="w-full px-4 py-3 rounded-2xl bg-slate-950/70 border border-slate-700/80 focus:border-amber-400 focus:outline-none text-white text-sm font-mono tracking-wider text-center"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Lock className="w-4 h-4 text-amber-400" />
                  كلمة المرور
                </label>
                <div className="relative">
                  <input
                    type={showLoginPassword ? "text" : "password"}
                    required
                    dir="ltr"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-3 rounded-2xl bg-slate-950/70 border border-slate-700/80 focus:border-amber-400 focus:outline-none text-white text-sm font-mono tracking-widest text-center"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword(!showLoginPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
                  >
                    {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-extrabold text-sm transition-all shadow-xl shadow-amber-500/20 active:scale-[0.99] cursor-pointer flex items-center justify-center gap-2 mt-2 disabled:opacity-50"
              >
                {isLoading ? (
                  <span>جاري التحقق وتسجيل الدخول...</span>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    <span>دخول البوابة</span>
                  </>
                )}
              </button>
            </form>
          ) : (
            /* TAB 2: REGISTER FORM (First-time) */
            <form onSubmit={handleRegisterSubmit} className="space-y-4">
              <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 leading-relaxed">
                💡 <strong>تفعيل حساب ولي الأمر:</strong> أدخل كود باركود الطالب ورقم هاتف ولي الأمر المسجل في المنظومة لتوثيق الهوية، ثم اختر كلمة مرور خاصة بك.
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Barcode className="w-4 h-4 text-amber-400" />
                  كود باركود الطالب المسجل
                </label>
                <input
                  type="text"
                  required
                  dir="ltr"
                  value={regBarcode}
                  onChange={(e) => setRegBarcode(e.target.value)}
                  placeholder="مثال: 1002"
                  className="w-full px-4 py-2.5 rounded-2xl bg-slate-950/70 border border-slate-700/80 focus:border-amber-400 focus:outline-none text-white text-sm font-mono text-center"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Phone className="w-4 h-4 text-amber-400" />
                  رقم الهاتف المسجل للطالب / ولي الأمر
                </label>
                <input
                  type="tel"
                  required
                  dir="ltr"
                  value={regPhone}
                  onChange={(e) => setRegPhone(e.target.value)}
                  placeholder="مثال: 01012345678"
                  className="w-full px-4 py-2.5 rounded-2xl bg-slate-950/70 border border-slate-700/80 focus:border-amber-400 focus:outline-none text-white text-sm font-mono text-center"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center gap-1.5">
                    <Lock className="w-4 h-4 text-amber-400" />
                    كلمة المرور الجديدة
                  </label>
                  <div className="relative">
                    <input
                      type={showRegPassword ? "text" : "password"}
                      required
                      dir="ltr"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="••••••"
                      className="w-full px-3 py-2.5 rounded-2xl bg-slate-950/70 border border-slate-700/80 focus:border-amber-400 focus:outline-none text-white text-xs font-mono text-center"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegPassword(!showRegPassword)}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
                    >
                      {showRegPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-amber-400" />
                    تأكيد كلمة المرور
                  </label>
                  <input
                    type={showRegPassword ? "text" : "password"}
                    required
                    dir="ltr"
                    value={regConfirmPassword}
                    onChange={(e) => setRegConfirmPassword(e.target.value)}
                    placeholder="••••••"
                    className="w-full px-3 py-2.5 rounded-2xl bg-slate-950/70 border border-slate-700/80 focus:border-amber-400 focus:outline-none text-white text-xs font-mono text-center"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-extrabold text-sm transition-all shadow-xl shadow-amber-500/20 active:scale-[0.99] cursor-pointer flex items-center justify-center gap-2 mt-2 disabled:opacity-50"
              >
                {isLoading ? (
                  <span>جاري توثيق الحساب...</span>
                ) : (
                  <>
                    <UserCheck className="w-4 h-4" />
                    <span>تأكيد وإنشاء حساب ولي الأمر</span>
                  </>
                )}
              </button>
            </form>
          )}

          {/* Quick Help Box */}
          <div className="pt-4 border-t border-slate-800 text-[11px] text-slate-400 text-center space-y-1">
            <p>لأي استفسار بخصوص بيانات الدخول أو تفعيل الحساب، يرجى التواصل مع إدارة المنظومة.</p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-5xl mx-auto text-center py-4 text-xs text-slate-500 z-10 flex flex-wrap items-center justify-between gap-3">
        <span>© {new Date().getFullYear()} منظومة الأستاذة إيمان الدمشيتي - جميع الحقوق محفوظة</span>
        <span className="flex items-center gap-1 text-slate-400">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          تزامن فوري سحابي مع إشعارات صوتية وتطبيق PWA
        </span>
      </footer>
    </div>
  );
};
