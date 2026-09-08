import React, { useState } from "react";
import { Student, GradeName, PaymentRecord } from "../types";
import { getCurrentMonthKey, getTodayKey, openWhatsApp, DEFAULT_GRADE_PRICES, getStudentPayment } from "../utils/helpers";
import { enqueuePlatformMessage, exportPaidStudentsToCloud } from "../utils/storage";
import { playBeep } from "../utils/audio";
import { StudentSearchBox } from "./StudentSearchBox";
import { StudentFinancialLedgerModal } from "./StudentFinancialLedgerModal";
import { EditPaymentModal } from "./EditPaymentModal";
import {
  CreditCard,
  CheckCircle,
  Tag,
  Sparkles,
  Send,
  ScanLine,
  Clock,
  FileText,
  AlertTriangle,
  Edit2,
  Trash2,
  CheckCircle2,
  CloudUpload,
} from "lucide-react";

interface PayExpensesTabProps {
  students: Student[];
  groupPrices: Record<GradeName, number>;
  payments: Record<string, Record<string, PaymentRecord>>;
  onRecordPayment: (barcode: string, amount: number, monthKey: string, note: string) => void;
  onUpdatePayment?: (
    oldMonthKey: string,
    barcode: string,
    newMonthKey: string,
    newAmount: number,
    newNote: string,
    newDate?: string
  ) => void;
  onDeletePayment?: (monthKey: string, barcode: string) => void;
}

export const PayExpensesTab: React.FC<PayExpensesTabProps> = ({
  students,
  groupPrices,
  payments,
  onRecordPayment,
  onUpdatePayment,
  onDeletePayment,
}) => {
  const [searchInput, setSearchInput] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthKey());
  const [customAmount, setCustomAmount] = useState<number | "">("");
  const [paymentNote, setPaymentNote] = useState("سداد الاشتراك الشهري");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [isLedgerModalOpen, setIsLedgerModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
    phone?: string;
    receiptMsg?: string;
  } | null>(null);
  const [isExportingToCloud, setIsExportingToCloud] = useState(false);

  const handleExportToCloud = async () => {
    setIsExportingToCloud(true);
    try {
      const res = await exportPaidStudentsToCloud();
      setIsExportingToCloud(false);
      if (res.success) {
        playBeep("success");
        setFeedback({ type: "success", message: `✅ ${res.message}` });
      } else {
        playBeep("warning");
        setFeedback({ type: "error", message: `⚠️ ${res.message}` });
      }
    } catch {
      setIsExportingToCloud(false);
      setFeedback({ type: "error", message: "حدث خطأ أثناء محاولة التصدير والمزامنة السحابية." });
    }
  };

  const existingPayment = selectedStudent
    ? getStudentPayment(payments[selectedMonth], selectedStudent.barcode)
    : undefined;

  const handleSelectStudent = (student: Student) => {
    setSelectedStudent(student);
    setSearchInput(student.name);
    const defaultPrice =
      student.customMonthlyFee ??
      groupPrices[student.groupGrade] ??
      DEFAULT_GRADE_PRICES[student.groupGrade] ??
      150;
    setCustomAmount(defaultPrice);
    playBeep("success");
  };

  const handlePaySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent) {
      setFeedback({ type: "error", message: "⚠️ يرجى اختيار أو مسح باركود طالب مسجل أولاً!" });
      return;
    }

    if (existingPayment) {
      setFeedback({
        type: "error",
        message: `🚫 هذا الطالب مسدد لاشتراك شهر (${selectedMonth}) بالفعل! لا يمكن سداد نفس الشهر مرتين. استخدم زر التعديل إذا كنت تريد تعديله أو اختر شهراً آخر.`,
      });
      playBeep("error");
      return;
    }

    const amount = Number(customAmount);
    if (isNaN(amount) || amount <= 0) {
      setFeedback({ type: "error", message: "⚠️ يرجى إدخال مبلغ صحيح!" });
      return;
    }

    onRecordPayment(
      selectedStudent.barcode,
      amount,
      selectedMonth,
      paymentNote.trim() || `اشتراك شهر ${selectedMonth}`
    );

    playBeep("success");

    // WhatsApp / In-App Receipt
    const receiptMsg = `إيصال سداد اشتراك 🧾\nمنظومة الأستاذة إيمان الدمشيتي - رياضيات 📐\nاسم الطالب: ${selectedStudent.name}\nالصف: ${selectedStudent.groupGrade}\nعن شهر: ${selectedMonth}\nالمبلغ المسدد: ${amount} ج.م\nالتاريخ: ${getTodayKey()}\nشاكرين لكم حسن تعاونكم واهتمامكم ✨`;

    // Direct Platform Notification sent to Firebase platform_messages & notifications collections
    const targetPhone = selectedStudent.parentPhone || selectedStudent.phone || "";
    enqueuePlatformMessage({
      studentBarcode: selectedStudent.barcode,
      studentName: selectedStudent.name,
      grade: selectedStudent.groupGrade,
      phone: targetPhone,
      messageType: "مصاريف",
      title: `إشعار سداد اشتراك - ${selectedStudent.name}`,
      message: receiptMsg,
      channel: "in_app",
    });

    setFeedback({
      type: "success",
      message: `✅ تم إثبات وتوثيق سداد ${amount} ج.م للطالب (${selectedStudent.name}) عن شهر (${selectedMonth}) وبث إشعار المنصة الفوري بنجاح!`,
      phone: targetPhone,
      receiptMsg,
    });

    setSearchInput("");
    setSelectedStudent(null);
    setCustomAmount("");

    setTimeout(() => {
      setFeedback(null);
    }, 7000);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 font-tajawal">
      <div className="glass-panel p-6 md:p-8 rounded-3xl shadow-2xl space-y-6">
        <div className="flex items-center justify-between gap-3.5 pb-4 border-b border-indigo-500/20 flex-wrap">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500/20 to-yellow-400/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-md">
              <CreditCard className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold font-fancy text-amber-300">
                نافذة إثبات وسداد المصروفات والاشتراكات
              </h2>
              <p className="text-xs text-slate-400 font-tajawal mt-0.5">
                بحث ذكي بالاسم أو ضرب الباركود بالسكانر مع نظام لمنع التكرار وتعديل السداد وإرسال إيصال فوري لواتساب ولي الأمر
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleExportToCloud}
            disabled={isExportingToCloud}
            className={`px-3.5 py-2 rounded-2xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-md cursor-pointer ${
              isExportingToCloud
                ? "bg-amber-400 text-slate-950 animate-pulse"
                : "bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 border border-emerald-500/40"
            }`}
            title="تصدير ومزامنة كافة اشتراكات الطلاب مع السحابة فوراً"
          >
            <CloudUpload className={`w-3.5 h-3.5 ${isExportingToCloud ? "animate-bounce" : "text-emerald-400"}`} />
            <span>{isExportingToCloud ? "جارٍ التصدير..." : "☁️ تصدير المسددين للسحابة"}</span>
          </button>
        </div>

        {feedback && (
          <div
            className={`p-3.5 rounded-2xl text-xs font-bold border transition-all flex flex-wrap items-center justify-between gap-2.5 ${
              feedback.type === "success"
                ? "bg-emerald-950/80 text-emerald-300 border-emerald-500/40"
                : "bg-rose-950/80 text-rose-300 border-rose-500/40"
            }`}
          >
            <span>{feedback.message}</span>
            {feedback.phone && feedback.receiptMsg && (
              <button
                type="button"
                onClick={() => openWhatsApp(feedback.phone!, feedback.receiptMsg!)}
                className="px-3 py-1.5 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-400/40 text-emerald-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm"
                title="خيار جانبي يدوي: فتح واتساب ولي الأمر لإرسال الإيصال"
              >
                <Send className="w-3.5 h-3.5 text-emerald-400" />
                <span>إرسال إيصال واتساب يدوي (خيار جانبي)</span>
              </button>
            )}
          </div>
        )}

        <form onSubmit={handlePaySubmit} className="space-y-4 text-xs font-bold font-tajawal">
          {/* Smart Search / Barcode Input */}
          <div className="space-y-1.5">
            <label className="text-slate-300 flex items-center justify-between">
              <span>ابحث باسم الطالب أو مرر الكارت بالسكانر:</span>
              <span className="text-[11px] text-amber-400 font-normal">
                يدعم البحث بالاسم الأول والأخير وتجاوز الأسماء الوسطى
              </span>
            </label>
            <StudentSearchBox
              students={students}
              value={searchInput}
              onChange={(val) => {
                setSearchInput(val);
                if (!val) setSelectedStudent(null);
              }}
              onSelectStudent={handleSelectStudent}
              placeholder="اكتب اسم الطالب (مثال: أحمد علي) أو اضرب الباركود..."
              autoFocus
            />
          </div>

          {/* Student Found Info Card */}
          {selectedStudent && (
            <div className="glass-card border-emerald-500/40 p-5 rounded-2xl space-y-2.5 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-base font-bold text-emerald-300 font-fancy">{selectedStudent.name}</h4>
                  <p className="text-xs text-slate-300 mt-1">
                    {selectedStudent.groupGrade} • {selectedStudent.groupDays} • باركود #{selectedStudent.barcode}
                  </p>
                </div>
                <div className="text-left">
                  <span className="text-[11px] text-slate-400 block">الاشتراك المعتمد:</span>
                  <span className="text-lg font-black text-amber-300 font-mono">
                    {selectedStudent.customMonthlyFee ??
                      groupPrices[selectedStudent.groupGrade] ??
                      100}{" "}
                    <span className="text-xs font-tajawal font-normal text-slate-400">ج.م</span>
                  </span>
                </div>
              </div>

              {selectedStudent.customMonthlyFee !== undefined && (
                <div className="flex items-center gap-1.5 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 rounded-xl">
                  <Tag className="w-3.5 h-3.5 text-amber-400" />
                  <span>طالب باشتراك خاص مخصص ({selectedStudent.customMonthlyFee} ج.م)</span>
                </div>
              )}

              <div className="pt-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => setIsLedgerModalOpen(true)}
                  className="px-3 py-1.5 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-amber-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all"
                >
                  <FileText className="w-4 h-4 text-amber-400" />
                  <span>عرض كشف الحساب الشامل للطالب 📊</span>
                </button>
              </div>
            </div>
          )}

          {/* Academic Month Quick Switcher Pills */}
          <div className="space-y-1.5">
            <label className="text-slate-300 text-xs flex items-center justify-between">
              <span>اختر شهر الاشتراك:</span>
              <span className="text-[11px] text-amber-300 font-normal">
                اضغط على الشهر المطلوب مباشرة
              </span>
            </label>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 scrollbar-thin">
              {[
                { key: "2026-08", label: "شهر 8 (أغسطس)" },
                { key: "2026-09", label: "شهر 9 (سبتمبر)" },
                { key: "2026-10", label: "شهر 10 (أكتوبر)" },
                { key: "2026-11", label: "شهر 11 (نوفمبر)" },
                { key: "2026-12", label: "شهر 12 (ديسمبر)" },
                { key: "2027-01", label: "شهر 1 (يناير)" },
                { key: "2027-02", label: "شهر 2 (فبراير)" },
                { key: "2027-03", label: "شهر 3 (مارس)" },
                { key: "2027-04", label: "شهر 4 (أبريل)" },
                { key: "2027-05", label: "شهر 5 (مايو)" },
              ].map((p) => {
                const isSelected = selectedMonth === p.key;
                const isStudentPaidInMonth = selectedStudent ? !!payments[p.key]?.[selectedStudent.barcode] : false;

                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setSelectedMonth(p.key)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1 cursor-pointer ${
                      isSelected
                        ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black shadow-md scale-105"
                        : isStudentPaidInMonth
                        ? "bg-emerald-950/60 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-900/50"
                        : "bg-slate-900/80 text-slate-300 hover:bg-slate-800 border border-slate-700/50"
                    }`}
                  >
                    <span>{p.label}</span>
                    {selectedStudent && (
                      <span className="text-[10px]">
                        {isStudentPaidInMonth ? "✅" : "⏳"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Month selection & Amount */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-slate-300">أو اختر الشهر من التقويم:</label>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-100 p-3 rounded-2xl outline-none focus:border-amber-400 transition-all font-bold"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-300">المبلغ المدفوع (ج.م):</label>
              <input
                type="number"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="المبلغ المسدد..."
                disabled={!!existingPayment}
                className="w-full bg-[#080d1e] border border-indigo-500/30 text-amber-300 font-mono text-base p-3 rounded-2xl outline-none focus:border-amber-400 font-bold transition-all disabled:opacity-40"
              />
            </div>
          </div>

          {/* Duplicate Payment Warning Banner & Quick Edit Card */}
          {selectedStudent && existingPayment && (
            <div className="p-4 rounded-2xl bg-amber-500/15 border-2 border-amber-500/50 space-y-3 animate-in fade-in">
              <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                <span>⚠️ تنبيه: تم سداد اشتراك شهر ({selectedMonth}) لهذا الطالب مسبقاً!</span>
              </div>
              <div className="bg-[#060b17] p-3 rounded-xl border border-amber-500/30 text-xs space-y-1 text-slate-300">
                <p>
                  💰 المبلغ المسدد: <strong className="text-emerald-400 font-mono">{existingPayment.amount} ج.م</strong>
                </p>
                <p>
                  📅 تاريخ ووقت السداد: <strong className="text-slate-200 font-mono">{existingPayment.date} - {existingPayment.time}</strong>
                </p>
                <p>
                  📝 ملاحظات السداد: <strong className="text-slate-200">{existingPayment.note || "لا توجد ملاحظات"}</strong>
                </p>
                {existingPayment.recordedBy && (
                  <p>
                    👤 سُجل بواسطة: <strong className="text-slate-200">{existingPayment.recordedBy}</strong>
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 pt-1 flex-wrap">
                {onUpdatePayment && (
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(true)}
                    className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-md cursor-pointer transition-all"
                  >
                    <Edit2 className="w-4 h-4" />
                    <span>تعديل هذا السداد / تحويل لشهر آخر</span>
                  </button>
                )}
                {onDeletePayment && (
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        confirm(
                          `هل أنت متأكد من إلغاء سداد شهر (${selectedMonth}) للطالب (${selectedStudent.name}) وإعادته كغير مسدد؟`
                        )
                      ) {
                        onDeletePayment(selectedMonth, selectedStudent.barcode);
                        setFeedback({
                          type: "success",
                          message: `✅ تم إلغاء سداد شهر (${selectedMonth}) للطالب وإعادته كغير مسدد.`,
                        });
                      }
                    }}
                    className="px-3.5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>إلغاء هذا السداد وحذفه</span>
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-slate-300">ملاحظات الإيصال:</label>
            <input
              type="text"
              value={paymentNote}
              onChange={(e) => setPaymentNote(e.target.value)}
              placeholder="مثال: سداد كامل / دفعة أولى"
              disabled={!!existingPayment}
              className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-100 p-3 rounded-2xl outline-none focus:border-amber-400 transition-all disabled:opacity-40"
            />
          </div>

          <button
            type="submit"
            disabled={!selectedStudent || !!existingPayment}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-200 hover:from-amber-300 hover:to-yellow-100 text-slate-950 font-black text-sm shadow-xl shadow-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.99]"
          >
            <CheckCircle className="w-5 h-5 text-slate-950" />
            <span>
              {existingPayment
                ? `❌ مسدد مسبقاً عن شهر (${selectedMonth})`
                : `إثبات وتوثيق السداد بالمنصة ✅`}
            </span>
          </button>
        </form>
      </div>

      {/* Student Detailed Financial Ledger Modal */}
      {selectedStudent && (
        <StudentFinancialLedgerModal
          student={selectedStudent}
          payments={payments}
          groupPrices={groupPrices}
          isOpen={isLedgerModalOpen}
          onClose={() => setIsLedgerModalOpen(false)}
          onRecordQuickPayment={onRecordPayment}
          onUpdatePayment={onUpdatePayment}
          onDeletePayment={onDeletePayment}
        />
      )}

      {/* Edit Payment Modal */}
      {selectedStudent && existingPayment && isEditModalOpen && onUpdatePayment && (
        <EditPaymentModal
          isOpen={isEditModalOpen}
          student={selectedStudent}
          payment={existingPayment}
          monthKey={selectedMonth}
          onClose={() => setIsEditModalOpen(false)}
          onSave={(oldMonthKey, barcode, newMonthKey, newAmount, newNote, newDate) => {
            onUpdatePayment(oldMonthKey, barcode, newMonthKey, newAmount, newNote, newDate);
            setIsEditModalOpen(false);
            setFeedback({
              type: "success",
              message: `✅ تم تعديل سداد الطالب بنجاح وتحويله لشهر (${newMonthKey}).`,
            });
          }}
          onDelete={(monthKey, barcode) => {
            if (onDeletePayment) {
              onDeletePayment(monthKey, barcode);
            }
            setIsEditModalOpen(false);
            setFeedback({
              type: "success",
              message: `✅ تم إلغاء سداد شهر (${monthKey}) للطالب بنجاح.`,
            });
          }}
        />
      )}
    </div>
  );
};
