import * as XLSX from "xlsx";
import { Student, GradeName, GroupDays, PaymentRecord, GRADE_ORDER } from "../types";
import {
  getAttendanceRate,
  getAbsenceRate,
  getExamAverage,
  getTodayKey,
  DEFAULT_GRADE_PRICES,
  sortStudentsByGradeAndName,
  isStudentPaid,
  getStudentPayment,
} from "./helpers";

export interface ExportFinancialOptions {
  students: Student[];
  payments: Record<string, Record<string, PaymentRecord>>;
  groupPrices?: Record<GradeName, number>;
  selectedMonth: string;
  filterGrade?: string;
  filterDays?: string;
  fileName?: string;
}

/**
 * Exports financial report organized strictly by Grade:
 * For each grade (e.g. 4th primary):
 * 1. FIRST: All students who PAID (الذين دفعوا)
 * 2. SECOND: All students who have NOT PAID (الذين لم يدفعوا)
 * Creates a comprehensive master sheet + individual sheets for each grade.
 */
export function exportDefaultersAndPaidExcel({
  students,
  payments,
  groupPrices = DEFAULT_GRADE_PRICES,
  selectedMonth,
  filterGrade = "ALL",
  filterDays = "ALL",
  fileName,
}: ExportFinancialOptions): void {
  const workbook = XLSX.utils.book_new();
  const monthPayments = payments[selectedMonth] || {};

  // Filter relevant students based on global filters
  const baseStudents = students.filter((s) => {
    if (filterGrade !== "ALL" && s.groupGrade !== filterGrade) return false;
    if (filterDays !== "ALL" && s.groupDays !== filterDays) return false;
    return true;
  });

  const gradesToProcess =
    filterGrade !== "ALL"
      ? [filterGrade as GradeName]
      : GRADE_ORDER.filter((g) => baseStudents.some((s) => s.groupGrade === g));

  // Helper to build rows for a given student list
  const formatStudentRows = (studentList: Student[], startingIndex = 1) => {
    const paidList: Student[] = [];
    const unpaidList: Student[] = [];

    studentList.forEach((s) => {
      if (isStudentPaid(monthPayments, s.barcode)) {
        paidList.push(s);
      } else {
        unpaidList.push(s);
      }
    });

    // Sort alphabetically by Arabic name within each group
    paidList.sort((a, b) => a.name.localeCompare(b.name, "ar"));
    unpaidList.sort((a, b) => a.name.localeCompare(b.name, "ar"));

    const rows: Record<string, unknown>[] = [];
    let currentIndex = startingIndex;

    // 1. All Paid Students FIRST
    paidList.forEach((s) => {
      const pay = getStudentPayment(monthPayments, s.barcode);
      const fee =
        s.customMonthlyFee ??
        groupPrices[s.groupGrade] ??
        DEFAULT_GRADE_PRICES[s.groupGrade] ??
        100;

      rows.push({
        "م": currentIndex++,
        "الصف الدراسي": s.groupGrade,
        "حالة السداد": "✅ تم السداد (مدفوع)",
        "اسم الطالب": s.name,
        "كود الباركود": s.barcode,
        "أيام المجموعة": s.groupDays,
        "الاشتراك المقرر (ج.م)": fee,
        "المبلغ المسدد (ج.م)": pay ? pay.amount : fee,
        "تاريخ وساعة السداد": pay ? `${pay.date} ${pay.time}` : "-",
        "رقم تليفون ولي الأمر": s.parentPhone || "-",
        "رقم تليفون الطالب": s.phone || "-",
        "ملاحظات": pay?.note || (s.discountReason ? `خصم: ${s.discountReason}` : "-"),
      });
    });

    // 2. All Unpaid Students SECOND
    unpaidList.forEach((s) => {
      const fee =
        s.customMonthlyFee ??
        groupPrices[s.groupGrade] ??
        DEFAULT_GRADE_PRICES[s.groupGrade] ??
        100;

      rows.push({
        "م": currentIndex++,
        "الصف الدراسي": s.groupGrade,
        "حالة السداد": "❌ غير مسدد (مستحق)",
        "اسم الطالب": s.name,
        "كود الباركود": s.barcode,
        "أيام المجموعة": s.groupDays,
        "الاشتراك المقرر (ج.م)": fee,
        "المبلغ المسدد (ج.م)": 0,
        "تاريخ وساعة السداد": "لم يسدد بعد",
        "رقم تليفون ولي الأمر": s.parentPhone || "-",
        "رقم تليفون الطالب": s.phone || "-",
        "ملاحظات": s.discountReason ? `خصم: ${s.discountReason}` : "-",
      });
    });

    return {
      rows,
      paidCount: paidList.length,
      unpaidCount: unpaidList.length,
      totalCount: studentList.length,
    };
  };

  // 1. Build Master Sheet (All Grades: Grade 1 [Paid -> Unpaid], Grade 2 [Paid -> Unpaid]...)
  const masterRows: Record<string, unknown>[] = [];
  let masterIndex = 1;

  gradesToProcess.forEach((grade) => {
    const gradeStudents = baseStudents.filter((s) => s.groupGrade === grade);
    if (gradeStudents.length === 0) return;

    const formatted = formatStudentRows(gradeStudents, masterIndex);
    masterRows.push(...formatted.rows);
    masterIndex += formatted.rows.length;
  });

  if (masterRows.length > 0) {
    const masterSheet = XLSX.utils.json_to_sheet(masterRows);
    masterSheet["!views"] = [{ RTL: true }];
    XLSX.utils.book_append_sheet(workbook, masterSheet, "كشف شامل لكافة الصفوف");
  }

  // 2. Build Individual Sheet for each Grade
  gradesToProcess.forEach((grade) => {
    const gradeStudents = baseStudents.filter((s) => s.groupGrade === grade);
    if (gradeStudents.length === 0) return;

    const formatted = formatStudentRows(gradeStudents, 1);
    const gradeSheet = XLSX.utils.json_to_sheet(formatted.rows);
    gradeSheet["!views"] = [{ RTL: true }];

    // Excel worksheet names have a max 31 character limit
    const safeSheetName = grade.length > 30 ? grade.slice(0, 30) : grade;
    XLSX.utils.book_append_sheet(workbook, gradeSheet, safeSheetName);
  });

  const finalFileName =
    fileName ||
    `كشف_الاشتراكات_وغير_الدافعين_${selectedMonth}_${
      filterGrade !== "ALL" ? filterGrade : "كافة_الصفوف"
    }`;

  XLSX.writeFile(workbook, `${finalFileName}.xlsx`);
}

export function exportStudentsToExcel(students: Student[], fileName = `قائمة_الطلاب_${getTodayKey()}`): void {
  const rows = students.map((s, index) => ({
    "م": index + 1,
    "كود الباركود": s.barcode,
    "اسم الطالب": s.name,
    "الصف الدراسي": s.groupGrade,
    "أيام المجموعة": s.groupDays,
    "رقم تليفون الطالب": s.phone,
    "رقم ولي الأمر": s.parentPhone,
    "الاشتراك الشهري (ج.م)": s.customMonthlyFee ?? "السعر الافتراضي",
    "سبب الخصم / الملاحظات": s.discountReason || "-",
    "إجمالي النقاط ⭐": s.points || 0,
    "نسبة الحضور": `${getAttendanceRate(s)}%`,
    "نسبة الغياب": `${getAbsenceRate(s)}%`,
    "متوسط درجات الامتحانات": `${getExamAverage(s)}%`,
    "آخر امتحان مسجل": s.lastExamTitle ? `${s.lastExamTitle} (${s.lastExamScore})` : "لا يوجد",
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  
  // RTL setting for Arabic sheet
  worksheet["!views"] = [{ RTL: true }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "الطلاب");

  XLSX.writeFile(workbook, `${fileName}.xlsx`);
}

export function exportAllExamsToExcel(students: Student[], fileName = `سجل_الدرجات_التراكمي_${getTodayKey()}`): void {
  const rows = students.map((s, index) => ({
    "م": index + 1,
    "كود الباركود": s.barcode,
    "اسم الطالب": s.name,
    "الصف الدراسي": s.groupGrade,
    "أيام المجموعة": s.groupDays,
    "آخر امتحان": s.lastExamTitle || "لا يوجد",
    "النتيجة / الدرجة": s.lastExamScore || "لا يوجد",
    "متوسط كافة الامتحانات": `${getExamAverage(s)}%`,
    "عدد الامتحانات المؤداة": s.totalExamScores?.length || 0,
    "النقاط ⭐": s.points || 0,
    "رقم ولي الأمر": s.parentPhone,
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!views"] = [{ RTL: true }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "الدرجات");

  XLSX.writeFile(workbook, `${fileName}.xlsx`);
}

export function exportAttendanceHistoryToExcel(
  students: Student[],
  attendanceMap: Record<string, string>,
  selectedDate: string,
  fileName = `سجل_حضور_${selectedDate}`
): void {
  const rows = students.map((s, index) => ({
    "م": index + 1,
    "كود الباركود": s.barcode,
    "اسم الطالب": s.name,
    "الصف الدراسي": s.groupGrade,
    "أيام المجموعة": s.groupDays,
    [`الحالة بتاريخ ${selectedDate}`]: attendanceMap[s.barcode] || "لم يسجل",
    "رقم ولي الأمر": s.parentPhone,
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!views"] = [{ RTL: true }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "الحضور والغياب");

  XLSX.writeFile(workbook, `${fileName}.xlsx`);
}

export function parseStudentsFromExcelFile(file: File): Promise<{ students: Partial<Student>[]; errors: string[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });

        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          throw new Error("ملف الإكسيل فارغ ولا يحتوي على أي أوراق عمل (Sheets).");
        }

        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        if (!worksheet) {
          throw new Error("ورقة العمل المحددة في ملف الإكسيل تالفة أو غير مقروءة.");
        }

        const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);
        if (!jsonData || jsonData.length === 0) {
          throw new Error("ورقة العمل لا تحتوي على أي صفوف أو بيانات طلاب للاستيراد.");
        }

        const parsedStudents: Partial<Student>[] = [];
        const errors: string[] = [];

        jsonData.forEach((row, idx) => {
          // Flexible header mapping (Arabic or English)
          const barcode = String(row["كود الباركود"] || row["الباركود"] || row["Barcode"] || row["كود"] || row["ID"] || "").trim();
          const name = String(row["اسم الطالب"] || row["الاسم"] || row["Name"] || row["Student Name"] || "").trim();
          const phone = String(row["رقم تليفون الطالب"] || row["تليفون الطالب"] || row["Phone"] || row["موبايل"] || "").trim();
          const parentPhone = String(row["رقم ولي الأمر"] || row["تليفون ولي الأمر"] || row["Parent Phone"] || row["ولي الأمر"] || "").trim();
          const groupGrade = String(row["الصف الدراسي"] || row["الصف"] || row["المرحلة"] || row["Grade"] || "الصف الرابع الابتدائي").trim() as GradeName;
          const groupDays = String(row["أيام المجموعة"] || row["الأيام"] || row["المجموعة"] || row["Days"] || "سبت - إثنين - أربعاء").trim() as GroupDays;
          
          const rawFee = row["الاشتراك الشهري"] || row["السعر"] || row["المبلغ"] || row["Fee"];
          const customMonthlyFee = rawFee !== undefined && rawFee !== "" && !isNaN(Number(rawFee)) ? Number(rawFee) : undefined;
          const discountReason = String(row["سبب الخصم"] || row["الملاحظات"] || row["Notes"] || "").trim();

          if (!barcode || !name) {
            errors.push(`السطر ${idx + 2}: مفقود الباركود أو اسم الطالب.`);
            return;
          }

          parsedStudents.push({
            barcode,
            name,
            phone: phone || parentPhone,
            parentPhone: parentPhone || phone,
            groupGrade: groupGrade || "الصف الرابع الابتدائي",
            groupDays: groupDays || "سبت - إثنين - أربعاء",
            customMonthlyFee,
            discountReason: discountReason || undefined,
            points: 0,
            totalAttendanceDays: 0,
            totalAbsentDays: 0,
            totalExamScores: [],
          });
        });

        resolve({ students: parsedStudents, errors });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}
