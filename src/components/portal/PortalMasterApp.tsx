import React, { useState, useEffect } from "react";
import { Student, PaymentRecord } from "../../types";
import { ParentAccount, PortalSession } from "../../types/portal";
import {
  getSavedPortalSession,
  savePortalSession,
  syncParentAccountsFromCloud,
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
}

export const PortalMasterApp: React.FC<PortalMasterAppProps> = ({
  students,
  attendanceToday,
  attendanceHistory,
  payments,
  scanLogTimes,
}) => {
  // Portal session state
  const [session, setSession] = useState<PortalSession | null>(() => {
    return getSavedPortalSession();
  });

  // Sync latest cloud accounts registry on mount
  useEffect(() => {
    syncParentAccountsFromCloud().catch(() => {});
  }, []);

  // Handle successful login from AuthScreen
  const handleLoginSuccess = (
    role: "parent" | "admin",
    account?: ParentAccount,
    barcode?: string
  ) => {
    const newSession: PortalSession = {
      role,
      account,
      barcode: barcode || account?.studentBarcode || "1",
      token: `sess-${Date.now()}`,
    };
    setSession(newSession);
    savePortalSession(newSession);
  };

  // Handle logout
  const handleLogout = () => {
    setSession(null);
    savePortalSession(null);
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
      />
    );
  }

  // 2. Logged in as Admin / Supervisor -> Show Admin Control Panel
  if (session.role === "admin") {
    return (
      <AdminControlPanel
        students={students}
        onLogout={handleLogout}
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
        onLogout={handleLogout}
        onUpdateAccount={handleUpdateAccount}
      />
    );
  }

  // Fallback fallback if account data was missing
  return (
    <PortalAuthScreen
      students={students}
      onLoginSuccess={handleLoginSuccess}
    />
  );
};
