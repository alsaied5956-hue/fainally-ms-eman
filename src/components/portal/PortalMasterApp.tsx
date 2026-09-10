import React, { useState, useEffect, useCallback } from "react";
import { Student, PaymentRecord, GradeName } from "../../types";
import { ParentAccount, PortalSession } from "../../types/portal";
import {
  getSavedPortalSession,
  savePortalSession,
  syncParentAccountsFromCloud,
  subscribeToParentAccountLiveStatus,
} from "../../utils/portalStorage";
import { PortalAuthScreen } from "./PortalAuthScreen";
import { ParentPortalDashboard } from "./ParentPortalDashboard";
import { AdminControlPanel } from "./AdminControlPanel";

interface PortalMasterAppProps {
  students: Student[];
  attendanceToday: Record<string, string>;
  attendanceHistory: Record<string, Record<string, string>>;
  payments: Record<string, Record<string, PaymentRecord>>;
  scanLogTimes: Record<string, string>;
  groupPrices?: Record<GradeName, number>;
}

export const PortalMasterApp: React.FC<PortalMasterAppProps> = ({
  students,
  attendanceToday,
  attendanceHistory,
  payments,
  scanLogTimes,
  groupPrices,
}) => {
  // Portal session state
  const [session, setSession] = useState<PortalSession | null>(() => {
    return getSavedPortalSession();
  });

  // Notice when session is revoked remotely by admin (disable or delete)
  const [revocationNotice, setRevocationNotice] = useState<string | null>(null);

  // Sync latest cloud accounts registry on mount
  useEffect(() => {
    syncParentAccountsFromCloud().catch(() => {});
  }, []);

  // Handle logout
  const handleLogout = useCallback((keepNotice: boolean = true) => {
    setSession(null);
    savePortalSession(null);
    if (!keepNotice) {
      setRevocationNotice(null);
    }
  }, []);

  // Live remote logout watcher:
  // If admin explicitly disables or revokes account, force remote logout
  useEffect(() => {
    if (session?.role !== "parent" || !session.account?.studentBarcode) {
      return;
    }

    const currentBarcode = String(session.account.studentBarcode).trim();

    // Realtime listener across Firestore, BroadcastChannel, and storage events
    const unsubscribe = subscribeToParentAccountLiveStatus(
      currentBarcode,
      (reason) => {
        setRevocationNotice(reason);
        handleLogout(true);
      },
      session.account.activatedAt
    );

    return () => {
      unsubscribe();
    };
  }, [session?.role, session?.account?.studentBarcode, session?.account?.activatedAt, handleLogout]);

  // Handle successful login from AuthScreen
  const handleLoginSuccess = (
    role: "parent" | "admin",
    account?: ParentAccount,
    barcode?: string
  ) => {
    setRevocationNotice(null);
    const newSession: PortalSession = {
      role,
      account,
      barcode: barcode || account?.studentBarcode || "1",
      token: `sess-${Date.now()}`,
    };
    setSession(newSession);
    savePortalSession(newSession);
  };

  // Update parent account in session state
  const handleUpdateAccount = (updated: ParentAccount) => {
    if (session && session.role === "parent") {
      const updatedSession: PortalSession = {
        ...session,
        account: updated,
      };
      setSession(updatedSession);
      savePortalSession(updatedSession);
    }
  };

  // 1. Not logged in -> Show Authentication / Registration Screen
  if (!session) {
    return (
      <PortalAuthScreen
        students={students}
        onLoginSuccess={handleLoginSuccess}
        revocationNotice={revocationNotice}
        onClearRevocationNotice={() => setRevocationNotice(null)}
      />
    );
  }

  // 2. Logged in as Admin / Supervisor -> Show Admin Control Panel
  if (session.role === "admin") {
    return (
      <AdminControlPanel
        students={students}
        onLogout={() => handleLogout(false)}
      />
    );
  }

  // 3. Logged in as Parent -> Show Parent Portal Dashboard
  if (session.role === "parent" && session.account) {
    return (
      <ParentPortalDashboard
        account={session.account}
        students={students}
        attendanceHistory={attendanceHistory}
        attendanceToday={attendanceToday}
        payments={payments}
        scanLogTimes={scanLogTimes}
        groupPrices={groupPrices}
        onLogout={() => handleLogout(false)}
        onUpdateAccount={handleUpdateAccount}
      />
    );
  }

  // Fallback if account data was missing
  return (
    <PortalAuthScreen
      students={students}
      onLoginSuccess={handleLoginSuccess}
      revocationNotice={revocationNotice}
      onClearRevocationNotice={() => setRevocationNotice(null)}
    />
  );
};
