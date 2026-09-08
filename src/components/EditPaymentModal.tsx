import React, { useState, useEffect } from "react";
import { Student, PaymentRecord } from "../types";
import { X, CheckCircle, Trash2, Calendar, DollarSign, FileText, AlertTriangle } from "lucide-react";

interface EditPaymentModalProps {
  isOpen: boolean;
  student: Student;
  payment: PaymentRecord;
  monthKey: string;
  onClose: () => void;
  onSave: (
    oldMonthKey: string,
    barcode: string,
    newMonthKey: string,
    newAmount: number,
    newNote: string,
    newDate?: string
  ) => void;
  onDelete: (monthKey: string, barcode: string) => void;
}

export const EditPaymentModal: React.FC<EditPaymentModalProps> = ({
  isOpen,
  student,
  payment,
  monthKey,
  onClose,
  onSave,
  onDelete,
}) => {
  const [newMonthKey, setNewMonthKey] = useState(monthKey || payment.monthKey || payment.month || "");
  const [newAmount, setNewAmount] = useState<number | "">(payment.amount || 0);
  const [newNote, setNewNote] = useState(payment.note || "");
  const [newDate, setNewDate] = useState(payment.date || new Date().toISOString().split("T")[0]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (payment) {
      setNewMonthKey(monthKey || payment.monthKey || payment.month || "");
      setNewAmount(payment.amount || 0);
      setNewNote(payment.note || "");
      setNewDate(payment.date || new Date().toISOString().split("T")[0]);
      setConfirmDelete(false);
      setErrorMsg(null);
    }
  }, [payment, monthKey, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(newAmount);
    if (isNaN(amt) || amt < 0) {
      setErrorMsg("⚠️ يرجى إدخال مبلغ صحيح!");
      return;
    }
    if (!newMonthKey.trim()) {
      setErrorMsg("⚠️ يرجى تحديد شهر الاشتراك!");
      return;
    }

    onSave(monthKey, student.barcode, newMonthKey.trim(), amt, newNote.trim(), newDate);
    onClose();
  };

  const handleDeleteClick = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    onDelete(monthKey, student.barcode);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center p-4 font-tajawal animate-in fade-in">
      <div className="bg-[#0b1226] border-2 border-amber-500/40 w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-5 border-b border-indigo-500/30 flex items-center justify-between bg-gradient-to-r from-amber-500/10 to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/40">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white font-fancy">
                تعديل أو تصحيح سداد الاشتراك
              </h3>
              <p className="text-xs text-slate-300">
                الطالب: <strong className="text-amber-300">{student.name}</strong> (#{student.barcode})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto text-xs font-bold flex-1">
          {errorMsg && (
            <div className="p-3 rounded-2xl bg-rose-950/80 text-rose-300 border border-rose-500/40 font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Change Month Field */}
          <div className="space-y-1.5">
            <label className="text-slate-300 flex items-center justify-between">
              <span>شهر الاشتراك المستحق:</span>
              <span className="text-[11px] text-amber-400">
                (يمكنك تغيير الشهر إذا سُجل لشهر خاطئ كـ شهر 8 بدلاً من 9)
              </span>
            </label>
            <div className="flex items-center gap-2 bg-[#060b17] border border-indigo-500/30 rounded-2xl p-2.5 focus-within:border-amber-400 transition-all">
              <Calendar className="w-4 h-4 text-amber-400 shrink-0" />
              <input
                type="month"
                value={newMonthKey}
                onChange={(e) => setNewMonthKey(e.target.value)}
                className="bg-transparent text-amber-300 font-bold outline-none w-full cursor-pointer text-xs"
                required
              />
            </div>
          </div>

          {/* Amount Field */}
          <div className="space-y-1.5">
            <label className="text-slate-300">المبلغ المسدد (ج.م):</label>
            <div className="flex items-center gap-2 bg-[#060b17] border border-indigo-500/30 rounded-2xl p-2.5 focus-within:border-amber-400 transition-all">
              <DollarSign className="w-4 h-4 text-emerald-400 shrink-0" />
              <input
                type="number"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value === "" ? "" : Number(e.target.value))}
                className="bg-transparent text-emerald-300 font-mono font-bold outline-none w-full text-sm"
                required
                min={0}
              />
            </div>
          </div>

          {/* Payment Date */}
          <div className="space-y-1.5">
            <label className="text-slate-300">تاريخ السداد المسجل:</label>
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="w-full bg-[#060b17] border border-indigo-500/30 rounded-2xl p-2.5 text-slate-200 outline-none focus:border-amber-400 text-xs"
            />
          </div>

          {/* Note Field */}
          <div className="space-y-1.5">
            <label className="text-slate-300">ملاحظات السداد:</label>
            <div className="flex items-center gap-2 bg-[#060b17] border border-indigo-500/30 rounded-2xl p-2.5 focus-within:border-amber-400 transition-all">
              <FileText className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                type="text"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="ملاحظات السداد..."
                className="bg-transparent text-slate-200 outline-none w-full text-xs"
              />
            </div>
          </div>

          {/* Delete / Revert Confirmation Warning */}
          {confirmDelete && (
            <div className="p-3 bg-rose-950/80 border border-rose-500/60 rounded-2xl text-rose-300 text-xs space-y-2 animate-in fade-in">
              <div className="flex items-center gap-2 font-bold">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>هل أنت متأكد من إلغاء سداد هذا الشهر؟</span>
              </div>
              <p className="text-[11px] text-rose-200/80">
                سيتم حذف قيد السداد وإعادة حالة الطالب إلى (غير مسدد ❌) لهذا الشهر.
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold cursor-pointer transition-all"
                >
                  نعم، احذف السداد فوراً
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs cursor-pointer"
                >
                  تراجع
                </button>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-3 flex items-center justify-between gap-3 border-t border-indigo-950">
            <button
              type="button"
              onClick={handleDeleteClick}
              className="px-3.5 py-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-400 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <Trash2 className="w-4 h-4" />
              <span>إلغاء السداد وحذفه</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs cursor-pointer transition-all"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/20 flex items-center gap-1.5 cursor-pointer transition-all"
              >
                <CheckCircle className="w-4 h-4" />
                <span>حفظ التعديلات</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
