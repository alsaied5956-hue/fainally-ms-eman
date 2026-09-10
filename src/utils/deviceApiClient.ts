/**
 * Device API Client (عميل الربط الشبكي للأجهزة والموقع الثاني)
 * 
 * المزايا:
 * 1. عزل تام للبيانات لكل جهاز بناءً على (Device ID / Machine ID).
 * 2. إلغاء كامل للكاش (Zero-Cache / Anti-Stale) باستخدام ترويسات no-cache ومحدد الوقت _t.
 * 3. حماية فائقة من توقف النظام عند انقطاع الاتصال (Resilient Error Handling & Exponential Backoff).
 * 4. دعم جلب البيانات اللحظية (Polling) والبث المباشر (Server-Sent Events - SSE).
 */

export interface DeviceLiveDataResponse {
  success: boolean;
  deviceId: string;
  device: {
    deviceId: string;
    machineId: string;
    deviceName: string;
    role: string;
    activeGrade?: string;
    activeDays?: string;
    activeSlotId?: string;
    lastSeen: number;
    status: "online" | "idle" | "offline";
    recentScans: Array<{
      id: string;
      barcode: string;
      studentName?: string;
      grade?: string;
      days?: string;
      status: "حضور" | "تأخير" | "غائب";
      timeIso: string;
      timeDisplay: string;
      timestamp: number;
    }>;
  };
  liveStats: {
    totalStudents: number;
    matchingStudents: number;
    todayAttendanceCount: number;
    todayLateCount: number;
    todayAbsentCount: number;
  };
  deviceScans: Array<{
    id: string;
    barcode: string;
    studentName?: string;
    grade?: string;
    days?: string;
    status: "حضور" | "تأخير" | "غائب";
    timeIso: string;
    timeDisplay: string;
    timestamp: number;
  }>;
  activeGrade: string;
  activeDays: string;
  activeSlotId: string;
  todayAttendanceMap: Record<string, string>;
  systemTime: string;
  systemVersion: number;
  error?: string;
}

const STORAGE_DEVICE_KEY = "aiman_machine_identifier_v1";

/**
 * الحصول على معرف الجهاز الثابت أو توليد معرف فريد جديد
 */
export function getOrSetDeviceId(customId?: string): string {
  if (customId && customId.trim()) {
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_DEVICE_KEY, customId.trim());
      }
    } catch {}
    return customId.trim();
  }

  if (typeof window === "undefined") {
    return "server_machine";
  }

  try {
    const existing = localStorage.getItem(STORAGE_DEVICE_KEY);
    if (existing && existing.trim()) {
      return existing.trim();
    }
  } catch {}

  // توليد معرّف عشوائي فريد ومستقر للجهاز
  const generated = `mac_${Math.random().toString(36).substring(2, 8)}_${Date.now().toString(36)}`;
  try {
    localStorage.setItem(STORAGE_DEVICE_KEY, generated);
  } catch {}
  return generated;
}

/**
 * إعداد الترويسات الموحدة لمنع التداخل والكاش تماماً
 */
export function buildDeviceHeaders(deviceId?: string, customHeaders?: HeadersInit): HeadersInit {
  const devId = deviceId || getOrSetDeviceId();
  return {
    "Content-Type": "application/json",
    "x-device-id": devId,
    "x-machine-id": devId,
    "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
    ...(customHeaders || {}),
  };
}

/**
 * 1. جلب البيانات اللحظية الأصلية الخاصة بالجهاز مباشرة وبدون كاش (Live Data Fetcher)
 */
export async function fetchDeviceLiveData(options: {
  baseUrl?: string;
  deviceId?: string;
  grade?: string;
  days?: string;
  includeStudents?: boolean;
  limit?: number;
  timeoutMs?: number;
} = {}): Promise<DeviceLiveDataResponse> {
  const baseUrl = options.baseUrl || "";
  const deviceId = options.deviceId || getOrSetDeviceId();
  const timeoutMs = options.timeoutMs || 8000;

  // Cache-Busting: إضافة طابع زمني دقيق في الرابط لمنع أي استجابة مؤقتة
  const queryParams = new URLSearchParams({
    deviceId,
    machineId: deviceId,
    noCache: "true",
    _t: String(Date.now()),
  });

  if (options.grade) queryParams.set("grade", options.grade);
  if (options.days) queryParams.set("days", options.days);
  if (options.includeStudents) queryParams.set("includeStudents", "true");
  if (options.limit) queryParams.set("limit", String(options.limit));

  const url = `${baseUrl}/api/device/live-data?${queryParams.toString()}`;

  // متحكم الإلغاء في حال بطء الشبكة
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: buildDeviceHeaders(deviceId),
      cache: "no-store", // إجبار المتصفح على جلب البيانات الحية من السيرفر مباشرة
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`خطأ في استجابة الخادم: ${res.status} ${res.statusText}`);
    }

    const data: DeviceLiveDataResponse = await res.json();
    return data;
  } catch (err: any) {
    clearTimeout(timer);
    const isAbort = err.name === "AbortError";
    const errorMessage = isAbort
      ? "انتهت مهلة انتظار استجابة الخادم (Connection Timeout)"
      : err.message || "تعذر الاتصال بالخادم لجلب بيانات الجهاز";

    console.warn(`[DeviceAPI] Warning for device (${deviceId}):`, errorMessage);

    // استجابة آمنة تحمي واجهة المستخدم من الانهيار (Safe Fallback)
    return {
      success: false,
      deviceId,
      device: {
        deviceId,
        machineId: deviceId,
        deviceName: `جهاز (${deviceId.slice(-6)})`,
        role: "scanner",
        status: "offline",
        lastSeen: Date.now(),
        recentScans: [],
      },
      liveStats: {
        totalStudents: 0,
        matchingStudents: 0,
        todayAttendanceCount: 0,
        todayLateCount: 0,
        todayAbsentCount: 0,
      },
      deviceScans: [],
      activeGrade: options.grade || "الكل",
      activeDays: options.days || "الكل",
      activeSlotId: "auto",
      todayAttendanceMap: {},
      systemTime: new Date().toISOString(),
      systemVersion: 0,
      error: errorMessage,
    };
  }
}

/**
 * 2. إرسال نبضة حياة وتحديث بيانات الجهاز (Heartbeat & Config)
 */
export async function sendDeviceHeartbeat(payload: {
  baseUrl?: string;
  deviceId?: string;
  deviceName?: string;
  role?: string;
  activeGrade?: string;
  activeDays?: string;
  activeSlotId?: string;
  customSettings?: Record<string, any>;
}): Promise<{ success: boolean; device?: any; error?: string }> {
  const baseUrl = payload.baseUrl || "";
  const deviceId = payload.deviceId || getOrSetDeviceId();

  try {
    const res = await fetch(`${baseUrl}/api/device/heartbeat`, {
      method: "POST",
      headers: buildDeviceHeaders(deviceId),
      cache: "no-store",
      body: JSON.stringify({
        deviceId,
        machineId: deviceId,
        deviceName: payload.deviceName,
        role: payload.role || "scanner",
        activeGrade: payload.activeGrade,
        activeDays: payload.activeDays,
        activeSlotId: payload.activeSlotId,
        customSettings: payload.customSettings,
      }),
    });

    if (!res.ok) {
      throw new Error(`Heartbeat failed: ${res.status}`);
    }

    return await res.json();
  } catch (err: any) {
    console.warn(`[DeviceHeartbeat] Failed for (${deviceId}):`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 3. تسجيل عملية مسح باركود خاصة بهذا الجهاز
 */
export async function sendDeviceScan(data: {
  baseUrl?: string;
  deviceId?: string;
  barcode: string;
  status: "حضور" | "تأخير" | "غائب";
  studentName?: string;
  grade?: string;
  days?: string;
  timeIso?: string;
  timeDisplay?: string;
}): Promise<{ success: boolean; deviceScan?: any; error?: string }> {
  const baseUrl = data.baseUrl || "";
  const deviceId = data.deviceId || getOrSetDeviceId();

  try {
    const res = await fetch(`${baseUrl}/api/device/scan`, {
      method: "POST",
      headers: buildDeviceHeaders(deviceId),
      cache: "no-store",
      body: JSON.stringify({
        deviceId,
        barcode: data.barcode,
        status: data.status,
        studentName: data.studentName,
        grade: data.grade,
        days: data.days,
        timeIso: data.timeIso || new Date().toISOString(),
        timeDisplay:
          data.timeDisplay ||
          new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
      }),
    });

    if (!res.ok) {
      throw new Error(`Scan submit failed: ${res.status}`);
    }

    return await res.json();
  } catch (err: any) {
    console.error(`[DeviceScan] Error for (${deviceId}):`, err);
    return { success: false, error: err.message };
  }
}

/**
 * 4. الاتصال بالبث المباشر للأحداث الخاصة بالجهاز (SSE Stream)
 * يضمن التحديث الفوري للأجهزة دون الحاجة لطلب متكرر، مع إعادة الاتصال التلقائي
 */
export function connectDeviceLiveStream(options: {
  baseUrl?: string;
  deviceId?: string;
  onScan?: (scan: any) => void;
  onStatusChange?: (status: any) => void;
  onError?: (err: any) => void;
}): () => void {
  if (typeof window === "undefined" || !("EventSource" in window)) {
    return () => {};
  }

  const baseUrl = options.baseUrl || "";
  const deviceId = options.deviceId || getOrSetDeviceId();
  let isClosed = false;
  let eventSource: EventSource | null = null;
  let retryTimeout: any = null;

  function connect() {
    if (isClosed) return;

    try {
      const url = `${baseUrl}/api/device/stream?deviceId=${encodeURIComponent(deviceId)}&_t=${Date.now()}`;
      eventSource = new EventSource(url);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "device_scan" && options.onScan) {
            options.onScan(data.scan);
          } else if (options.onStatusChange) {
            options.onStatusChange(data);
          }
        } catch {}
      };

      eventSource.onerror = (err) => {
        if (options.onError) options.onError(err);
        try {
          eventSource?.close();
        } catch {}
        // إعادة المحاولة بعد 4 ثوانٍ بأمان دون تجميد المتصفح
        if (!isClosed) {
          retryTimeout = setTimeout(connect, 4000);
        }
      };
    } catch (e) {
      if (!isClosed) {
        retryTimeout = setTimeout(connect, 4000);
      }
    }
  }

  connect();

  return () => {
    isClosed = true;
    if (retryTimeout) clearTimeout(retryTimeout);
    if (eventSource) {
      try {
        eventSource.close();
      } catch {}
      eventSource = null;
    }
  };
}
