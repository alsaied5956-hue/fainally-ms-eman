import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { Student, PaymentRecord } from "../types";
import { ParentAccount } from "../types/portal";
import { supabase } from "../utils/supabaseClient";

export interface ChildBatchedData {
  student: Student;
  attendanceHistory?: Record<string, string>;
  paymentRecords?: PaymentRecord[];
  totalPoints?: number;
  lastExamScore?: string;
  lastExamTitle?: string;
}

interface ParentChildContextType {
  account: ParentAccount | null;
  activeBarcode: string;
  activeStudent: Student;
  allChildren: Student[];
  linkedBarcodes: string[];
  isLoadingBatch: boolean;
  switchChild: (barcode: string) => void;
  updateActiveStudentData: (updater: (prev: Student) => Student) => void;
  reloadChildrenBatch: () => Promise<void>;
}

const ParentChildContext = createContext<ParentChildContextType | null>(null);

export interface ParentChildProviderProps {
  children: ReactNode;
  account: ParentAccount | null;
  initialStudent: Student;
  allSystemStudents?: Student[];
}

export const ParentChildProvider: React.FC<ParentChildProviderProps> = ({
  children,
  account,
  initialStudent,
  allSystemStudents = [],
}) => {
  const [activeBarcode, setActiveBarcode] = useState<string>(
    initialStudent.barcode || account?.studentBarcode || ""
  );

  // In-memory cache of all linked students to guarantee 0ms switching with zero extra API reads
  const [childrenMap, setChildrenMap] = useState<Record<string, Student>>(() => {
    const map: Record<string, Student> = {};
    if (initialStudent?.barcode) {
      map[initialStudent.barcode] = initialStudent;
    }
    return map;
  });

  const [isLoadingBatch, setIsLoadingBatch] = useState<boolean>(false);

  // All linked barcodes for this parent account
  const linkedBarcodes = useMemo<string[]>(() => {
    if (!account) return [initialStudent.barcode].filter(Boolean);
    const set = new Set<string>();
    if (account.studentBarcode) set.add(account.studentBarcode);
    if (account.linkedBarcodes && Array.isArray(account.linkedBarcodes)) {
      account.linkedBarcodes.forEach((b) => b && set.add(b));
    }
    if (initialStudent?.barcode) set.add(initialStudent.barcode);
    return Array.from(set);
  }, [account, initialStudent.barcode]);

  // Single Batched Fetch from Supabase (Free-Tier Optimization)
  const reloadChildrenBatch = useCallback(async () => {
    if (!linkedBarcodes || linkedBarcodes.length === 0) return;

    setIsLoadingBatch(true);
    try {
      // 1. Resolve any locally available system students first (0ms latency)
      const newMap: Record<string, Student> = { ...childrenMap };
      if (initialStudent?.barcode) {
        newMap[initialStudent.barcode] = initialStudent;
      }

      allSystemStudents.forEach((st) => {
        if (st && linkedBarcodes.includes(st.barcode)) {
          newMap[st.barcode] = { ...st };
        }
      });

      // 2. Single batched query to Supabase `students` table
      const barcodesToQuery = linkedBarcodes.filter(Boolean);
      if (barcodesToQuery.length > 0) {
        const { data: supaStudents, error } = await supabase
          .from("students")
          .select("*")
          .in("barcode", barcodesToQuery);

        if (!error && supaStudents && supaStudents.length > 0) {
          supaStudents.forEach((row: any) => {
            const b = String(row.barcode);
            newMap[b] = {
              barcode: b,
              name: row.name || `طالب (${b})`,
              phone: row.phone || "",
              parentPhone: row.parent_phone || row.parentPhone || "",
              groupGrade: row.grade || row.groupGrade || "الصف الرابع الابتدائي",
              groupDays: row.group_days || row.groupDays || "سبت - إثنين - أربعاء",
              points: row.points || 0,
              totalAttendanceDays: row.total_attendance_days || 0,
              totalAbsentDays: row.total_absent_days || 0,
              totalExamScores: row.exam_scores || [],
              notes: row.notes || "",
              customMonthlyFee: row.custom_monthly_fee,
              lastExamScore: row.last_exam_score,
              lastExamTitle: row.last_exam_title,
              createdAt: row.created_at,
            };
          });
        }
      }

      setChildrenMap(newMap);
    } catch (err) {
      console.warn("[ParentChildContext] Batched load notice:", err);
    } finally {
      setIsLoadingBatch(false);
    }
  }, [linkedBarcodes, allSystemStudents, initialStudent]);

  // Load once upon authentication
  useEffect(() => {
    reloadChildrenBatch();
  }, [reloadChildrenBatch]);

  // Update activeBarcode if initialStudent changes
  useEffect(() => {
    if (initialStudent?.barcode && !childrenMap[initialStudent.barcode]) {
      setChildrenMap((prev) => ({ ...prev, [initialStudent.barcode]: initialStudent }));
    }
  }, [initialStudent, childrenMap]);

  // Active student object (computed instantly from in-memory map)
  const activeStudent = useMemo<Student>(() => {
    if (childrenMap[activeBarcode]) {
      return childrenMap[activeBarcode];
    }
    return initialStudent;
  }, [childrenMap, activeBarcode, initialStudent]);

  // All linked children array
  const allChildren = useMemo<Student[]>(() => {
    return linkedBarcodes.map((b) => {
      return (
        childrenMap[b] || {
          barcode: b,
          name: `طالب (${b})`,
          phone: "",
          parentPhone: account?.parentPhone || "",
          groupGrade: "الصف الرابع الابتدائي",
          groupDays: "سبت - إثنين - أربعاء",
          points: 0,
          totalAttendanceDays: 0,
          totalAbsentDays: 0,
          totalExamScores: [],
        }
      );
    });
  }, [linkedBarcodes, childrenMap, account?.parentPhone]);

  // Ultra-Fast 0ms In-Memory Child Switching (Zero duplicate network calls)
  const switchChild = useCallback((barcode: string) => {
    const clean = String(barcode).trim();
    if (!clean) return;
    setActiveBarcode(clean);
  }, []);

  const updateActiveStudentData = useCallback(
    (updater: (prev: Student) => Student) => {
      setChildrenMap((prev) => {
        const current = prev[activeBarcode] || activeStudent;
        const updated = updater(current);
        return {
          ...prev,
          [activeBarcode]: updated,
        };
      });
    },
    [activeBarcode, activeStudent]
  );

  const value = useMemo<ParentChildContextType>(
    () => ({
      account,
      activeBarcode,
      activeStudent,
      allChildren,
      linkedBarcodes,
      isLoadingBatch,
      switchChild,
      updateActiveStudentData,
      reloadChildrenBatch,
    }),
    [
      account,
      activeBarcode,
      activeStudent,
      allChildren,
      linkedBarcodes,
      isLoadingBatch,
      switchChild,
      updateActiveStudentData,
      reloadChildrenBatch,
    ]
  );

  return (
    <ParentChildContext.Provider value={value}>
      {children}
    </ParentChildContext.Provider>
  );
};

export function useParentChild(): ParentChildContextType {
  const context = useContext(ParentChildContext);
  if (!context) {
    throw new Error("useParentChild must be used within a ParentChildProvider");
  }
  return context;
}
