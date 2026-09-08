import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  initializeFirestore, 
  getFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager,
  memoryLocalCache,
  setLogLevel,
  Firestore
} from "firebase/firestore";
import { getAuth, signInAnonymously, onAuthStateChanged, Auth } from "firebase/auth";
import config from "../../firebase-applet-config.json";

// Suppress benign connection retry / quota / offline notice logs from spamming console
try {
  setLogLevel("silent");
} catch {
  // Ignore
}

// Initialize Firebase App
export const app = getApps().length === 0 ? initializeApp(config) : getApp();

// Initialize Auth and ensure anonymous session is established if supported
export const auth: Auth = getAuth(app);
let authInFlightPromise: Promise<boolean> | null = null;
let lastAuthAttemptTime = 0;
let consecutiveAuthFailures = 0;
let isAnonymousAuthUnavailable = false;

// Listen to auth state transitions to clear failure counters on successful session
onAuthStateChanged(auth, (user) => {
  if (user) {
    consecutiveAuthFailures = 0;
    isAnonymousAuthUnavailable = false;
  }
});

export async function ensureFirebaseAuth(): Promise<boolean> {
  if (auth.currentUser) {
    return true;
  }

  if (isAnonymousAuthUnavailable) {
    return false;
  }

  // Deduplicate concurrent auth requests
  if (authInFlightPromise) {
    return authInFlightPromise;
  }

  // If failed recently, enforce cooldown to prevent spamming
  const cooldownMs = Math.min(60000, 2000 * Math.pow(2, consecutiveAuthFailures));
  if (Date.now() - lastAuthAttemptTime < cooldownMs && consecutiveAuthFailures > 0) {
    return !!auth.currentUser;
  }

  lastAuthAttemptTime = Date.now();

  authInFlightPromise = (async () => {
    try {
      await signInAnonymously(auth);
      consecutiveAuthFailures = 0;
      return true;
    } catch (err: any) {
      consecutiveAuthFailures++;
      const code = err?.code || "";
      // If project has anonymous authentication disabled in console, permanently avoid blocking sync
      if (
        code === "auth/admin-restricted-operation" ||
        code === "auth/operation-not-allowed" ||
        consecutiveAuthFailures >= 3
      ) {
        isAnonymousAuthUnavailable = true;
      }
      return false;
    } finally {
      authInFlightPromise = null;
    }
  })();

  return authInFlightPromise;
}

// Attempt background auth once without blocking startup
ensureFirebaseAuth().catch(() => {});

// Cloud Connection Diagnostics: Ping Firestore server directly with getDocFromServer
export async function testFirestoreConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = performance.now();
  try {
    const { doc, getDocFromServer } = await import("firebase/firestore");
    await getDocFromServer(doc(db, "system_state", "connection_test"));
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (err: any) {
    const elapsed = Math.round(performance.now() - start);
    // If the document doesn't exist, that still means connection to server succeeded!
    if (err?.code === "not-found" || err?.message?.includes("not-found")) {
      return { ok: true, latencyMs: elapsed };
    }
    return {
      ok: false,
      latencyMs: elapsed,
      error: err?.message || err?.code || "Connection failed",
    };
  }
}

// Initialize Firestore Database instance with resilient in-memory cache
// Using memoryLocalCache completely prevents IndexedDB multi-tab lock corruptions,
// stale target watch streams (ID: ca9 / b815 / c050), and iframe persistence crashes.
let dbInstance: Firestore;
try {
  dbInstance = initializeFirestore(
    app,
    {
      localCache: memoryLocalCache(),
    },
    config.firestoreDatabaseId || undefined
  );
} catch {
  dbInstance = getFirestore(app, config.firestoreDatabaseId || undefined);
}

export const db = dbInstance;

