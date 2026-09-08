import React, { useState } from "react";
import { Student, GradeName, GroupDays, GRADE_ORDER } from "../types";
import { DEFAULT_GRADE_PRICES, cleanPhoneNumber } from "../utils/helpers";
import { enqueuePlatformMessage } from "../utils/storage";
import { UserPlus, Sparkles, Tag, Loader2 } from "lucide-react";

interface AddStudentTabProps {
  students: Student[];
  groupPrices: Record<GradeName, number>;
  onAddStudent: (student: Student, cardFee: number) => void;
}

export const AddStudentTab: React.FC<AddStudentTabProps> = ({
  students,
  groupPrices,
  onAddStudent,
}) => {
  const [barcode, setBarcode] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [groupGrade, setGroupGrade] = useState<GradeName>("الصف الرابع الابتدائي");
  const [groupDays, setGroupDays] = useState<GroupDays>("سبت - إثنين - أربعاء");
  const [isCustomFee, setIsCustomFee] = useState(false);
  const [customMonthlyFee, setCustomMonthlyFee] = useState<number>(100);
  const [discountReason, setDiscountReason] = useState("");
  const [cardFeeAmount, setCardFeeAmount] = useState(30);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const defaultGradePrice = groupPrices[groupGrade] ?? DEFAULT_GRADE_PRICES[groupGrade] ?? 100;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const cleanBarcode = barcode.trim();
    const cleanName = name.trim();

    if (!cleanBarcode || !cleanName) {
      setFeedback({ type: "error", message: "⚠️ يرجى إدخال كود الباركود واسم الطالب ثلاثي!" });
      return;
    }

    if (students.some((s) => String(s.barcode).trim() === cleanBarcode)) {
      setFeedback({ type: "error", message: "⚠️ هذا الباركود مسجل لطالب آخر بالفعل! يرجى استخدام كود مختلف." });
      return;
    }

    const normalizedPhone = cleanPhoneNumber(phone.trim());
    const normalizedParentPhone = cleanPhoneNumber(parentPhone.trim());
    const safeCardFee = Math.max(0, isNaN(Number(cardFeeAmount)) ? 0 : Number(cardFeeAmount));
    const safeCustomMonthlyFee = Math.max(0, isNaN(Number(customMonthlyFee)) ? defaultGradePrice : Number(customMonthlyFee));

    setIsSubmitting(true);

    const newStudent: Student = {
      barcode: cleanBarcode,
      name: cleanName,
      phone: normalizedPhone || normalizedParentPhone,
      parentPhone: normalizedParentPhone || normalizedPhone,
      groupGrade,
      groupDays,
      customMonthlyFee: isCustomFee ? safeCustomMonthlyFee : undefined,
      discountReason: isCustomFee ? discountReason.trim() : undefined,
      points: 0,
      totalAttendanceDays: 0,
      totalAbsentDays: 0,
      totalExamScores: [],
      createdAt: new Date().toISOString(),
    };

    onAddStudent(newStudent, safeCardFee);

    // Platform Notification for registration & welcome
    const welcomeMsg = `تم تسجيل الطالب/ة: (${cleanName})\nمع ميس إيمان الدمشيتي - أستاذة الرياضيات 📐\nالصف: ${groupGrade} (${groupDays})\nقيمة استخراج الكارت: ${safeCardFee} ج.م\nالاشتراك الشهري: ${
      isCustomFee ? safeCustomMonthlyFee : defaultGradePrice
    } ج.م\nنرحب بكم ونتمنى لأبنائنا دوام التوفيق والتميز 🌟`;

    enqueuePlatformMessage({
      studentBarcode: cleanBarcode,
      studentName: cleanName,
      grade: groupGrade,
      phone: normalizedParentPhone || normalizedPhone,
      messageType: "عام",
      title: `تسجيل وترحيب طالب جديد - ${cleanName}`,
      message: welcomeMsg,
      channel: "in_app",
    });

    setFeedback({
      type: "success",
      message: `✅ تم تسجيل الطالب (${cleanName}) بنجاح وإصدار كارت الباركود #${cleanBarcode} وبث إشعار الترحيب بالمنصة!`,
    });

    // Reset Form
    setBarcode("");
    setName("");
    setPhone("");
    setParentPhone("");
    setIsCustomFee(false);
    setDiscountReason("");
    setIsSubmitting(false);

    setTimeout(() => {
      setFeedback(null);
    }, 4000);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="glass-panel p-6 md:p-8 rounded-3xl shadow-2xl space-y-6">
        <div className="flex items-center gap-3.5 pb-4 border-b border-indigo-500/20">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500/20 to-yellow-400/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-md">
            <UserPlus className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold font-fancy text-amber-300">
              تسجيل طالب جديد وتحديد الاشتراك الشهري
            </h2>
            <p className="text-xs text-slate-400 font-tajawal mt-0.5">
              تسجيل بيانات الطالب مع إمكانية تحديد اشتراك شهري مخصص (50، 60، 70، 80 ج.م أو حسب رغبتك)
            </p>
          </div>
        </div>

        {feedback && (
          <div
            className={`p-3 rounded-2xl text-xs font-bold border transition-all ${
              feedback.type === "success"
                ? "bg-emerald-950/80 text-emerald-300 border-emerald-500/40"
                : "bg-rose-950/80 text-rose-300 border-rose-500/40"
            }`}
          >
            {feedback.message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs font-bold font-tajawal">
          <div className="space-y-1.5">
            <label className="text-slate-300 font-tajawal text-xs">الرقم التسلسلي لكارت الباركود (Barcode) *</label>
            <input
              type="text"
              required
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="مرر الكارت أمام الإسكانر أو اكتب الكود..."
              className="w-full bg-[#080d1e] border border-indigo-500/30 focus:border-amber-400 text-amber-300 px-4 py-3 rounded-2xl outline-none font-mono text-sm shadow-inner transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-slate-300 font-tajawal text-xs">اسم الطالب ثلاثي *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: أحمد محمد علي"
              className="w-full bg-[#080d1e] border border-indigo-500/30 focus:border-amber-400 text-slate-100 px-4 py-3 rounded-2xl outline-none text-sm shadow-inner transition-all"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-slate-300 font-tajawal text-xs">رقم تليفون الطالب</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="01xxxxxxxxx"
                className="w-full bg-[#080d1e] border border-indigo-500/30 focus:border-amber-400 text-slate-100 px-4 py-3 rounded-2xl outline-none font-mono text-sm shadow-inner transition-all"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-300 font-tajawal text-xs">رقم تليفون ولي الأمر (للواتساب) *</label>
              <input
                type="text"
                required
                value={parentPhone}
                onChange={(e) => setParentPhone(e.target.value)}
                placeholder="01xxxxxxxxx"
                className="w-full bg-[#080d1e] border border-indigo-500/30 focus:border-amber-400 text-slate-100 px-4 py-3 rounded-2xl outline-none font-mono text-sm shadow-inner transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-slate-300 font-tajawal text-xs">الصف الدراسي *</label>
              <select
                value={groupGrade}
                onChange={(e) => setGroupGrade(e.target.value as GradeName)}
                className="w-full bg-[#080d1e] border border-indigo-500/30 focus:border-amber-400 text-slate-100 px-4 py-3 rounded-2xl outline-none text-sm cursor-pointer transition-all"
              >
                {GRADE_ORDER.map((grade) => (
                  <option key={grade} value={grade} className="bg-slate-900 text-white">
                    {grade}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-300 font-tajawal text-xs">أيام المجموعة *</label>
              <select
                value={groupDays}
                onChange={(e) => setGroupDays(e.target.value as GroupDays)}
                className="w-full bg-[#080d1e] border border-indigo-500/30 focus:border-amber-400 text-slate-100 px-4 py-3 rounded-2xl outline-none text-sm cursor-pointer transition-all"
              >
                <option value="سبت - إثنين - أربعاء" className="bg-slate-900 text-white">سبت - إثنين - أربعاء</option>
                <option value="أحد - ثلاثاء - خميس" className="bg-slate-900 text-white">أحد - ثلاثاء - خميس</option>
              </select>
            </div>
          </div>

          {/* Custom Monthly Fee Section */}
          <div className="glass-card p-4.5 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-amber-300 flex items-center gap-2 font-bold text-xs">
                <Tag className="w-4 h-4 text-amber-400" />
                تحديد اشتراك شهري مخصص للطالب:
              </span>
              <label className="flex items-center gap-2 cursor-pointer bg-white/5 px-3 py-1 rounded-full border border-white/5 hover:border-amber-400/30 transition-colors">
                <input
                  type="checkbox"
                  checked={isCustomFee}
                  onChange={(e) => {
                    setIsCustomFee(e.target.value === "true" || e.target.checked);
                    if (!isCustomFee) setCustomMonthlyFee(defaultGradePrice);
                  }}
                  className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                />
                <span className="text-xs text-slate-300 font-bold">تفعيل سعر مخصص</span>
              </label>
            </div>

            {isCustomFee ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div className="space-y-1">
                  <label className="text-slate-300 text-[11px]">قيمة الاشتراك الشهري (ج.م):</label>
                  <input
                    type="number"
                    min={0}
                    step={5}
                    value={customMonthlyFee}
                    onChange={(e) => setCustomMonthlyFee(Number(e.target.value))}
                    placeholder="مثلاً: 50 أو 60 أو 70 أو 80"
                    className="w-full bg-[#080d1e] border border-amber-400 text-amber-300 px-3.5 py-2.5 rounded-xl outline-none font-bold text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-300 text-[11px]">سبب الخصم / الملاحظة:</label>
                  <input
                    type="text"
                    value={discountReason}
                    onChange={(e) => setDiscountReason(e.target.value)}
                    placeholder="مثال: خصم إخوة / أيتام / تفوق"
                    className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-200 px-3.5 py-2.5 rounded-xl outline-none text-xs"
                  />
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-400">
                السعر الافتراضي للمرحلة:{" "}
                <span className="text-emerald-400 font-bold">{defaultGradePrice} ج.م شهرياً</span>
              </div>
            )}
          </div>

          {/* Card Fee */}
          <div className="flex items-center justify-between bg-slate-900/60 p-4 rounded-2xl border border-indigo-500/20">
            <span className="text-slate-300 text-xs">رسوم استخراج كارت الباركود:</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={cardFeeAmount}
                onChange={(e) => setCardFeeAmount(Number(e.target.value))}
                className="w-20 bg-[#080d1e] border border-indigo-500/30 text-center text-amber-300 font-bold text-xs py-1.5 rounded-xl"
              />
              <span className="text-slate-400 text-xs">ج.م (تسجل كإيراد فوري)</span>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className={`w-full py-3.5 bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-200 hover:from-amber-300 hover:to-yellow-100 text-slate-950 font-black text-sm rounded-2xl shadow-xl shadow-amber-500/25 transition-all flex items-center justify-center gap-2 transform active:scale-98 font-tajawal ${
              isSubmitting ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
            }`}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                <span>جارٍ حفظ بيانات الطالب...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-slate-950" />
                <span>حفظ وتأكيد تسجيل الطالب وفتح واتساب ولي الأمر 📲</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
