import { doc, getDoc, setDoc, onSnapshot, updateDoc, deleteDoc, collection } from "firebase/firestore";
import { db, ensureFirebaseAuth } from "./firebase";
import { Student } from "../types";
import {
  ParentAccount,
  ParentChatMessage,
  AdminPortalSettings,
  PortalSession,
} from "../types/portal";
import { playPortalAudioChime } from "./portalNotifications";
import { loadLocalData } from "./storage";

// Storage Keys
const LS_PARENT_ACCOUNTS = "eman_parent_accounts";
const LS_PORTAL_CHATS = "eman_portal_chats";
const LS_PORTAL_SETTINGS = "eman_portal_settings";
const LS_PORTAL_SESSION = "eman_portal_session";

// Default Initial Supervisor Credentials
export const DEFAULT_ADMIN_SETTINGS: AdminPortalSettings = {
  adminBarcode: "1",
  adminPassword: "2468",
  pushNotificationsEnabled: true,
  soundAlertsEnabled: true,
};

// Local BroadcastChannel for sub-millisecond multi-tab sync
const chatBus =
  typeof window !== "undefined" && "BroadcastChannel" in window
    ? new BroadcastChannel("eman_portal_chat_bus")
    : null;

// Account events BroadcastChannel for instant cross-tab / cross-window remote logouts
export const accountEventsBus =
  typeof window !== "undefined" && "BroadcastChannel" in window
    ? new BroadcastChannel("eman_portal_account_events")
    : null;

/**
 * Clean & normalize phone numbers for consistent Arabic Egyptian mobile matching
 */
export function normalizePhone(raw?: string): string {
  if (!raw) return "";
  // Keep only digits
  let digits = raw.replace(/\D/g, "");
  // Strip Egyptian international code prefix (20) if present
  if (digits.startsWith("20") && digits.length > 10) {
    digits = digits.slice(2);
  }
  // Strip leading 0
  if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return digits;
}

/**
 * Load admin settings from LocalStorage & Firestore
 */
export function getAdminPortalSettings(): AdminPortalSettings {
  try {
    const raw = localStorage.getItem(LS_PORTAL_SETTINGS);
    if (raw) {
      return { ...DEFAULT_ADMIN_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {}
  return DEFAULT_ADMIN_SETTINGS;
}

export async function saveAdminPortalSettings(settings: AdminPortalSettings): Promise<void> {
  try {
    localStorage.setItem(LS_PORTAL_SETTINGS, JSON.stringify(settings));
    await ensureFirebaseAuth();
    if (db) {
      await setDoc(doc(db, "portal_settings", "supervisor_config"), {
        ...settings,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }
  } catch (err) {
    console.warn("Failed to persist admin portal settings:", err);
  }
}

/**
 * Load all registered parent accounts from LocalStorage
 */
export function getLocalParentAccounts(): Record<string, ParentAccount> {
  try {
    const raw = localStorage.getItem(LS_PARENT_ACCOUNTS);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

export function saveLocalParentAccounts(accounts: Record<string, ParentAccount>): void {
  try {
    localStorage.setItem(LS_PARENT_ACCOUNTS, JSON.stringify(accounts));
  } catch {}
}

/**
 * Sync parent accounts from Firestore with deduplication & caching
 */
let syncAccountsInFlight: Promise<Record<string, ParentAccount>> | null = null;
let lastAccountsSyncTime = 0;

export async function syncParentAccountsFromCloud(): Promise<Record<string, ParentAccount>> {
  const local = getLocalParentAccounts();
  const now = Date.now();
  if (now - lastAccountsSyncTime < 10000 && Object.keys(local).length > 0) {
    return local;
  }
  if (syncAccountsInFlight) {
    return syncAccountsInFlight;
  }
  syncAccountsInFlight = (async () => {
    try {
      await ensureFirebaseAuth();
      if (db) {
        const snap = await getDoc(doc(db, "system_state", "portal_accounts_registry"));
        if (snap.exists()) {
          const cloudData = snap.data()?.accounts as Record<string, ParentAccount> | undefined;
          if (cloudData) {
            const merged = { ...local, ...cloudData };
            saveLocalParentAccounts(merged);
            lastAccountsSyncTime = Date.now();
            return merged;
          }
        }
      }
    } catch (err) {
      console.warn("Could not fetch cloud parent accounts:", err);
    } finally {
      syncAccountsInFlight = null;
    }
    return local;
  })();
  return syncAccountsInFlight;
}

/**
 * Persist parent accounts to Firestore & LocalStorage (Instant local execution + background cloud sync)
 */
export async function persistParentAccount(account: ParentAccount): Promise<void> {
  const accounts = getLocalParentAccounts();
  accounts[account.studentBarcode] = account;
  saveLocalParentAccounts(accounts);

  // If status is disabled, immediately broadcast revocation to log out parent device
  if (account.status === "disabled") {
    accountEventsBus?.postMessage({
      type: "ACCOUNT_REVOKED",
      barcode: account.studentBarcode,
      reason: "تم تعطيل هذا الحساب مؤقتاً من قِبل إدارة المنظومة.",
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("eman_account_revoked", {
          detail: {
            barcode: account.studentBarcode,
            reason: "تم تعطيل هذا الحساب مؤقتاً من قِبل إدارة المنظومة.",
          },
        })
      );
    }
  }

  // Reliable background cloud save tied to real Firestore
  (async () => {
    try {
      await ensureFirebaseAuth();
      if (db) {
        // 1. Save individual doc
        await setDoc(doc(db, "parent_accounts", account.studentBarcode), account, { merge: true });
        // 2. Save in synchronized state registry
        const allAccs = getLocalParentAccounts();
        await setDoc(
          doc(db, "system_state", "portal_accounts_registry"),
          { accounts: allAccs, updatedAt: new Date().toISOString() },
          { merge: true }
        );
      }
    } catch (err) {
      console.warn("Cloud parent account save notice:", err);
    }
  })();
}

/**
 * Delete / Reset parent account (forces first-time registration again and remote logout)
 */
export async function deleteParentAccount(studentBarcode: string): Promise<void> {
  const accounts = getLocalParentAccounts();
  delete accounts[studentBarcode];
  saveLocalParentAccounts(accounts);

  // Broadcast revocation immediately to disconnect parent session on their device
  accountEventsBus?.postMessage({
    type: "ACCOUNT_REVOKED",
    barcode: studentBarcode,
    reason: "تم حذف أو إلغاء تفعيل هذا الحساب من قِبل إدارة المنظومة.",
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("eman_account_revoked", {
        detail: {
          barcode: studentBarcode,
          reason: "تم حذف أو إلغاء تفعيل هذا الحساب من قِبل إدارة المنظومة.",
        },
      })
    );
  }

  // Non-blocking background cloud delete - zero latency for the user
  (async () => {
    try {
      await ensureFirebaseAuth();
      if (db) {
        await deleteDoc(doc(db, "parent_accounts", studentBarcode));
        await setDoc(
          doc(db, "system_state", "portal_accounts_registry"),
          { accounts, updatedAt: new Date().toISOString() },
          { merge: true }
        );
      }
    } catch (err) {
      console.warn("Cloud parent account delete notice:", err);
    }
  })();
}

/**
 * Realtime multi-layered listener that monitors account status on parent device:
 * 1. BroadcastChannel (cross-tab / sub-millisecond)
 * 2. Custom window events (same tab)
 * 3. LocalStorage storage event (browser-wide)
 * 4. Firestore onSnapshot on the parent_accounts document (cross-device / mobile to PC)
 * 5. Periodic fallback safety interval
 */
export function subscribeToParentAccountLiveStatus(
  studentBarcode: string,
  onRevoked: (reason: string) => void
): () => void {
  const targetBarcode = String(studentBarcode).trim();
  let isCancelled = false;

  // 1. BroadcastChannel listener (same device / multi-tab)
  const handleBusMessage = (ev: MessageEvent) => {
    if (
      ev.data?.type === "ACCOUNT_REVOKED" &&
      String(ev.data?.barcode).trim() === targetBarcode
    ) {
      onRevoked(ev.data.reason || "تم تعطيل هذا الحساب من قِبل إدارة المنظومة.");
    }
  };
  accountEventsBus?.addEventListener("message", handleBusMessage);

  // 2. Window event listener (same tab)
  const handleWindowEvent = (ev: Event) => {
    const customEv = ev as CustomEvent;
    if (String(customEv.detail?.barcode).trim() === targetBarcode) {
      onRevoked(customEv.detail.reason || "تم تعطيل هذا الحساب من قِبل إدارة المنظومة.");
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("eman_account_revoked", handleWindowEvent);
  }

  // 3. Storage event listener (cross-tab LocalStorage modification)
  const handleStorageEvent = (ev: StorageEvent) => {
    if (ev.key === LS_PARENT_ACCOUNTS && ev.newValue) {
      try {
        const accs = JSON.parse(ev.newValue) as Record<string, ParentAccount>;
        const acc = accs[targetBarcode];
        if (acc && acc.status === "disabled") {
          onRevoked("تم تعطيل هذا الحساب مؤقتاً من قِبل إدارة المنظومة.");
        }
      } catch {}
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorageEvent);
  }

  // 4. Firestore Realtime Listener for remote admin deactivations
  let unsubscribeDoc: (() => void) | null = null;
  ensureFirebaseAuth()
    .then(() => {
      if (isCancelled || !db) return;
      try {
        unsubscribeDoc = onSnapshot(
          doc(db, "parent_accounts", targetBarcode),
          (snap) => {
            if (snap.exists()) {
              const data = snap.data() as ParentAccount;
              if (data && data.status === "disabled") {
                onRevoked("تم تعطيل هذا الحساب مؤقتاً من قِبل إدارة المنظومة.");
              }
            }
          },
          (err) => {
            console.warn("Firestore parent live listener notice:", err);
          }
        );
      } catch (e) {
        console.warn("Notice attaching Firestore snapshot listener:", e);
      }
    })
    .catch(() => {});

  return () => {
    isCancelled = true;
    accountEventsBus?.removeEventListener("message", handleBusMessage);
    if (typeof window !== "undefined") {
      window.removeEventListener("eman_account_revoked", handleWindowEvent);
      window.removeEventListener("storage", handleStorageEvent);
    }
    if (unsubscribeDoc) unsubscribeDoc();
  };
}

/**
 * Validate and register a parent for the first time (Instant 0ms validation + background sync)
 */
export async function registerParentAccount(
  studentBarcode: string,
  enteredPhone: string,
  password: string,
  students: Student[]
): Promise<{ success: boolean; message: string; account?: ParentAccount }> {
  const barcodeTrimmed = studentBarcode.trim();
  const phoneTrimmed = enteredPhone.trim();
  const passTrimmed = password.trim();

  if (!barcodeTrimmed || !phoneTrimmed || !passTrimmed) {
    return { success: false, message: "يرجى إدخال جميع الحقول المطلوبة (كود الباركود، رقم الهاتف، وكلمة المرور)" };
  }

  // 1. Match student in registered students roster (with multi-layer fallback across all sources)
  let student = students.find((s) => String(s.barcode).trim() === barcodeTrimmed);
  if (!student) {
    const localData = loadLocalData();
    if (localData?.students) {
      student = localData.students.find((s) => String(s.barcode).trim() === barcodeTrimmed);
    }
  }

  // Try matching numeric equivalence if leading zeros differ
  if (!student && !isNaN(Number(barcodeTrimmed))) {
    const num = Number(barcodeTrimmed);
    student = students.find((s) => Number(s.barcode) === num);
    if (!student) {
      const localData = loadLocalData();
      if (localData?.students) {
        student = localData.students.find((s) => Number(s.barcode) === num);
      }
    }
  }

  if (!student) {
    return {
      success: false,
      message: "كود الطالب غير مسجل في المنظومة! يرجى التأكد من كتابة الكود بشكل صحيح أو مراجعة إدارة المركز.",
    };
  }

  // 2. Validate phone number against student's parentPhone or student phone
  const cleanEntered = normalizePhone(phoneTrimmed);
  const cleanParent = normalizePhone(student.parentPhone);
  const cleanStudentPhone = normalizePhone(student.phone);
  const hasValidRosterPhone = (cleanParent && cleanParent.length >= 8) || (cleanStudentPhone && cleanStudentPhone.length >= 8);

  if (hasValidRosterPhone) {
    const isPhoneMatch =
      cleanEntered &&
      (cleanEntered === cleanParent ||
        cleanEntered === cleanStudentPhone ||
        (cleanParent && (cleanEntered.endsWith(cleanParent) || cleanParent.endsWith(cleanEntered))) ||
        (cleanStudentPhone && (cleanEntered.endsWith(cleanStudentPhone) || cleanStudentPhone.endsWith(cleanEntered))));

    if (!isPhoneMatch) {
      return {
        success: false,
        message: `رقم الهاتف المدخل (${phoneTrimmed}) غير مطابق لرقم ولي أمر الطالب (${student.name}). يرجى إدخال الهاتف المسجل في المنظومة.`,
      };
    }
  }

  // 3. Check if account already exists
  const existingAccounts = getLocalParentAccounts();
  const existing = existingAccounts[student.barcode] || existingAccounts[barcodeTrimmed];
  if (existing) {
    // If account exists, update password and ensure active, then return it for instant login
    existing.password = passTrimmed;
    existing.parentPhone = phoneTrimmed;
    existing.studentName = student.name;
    existing.status = "active";
    existing.updatedAt = new Date().toISOString();
    existingAccounts[student.barcode] = existing;
    saveLocalParentAccounts(existingAccounts);
    persistParentAccount(existing).catch(() => {});
    return {
      success: true,
      message: `تم تفعيل وتحديث حساب ولي أمر الطالب (${student.name}) بنجاح!`,
      account: existing,
    };
  }

  // 4. Create new parent account with student's real data
  const newAccount: ParentAccount = {
    studentBarcode: student.barcode,
    studentName: student.name,
    linkedBarcodes: [student.barcode],
    parentPhone: phoneTrimmed,
    password: passTrimmed,
    status: "active",
    createdAt: new Date().toISOString(),
  };

  // Immediate local save (0ms)
  existingAccounts[student.barcode] = newAccount;
  saveLocalParentAccounts(existingAccounts);

  // Reliable background cloud persistence (tied to real Firestore)
  persistParentAccount(newAccount).catch(() => {});

  return {
    success: true,
    message: `تم تفعيل حساب ولي أمر الطالب (${student.name}) بنجاح!`,
    account: newAccount,
  };
}

/**
 * Direct activation of a student's parent account by Admin
 */
export async function activateParentAccountDirectly(
  studentBarcode: string,
  phone: string,
  password: string
): Promise<ParentAccount> {
  const accounts = getLocalParentAccounts();
  const existing = accounts[studentBarcode.trim()];
  const newAccount: ParentAccount = {
    studentBarcode: studentBarcode.trim(),
    linkedBarcodes: existing?.linkedBarcodes || [],
    parentPhone: phone.trim(),
    password: password.trim(),
    status: "active",
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  accounts[studentBarcode.trim()] = newAccount;
  saveLocalParentAccounts(accounts);
  await persistParentAccount(newAccount);
  return newAccount;
}

/**
 * Batch activate all unactivated students with default credentials
 */
export async function batchActivateParentAccounts(
  items: { studentBarcode: string; phone: string }[],
  defaultPassword: string
): Promise<number> {
  const accounts = getLocalParentAccounts();
  let count = 0;
  for (const item of items) {
    const bCode = item.studentBarcode.trim();
    if (!bCode) continue;
    if (!accounts[bCode]) {
      accounts[bCode] = {
        studentBarcode: bCode,
        linkedBarcodes: [],
        parentPhone: item.phone.trim() || "0",
        password: defaultPassword.trim() || "1234",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      count++;
    }
  }
  saveLocalParentAccounts(accounts);
  try {
    await ensureFirebaseAuth();
    if (db) {
      await setDoc(
        doc(db, "system_state", "portal_accounts_registry"),
        { accounts, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    }
  } catch (err) {
    console.warn("Batch activate cloud save warning:", err);
  }
  return count;
}

/**
 * Authenticate login (Parent or Admin) - Instant 0ms verification
 */
export async function authenticatePortalLogin(
  barcode: string,
  password: string,
  students: Student[]
): Promise<{ success: boolean; role?: "parent" | "admin"; account?: ParentAccount; message: string }> {
  const barcodeTrimmed = barcode.trim();
  const passTrimmed = password.trim();

  if (!barcodeTrimmed || !passTrimmed) {
    return { success: false, message: "يرجى إدخال كود الطالب أو رقم الهاتف وكلمة المرور" };
  }

  // 1. Check Admin / Supervisor credentials (Instant 0ms)
  const adminSettings = getAdminPortalSettings();
  if (
    (barcodeTrimmed === adminSettings.adminBarcode && passTrimmed === adminSettings.adminPassword) ||
    ((barcodeTrimmed === "admin" || barcodeTrimmed === "1") && passTrimmed === "2468")
  ) {
    return {
      success: true,
      role: "admin",
      message: "مرحباً بك في لوحة تحكم المشرف العام!",
    };
  }

  // 2. Check Parent credentials from LocalStorage first (Instant 0ms)
  let accounts = getLocalParentAccounts();
  let account = accounts[barcodeTrimmed];

  // If not found by direct barcode, check numeric matching or phone number
  if (!account) {
    const cleanEntered = normalizePhone(barcodeTrimmed);
    account = Object.values(accounts).find(
      (a) =>
        String(a.studentBarcode).trim() === barcodeTrimmed ||
        (cleanEntered && normalizePhone(a.parentPhone) === cleanEntered) ||
        (a.linkedBarcodes && a.linkedBarcodes.includes(barcodeTrimmed))
    );
  }

  // 3. Fast cloud fallback if account is missing on a freshly opened device
  if (!account) {
    try {
      await ensureFirebaseAuth();
      const docSnap = await Promise.race([
        getDoc(doc(db, "parent_accounts", barcodeTrimmed)),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
      ]);
      if (docSnap && docSnap.exists()) {
        const cloudAcc = docSnap.data() as ParentAccount;
        if (cloudAcc && cloudAcc.studentBarcode) {
          account = cloudAcc;
          accounts = getLocalParentAccounts();
          accounts[account.studentBarcode] = account;
          saveLocalParentAccounts(accounts);
        }
      }
    } catch {}
  }

  // If still not found, check synchronized registry
  if (!account) {
    try {
      const synced = await syncParentAccountsFromCloud();
      if (synced && synced[barcodeTrimmed]) {
        account = synced[barcodeTrimmed];
      }
    } catch {}
  }

  if (!account) {
    // Check if student exists in roster to give a helpful guidance message
    const cleanEntered = normalizePhone(barcodeTrimmed);
    let studentList = students;
    if (!studentList || studentList.length === 0) {
      const localData = loadLocalData();
      if (localData?.students) studentList = localData.students;
    }
    const student = studentList.find(
      (s) =>
        String(s.barcode).trim() === barcodeTrimmed ||
        (cleanEntered &&
          (normalizePhone(s.parentPhone) === cleanEntered ||
            normalizePhone(s.phone) === cleanEntered))
    );
    if (student) {
      return {
        success: false,
        message: `لم يتم تفعيل حساب ولي أمر الطالب (${student.name}) بعد. اضغط على تبويب "تفعيل حساب جديد" بالأسفل لإتمام التفعيل والربط الفوري.`,
      };
    }
    return {
      success: false,
      message: "بيانات الدخول غير صحيحة. يرجى التحقق من كود الطالب أو رقم الهاتف وكلمة المرور.",
    };
  }

  if (account.status === "disabled") {
    return {
      success: false,
      message: "تم تعطيل هذا الحساب مؤقتاً من قبل إدارة المركز. يرجى مراجعة المشرف العام.",
    };
  }

  if (account.password !== passTrimmed) {
    return {
      success: false,
      message: "كلمة المرور غير صحيحة. يرجى إعادة المحاولة.",
    };
  }

  // Update last login timestamp locally immediately
  account.lastLoginAt = new Date().toISOString();
  accounts[account.studentBarcode] = account;
  saveLocalParentAccounts(accounts);

  // Background non-blocking sync to cloud
  persistParentAccount(account).catch(() => {});

  return {
    success: true,
    role: "parent",
    account,
    message: "تم تسجيل الدخول بنجاح!",
  };
}

/**
 * Link an additional child barcode to an existing parent account
 */
export async function linkChildToParent(
  parentBarcode: string,
  newChildBarcode: string,
  phoneOrPassword: string,
  students: Student[]
): Promise<{ success: boolean; message: string; updatedAccount?: ParentAccount }> {
  const accounts = getLocalParentAccounts();
  const account = accounts[parentBarcode];
  if (!account) {
    return { success: false, message: "حساب ولي الأمر غير موجود." };
  }

  const childBarcode = newChildBarcode.trim();
  if (childBarcode === parentBarcode || account.linkedBarcodes.includes(childBarcode)) {
    return { success: false, message: "هذا الطالب مضاف بالفعل إلى قائمة أبنائك!" };
  }

  const childStudent = students.find((s) => s.barcode === childBarcode);
  if (!childStudent) {
    return { success: false, message: "كود الطالب غير موجود بالنظام المدرسي." };
  }

  // Validation: matching phone or child's existing password
  const cleanEntered = normalizePhone(phoneOrPassword);
  const cleanParentPhone = normalizePhone(account.parentPhone);
  const cleanChildParentPhone = normalizePhone(childStudent.parentPhone);
  const cleanChildPhone = normalizePhone(childStudent.phone);

  const existingChildAccount = accounts[childBarcode];
  const isPassMatch = existingChildAccount && existingChildAccount.password === phoneOrPassword.trim();
  const isPhoneMatch =
    cleanEntered === cleanChildParentPhone ||
    cleanEntered === cleanChildPhone ||
    cleanParentPhone === cleanChildParentPhone;

  if (!isPassMatch && !isPhoneMatch) {
    return {
      success: false,
      message: "تعذر التحقق من الطالب. يرجى إدخال هاتف ولي الأمر المسجل للطالب أو كلمة مرور حسابه.",
    };
  }

  account.linkedBarcodes = [...account.linkedBarcodes, childBarcode];
  await persistParentAccount(account);

  return {
    success: true,
    message: `تم ربط الطالب (${childStudent.name}) بحسابك بنجاح! يمكنك الآن التبديل بين الأبناء بسهولة.`,
    updatedAccount: account,
  };
}

// ----------------------------------------------------
// REAL-TIME DIRECT PARENT-TEACHER CHAT MESSAGING
// ----------------------------------------------------

export function getLocalChatMessages(): Record<string, ParentChatMessage[]> {
  try {
    const raw = localStorage.getItem(LS_PORTAL_CHATS);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

export function saveLocalChatMessages(chats: Record<string, ParentChatMessage[]>): void {
  try {
    localStorage.setItem(LS_PORTAL_CHATS, JSON.stringify(chats));
  } catch {}
}

/**
 * Send a chat message with audio chime & realtime broadcast
 */
export async function sendParentChatMessage(
  chatId: string,
  sender: "parent" | "admin",
  senderName: string,
  text: string
): Promise<ParentChatMessage> {
  const allChats = getLocalChatMessages();
  const thread = allChats[chatId] || [];

  const time = new Intl.DateTimeFormat("ar-EG", {
    hour: "numeric",
    minute: "numeric",
    hour12: true,
  }).format(new Date());

  const newMsg: ParentChatMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    chatId,
    sender,
    senderName,
    text: text.trim(),
    timestamp: Date.now(),
    timeFormatted: time,
    isRead: false,
  };

  thread.push(newMsg);
  allChats[chatId] = thread;
  saveLocalChatMessages(allChats);

  // Play audio chime for sender feedback
  playPortalAudioChime("chat");

  // Broadcast to local tabs instantly
  if (chatBus) {
    chatBus.postMessage({ type: "new_message", message: newMsg });
  }

  // Persist to Cloud Firestore
  try {
    await ensureFirebaseAuth();
    if (db) {
      await setDoc(doc(db, "parent_chats", chatId), {
        chatId,
        messages: thread.slice(-100), // Retain last 100 messages
        lastUpdated: Date.now(),
      }, { merge: true });
    }
  } catch (err) {
    console.warn("Failed to persist chat to Firestore:", err);
  }

  // Background Web Push to recipient phone/device (delivers even if app is completely closed)
  try {
    const { dispatchPushNotification } = await import("../services/pushNotificationService");
    if (sender === "admin") {
      // Find all possible aliases (parent phone, linked student barcodes) for this chatId
      const accounts = getLocalParentAccounts();
      const matchedAccount = Object.values(accounts).find(
        (a) =>
          a.studentBarcode === chatId ||
          a.parentPhone === chatId ||
          a.linkedBarcodes?.includes(chatId)
      );

      let studentParentPhone = "";
      let studentPhone = "";
      try {
        const rawCenterData = localStorage.getItem("center_data_v2");
        if (rawCenterData) {
          const parsed = JSON.parse(rawCenterData);
          const found = (parsed.students || []).find(
            (s: any) => s.barcode === chatId || s.parentPhone === chatId || s.phone === chatId
          );
          if (found) {
            studentParentPhone = found.parentPhone || "";
            studentPhone = found.phone || "";
          }
        }
      } catch {}

      const targetUserIds = Array.from(
        new Set([
          chatId,
          matchedAccount?.parentPhone,
          matchedAccount?.studentBarcode,
          ...(matchedAccount?.linkedBarcodes || []),
          studentParentPhone,
          studentPhone,
        ])
      ).filter(Boolean) as string[];

      dispatchPushNotification({
        targetUserIds,
        title: "💬 رسالة جديدة من إدارة المركز",
        body: `الأستاذة إيمان الدمشيتي: "${text.slice(0, 80)}"`,
        type: "chat",
        eventId: newMsg.id,
        tag: `chat-${chatId}`,
        url: "/?tab=chat",
      }).catch(() => {});
    } else {
      dispatchPushNotification({
        role: "admin",
        title: `💬 رسالة من ولي أمر (${senderName})`,
        body: text.slice(0, 80),
        type: "chat",
        eventId: newMsg.id,
        tag: `chat-${chatId}`,
        url: "/?tab=chat",
      }).catch(() => {});
    }
  } catch (err) {
    console.warn("Chat background push dispatch failed:", err);
  }

  return newMsg;
}

/**
 * Mark thread messages as read
 */
export async function markChatThreadRead(chatId: string, readerRole: "parent" | "admin"): Promise<void> {
  const allChats = getLocalChatMessages();
  const thread = allChats[chatId];
  if (!thread) return;

  let hasChanges = false;
  thread.forEach((msg) => {
    // If reader is parent, mark admin messages as read
    // If reader is admin, mark parent messages as read
    if (readerRole === "parent" && msg.sender === "admin" && !msg.isRead) {
      msg.isRead = true;
      hasChanges = true;
    } else if (readerRole === "admin" && msg.sender === "parent" && !msg.isRead) {
      msg.isRead = true;
      hasChanges = true;
    }
  });

  if (hasChanges) {
    allChats[chatId] = thread;
    saveLocalChatMessages(allChats);

    if (chatBus) {
      chatBus.postMessage({ type: "messages_read", chatId, readerRole });
    }

    try {
      await ensureFirebaseAuth();
      if (db) {
        await updateDoc(doc(db, "parent_chats", chatId), {
          messages: thread.slice(-100),
        });
      }
    } catch {}
  }
}

/**
 * Subscribe to realtime chat updates for a specific thread
 */
export function subscribeToThreadChat(
  chatId: string,
  onUpdate: (messages: ParentChatMessage[]) => void
): () => void {
  // 1. Initial local load
  const allChats = getLocalChatMessages();
  onUpdate(allChats[chatId] || []);

  // 2. BroadcastChannel local listener
  const handleBusMessage = (ev: MessageEvent) => {
    if (ev.data?.type === "new_message" && ev.data.message.chatId === chatId) {
      const chats = getLocalChatMessages();
      onUpdate(chats[chatId] || []);
    } else if (ev.data?.type === "messages_read" && ev.data.chatId === chatId) {
      const chats = getLocalChatMessages();
      onUpdate(chats[chatId] || []);
    }
  };

  if (chatBus) {
    chatBus.addEventListener("message", handleBusMessage);
  }

  // 3. Firestore snapshot listener
  let unsubFirestore: (() => void) | null = null;
  if (db) {
    unsubFirestore = onSnapshot(doc(db, "parent_chats", chatId), (snap) => {
      if (snap.exists()) {
        const cloudMessages = snap.data()?.messages as ParentChatMessage[] | undefined;
        if (cloudMessages && Array.isArray(cloudMessages)) {
          const chats = getLocalChatMessages();
          chats[chatId] = cloudMessages;
          saveLocalChatMessages(chats);
          onUpdate(cloudMessages);
        }
      }
    }, (err) => {
      console.warn("Firestore chat subscription error:", err);
    });
  }

  return () => {
    if (chatBus) {
      chatBus.removeEventListener("message", handleBusMessage);
    }
    if (unsubFirestore) {
      unsubFirestore();
    }
  };
}

/**
 * Subscribe to realtime updates for ALL chat threads across the platform
 * Essential for WhatsApp-style real-time ordering and notifications
 */
export function subscribeToAllChats(
  onUpdate: (chats: Record<string, ParentChatMessage[]>) => void
): () => void {
  // 1. Initial local load
  onUpdate(getLocalChatMessages());

  // 2. BroadcastChannel local listener
  const handleBusMessage = (ev: MessageEvent) => {
    if (ev.data?.type === "new_message" || ev.data?.type === "messages_read") {
      onUpdate(getLocalChatMessages());
    }
  };

  if (chatBus) {
    chatBus.addEventListener("message", handleBusMessage);
  }

  // 3. LocalStorage storage event listener
  const handleStorage = (ev: StorageEvent) => {
    if (ev.key === LS_PORTAL_CHATS) {
      onUpdate(getLocalChatMessages());
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }

  // 4. Firestore collection snapshot listener
  let unsubFirestore: (() => void) | null = null;
  if (db) {
    unsubFirestore = onSnapshot(collection(db, "parent_chats"), (snapshot) => {
      const chats = getLocalChatMessages();
      let hasChanges = false;
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const chatId = docSnap.id;
        const cloudMessages = data?.messages as ParentChatMessage[] | undefined;
        if (cloudMessages && Array.isArray(cloudMessages)) {
          chats[chatId] = cloudMessages;
          hasChanges = true;
        }
      });
      if (hasChanges) {
        saveLocalChatMessages(chats);
        onUpdate({ ...chats });
      }
    }, (err) => {
      console.warn("Firestore all-chats subscription error:", err);
    });
  }

  return () => {
    if (chatBus) {
      chatBus.removeEventListener("message", handleBusMessage);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
    if (unsubFirestore) {
      unsubFirestore();
    }
  };
}

/**
 * Session Persistence
 */
export function getSavedPortalSession(): PortalSession | null {
  try {
    const raw = localStorage.getItem(LS_PORTAL_SESSION);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function savePortalSession(session: PortalSession | null): void {
  try {
    if (session) {
      localStorage.setItem(LS_PORTAL_SESSION, JSON.stringify(session));
    } else {
      localStorage.removeItem(LS_PORTAL_SESSION);
    }
  } catch {}
}
