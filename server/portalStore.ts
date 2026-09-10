import fs from "fs";
import path from "path";
import type { Response } from "express";

export interface StudentRecord {
  barcode: string;
  name: string;
  phone: string;
  parentPhone: string;
  groupGrade: string;
  groupDays: string;
  points?: number;
  totalAttendanceDays?: number;
  totalAbsentDays?: number;
  totalExamScores?: number[];
  createdAt?: string;
  notes?: string;
  lastExamTitle?: string;
  lastExamScore?: string;
  [key: string]: any;
}

export interface SystemDataCache {
  students: StudentRecord[];
  attendanceHistory: Record<string, Record<string, string>>;
  attendanceToday: Record<string, string>;
  scanLogTimes: Record<string, string>;
  scanLogOrder: string[];
  payments: Record<string, Record<string, any>>;
  groupPrices: Record<string, number>;
  usersList: any[];
  platformMessages: any[];
  pendingWhatsAppMessages: any[];
  gradeWhatsAppLinks: Record<string, string>;
  activeSessionSlotId?: string;
  version: number;
  lastUpdated: number;
}

export interface ParentAccountRecord {
  studentBarcode: string;
  studentName?: string;
  linkedBarcodes?: string[];
  parentPhone: string;
  password: string;
  status: "active" | "disabled" | "deleted";
  reason?: string;
  createdAt?: string;
  activatedAt?: string;
  updatedAt?: string;
  lastLoginAt?: string;
}

// In-Memory Storage
let systemDataCache: SystemDataCache = {
  students: [],
  attendanceHistory: {},
  attendanceToday: {},
  scanLogTimes: {},
  scanLogOrder: [],
  payments: {},
  groupPrices: {},
  usersList: [],
  platformMessages: [],
  pendingWhatsAppMessages: [],
  gradeWhatsAppLinks: {},
  version: 1,
  lastUpdated: Date.now(),
};

let parentAccountsCache: Record<string, ParentAccountRecord> = {};

const STORE_PATH = path.join(process.cwd(), ".system_data_store.json");
const ACCOUNTS_PATH = path.join(process.cwd(), ".parent_accounts_store.json");
const BACKUP_PATH = path.join(process.cwd(), "src/data/centerBackup.json");

function normalizePhone(val?: string | null): string {
  if (!val) return "";
  const cleaned = String(val).replace(/\D/g, "");
  if (cleaned.startsWith("20") && cleaned.length > 10) {
    return "0" + cleaned.slice(2);
  }
  return cleaned;
}

export function getTodayKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Load baseline & disk cache on module load
export function initPortalStore(): void {
  try {
    // 1. Load guaranteed original center backup (728 students, actual Egyptian data)
    if (fs.existsSync(BACKUP_PATH)) {
      const backupRaw = fs.readFileSync(BACKUP_PATH, "utf8");
      const backupJson = JSON.parse(backupRaw);

      systemDataCache.students = Array.isArray(backupJson.students) ? backupJson.students : [];
      systemDataCache.attendanceHistory = backupJson.attendanceHistory || {};
      systemDataCache.attendanceToday = backupJson.attendanceToday || {};
      systemDataCache.scanLogTimes = backupJson.scanLogTimes || {};
      systemDataCache.scanLogOrder = Array.isArray(backupJson.scanLogOrder) ? backupJson.scanLogOrder : [];
      systemDataCache.payments = backupJson.payments || {};
      systemDataCache.groupPrices = backupJson.groupPrices || {};
      systemDataCache.usersList = Array.isArray(backupJson.usersList) ? backupJson.usersList : [];
      systemDataCache.platformMessages = Array.isArray(backupJson.platformMessages) ? backupJson.platformMessages : [];
      systemDataCache.gradeWhatsAppLinks = backupJson.gradeWhatsAppLinks || {};
      systemDataCache.activeSessionSlotId = backupJson.activeSessionSlotId || "";

      console.log(`[PortalStore] Initialized baseline with ${systemDataCache.students.length} students from center backup.`);
    }

    // 2. Overlay disk store if existing
    if (fs.existsSync(STORE_PATH)) {
      try {
        const storeRaw = fs.readFileSync(STORE_PATH, "utf8");
        const storeJson = JSON.parse(storeRaw);
        if (storeJson && typeof storeJson === "object") {
          if (Array.isArray(storeJson.students) && storeJson.students.length > 0) {
            // Merge students keeping disk additions and edits
            const map = new Map<string, StudentRecord>();
            systemDataCache.students.forEach((s) => map.set(String(s.barcode).trim(), s));
            storeJson.students.forEach((s: StudentRecord) => {
              if (s && s.barcode) map.set(String(s.barcode).trim(), s);
            });
            systemDataCache.students = Array.from(map.values());
          }
          if (storeJson.attendanceHistory) {
            systemDataCache.attendanceHistory = { ...systemDataCache.attendanceHistory, ...storeJson.attendanceHistory };
          }
          if (storeJson.attendanceToday) {
            systemDataCache.attendanceToday = { ...systemDataCache.attendanceToday, ...storeJson.attendanceToday };
          }
          if (storeJson.scanLogTimes) {
            systemDataCache.scanLogTimes = { ...systemDataCache.scanLogTimes, ...storeJson.scanLogTimes };
          }
          if (Array.isArray(storeJson.scanLogOrder)) {
            systemDataCache.scanLogOrder = storeJson.scanLogOrder;
          }
          if (storeJson.payments) {
            systemDataCache.payments = { ...systemDataCache.payments, ...storeJson.payments };
          }
          if (storeJson.groupPrices) {
            systemDataCache.groupPrices = { ...systemDataCache.groupPrices, ...storeJson.groupPrices };
          }
          if (storeJson.version) {
            systemDataCache.version = Math.max(systemDataCache.version, storeJson.version);
          }
          console.log(`[PortalStore] Merged live disk store. Active students: ${systemDataCache.students.length}`);
        }
      } catch (err) {
        console.warn("[PortalStore] Error parsing .system_data_store.json:", err);
      }
    }

    // 3. Load Parent Accounts
    if (fs.existsSync(ACCOUNTS_PATH)) {
      try {
        const accRaw = fs.readFileSync(ACCOUNTS_PATH, "utf8");
        parentAccountsCache = JSON.parse(accRaw) || {};
        console.log(`[PortalStore] Loaded ${Object.keys(parentAccountsCache).length} parent accounts.`);
      } catch {}
    }
  } catch (err) {
    console.error("[PortalStore] Init error:", err);
  }
}

// Debounced Disk Persistence
let saveTimeout: NodeJS.Timeout | null = null;
export function persistStoreDebounced(): void {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    try {
      fs.writeFileSync(STORE_PATH, JSON.stringify(systemDataCache), "utf8");
    } catch (e) {
      console.warn("[PortalStore] Failed saving .system_data_store.json:", e);
    }
  }, 1000);
}

let saveAccountsTimeout: NodeJS.Timeout | null = null;
export function persistAccountsDebounced(): void {
  if (saveAccountsTimeout) clearTimeout(saveAccountsTimeout);
  saveAccountsTimeout = setTimeout(() => {
    saveAccountsTimeout = null;
    try {
      fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(parentAccountsCache), "utf8");
    } catch (e) {
      console.warn("[PortalStore] Failed saving .parent_accounts_store.json:", e);
    }
  }, 1000);
}

// SSE Live Stream Clients
interface PortalClient {
  id: string;
  res: Response;
  barcode?: string;
  aliases: string[];
  connectedAt: number;
}

const activeClients = new Map<string, PortalClient>();

export function registerPortalSSEClient(id: string, res: Response, barcode?: string, aliases: string[] = []): void {
  const normBarcode = barcode ? barcode.trim() : undefined;
  const normAliases = aliases.map((a) => String(a).trim()).filter(Boolean);

  activeClients.set(id, {
    id,
    res,
    barcode: normBarcode,
    aliases: normAliases,
    connectedAt: Date.now(),
  });

  // Initial handshake
  res.write(`data: ${JSON.stringify({ type: "connected", clientId: id, timestamp: Date.now() })}\n\n`);
}

export function unregisterPortalSSEClient(id: string): void {
  activeClients.delete(id);
}

export function broadcastPortalSSE(event: { type: string; barcode?: string; [key: string]: any }): void {
  const targetBarcode = event.barcode ? String(event.barcode).trim() : null;
  const payload = `data: ${JSON.stringify({ ...event, timestamp: Date.now() })}\n\n`;

  activeClients.forEach((client, id) => {
    try {
      // If event has no target barcode, broadcast to everyone
      // If event has barcode, match client.barcode or any linked alias
      if (
        !targetBarcode ||
        !client.barcode ||
        client.barcode === targetBarcode ||
        client.aliases.includes(targetBarcode)
      ) {
        client.res.write(payload);
      }
    } catch {
      activeClients.delete(id);
    }
  });
}

// Keepalive Ping every 20s
setInterval(() => {
  activeClients.forEach((client, id) => {
    try {
      client.res.write(`: ping\n\n`);
    } catch {
      activeClients.delete(id);
    }
  });
}, 20000);

// Core Data Accessors
export function getSystemCache(): SystemDataCache {
  return systemDataCache;
}

export function getSystemETag(): string {
  return `W/"${systemDataCache.version}-${systemDataCache.lastUpdated}-${systemDataCache.students.length}"`;
}

export function recordLiveScan(data: {
  barcode: string;
  status: "حضور" | "تأخير" | "غائب";
  timeIso?: string;
  timeDisplay?: string;
  studentName?: string;
  grade?: string;
  days?: string;
  scannedBy?: string;
}): { success: boolean; student?: StudentRecord; scanInfo: any } {
  const barcode = String(data.barcode).trim();
  const todayKey = getTodayKey();
  const timeIso = data.timeIso || new Date().toISOString();
  const timeDisplay = data.timeDisplay || new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });

  // 1. Update in-memory state
  systemDataCache.attendanceToday[barcode] = data.status;
  systemDataCache.scanLogTimes[barcode] = timeIso;

  if (!systemDataCache.attendanceHistory[todayKey]) {
    systemDataCache.attendanceHistory[todayKey] = {};
  }
  systemDataCache.attendanceHistory[todayKey][barcode] = data.status;

  // Add to scan order (dedup)
  const existingOrderIndex = systemDataCache.scanLogOrder.indexOf(barcode);
  if (existingOrderIndex !== -1) {
    systemDataCache.scanLogOrder.splice(existingOrderIndex, 1);
  }
  systemDataCache.scanLogOrder.unshift(barcode);

  // Find student to update points/stats
  const student = systemDataCache.students.find((s) => String(s.barcode).trim() === barcode);
  if (student) {
    if (data.status === "حضور") {
      student.totalAttendanceDays = (student.totalAttendanceDays || 0) + 1;
      student.points = (student.points || 0) + 5;
    } else if (data.status === "تأخير") {
      student.totalAttendanceDays = (student.totalAttendanceDays || 0) + 1;
      student.points = (student.points || 0) + 2;
    } else if (data.status === "غائب") {
      student.totalAbsentDays = (student.totalAbsentDays || 0) + 1;
    }
  }

  systemDataCache.version++;
  systemDataCache.lastUpdated = Date.now();

  // 2. Persist to disk
  persistStoreDebounced();

  // 3. Broadcast instant SSE to all open parent & teacher windows
  broadcastPortalSSE({
    type: "scan",
    barcode,
    status: data.status,
    timeIso,
    timeDisplay,
    studentName: student?.name || data.studentName || "الطالب",
    grade: student?.groupGrade || data.grade,
    days: student?.groupDays || data.days,
    scannedBy: data.scannedBy || "الماسح",
    timestamp: Date.now(),
  });

  return {
    success: true,
    student,
    scanInfo: {
      barcode,
      status: data.status,
      timeIso,
      timeDisplay,
    },
  };
}

export function getStudentPortalData(query: string): {
  success: boolean;
  student?: StudentRecord;
  todayAttendance?: string | null;
  todayScanTime?: string | null;
  attendanceHistory?: Record<string, string>;
  payments?: Record<string, any>;
  groupPrices?: Record<string, number>;
  examScores?: number[];
  unreadNotices?: any[];
  account?: ParentAccountRecord | null;
  message?: string;
  systemTime: string;
} {
  const clean = query.trim();
  const cleanPhone = normalizePhone(clean);
  const todayKey = getTodayKey();

  // Search by exact barcode first, then numeric barcode, then parent phone or student phone
  const student = systemDataCache.students.find((s) => {
    const b = String(s.barcode).trim();
    if (b === clean) return true;
    if (!isNaN(Number(clean)) && Number(b) === Number(clean)) return true;
    if (cleanPhone) {
      if (normalizePhone(s.parentPhone) === cleanPhone) return true;
      if (normalizePhone(s.phone) === cleanPhone) return true;
    }
    return false;
  });

  if (!student) {
    return {
      success: false,
      message: "لم يتم العثور على طالب بهذا الكود أو رقم الهاتف",
      systemTime: new Date().toISOString(),
    };
  }

  const bCode = String(student.barcode).trim();

  // Collect student-specific attendance history
  const studentHistory: Record<string, string> = {};
  for (const [date, rec] of Object.entries(systemDataCache.attendanceHistory || {})) {
    if (rec && rec[bCode]) {
      studentHistory[date] = rec[bCode];
    }
  }

  // Collect student-specific payments
  const studentPayments: Record<string, any> = {};
  for (const [mKey, pMap] of Object.entries(systemDataCache.payments || {})) {
    if (pMap && pMap[bCode]) {
      studentPayments[mKey] = pMap[bCode];
    }
  }

  // Today status
  const todayAttendance =
    systemDataCache.attendanceToday[bCode] ||
    systemDataCache.attendanceHistory[todayKey]?.[bCode] ||
    null;

  const todayScanTime = systemDataCache.scanLogTimes[bCode] || null;

  // Filter notices for this student or grade
  const unreadNotices = (systemDataCache.platformMessages || []).filter((msg) => {
    if (!msg) return false;
    if (msg.studentBarcode && String(msg.studentBarcode).trim() === bCode) return true;
    if (msg.grade && student.groupGrade && msg.grade === student.groupGrade) return true;
    if (msg.target === "all" || msg.target === "all_parents") return true;
    return false;
  });

  // Find account if registered
  const account = parentAccountsCache[bCode] || null;

  return {
    success: true,
    student,
    todayAttendance,
    todayScanTime,
    attendanceHistory: studentHistory,
    payments: studentPayments,
    groupPrices: systemDataCache.groupPrices,
    examScores: student.totalExamScores || [],
    unreadNotices,
    account,
    systemTime: new Date().toISOString(),
  };
}

export function updateSystemDataPartial(updates: Partial<SystemDataCache>): void {
  if (Array.isArray(updates.students)) {
    systemDataCache.students = updates.students;
  }
  if (updates.attendanceHistory) {
    systemDataCache.attendanceHistory = { ...systemDataCache.attendanceHistory, ...updates.attendanceHistory };
  }
  if (updates.attendanceToday) {
    systemDataCache.attendanceToday = { ...systemDataCache.attendanceToday, ...updates.attendanceToday };
  }
  if (updates.scanLogTimes) {
    systemDataCache.scanLogTimes = { ...systemDataCache.scanLogTimes, ...updates.scanLogTimes };
  }
  if (Array.isArray(updates.scanLogOrder)) {
    systemDataCache.scanLogOrder = updates.scanLogOrder;
  }
  if (updates.payments) {
    systemDataCache.payments = { ...systemDataCache.payments, ...updates.payments };
  }
  if (updates.groupPrices) {
    systemDataCache.groupPrices = { ...systemDataCache.groupPrices, ...updates.groupPrices };
  }
  if (Array.isArray(updates.usersList)) {
    systemDataCache.usersList = updates.usersList;
  }
  if (Array.isArray(updates.platformMessages)) {
    systemDataCache.platformMessages = updates.platformMessages;
  }
  if (updates.activeSessionSlotId !== undefined) {
    systemDataCache.activeSessionSlotId = updates.activeSessionSlotId;
  }

  systemDataCache.version++;
  systemDataCache.lastUpdated = Date.now();
  persistStoreDebounced();
}

// Parent Accounts Operations
export function getAllParentAccounts(): Record<string, ParentAccountRecord> {
  return parentAccountsCache;
}

export function saveParentAccountRecord(account: ParentAccountRecord): ParentAccountRecord {
  const bCode = String(account.studentBarcode).trim();
  const nowIso = new Date().toISOString();

  const existing = parentAccountsCache[bCode];
  const updated: ParentAccountRecord = {
    ...existing,
    ...account,
    studentBarcode: bCode,
    updatedAt: nowIso,
    activatedAt: existing?.activatedAt || account.activatedAt || nowIso,
  };

  parentAccountsCache[bCode] = updated;
  persistAccountsDebounced();

  // Broadcast account state change
  broadcastPortalSSE({
    type: "account_status_changed",
    barcode: bCode,
    status: updated.status,
    account: updated,
    timestamp: Date.now(),
  });

  return updated;
}

// Initialize immediately on file load
initPortalStore();
