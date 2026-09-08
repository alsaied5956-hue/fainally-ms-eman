import React, { useState, useMemo } from "react";
import { Student, GradeName, GroupDays, GRADE_ORDER, PaymentRecord } from "../types";
import { sortStudentsByGradeAndName, getExamAverage, getAbsenceRate, DEFAULT_GRADE_PRICES, cleanPhoneNumber } from "../utils/helpers";
import { matchStudentSearch } from "../utils/search";
import { StudentFinancialLedgerModal } from "./StudentFinancialLedgerModal";
import { Users2, Trash2, Edit3, Search, AlertTriangle, Tag, Sparkles, X, CreditCard, FileText } from "lucide-react";

interface ManageStudentsTabProps {
  students: Student[];
  payments?: Record<string, Record<string, PaymentRecord>>;
  groupPrices?: Record<GradeName, number>;
  onUpdateStudent: (oldBarcode: string, updated: Student) => void;
  onDeleteStudent: (barcode: string) => void;
  onClearAllData: () => void;
  onOpenPrintCards?: () => void;
  onOpenMultiDeviceSync?: () => void;
  onRecordPayment?: (barcode: string, amount: number, monthKey: string, note: string) => void;
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

export const ManageStudentsTab: React.FC<ManageStudentsTabProps> = ({
  students,
  payments = {},
  groupPrices = {} as Record<GradeName, number>,
  onUpdateStudent,
  onDeleteStudent,
  onClearAllData,
  onOpenPrintCards,
  onOpenMultiDeviceSync,
  onRecordPayment,
  onUpdatePayment,
  onDeletePayment,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [oldBarcode, setOldBarcode] = useState("");
  const [ledgerModalStudent, setLedgerModalStudent] = useState<Student | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [deleteConfirmStudent, setDeleteConfirmStudent] = useState<Student | null>(null);
  const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState("");

  const sortedStudents = useMemo(() => {
    if (searchQuery.trim()) {
      const scored: { student: Student; score: number }[] = [];
      for (const s of students) {
        const { match, score } = matchStudentSearch(s, searchQuery);
        if (match) {
          scored.push({ student: s, score });
        }
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.map((item) => item.student);
    }

    return sortStudentsByGradeAndName(students);
  }, [students, searchQuery]);

  const handleOpenEdit = (student: Student) => {
    setOldBarcode(student.barcode);
    setEditingStudent({ ...student });
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent) return;

    const trimmedBarcode = editingStudent.barcode.trim();
    const trimmedName = editingStudent.name.trim();

    if (!trimmedBarcode || !trimmedName) {
      setFeedback({ type: "error", message: "⚠️ يرجى التأكد من كتابة كود الباركود واسم الطالب!" });
      return;
    }

    if (
      oldBarcode !== trimmedBarcode &&
      students.some((s) => s.barcode === trimmedBarcode)
    ) {
      setFeedback({ type: "error", message: "⚠️ هذا الباركود الجديد مستخدم بالفعل لطالب آخر!" });
      return;
    }

    const normalizedPhone = cleanPhoneNumber(editingStudent.phone?.trim() || "");
    const normalizedParentPhone = cleanPhoneNumber(editingStudent.parentPhone?.trim() || "");
    const sanitizedFee = editingStudent.customMonthlyFee !== undefined
      ? Math.max(0, isNaN(Number(editingStudent.customMonthlyFee)) ? 0 : Number(editingStudent.customMonthlyFee))
      : undefined;

    const studentToSave: Student = {
      ...editingStudent,
      barcode: trimmedBarcode,
      name: trimmedName,
      phone: normalizedPhone || normalizedParentPhone,
      parentPhone: normalizedParentPhone || normalizedPhone,
      customMonthlyFee: sanitizedFee,
    };

    onUpdateStudent(oldBarcode, studentToSave);
    setFeedback({ type: "success", message: `✅ تم تحديث بيانات الطالب (${studentToSave.name}) بنجاح!` });
    setEditingStudent(null);

    setTimeout(() => {
      setFeedback(null);
    }, 4000);
  };

  const handleConfirmDelete = () => {
    if (!deleteConfirmStudent) return;
    onDeleteStudent(deleteConfirmStudent.barcode);
    setFeedback({
      type: "success",
      message: `✅ تم حذف الطالب (${deleteConfirmStudent.name}) نهائياً من المنظومة.`,
    });
    setDeleteConfirmStudent(null);
    setTimeout(() => setFeedback(null), 4000);
  };

  const handleConfirmClearAll = () => {
    if (clearConfirmText.trim() === "مسح") {
      onClearAllData();
      setClearAllConfirmOpen(false);
      setClearConfirmText("");
      setFeedback({ type: "success", message: "✅ تم مسح كافة بيانات الطلاب بنجاح." });
      setTimeout(() => setFeedback(null), 4000);
    } else {
      setFeedback({ type: "error", message: "⚠️ يجب كتابة كلمة (مسح) للتأكيد النهائي." });
    }
  };

  return (
    <div className="space-y-6 font-tajawal">
      {/* Header Bar */}
      <div className="glass-panel p-6 md:p-8 rounded-3xl shadow-2xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center shadow-md">
            <Users2 className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold font-fancy text-amber-300">
              لوحة التحكم وتعديل بيانات الطلاب
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              تعديل الأكواد والاشتراكات المخصصة أو حذف الطلاب من المنظومة (<span className="font-mono text-amber-300">{students.length}</span> طالب)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {onOpenMultiDeviceSync && (
            <button
              type="button"
              onClick={onOpenMultiDeviceSync}
              className="px-4 py-2.5 bg-gradient-to-r from-indigo-600 via-indigo-700 to-purple-700 hover:from-indigo-500 hover:to-purple-600 text-white font-bold text-xs rounded-2xl shadow-lg shadow-indigo-600/20 border border-indigo-400/30 flex items-center gap-2 transition-all transform hover:scale-105 cursor-pointer active:scale-95"
              title="توحيد ودمج أسماء الطلاب بين جميع الأجهزة (لابتوب / كمبيوتر / موبايل)"
            >
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>📱💻 توحيد بيانات كل الأجهزة</span>
            </button>
          )}

          {onOpenPrintCards && (
            <button
              type="button"
              onClick={onOpenPrintCards}
              className="px-4 py-2.5 bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-200 hover:from-amber-300 text-slate-950 font-black text-xs rounded-2xl shadow-lg shadow-amber-500/20 flex items-center gap-2 transition-all transform hover:scale-105 cursor-pointer active:scale-95"
            >
              <CreditCard className="w-4 h-4" />
              <span>🪪 طباعة كروت الباركود (PDF)</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setClearAllConfirmOpen(true)}
            className="px-4 py-2.5 bg-rose-600/15 hover:bg-rose-600/25 border border-rose-500/40 text-rose-300 font-bold text-xs rounded-2xl shadow-md flex items-center gap-2 transition-all cursor-pointer"
          >
            <Trash2 className="w-4 h-4 text-rose-400" />
            <span>مسح كافة البيانات (أدمن)</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-2xl text-xs font-bold border transition-all ${
            feedback.type === "success"
              ? "bg-emerald-950/80 text-emerald-300 border-emerald-500/40"
              : "bg-rose-950/80 text-rose-300 border-rose-500/40"
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Smart Search Input */}
      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-amber-400/60 absolute right-3.5 top-3.5 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="ابحث بالاسم (مثال: أحمد علي)، التليفون، أو الباركود..."
          className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-100 text-xs px-4 pr-10 pl-8 py-3 rounded-2xl outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/30 font-medium transition-all"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute left-3 top-3 p-0.5 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Students Management Table */}
      <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border-indigo-500/20">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-xs">
            <thead>
              <tr className="bg-slate-900/90 text-amber-300 font-bold font-fancy border-b border-indigo-500/20">
                <th className="p-3.5">م</th>
                <th className="p-3.5">الباركود</th>
                <th className="p-3.5">اسم الطالب</th>
                <th className="p-3.5">الصف الدراسي</th>
                <th className="p-3.5">المجموعة</th>
                <th className="p-3.5">الاشتراك المحدد</th>
                <th className="p-3.5">رقم ولي الأمر</th>
                <th className="p-3.5">النقاط ⭐</th>
                <th className="p-3.5">متوسط الدرجات</th>
                <th className="p-3.5 text-center">إجراءات التحكم</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {sortedStudents.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400 italic">
                    {searchQuery ? `لا توجد نتائج مطابقة لـ "${searchQuery}"` : "لا يوجد طلاب مطابقين للبحث."}
                  </td>
                </tr>
              ) : (
                sortedStudents.map((student, idx) => {
                  const examAvg = getExamAverage(student);

                  return (
                    <tr key={student.barcode} className="hover:bg-amber-500/5 transition-colors">
                      <td className="p-3.5 font-mono text-slate-400">{idx + 1}</td>
                      <td className="p-3.5 font-mono text-amber-300 font-bold">#{student.barcode}</td>
                      <td className="p-3.5 font-bold text-slate-100 font-fancy">{student.name}</td>
                      <td className="p-3.5 text-slate-300">{student.groupGrade}</td>
                      <td className="p-3.5 text-slate-400">{student.groupDays}</td>
                      <td className="p-3.5">
                        <span
                          className={`font-bold ${
                            student.customMonthlyFee !== undefined
                              ? "text-purple-300"
                              : "text-slate-400"
                          }`}
                        >
                          {student.customMonthlyFee !== undefined
                            ? `${student.customMonthlyFee} ج.م (مخصص)`
                            : "الافتراضي"}
                        </span>
                      </td>
                      <td className="p-3.5 font-mono text-slate-300">{student.parentPhone}</td>
                      <td className="p-3.5 font-bold text-amber-300 font-mono">{student.points || 0}</td>
                      <td className="p-3.5 font-bold text-emerald-400 font-mono">{examAvg}%</td>
                      <td className="p-3.5">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => setLedgerModalStudent(student)}
                            className="px-2.5 py-1.5 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-200 border border-indigo-500/30 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all"
                            title="عرض كشف الحساب المالي المفصل للطالب"
                          >
                            <FileText className="w-3 h-3 text-amber-400" />
                            <span>سجل الحساب</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenEdit(student)}
                            className="px-2.5 py-1.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>تعديل</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setDeleteConfirmStudent(student)}
                            className="px-2.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>حذف</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Single Student Confirmation Modal */}
      {deleteConfirmStudent && (
        <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-md p-6 rounded-3xl space-y-4 border-rose-500/40">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100 font-fancy">تأكيد حذف الطالب</h3>
                <p className="text-xs text-slate-400">هل أنت متأكد من رغبتك في حذف هذا الطالب نهائياً؟</p>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#080d1e] border border-rose-500/20 space-y-1 text-xs">
              <div className="text-amber-300 font-bold font-fancy">{deleteConfirmStudent.name}</div>
              <div className="text-slate-400 font-mono">الباركود: #{deleteConfirmStudent.barcode} • {deleteConfirmStudent.groupGrade}</div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmStudent(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-bold"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black shadow-lg shadow-rose-600/30 active:scale-95"
              >
                نعم، احذف الطالب
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear All Data Modal */}
      {clearAllConfirmOpen && (
        <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-md p-6 rounded-3xl space-y-4 border-rose-500/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-rose-400 font-fancy">🚨 تحذير: مسح جميع بيانات الطلاب</h3>
                <p className="text-xs text-slate-400">لا يمكن التراجع عن هذه الخطوة بعد تنفيذها!</p>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <label className="text-slate-300 block">للتأكيد النهائي، اكتب كلمة <span className="text-amber-400 font-bold font-mono">مسح</span> أدناه:</label>
              <input
                type="text"
                value={clearConfirmText}
                onChange={(e) => setClearConfirmText(e.target.value)}
                placeholder="اكتب كلمة: مسح"
                className="w-full bg-[#080d1e] border border-rose-500/40 text-amber-300 px-4 py-2.5 rounded-xl font-bold text-center outline-none focus:border-rose-400"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setClearAllConfirmOpen(false);
                  setClearConfirmText("");
                }}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-bold"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmClearAll}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black shadow-lg shadow-rose-600/30 active:scale-95"
              >
                تأكيد المسح الشامل
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Student Full Modal */}
      {editingStudent && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overflow-y-auto">
          <div className="glass-panel border-amber-500/40 p-6 md:p-8 rounded-3xl max-w-lg w-full shadow-2xl space-y-4 my-auto animate-in fade-in zoom-in-95">
            <h3 className="text-base font-bold font-fancy text-amber-300 border-b border-indigo-500/20 pb-3 flex items-center gap-2">
              <Edit3 className="w-4 h-4 text-amber-400" />
              <span>تعديل بيانات الطالب والاشتراك الشهري</span>
            </h3>

            <form onSubmit={handleSaveEdit} className="space-y-4 text-xs font-bold font-tajawal">
              <div className="space-y-1.5">
                <label className="text-slate-300">باركود الطالب *</label>
                <input
                  type="text"
                  required
                  value={editingStudent.barcode}
                  onChange={(e) =>
                    setEditingStudent({ ...editingStudent, barcode: e.target.value })
                  }
                  className="w-full bg-[#080d1e] border border-amber-400 text-amber-300 font-mono px-4 py-2.5 rounded-2xl outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300">اسم الطالب ثلاثي *</label>
                <input
                  type="text"
                  required
                  value={editingStudent.name}
                  onChange={(e) =>
                    setEditingStudent({ ...editingStudent, name: e.target.value })
                  }
                  className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-100 px-4 py-2.5 rounded-2xl outline-none focus:border-amber-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-slate-300">رقم الطالب</label>
                  <input
                    type="text"
                    value={editingStudent.phone}
                    onChange={(e) =>
                      setEditingStudent({ ...editingStudent, phone: e.target.value })
                    }
                    className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-200 px-4 py-2.5 rounded-2xl font-mono outline-none focus:border-amber-400"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-slate-300">رقم ولي الأمر *</label>
                  <input
                    type="text"
                    required
                    value={editingStudent.parentPhone}
                    onChange={(e) =>
                      setEditingStudent({ ...editingStudent, parentPhone: e.target.value })
                    }
                    className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-200 px-4 py-2.5 rounded-2xl font-mono outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-slate-300">الصف الدراسي</label>
                  <select
                    value={editingStudent.groupGrade}
                    onChange={(e) =>
                      setEditingStudent({
                        ...editingStudent,
                        groupGrade: e.target.value as GradeName,
                      })
                    }
                    className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-200 px-4 py-2.5 rounded-2xl outline-none"
                  >
                    {GRADE_ORDER.map((g) => (
                      <option key={g} value={g} className="bg-slate-900 text-white">
                        {g}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-300">أيام المجموعة</label>
                  <select
                    value={editingStudent.groupDays}
                    onChange={(e) =>
                      setEditingStudent({
                        ...editingStudent,
                        groupDays: e.target.value as GroupDays,
                      })
                    }
                    className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-200 px-4 py-2.5 rounded-2xl outline-none"
                  >
                    <option value="سبت - إثنين - أربعاء" className="bg-slate-900 text-white">سبت - إثنين - أربعاء</option>
                    <option value="أحد - ثلاثاء - خميس" className="bg-slate-900 text-white">أحد - ثلاثاء - خميس</option>
                  </select>
                </div>
              </div>

              {/* Custom Monthly Fee Override */}
              <div className="glass-card p-3.5 rounded-2xl border-amber-500/30 space-y-2">
                <label className="text-amber-300 text-xs block">
                  الاشتراك الشهري المخصص للطالب (ج.م) - اتركه فارغاً للاعتماد على سعر الصف الافتراضي:
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <input
                    type="number"
                    min={0}
                    step={5}
                    value={editingStudent.customMonthlyFee ?? ""}
                    onChange={(e) =>
                      setEditingStudent({
                        ...editingStudent,
                        customMonthlyFee:
                          e.target.value === "" ? undefined : Number(e.target.value),
                      })
                    }
                    placeholder="مثال: 50 أو 60 أو 70 أو 80"
                    className="w-full bg-[#080d1e] border border-amber-400 text-amber-300 px-3 py-2 rounded-xl font-bold font-mono outline-none"
                  />

                  <input
                    type="text"
                    value={editingStudent.discountReason ?? ""}
                    onChange={(e) =>
                      setEditingStudent({
                        ...editingStudent,
                        discountReason: e.target.value || undefined,
                      })
                    }
                    placeholder="سبب الخصم / ملاحظات"
                    className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-200 px-3 py-2 rounded-xl text-xs outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setEditingStudent(null)}
                  className="px-5 py-2.5 rounded-2xl bg-slate-800/80 text-slate-300 hover:bg-slate-700 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-200 hover:from-amber-300 text-slate-950 font-black cursor-pointer shadow-md active:scale-95"
                >
                  حفظ وتحديث البيانات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Student Detailed Financial Ledger Modal */}
      {ledgerModalStudent && (
        <StudentFinancialLedgerModal
          student={ledgerModalStudent}
          payments={payments}
          groupPrices={groupPrices}
          isOpen={!!ledgerModalStudent}
          onClose={() => setLedgerModalStudent(null)}
          onRecordQuickPayment={onRecordPayment}
          onUpdatePayment={onUpdatePayment}
          onDeletePayment={onDeletePayment}
        />
      )}
    </div>
  );
};
