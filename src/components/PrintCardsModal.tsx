import React, { useState } from "react";
import { Student, GradeName, GRADE_ORDER } from "../types";
import { TEACHER_NAME } from "../utils/helpers";
import { printElement, downloadPrintableHtml } from "../utils/print";
import { Printer, X, CreditCard, Filter, Info, Download } from "lucide-react";

interface PrintCardsModalProps {
  students: Student[];
  onClose: () => void;
}

export const PrintCardsModal: React.FC<PrintCardsModalProps> = ({ students, onClose }) => {
  const [selectedGrade, setSelectedGrade] = useState<string>("ALL");

  const filteredStudents =
    selectedGrade === "ALL"
      ? students
      : students.filter((s) => s.groupGrade === selectedGrade);

  const printCss = `
    @page { size: A4 portrait; margin: 8mm; }
    #printable-student-cards-grid {
      display: grid !important;
      grid-template-columns: repeat(2, 1fr) !important;
      gap: 12px !important;
      width: 100% !important;
    }
    .student-id-card {
      border: 2px solid #b38728 !important;
      border-radius: 12px !important;
      padding: 12px 14px !important;
      background: #ffffff !important;
      color: #0f172a !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
      display: flex !important;
      flex-direction: column !important;
      justify-content: space-between !important;
      min-height: 58mm !important;
      box-sizing: border-box !important;
      position: relative !important;
    }
  `;

  const handlePrintCards = () => {
    printElement("printable-student-cards-grid", {
      title: `كروت_باركود_الطلاب_${selectedGrade}`,
      orientation: "portrait",
      customCss: printCss,
    });
  };

  const handleDownloadCards = () => {
    downloadPrintableHtml(
      "printable-student-cards-grid",
      `كروت_باركود_الطلاب_${selectedGrade}.html`,
      {
        title: `كروت باركود الطلاب - ${selectedGrade}`,
        orientation: "portrait",
        customCss: printCss,
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center p-4 overflow-y-auto">
      {/* Top Controls */}
      <div className="no-print bg-[#121926] border border-amber-500/30 w-full max-w-5xl p-4 rounded-2xl flex flex-wrap items-center justify-between gap-4 mb-6 shadow-2xl sticky top-4 z-50">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400">
            <CreditCard className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-amber-400">
              طباعة كروت الباركود الذكية للطلاب (A4 Grid جاهز للقص والتغليف)
            </h3>
            <p className="text-xs text-slate-300">
              طباعة شبكة كروت منسقة لكل طالب مع الكود والبيانات
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 rounded-xl border border-amber-500/20 text-xs">
            <Filter className="w-3.5 h-3.5 text-amber-400" />
            <select
              value={selectedGrade}
              onChange={(e) => setSelectedGrade(e.target.value)}
              className="bg-transparent text-amber-300 font-bold outline-none cursor-pointer"
            >
              <option value="ALL" className="bg-slate-900 text-white">جميع المراحل ({students.length})</option>
              {GRADE_ORDER.map((g) => (
                <option key={g} value={g} className="bg-slate-900 text-white">
                  {g} ({students.filter((s) => s.groupGrade === g).length})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handlePrintCards}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 text-black font-black text-xs shadow-lg shadow-amber-500/30 flex items-center gap-2 transition-all transform hover:scale-105 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة الكروت الآن / حفظ PDF</span>
          </button>

          <button
            onClick={handleDownloadCards}
            className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
            title="تحميل الكروت كملف للفتح والطباعة من كروم"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            <span>تحميل كملف مستند</span>
          </button>

          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tip */}
        <div className="w-full bg-amber-500/10 border border-amber-500/30 rounded-xl p-2.5 flex items-center gap-2 text-xs text-amber-300">
          <Info className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            <strong>💡 للحفظ كملف PDF:</strong> اضغط على زر «طباعة الكروت الآن»، ستفتح صفحة الكروت في تبويب كروم وتظهر نافذة الطباعة تلقائياً، اختر <strong>«Save as PDF / حفظ بتنسيق PDF»</strong>.
          </span>
        </div>
      </div>

      {/* Cards Grid Container */}
      <div
        id="printable-student-cards-grid"
        className="w-full max-w-5xl grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-100 p-6 rounded-2xl font-['Tajawal',sans-serif]"
      >
        {filteredStudents.length === 0 ? (
          <div className="col-span-2 text-center py-12 text-slate-500 font-bold">
            لا يوجد طلاب في هذه المرحلة حالياً
          </div>
        ) : (
          filteredStudents.map((student) => (
            <div
              key={student.barcode}
              className="student-id-card bg-white border-2 border-[#b38728] rounded-2xl p-4 shadow-md flex flex-col justify-between relative overflow-hidden"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 90% 10%, rgba(212, 175, 55, 0.08) 0%, transparent 50%)",
              }}
            >
              {/* Card Header */}
              <div className="flex items-center justify-between border-b border-amber-200 pb-2 mb-2">
                <div className="text-right">
                  <h4 className="text-xs font-black text-[#8c671b] leading-tight">
                    منظومة {TEACHER_NAME}
                  </h4>
                  <p className="text-[10px] text-slate-500 font-bold">
                    أستاذة الرياضيات | 01070642904
                  </p>
                </div>
                <span className="text-[10px] font-black bg-amber-100 text-[#7c5b16] px-2 py-0.5 rounded-full border border-amber-300">
                  كارت الطالب الذكي
                </span>
              </div>

              {/* Student Info */}
              <div className="space-y-1 my-1 text-right">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-500 font-bold">اسم الطالب:</span>
                  <span className="text-xs font-extrabold text-slate-900">{student.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 font-bold">المرحلة والصف:</span>
                  <span className="text-[11px] font-bold text-amber-800">{student.groupGrade}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 font-bold">مواعيد المجموعة:</span>
                  <span className="text-[10px] font-semibold text-slate-700">{student.groupDays}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 font-bold">هاتف ولي الأمر:</span>
                  <span className="text-[10px] font-mono font-bold text-slate-800">{student.parentPhone}</span>
                </div>
              </div>

              {/* Barcode Visual & Code */}
              <div className="border-t border-slate-200 pt-2 mt-2 flex flex-col items-center justify-center">
                {/* Visual Barcode Bars Pattern */}
                <div className="flex items-center justify-center gap-[2px] h-9 w-full max-w-[200px] my-0.5 px-2 bg-white">
                  {student.barcode.split("").map((char, i) => {
                    const code = char.charCodeAt(0);
                    return (
                      <React.Fragment key={i}>
                        <div
                          className="bg-black"
                          style={{
                            width: `${(code % 3) + 1.5}px`,
                            height: "100%",
                          }}
                        />
                        <div
                          className="bg-transparent"
                          style={{
                            width: `${((code * 2) % 3) + 1}px`,
                            height: "100%",
                          }}
                        />
                      </React.Fragment>
                    );
                  })}
                </div>
                <div className="font-mono text-xs font-black tracking-widest text-slate-900 mt-0.5">
                  *{student.barcode}*
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
