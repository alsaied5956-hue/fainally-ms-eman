import React, { useState, useMemo } from "react";
import { Student, PaymentRecord, GradeName } from "../types";
import { DEFAULT_GRADE_PRICES, openWhatsApp, isStudentPaid, getStudentPayment } from "../utils/helpers";
import { printElement } from "../utils/print";
import { EditPaymentModal } from "./EditPaymentModal";
import {
  X,
  Printer,
  Calendar,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Clock,
  Phone,
  FileSpreadsheet,
  Receipt,
  ArrowRight,
  Sparkles,
  Edit2,
  Trash2,
} from "lucide-react";

interface StudentFinancialLedgerModalProps {
  student: Student | null;
  payments: Record<string, Record<string, PaymentRecord>>; // payments[monthKey][barcode]
  groupPrices: Record<GradeName, number>;
  isOpen: boolean;
  onClose: () => void;
  onRecordQuickPayment?: (barcode: string, amount: number, monthKey: string, note: string) => void;
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

export const StudentFinancialLedgerModal: React.FC<StudentFinancialLedgerModalProps> = ({
  student,
  payments,
  groupPrices,
  isOpen,
  onClose,
  onRecordQuickPayment,
  onUpdatePayment,
  onDeletePayment,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<"ledger" | "receipt">("ledger");
  const [selectedReceiptMonth, setSelectedReceiptMonth] = useState<string>("");
  const [editingPayment, setEditingPayment] = useState<{ record: PaymentRecord; monthKey: string } | null>(null);
  const [quickPayAmount, setQuickPayAmount] = useState<number | "">("");
  const [quickPayMonth, setQuickPayMonth] = useState<string>("");

  // Build the list of months for the academic year (e.g. 2025/2026 or 2026/2027)
  const academicMonths = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12

    // If current month >= 8 (August), academic year starts this year, ends next year
    // Else academic year started previous year, ends this year
    const startYear = currentMonth >= 8 ? currentYear : currentYear - 1;
    const endYear = startYear + 1;

    const list: { key: string; label: string; monthNumber: number; year: number }[] = [
      { key: `${startYear}-08`, label: `أغسطس ${startYear}`, monthNumber: 8, year: startYear },
      { key: `${startYear}-09`, label: `سبتمبر ${startYear}`, monthNumber: 9, year: startYear },
      { key: `${startYear}-10`, label: `أكتوبر ${startYear}`, monthNumber: 10, year: startYear },
      { key: `${startYear}-11`, label: `نوفمبر ${startYear}`, monthNumber: 11, year: startYear },
      { key: `${startYear}-12`, label: `ديسمبر ${startYear}`, monthNumber: 12, year: startYear },
      { key: `${endYear}-01`, label: `يناير ${endYear}`, monthNumber: 1, year: endYear },
      { key: `${endYear}-02`, label: `فبراير ${endYear}`, monthNumber: 2, year: endYear },
      { key: `${endYear}-03`, label: `مارس ${endYear}`, monthNumber: 3, year: endYear },
      { key: `${endYear}-04`, label: `أبريل ${endYear}`, monthNumber: 4, year: endYear },
      { key: `${endYear}-05`, label: `مايو ${endYear}`, monthNumber: 5, year: endYear },
      { key: `${endYear}-06`, label: `يونيو ${endYear}`, monthNumber: 6, year: endYear },
      { key: `${endYear}-07`, label: `يوليو ${endYear}`, monthNumber: 7, year: endYear },
    ];

    // Include any additional months found in payments history that might be outside standard 12 months
    Object.keys(payments || {}).forEach((mKey) => {
      if (student && isStudentPaid(payments[mKey] || {}, student.barcode) && !list.some((item) => item.key === mKey)) {
        list.push({
          key: mKey,
          label: mKey,
          monthNumber: parseInt(mKey.split("-")[1] || "1", 10),
          year: parseInt(mKey.split("-")[0] || String(currentYear), 10),
        });
      }
    });

    return list;
  }, [payments, student]);

  const standardFee =
    student?.customMonthlyFee ??
    (student ? groupPrices[student.groupGrade] : 0) ??
    (student ? DEFAULT_GRADE_PRICES[student.groupGrade] : 100) ??
    100;

  // Compute ledger entries
  const ledgerEntries = academicMonths.map((m) => {
    const pay = student ? getStudentPayment(payments[m.key] || {}, student.barcode) : undefined;
    const isPaid = !!pay;
    const paidAmount = pay ? pay.amount : 0;
    const requiredAmount = standardFee;
    const balance = isPaid ? paidAmount - requiredAmount : -requiredAmount;

    return {
      monthKey: m.key,
      monthLabel: m.label,
      isPaid,
      paidAmount,
      requiredAmount,
      balance,
      payRecord: pay,
    };
  });

  // Calculate totals
  const totalRequiredAllMonths = ledgerEntries.reduce((acc, curr) => acc + curr.requiredAmount, 0);
  const totalPaidAllMonths = ledgerEntries.reduce((acc, curr) => acc + curr.paidAmount, 0);
  const paidMonthsCount = ledgerEntries.filter((e) => e.isPaid).length;
  const unpaidMonthsCount = ledgerEntries.filter((e) => !e.isPaid).length;

  const currentMonthKeyStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

  const handlePrintLedger = () => {
    if (student) {
      printElement("student-ledger-table-print", {
        title: `كشف حساب ومصروفات الطالب - ${student.name}`,
      });
    } else {
      window.print();
    }
  };

  const handleOpenReceipt = (monthKey: string) => {
    setSelectedReceiptMonth(monthKey);
    setActiveSubTab("receipt");
  };

  const handleSendWhatsAppStatement = () => {
    const paidList = ledgerEntries.filter((e) => e.isPaid).map((e) => `• ${e.monthLabel}: مدفوع (${e.paidAmount} ج.م)`).join("\n");
    const unpaidList = ledgerEntries.filter((e) => !e.isPaid && e.monthKey <= currentMonthKeyStr).map((e) => `• ${e.monthLabel}: مستحق (${e.requiredAmount} ج.م)`).join("\n");

    const message = `📊 كشف حساب ومصروفات الطالب 🧾\n` +
      `منظومة الأستاذة إيمان الدمشيتي - رياضيات 📐\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `👤 الطالب: ${student.name}\n` +
      `📚 الصف: ${student.groupGrade}\n` +
      `📅 المجموعة: ${student.groupDays}\n` +
      `🏷️ الاشتراك الشهري المحدد: ${standardFee} ج.م\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `💰 إجمالي المسدد: ${totalPaidAllMonths} ج.م (${paidMonthsCount} شهور)\n\n` +
      (unpaidList ? `⚠️ الشهور المستحقة حتى تاريخه:\n${unpaidList}\n\n` : `🎉 جميع الشهور حتى الآن مسددة بالكامل!\n\n`) +
      `شاكرين لكم اهتمامكم وحرصكم الدائم ✨`;

    openWhatsApp(student.parentPhone || student.phone || "", message);
  };

  const activeReceiptRecord = selectedReceiptMonth
    ? ledgerEntries.find((e) => e.monthKey === selectedReceiptMonth)
    : ledgerEntries.find((e) => e.isPaid);

  if (!isOpen || !student) return null;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3 md:p-6 no-print-backdrop">
      <div className="bg-[#0b1224] border-2 border-indigo-500/40 w-full max-w-4xl rounded-3xl p-5 md:p-7 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 max-h-[92vh] flex flex-col font-tajawal text-slate-100">
        
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-indigo-500/20 shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500/20 via-amber-400/10 to-yellow-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-md">
              <CreditCard className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg md:text-xl font-black text-amber-300 font-fancy">
                  كشف الحساب والسجل المالي للطالب
                </h3>
                <span className="font-mono text-xs bg-slate-900 px-2.5 py-0.5 rounded-lg border border-slate-700 text-amber-400">
                  #{student.barcode}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                الطالب: <strong className="text-white text-sm">{student.name}</strong> • {student.groupGrade} • {student.groupDays}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSendWhatsAppStatement}
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-600/20 cursor-pointer transition-all"
            >
              <Phone className="w-3.5 h-3.5" />
              <span>إرسال كشف الحساب واتساب</span>
            </button>

            <button
              type="button"
              onClick={handlePrintLedger}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs flex items-center gap-1.5 border border-slate-700 cursor-pointer transition-all"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>طباعة كشف الحساب</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Selector: Full Ledger vs Printable Receipt */}
        <div className="grid grid-cols-2 gap-2 bg-[#060a14] p-1.5 rounded-2xl border border-indigo-500/20 shrink-0">
          <button
            type="button"
            onClick={() => setActiveSubTab("ledger")}
            className={`py-2.5 px-3 rounded-xl font-bold text-xs md:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeSubTab === "ledger"
                ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-md font-black"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>سجل شهور العام الدراسي والمصروفات</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!selectedReceiptMonth && ledgerEntries.some((e) => e.isPaid)) {
                setSelectedReceiptMonth(ledgerEntries.find((e) => e.isPaid)?.monthKey || "");
              }
              setActiveSubTab("receipt");
            }}
            className={`py-2.5 px-3 rounded-xl font-bold text-xs md:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeSubTab === "receipt"
                ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 shadow-md font-black"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>معاينة وطباعة إيصال سداد الشهر</span>
          </button>
        </div>

        {/* Summary Metrics Banner */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
          <div className="bg-[#070d1d] border border-indigo-500/30 p-3 rounded-2xl">
            <span className="text-[11px] text-slate-400 block font-medium">الاشتراك الشهري المعتمد</span>
            <span className="text-xl font-black text-amber-300 font-mono mt-0.5 block">
              {standardFee} <span className="text-xs font-normal text-slate-400">ج.م/شهر</span>
            </span>
            {student.customMonthlyFee !== undefined && (
              <span className="text-[10px] text-amber-400/90 font-bold block">
                🏷️ اشتراك مخصص ({student.discountReason || "خصم معتمد"})
              </span>
            )}
          </div>

          <div className="bg-[#070d1d] border border-emerald-500/30 p-3 rounded-2xl">
            <span className="text-[11px] text-emerald-400 block font-medium">إجمالي المسدد فعلياً</span>
            <span className="text-xl font-black text-emerald-400 font-mono mt-0.5 block">
              {totalPaidAllMonths} <span className="text-xs font-normal text-slate-400">ج.م</span>
            </span>
            <span className="text-[10px] text-slate-400 block">عدد {paidMonthsCount} شهور مسددة</span>
          </div>

          <div className="bg-[#070d1d] border border-rose-500/30 p-3 rounded-2xl">
            <span className="text-[11px] text-rose-400 block font-medium">الشهور غير المسددة</span>
            <span className="text-xl font-black text-rose-400 font-mono mt-0.5 block">
              {unpaidMonthsCount} <span className="text-xs font-normal text-slate-400">شهور</span>
            </span>
            <span className="text-[10px] text-slate-400 block">من إجمالي {ledgerEntries.length} شهر بالعام</span>
          </div>

          <div className="bg-[#070d1d] border border-cyan-500/30 p-3 rounded-2xl">
            <span className="text-[11px] text-cyan-400 block font-medium">حالة شهر ({currentMonthKeyStr})</span>
            {payments[currentMonthKeyStr]?.[student.barcode] ? (
              <span className="text-xs font-bold text-emerald-400 flex items-center gap-1 mt-1.5">
                <CheckCircle2 className="w-4 h-4" />
                تم سداد الشهر الحالي
              </span>
            ) : (
              <span className="text-xs font-bold text-rose-400 flex items-center gap-1 mt-1.5">
                <AlertCircle className="w-4 h-4" />
                مستحق السداد الآن
              </span>
            )}
          </div>
        </div>

        {/* Content View 1: Detailed Monthly Ledger Table */}
        {activeSubTab === "ledger" && (
          <div id="student-ledger-table-print" className="space-y-4 overflow-hidden flex flex-col flex-1">
            <div className="overflow-y-auto flex-1 pr-1 border border-indigo-500/20 rounded-2xl bg-[#060b17]">
              <table className="w-full text-right border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-900 text-amber-300 font-bold border-b border-indigo-500/30 z-10">
                  <tr>
                    <th className="p-3">الشهر الدراسي</th>
                    <th className="p-3">قيمة الاشتراك</th>
                    <th className="p-3">المسدد فعلياً</th>
                    <th className="p-3">حالة السداد</th>
                    <th className="p-3">تاريخ ووقت العملية</th>
                    <th className="p-3">ملاحظات</th>
                    <th className="p-3 text-center">إجراءات سريعة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-indigo-950/60 font-medium">
                  {ledgerEntries.map((item) => (
                    <tr
                      key={item.monthKey}
                      className={`hover:bg-indigo-500/10 transition-colors ${
                        item.monthKey === currentMonthKeyStr ? "bg-amber-500/5 font-bold" : ""
                      }`}
                    >
                      <td className="p-3 flex items-center gap-2">
                        <Calendar className="w-3.5 h-3.5 text-amber-400" />
                        <span>{item.monthLabel}</span>
                        {item.monthKey === currentMonthKeyStr && (
                          <span className="text-[10px] bg-amber-400/20 text-amber-300 px-1.5 py-0.5 rounded">
                            الشهر الحالي
                          </span>
                        )}
                      </td>
                      <td className="p-3 font-mono text-slate-300">{item.requiredAmount} ج.م</td>
                      <td className="p-3 font-mono font-bold">
                        {item.paidAmount > 0 ? (
                          <span className="text-emerald-400">{item.paidAmount} ج.م</span>
                        ) : (
                          <span className="text-slate-500">0 ج.م</span>
                        )}
                      </td>
                      <td className="p-3">
                        {item.isPaid ? (
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            تم السداد
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 inline-flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            مستحق
                          </span>
                        )}
                      </td>
                      <td className="p-3 font-mono text-slate-400">
                        {item.payRecord ? `${item.payRecord.date} ${item.payRecord.time}` : "-"}
                      </td>
                      <td className="p-3 text-slate-400 text-[11px]">
                        {item.payRecord?.note || "-"}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {item.isPaid ? (
                            <>
                              {onUpdatePayment && item.payRecord && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditingPayment({
                                      record: item.payRecord!,
                                      monthKey: item.monthKey,
                                    })
                                  }
                                  className="p-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all"
                                  title="تعديل السداد أو تحويل الشهر"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {onDeletePayment && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (
                                      confirm(
                                        `هل تود إلغاء سداد شهر (${item.monthLabel}) للطالب (${student.name}) وإعادته كغير مسدد؟`
                                      )
                                    ) {
                                      onDeletePayment(item.monthKey, student.barcode);
                                    }
                                  }}
                                  className="p-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all"
                                  title="إلغاء السداد وحذفه"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleOpenReceipt(item.monthKey)}
                                className="px-2 py-1 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-500/40 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all"
                              >
                                <Receipt className="w-3 h-3" />
                                <span>إيصال</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const singleReceiptMsg = `إيصال استلام سداد اشتراك 🧾\n` +
                                    `منظومة الأستاذة إيمان الدمشيتي - رياضيات 📐\n` +
                                    `اسم الطالب: ${student.name}\n` +
                                    `الصف: ${student.groupGrade}\n` +
                                    `عن شهر: ${item.monthLabel}\n` +
                                    `المبلغ المسدد: ${item.paidAmount} ج.م\n` +
                                    `تاريخ السداد: ${item.payRecord?.date || ""} ${item.payRecord?.time || ""}\n` +
                                    `شكراً لثقتكم واهتمامكم ✨`;
                                  openWhatsApp(student.parentPhone, singleReceiptMsg);
                                }}
                                className="p-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 cursor-pointer"
                                title="إرسال إيصال الشهر عبر واتساب"
                              >
                                <Phone className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            onRecordQuickPayment && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (
                                    confirm(
                                      `هل تود إثبات سداد مبلغ (${item.requiredAmount} ج.م) عن شهر (${item.monthLabel}) للطالب (${student.name})؟`
                                    )
                                  ) {
                                    onRecordQuickPayment(
                                      student.barcode,
                                      item.requiredAmount,
                                      item.monthKey,
                                      `سداد اشتراك ${item.monthLabel}`
                                    );
                                  }
                                }}
                                className="px-2.5 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-black shadow-sm cursor-pointer transition-all flex items-center gap-1"
                              >
                                <CreditCard className="w-3 h-3" />
                                <span>سداد فوري</span>
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Content View 2: Official Printable Receipt Card */}
        {activeSubTab === "receipt" && (
          <div className="space-y-4 overflow-y-auto flex-1 pr-1">
            {/* Month Selector for Receipt */}
            <div className="flex flex-wrap items-center gap-2 bg-[#060b17] p-3 rounded-2xl border border-indigo-500/30 shrink-0">
              <span className="text-xs text-amber-300 font-bold">اختر الشهر المراد طباعة أو عرض إيصاله:</span>
              <select
                value={selectedReceiptMonth}
                onChange={(e) => setSelectedReceiptMonth(e.target.value)}
                className="bg-[#0b1226] border border-indigo-500/40 text-white text-xs font-bold px-3 py-1.5 rounded-xl outline-none"
              >
                {ledgerEntries.map((m) => (
                  <option key={m.monthKey} value={m.monthKey}>
                    {m.monthLabel} {m.isPaid ? "✅ (مدفوع)" : "❌ (مستحق)"}
                  </option>
                ))}
              </select>
            </div>

            {/* Printable Receipt Card Design */}
            {activeReceiptRecord ? (
              <div className="bg-gradient-to-b from-[#0e172e] to-[#080e1e] border-2 border-amber-500/40 p-6 md:p-8 rounded-3xl shadow-2xl max-w-lg mx-auto space-y-6 text-center relative overflow-hidden">
                {/* Decorative Pattern / Badge */}
                <div className="absolute top-0 right-0 left-0 h-2 bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600" />
                
                <div className="space-y-1">
                  <span className="text-xs text-amber-400 font-bold tracking-wider">منظومة الأستاذة إيمان الدمشيتي</span>
                  <h4 className="text-xl font-black text-white font-fancy">إيصال سداد اشتراك الرياضيات</h4>
                  <p className="text-[11px] text-slate-400 font-mono">رقم الإيصال: REC-{student.barcode}-{activeReceiptRecord.monthKey}</p>
                </div>

                {/* Receipt Details Box */}
                <div className="bg-[#050813] border border-indigo-500/30 rounded-2xl p-4 space-y-3 text-right text-xs">
                  <div className="flex justify-between border-b border-indigo-950 pb-2">
                    <span className="text-slate-400">اسم الطالب:</span>
                    <span className="font-bold text-white text-sm">{student.name}</span>
                  </div>
                  <div className="flex justify-between border-b border-indigo-950 pb-2">
                    <span className="text-slate-400">الصف الدراسي:</span>
                    <span className="font-bold text-slate-200">{student.groupGrade}</span>
                  </div>
                  <div className="flex justify-between border-b border-indigo-950 pb-2">
                    <span className="text-slate-400">عن شهر:</span>
                    <span className="font-bold text-amber-300 text-sm">{activeReceiptRecord.monthLabel}</span>
                  </div>
                  <div className="flex justify-between border-b border-indigo-950 pb-2">
                    <span className="text-slate-400">المبلغ المسدد:</span>
                    <span className="font-black text-emerald-400 text-base font-mono">
                      {activeReceiptRecord.paidAmount > 0 ? activeReceiptRecord.paidAmount : activeReceiptRecord.requiredAmount} ج.م
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-indigo-950 pb-2">
                    <span className="text-slate-400">تاريخ ووقت السداد:</span>
                    <span className="font-mono text-slate-300">
                      {activeReceiptRecord.payRecord?.date || new Date().toISOString().split("T")[0]} {activeReceiptRecord.payRecord?.time || ""}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">حالة الإيصال:</span>
                    <span className={`font-bold ${activeReceiptRecord.isPaid ? "text-emerald-400" : "text-amber-400"}`}>
                      {activeReceiptRecord.isPaid ? "✅ تم السداد والاعتماد" : "⚠️ قيد انتظار السداد"}
                    </span>
                  </div>
                </div>

                {/* Footer and Stamps */}
                <div className="flex items-center justify-between pt-2 text-[11px] text-slate-400 border-t border-indigo-900/60">
                  <span>توقيع وختم الإدارة: أ/ إيمان الدمشيتي ✍️</span>
                  <span>مع تمنياتنا بالتفوق والتميز 🌟</span>
                </div>

                {/* Print Button inside receipt */}
                <div className="pt-2 flex justify-center gap-3">
                  <button
                    type="button"
                    onClick={handlePrintLedger}
                    className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/20 flex items-center gap-2 cursor-pointer transition-all"
                  >
                    <Printer className="w-4 h-4" />
                    <span>طباعة هذا الإيصال فوراً</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center p-8 text-slate-400 text-xs">
                يرجى اختيار شهر لعرض الإيصال.
              </div>
            )}
          </div>
        )}

        {/* Edit Payment Modal */}
        {editingPayment && onUpdatePayment && (
          <EditPaymentModal
            isOpen={!!editingPayment}
            student={student}
            payment={editingPayment.record}
            monthKey={editingPayment.monthKey}
            onClose={() => setEditingPayment(null)}
            onSave={(oldMonthKey, barcode, newMonthKey, newAmount, newNote, newDate) => {
              onUpdatePayment(oldMonthKey, barcode, newMonthKey, newAmount, newNote, newDate);
              setEditingPayment(null);
            }}
            onDelete={(monthKey, barcode) => {
              if (onDeletePayment) {
                onDeletePayment(monthKey, barcode);
              }
              setEditingPayment(null);
            }}
          />
        )}

      </div>
    </div>
  );
};
