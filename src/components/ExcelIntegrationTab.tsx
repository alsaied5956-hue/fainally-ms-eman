import React, { useState, useRef } from "react";
import { Student, PaymentRecord, GradeName } from "../types";
import { exportStudentsToExcel, exportAllExamsToExcel, parseStudentsFromExcelFile } from "../utils/excel";
import { cleanPhoneNumber } from "../utils/helpers";
import { FileSpreadsheet, Upload, Download, CheckCircle, AlertCircle, FileCheck, Users, Sparkles } from "lucide-react";

interface ExcelIntegrationTabProps {
  students?: Student[];
  payments?: Record<string, Record<string, PaymentRecord>>;
  attendanceHistory?: Record<string, Record<string, string>>;
  onBulkImportStudents?: (newStudents: Student[]) => void;
}

export const ExcelIntegrationTab: React.FC<ExcelIntegrationTabProps> = ({
  students = [],
  payments = {},
  attendanceHistory = {},
  onBulkImportStudents,
}) => {
  const [importPreview, setImportPreview] = useState<Partial<Student>[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (file: File) => {
    setIsProcessing(true);
    setImportErrors([]);
    try {
      const result = await parseStudentsFromExcelFile(file);
      setImportPreview(result.students);
      setImportErrors(result.errors);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "❌ فشل قراءة ملف الإكسيل! تأكد من أن الملف بصيغة .xlsx أو .xls صالحة.";
      alert(errMsg);
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmImport = () => {
    if (!importPreview || importPreview.length === 0) return;

    // Filter out duplicates with existing barcodes
    const existingBarcodes = new Set(students.map((s) => String(s.barcode).trim()));
    const validNewStudents: Student[] = [];
    let duplicatesCount = 0;

    importPreview.forEach((p) => {
      const b = String(p.barcode || "").trim();
      if (!b || existingBarcodes.has(b)) {
        duplicatesCount++;
        return;
      }

      existingBarcodes.add(b);
      validNewStudents.push({
        barcode: b,
        name: p.name || "طالب جديد",
        phone: cleanPhoneNumber(p.phone || ""),
        parentPhone: cleanPhoneNumber(p.parentPhone || p.phone || ""),
        groupGrade: (p.groupGrade as GradeName) || "الصف الرابع الابتدائي",
        groupDays: p.groupDays || "سبت - إثنين - أربعاء",
        customMonthlyFee: p.customMonthlyFee,
        discountReason: p.discountReason,
        points: 0,
        totalAttendanceDays: 0,
        totalAbsentDays: 0,
        totalExamScores: [],
        createdAt: new Date().toISOString(),
      });
    });

    if (validNewStudents.length === 0) {
      alert("⚠️ جميع الطلاب الموجودين في الملف مضافون بالفعل في المنظومة (أكواد مكررة)!");
      return;
    }

    if (onBulkImportStudents) {
      onBulkImportStudents(validNewStudents);
    }
    alert(
      `🎉 تم استيراد (${validNewStudents.length}) طالب جديد بنجاح! ${
        duplicatesCount > 0 ? `(تم تجاهل ${duplicatesCount} كود مكرر مسبقاً)` : ""
      }`
    );

    setImportPreview(null);
    setImportErrors([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-6 font-tajawal">
      {/* Quick Export Cards */}
      <div className="glass-panel p-6 md:p-8 rounded-3xl shadow-2xl space-y-5">
        <div className="flex items-center gap-3.5 pb-4 border-b border-indigo-500/20">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shadow-md">
            <Download className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold font-fancy text-amber-300">
              تصدير سجلات المنظومة إلى ملفات Excel (.xlsx)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              تنزيل وتصدير كامل لكشوف الطلاب والدرجات والحسابات بتنسيق عربي سليم ومتوافق مع جميع البرامج
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <button
            onClick={() => exportStudentsToExcel(students)}
            className="p-5 rounded-2xl glass-card hover:border-amber-400 text-right transition-all flex items-center justify-between group shadow-lg cursor-pointer"
          >
            <div>
              <h4 className="text-sm font-bold font-fancy text-amber-300 group-hover:text-amber-200">
                📥 كشف الطلاب الرئيسي بالكامل
              </h4>
              <p className="text-xs text-slate-400 mt-1">
                يشمل الباركود، الأرقام، الاشتراكات المخصصة، ونسب الحضور والغياب (<span className="font-mono text-amber-300">{students.length}</span> طالب)
              </p>
            </div>
            <FileSpreadsheet className="w-8 h-8 text-emerald-400 group-hover:scale-110 transition-transform shrink-0" />
          </button>

          <button
            onClick={() => exportAllExamsToExcel(students)}
            className="p-5 rounded-2xl glass-card hover:border-sky-400 text-right transition-all flex items-center justify-between group shadow-lg cursor-pointer"
          >
            <div>
              <h4 className="text-sm font-bold font-fancy text-sky-300 group-hover:text-sky-200">
                📥 سجل الدرجات والاختبارات التراكمي
              </h4>
              <p className="text-xs text-slate-400 mt-1">
                يشمل درجات كافة الامتحانات والنسب المئوية ومتوسط كل طالب
              </p>
            </div>
            <FileSpreadsheet className="w-8 h-8 text-sky-400 group-hover:scale-110 transition-transform shrink-0" />
          </button>
        </div>
      </div>

      {/* Excel Import Section */}
      <div className="glass-panel p-6 md:p-8 rounded-3xl shadow-2xl space-y-5">
        <div className="flex items-center gap-3.5 pb-4 border-b border-indigo-500/20">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shadow-md">
            <Upload className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold font-fancy text-amber-300">
              استيراد وإضافة مئات الطلاب دفعة واحدة من شيت Excel
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              ارفع ملف إكسيل (.xlsx / .csv) يحتوي على الأعمدة: (كود الباركود، اسم الطالب، رقم ولي الأمر، الصف الدراسي)
            </p>
          </div>
        </div>

        {/* Drag and Drop Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
              handleFileChange(e.dataTransfer.files[0]);
            }
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-3xl p-8 text-center cursor-pointer transition-all ${
            dragActive
              ? "border-amber-400 bg-amber-500/10 scale-[1.01]"
              : "border-indigo-500/30 hover:border-amber-500/60 bg-[#080d1e]/80"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx, .xls, .csv"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFileChange(e.target.files[0]);
              }
            }}
            className="hidden"
          />

          <FileSpreadsheet className="w-12 h-12 text-amber-400/80 mx-auto mb-3 animate-bounce" />
          <h3 className="text-base font-bold font-fancy text-slate-200">
            اضغط هنا لاختيار ملف الإكسيل أو اسحب الملف وأفلته مباشرة
          </h3>
          <p className="text-xs text-slate-400 mt-1">يدعم ملفات .xlsx, .xls, .csv</p>
        </div>

        {/* Import Preview Table */}
        {importPreview && importPreview.length > 0 && (
          <div className="space-y-4 pt-4 border-t border-indigo-500/20">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-2">
                <FileCheck className="w-4 h-4" />
                <span>تم التعرف على <span className="font-mono">{importPreview.length}</span> طالب جاهز للإضافة</span>
              </h3>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setImportPreview(null)}
                  className="px-4 py-2 rounded-2xl bg-slate-800 text-slate-300 text-xs font-bold hover:bg-slate-700 cursor-pointer"
                >
                  إلغاء
                </button>

                <button
                  type="button"
                  onClick={handleConfirmImport}
                  className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 text-slate-950 font-black text-xs shadow-lg shadow-emerald-500/20 flex items-center gap-2 cursor-pointer active:scale-95"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>تأكيد استيراد وحفظ الطلاب في المنظومة ➕</span>
                </button>
              </div>
            </div>

            <div className="max-h-60 overflow-y-auto overflow-x-auto rounded-2xl border border-indigo-500/20 bg-[#080d1e]/80">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900/90 text-amber-300 sticky top-0 font-bold font-fancy border-b border-indigo-500/20">
                    <th className="p-3">م</th>
                    <th className="p-3">الباركود</th>
                    <th className="p-3">اسم الطالب</th>
                    <th className="p-3">الصف الدراسي</th>
                    <th className="p-3">رقم ولي الأمر</th>
                    <th className="p-3">الاشتراك المخصص</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  {importPreview.slice(0, 30).map((p, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/40">
                      <td className="p-2.5 font-mono text-slate-400">{idx + 1}</td>
                      <td className="p-2.5 font-mono text-amber-300">#{p.barcode}</td>
                      <td className="p-2.5 font-bold text-slate-200 font-fancy">{p.name}</td>
                      <td className="p-2.5 text-slate-400">{p.groupGrade}</td>
                      <td className="p-2.5 font-mono text-slate-400">{p.parentPhone}</td>
                      <td className="p-2.5 text-purple-300 font-bold">
                        {p.customMonthlyFee ? `${p.customMonthlyFee} ج` : "الافتراضي"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {importPreview.length > 30 && (
              <p className="text-xs text-slate-400 text-center">
                ... ويوجد {importPreview.length - 30} طالب آخر في الملف سيتم استيرادهم بالكامل.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
