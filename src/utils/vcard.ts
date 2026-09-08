import { Student, GradeName } from "../types";
import { cleanPhoneNumber, TEACHER_NAME } from "./helpers";
import * as XLSX from "xlsx";

/**
 * Generate RFC 2426 vCard 3.0 string for all students in a grade.
 * When imported into a phone (Android / iOS / Google Contacts),
 * all parents and students will be saved to the phone's address book
 * with descriptive names for organized academic management and calling.
 */
export function generateGradeVCard(students: Student[], gradeName: GradeName | string): string {
  const vcardEntries: string[] = [];
  const cleanGrade = gradeName.replace("الصف ", "");

  students.forEach((student) => {
    // 1. Parent contact
    const rawParentPhone = student.parentPhone || student.phone;
    const parentPhone = cleanPhoneNumber(rawParentPhone);

    if (parentPhone) {
      const parentContactName = `ولي أمر ${student.name} (${cleanGrade})`;
      vcardEntries.push(
        [
          "BEGIN:VCARD",
          "VERSION:3.0",
          `FN;CHARSET=UTF-8:${parentContactName}`,
          `N;CHARSET=UTF-8:;${parentContactName};;;`,
          `TEL;TYPE=CELL,VOICE:+${parentPhone}`,
          `NOTE;CHARSET=UTF-8:طالب: ${student.name} | الصف: ${student.groupGrade} | المجموعة: ${student.groupDays} | باركود: ${student.barcode} | ${TEACHER_NAME}`,
          "END:VCARD",
        ].join("\r\n")
      );
    }

    // 2. Student contact (if distinct personal phone exists)
    const rawStudentPhone = student.phone;
    const studentPhone = cleanPhoneNumber(rawStudentPhone);

    if (studentPhone && studentPhone !== parentPhone) {
      const studentContactName = `طالب: ${student.name} (${cleanGrade})`;
      vcardEntries.push(
        [
          "BEGIN:VCARD",
          "VERSION:3.0",
          `FN;CHARSET=UTF-8:${studentContactName}`,
          `N;CHARSET=UTF-8:;${studentContactName};;;`,
          `TEL;TYPE=CELL,VOICE:+${studentPhone}`,
          `NOTE;CHARSET=UTF-8:طالب: ${student.name} | ${student.groupGrade} - ${student.groupDays} | ${TEACHER_NAME}`,
          "END:VCARD",
        ].join("\r\n")
      );
    }
  });

  return vcardEntries.join("\r\n");
}

/**
 * Trigger immediate browser download of the vCard file (.vcf)
 */
export function downloadVCardFile(vcardContent: string, fileName: string): void {
  const blob = new Blob([vcardContent], { type: "text/vcard;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const safeName = fileName.endsWith(".vcf") ? fileName : `${fileName}.vcf`;
  link.setAttribute("download", safeName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Extract phone numbers as clean text (comma-separated or lines)
 */
export function extractPhoneNumbersList(
  students: Student[],
  type: "parents" | "students" | "both" = "parents",
  separator: "\n" | ", " = "\n"
): { numbers: string[]; text: string } {
  const seen = new Set<string>();
  const list: string[] = [];

  students.forEach((s) => {
    if (type === "parents" || type === "both") {
      const p = cleanPhoneNumber(s.parentPhone || s.phone);
      if (p && !seen.has(p)) {
        seen.add(p);
        list.push(`+${p}`);
      }
    }
    if (type === "students" || type === "both") {
      const p = cleanPhoneNumber(s.phone);
      if (p && !seen.has(p)) {
        seen.add(p);
        list.push(`+${p}`);
      }
    }
  });

  return {
    numbers: list,
    text: list.join(separator),
  };
}

/**
 * Export Grade Contacts to Excel
 */
export function exportGradeContactsExcel(students: Student[], gradeName: string): void {
  const rows = students.map((s, idx) => ({
    "م": idx + 1,
    "كود الطالب": s.barcode,
    "اسم الطالب": s.name,
    "الصف الدراسي": s.groupGrade,
    "مجموعة الأيام": s.groupDays,
    "هاتف ولي الأمر": s.parentPhone || "-",
    "هاتف الطالب الشخصي": s.phone || "-",
    "ملاحظات": s.notes || "-",
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "أرقام التواصل");
  const safeGrade = gradeName.replace(/[\s/\\?*:[\]]/g, "_");
  XLSX.writeFile(workbook, `أرقام_وتواصل_${safeGrade}.xlsx`);
}
