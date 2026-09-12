import { ParentChatMessage, ParentAccount } from "../types/portal";
import {
  SystemData,
  loadLocalData,
  saveToLocalStorage,
  notifyCloudDataListeners,
  mergeCloudDataWithLocal,
} from "./storage";
import {
  getLocalChatMessages,
  saveLocalChatMessages,
  getLocalParentAccounts,
  saveLocalParentAccounts,
  getSavedPortalSession,
} from "./portalStorage";
import { playPortalAudioChime } from "./portalNotifications";

// Unique ID for this browser tab / window session to prevent applying echo updates
export const CLIENT_ID =
  typeof window !== "undefined"
    ? window.sessionStorage.getItem("eman_client_id") ||
      (() => {
        const id = `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        try {
          window.sessionStorage.setItem("eman_client_id", id);
        } catch {}
        return id;
      })()
    : "server_client";

let eventSource: EventSource | null = null;
let reconnectTimer: any = null;
let isInitialized = false;

/**
 * High-speed broadcast to all other open supervisor & parent screens via Server-Sent Events (<30ms)
 */
export async function notifyOtherDevicesOfSystemUpdate(data: Partial<SystemData>): Promise<void> {
  if (typeof window === "undefined" || !navigator.onLine) return;
  try {
    fetch("/api/portal/system-sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": CLIENT_ID,
      },
      body: JSON.stringify({
        ...data,
        _lastClientId: CLIENT_ID,
        _lastClientTimestamp: Date.now(),
        updatedAt: Date.now(),
      }),
    }).catch(() => {});
  } catch {}
}

/**
 * Initialize Central Real-Time SSE Stream for Zero-Refresh Multi-Device Sync
 */
export function initOnlineRealtimeSync(): () => void {
  if (typeof window === "undefined" || !("EventSource" in window)) {
    return () => {};
  }

  if (isInitialized && eventSource && eventSource.readyState !== EventSource.CLOSED) {
    return () => {};
  }

  isInitialized = true;

  const connect = () => {
    if (eventSource) {
      try {
        eventSource.close();
      } catch {}
      eventSource = null;
    }

    const session = getSavedPortalSession();
    let streamUrl = `/api/portal/live-stream?clientId=${encodeURIComponent(CLIENT_ID)}`;

    if (session?.role === "parent") {
      const barcode = session.barcode || session.account?.studentBarcode;
      const aliases = session.account?.linkedBarcodes || [];
      if (barcode) {
        streamUrl += `&barcode=${encodeURIComponent(barcode)}`;
      }
      if (aliases.length > 0) {
        streamUrl += `&aliases=${encodeURIComponent(aliases.join(","))}`;
      }
    } else {
      streamUrl += `&role=supervisor`;
    }

    try {
      eventSource = new EventSource(streamUrl);

      eventSource.onopen = () => {
        // Connected successfully
      };

      eventSource.onmessage = (event) => {
        if (!event.data) return;
        try {
          const payload = JSON.parse(event.data);
          handleRealtimeEvent(payload);
        } catch {}
      };

      eventSource.onerror = () => {
        if (eventSource) {
          try {
            eventSource.close();
          } catch {}
          eventSource = null;
        }
        // Auto-reconnect with 3s backoff
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 3000);
      };
    } catch {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 5000);
    }
  };

  connect();

  // Handle visibility change and online recovery
  const handleResume = () => {
    if (document.visibilityState === "visible" && (!eventSource || eventSource.readyState === EventSource.CLOSED)) {
      connect();
    }
  };

  const handleOnline = () => {
    connect();
  };

  window.addEventListener("online", handleOnline);
  document.addEventListener("visibilitychange", handleResume);

  return () => {
    window.removeEventListener("online", handleOnline);
    document.removeEventListener("visibilitychange", handleResume);
    clearTimeout(reconnectTimer);
    if (eventSource) {
      try {
        eventSource.close();
      } catch {}
      eventSource = null;
    }
    isInitialized = false;
  };
}

/**
 * Handle incoming real-time events streamed from the Node.js server
 */
function handleRealtimeEvent(event: any): void {
  if (!event || !event.type) return;

  // 1. SYSTEM DATA UPDATED: Another supervisor modified students, attendance, payments, etc.
  if (event.type === "SYSTEM_DATA_UPDATED") {
    // Ignore self-echo
    if (event.clientId && event.clientId === CLIENT_ID) {
      return;
    }

    const incomingData = event.data;
    if (incomingData && typeof incomingData === "object") {
      try {
        const current = loadLocalData();
        const merged = mergeCloudDataWithLocal(current, incomingData);
        saveToLocalStorage(merged, false);
        notifyCloudDataListeners(merged);

        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("center-data-updated", {
              detail: merged,
            })
          );
        }
      } catch (err) {
        console.warn("Error merging real-time system data:", err);
      }
    }
    return;
  }

  // 2. LIVE SCAN: Teacher/Supervisor scanned student attendance barcode
  if (event.type === "scan") {
    const { barcode, status, timeIso, studentName } = event;
    if (barcode && status) {
      try {
        const current = loadLocalData();
        const updatedAttendance = { ...current.attendanceToday, [barcode]: status };
        const updatedScanLog = [
          barcode,
          ...current.scanLogOrder.filter((b) => b !== barcode),
        ].slice(0, 200);

        const updated: SystemData = {
          ...current,
          attendanceToday: updatedAttendance,
          scanLogOrder: updatedScanLog,
          updatedAt: Date.now(),
        };

        saveToLocalStorage(updated, false);
        notifyCloudDataListeners(updated);

        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("center-data-updated", {
              detail: updated,
            })
          );
          window.dispatchEvent(
            new CustomEvent("center-live-scan", {
              detail: event,
            })
          );
        }
      } catch {}
    }
    return;
  }

  // 3. REAL-TIME CHAT MESSAGE: Instant WhatsApp-style delivery
  if (event.type === "CHAT_MESSAGE") {
    const rawMsg = event.message;
    if (!rawMsg) return;

    const chatId = String(event.chatId || event.barcode || rawMsg.chatId || rawMsg.conversationId).trim();
    if (!chatId) return;

    const newMsg: ParentChatMessage = {
      id: rawMsg.id || `msg-${Date.now()}`,
      chatId,
      sender: rawMsg.sender === "admin" || rawMsg.senderRole === "supervisor" ? "admin" : "parent",
      senderName: rawMsg.senderName || (rawMsg.senderRole === "supervisor" ? "إدارة المنظومة" : "ولي الأمر"),
      text: String(rawMsg.text || "").trim(),
      timestamp: rawMsg.timestamp || Date.now(),
      timeFormatted: rawMsg.timeFormatted || new Intl.DateTimeFormat("ar-EG", { hour: "numeric", minute: "numeric", hour12: true }).format(new Date()),
      isRead: false,
    };

    // Store in local chat collection
    const allChats = getLocalChatMessages();
    const thread = allChats[chatId] || [];
    const exists = thread.some((m) => m.id === newMsg.id);

    if (!exists) {
      thread.push(newMsg);
      allChats[chatId] = thread.slice(-100);
      saveLocalChatMessages(allChats);

      const session = getSavedPortalSession();
      const isSupervisor = !session || session.role !== "parent";

      // Play chime on receiving end
      if (isSupervisor && newMsg.sender === "parent") {
        playPortalAudioChime("chat");
      } else if (!isSupervisor && newMsg.sender === "admin") {
        playPortalAudioChime("chat");
      }

      // Notify UI components immediately
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("eman_chat_message_received", {
            detail: {
              chatId,
              message: newMsg,
            },
          })
        );
      }
    }
    return;
  }

  // 3b. REAL-TIME CHAT READ: Mark messages as read across all devices instantly
  if (event.type === "CHAT_READ") {
    const chatId = String(event.chatId || event.conversationId || "").trim();
    if (chatId) {
      try {
        const allChats = getLocalChatMessages();
        const thread = allChats[chatId];
        if (Array.isArray(thread)) {
          let modified = false;
          thread.forEach((msg) => {
            const matchesId = Array.isArray(event.messageIds) && event.messageIds.length > 0 && event.messageIds.includes(msg.id);
            const isBatchAll = !event.messageIds || (Array.isArray(event.messageIds) && event.messageIds.length === 0);
            const matchesRole =
              (event.readerRole === "admin" && (msg.sender === "parent" || (msg as any).senderRole === "parent")) ||
              (event.readerRole === "parent" && (msg.sender === "admin" || (msg as any).senderRole === "supervisor"));

            if (matchesId || isBatchAll || matchesRole) {
              if (!msg.isRead || msg.status !== "READ") {
                msg.isRead = true;
                msg.status = "READ";
                modified = true;
              }
            }
          });

          if (modified) {
            allChats[chatId] = thread;
            saveLocalChatMessages(allChats);
          }
        }

        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("eman_chat_messages_read", {
              detail: {
                chatId,
                readerRole: event.readerRole,
                messageIds: event.messageIds,
              },
            })
          );
        }
      } catch (err) {
        console.warn("Error processing CHAT_READ event:", err);
      }
    }
    return;
  }

  // 4. ACCOUNT SAVED OR ACTIVATED: Remote account registration / activation
  if (event.type === "ACCOUNT_SAVED" || event.type === "ACCOUNT_ACTIVATED") {
    const acc = event.account as ParentAccount | undefined;
    const barcode = event.barcode || acc?.studentBarcode;
    if (barcode && acc) {
      const accounts = getLocalParentAccounts();
      accounts[barcode] = acc;
      saveLocalParentAccounts(accounts);

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("eman_account_activated", {
            detail: {
              barcode,
              account: acc,
            },
          })
        );
      }
    }
    return;
  }

  // 5. ACCOUNT REVOKED OR DELETED: Supervisor deleted account
  if (event.type === "ACCOUNT_REVOKED" || event.type === "ACCOUNT_DELETED") {
    const barcode = event.barcode;
    if (barcode) {
      const accounts = getLocalParentAccounts();
      delete accounts[barcode];
      saveLocalParentAccounts(accounts);

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("eman_account_revoked", {
            detail: {
              barcode,
              reason: event.reason || "تم حذف الحساب من قِبل إدارة المنظومة",
            },
          })
        );
      }
    }
    return;
  }
}
