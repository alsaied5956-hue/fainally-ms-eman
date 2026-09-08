import React, { useState } from "react";
import { UserAccount, PermissionKey } from "../types";
import { ALL_PERMISSIONS } from "../utils/storage";
import { Users, UserPlus, Shield, KeyRound, Trash2, Edit3, CheckSquare, Square } from "lucide-react";

interface UsersTabProps {
  usersList: UserAccount[];
  currentUser: UserAccount;
  onAddUser: (user: UserAccount) => void;
  onUpdateUser: (originalUsername: string, updated: UserAccount) => void;
  onDeleteUser: (username: string) => void;
}

const PERMISSION_LABELS: Record<PermissionKey, string> = {
  add_student: "➕ إضافة طالب جديد",
  edit_student: "✏️ تعديل بيانات الطالب",
  delete_student: "🗑️ حذف الطلاب",
  change_status: "🔄 تغيير حالة الحضور",
  pay_expenses: "💳 إثبات دفع الاشتراك",
  view_revenues: "💰 رؤية الإيرادات والإحصائيات",
  add_grades: "📝 رصد الدرجات",
  send_messages: "📲 إرسال الرسائل والمراسلة",
  manage_prices: "🏷️ تعديل أسعار المجموعات",
  early_warning: "🚨 نظام الإنذار المبكر",
  certificates: "📜 إصدار شهادات التقدير",
  excel_integration: "📥 استيراد وتصدير Excel",
};

export const UsersTab: React.FC<UsersTabProps> = ({
  usersList,
  currentUser,
  onAddUser,
  onUpdateUser,
  onDeleteUser,
}) => {
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "secretary">("secretary");
  const [selectedPerms, setSelectedPerms] = useState<PermissionKey[]>([
    "add_student",
    "edit_student",
    "change_status",
    "pay_expenses",
    "add_grades",
    "send_messages",
    "certificates",
  ]);

  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [originalEditUsername, setOriginalEditUsername] = useState("");

  const handleTogglePerm = (perm: PermissionKey) => {
    if (selectedPerms.includes(perm)) {
      setSelectedPerms(selectedPerms.filter((p) => p !== perm));
    } else {
      setSelectedPerms([...selectedPerms, perm]);
    }
  };

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    const u = newUsername.trim();
    const p = newPassword.trim();
    if (!u || !p) {
      alert("⚠️ يرجى إدخال اسم المستخدم وكلمة المرور!");
      return;
    }

    if (usersList.some((user) => user.username === u)) {
      alert("⚠️ اسم المستخدم موجود بالفعل!");
      return;
    }

    const newUser: UserAccount = {
      username: u,
      pass: p,
      role: newRole,
      permissions: newRole === "admin" ? [...ALL_PERMISSIONS] : selectedPerms,
    };

    onAddUser(newUser);
    alert(`✅ تم إنشاء حساب (${u}) بنجاح!`);
    setNewUsername("");
    setNewPassword("");
  };

  const handleOpenEdit = (user: UserAccount) => {
    setOriginalEditUsername(user.username);
    setEditingUser({ ...user });
  };

  const handleSaveEditUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    const trimmedUsername = editingUser.username.trim();
    const trimmedPass = editingUser.pass.trim();

    if (!trimmedUsername || !trimmedPass) {
      alert("⚠️ يرجى إدخال اسم المستخدم وكلمة المرور!");
      return;
    }

    const isDuplicate = usersList.some(
      (u) =>
        u.username.toLowerCase() === trimmedUsername.toLowerCase() &&
        u.username.toLowerCase() !== originalEditUsername.toLowerCase()
    );

    if (isDuplicate) {
      alert(`⚠️ اسم المستخدم (${trimmedUsername}) مستخدم بالفعل لحساب آخر!`);
      return;
    }

    onUpdateUser(originalEditUsername, {
      ...editingUser,
      username: trimmedUsername,
      pass: trimmedPass,
      permissions:
        editingUser.role === "admin" ? [...ALL_PERMISSIONS] : editingUser.permissions || [],
    });

    alert("✅ تم تعديل بيانات المستخدم وصلاحياته بنجاح!");
    setEditingUser(null);
  };

  const adminCount = usersList.filter((u) => u.role === "admin").length;

  return (
    <div className="space-y-6 font-tajawal">
      {/* Create User Card */}
      <div className="glass-panel p-6 md:p-8 rounded-3xl shadow-2xl space-y-5">
        <div className="flex items-center gap-3.5 pb-4 border-b border-indigo-500/20">
          <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-2xl flex items-center justify-center shadow-md">
            <UserPlus className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold font-fancy text-amber-300">
              إضافة حساب مستخدم جديد وتحديد الصلاحيات
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              إنشاء حسابات سكرتارية بصلاحيات محددة أو مسؤولين كاملين (أدمن)
            </p>
          </div>
        </div>

        <form onSubmit={handleCreateUser} className="space-y-4 text-xs font-bold font-tajawal">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="space-y-1.5">
              <label className="text-slate-300">اسم المستخدم (Username) *</label>
              <input
                type="text"
                required
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="مثال: secretary1"
                className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-100 px-4 py-2.5 rounded-2xl outline-none focus:border-amber-400 font-medium"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-300">كلمة المرور (Password) *</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="أدخل كلمة المرور"
                className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-100 px-4 py-2.5 rounded-2xl outline-none focus:border-amber-400 font-medium"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-300">نوع الحساب *</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as "admin" | "secretary")}
                className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-100 px-4 py-2.5 rounded-2xl outline-none cursor-pointer focus:border-amber-400 font-medium"
              >
                <option value="secretary" className="bg-slate-900 text-white">سكرتارية (صلاحيات مخصصة)</option>
                <option value="admin" className="bg-slate-900 text-white">👑 مسؤول كامل (الأدمن)</option>
              </select>
            </div>
          </div>

          {newRole === "secretary" && (
            <div className="glass-card p-4 rounded-2xl border-amber-500/30 space-y-3">
              <label className="text-amber-300 text-xs font-fancy block">
                حدد الصلاحيات الممنوحة لهذا الحساب:
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {ALL_PERMISSIONS.map((perm) => {
                  const isChecked = selectedPerms.includes(perm);
                  return (
                    <label
                      key={perm}
                      className="flex items-center gap-2.5 text-slate-300 cursor-pointer select-none text-xs p-2 rounded-xl hover:bg-white/5 transition-all"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleTogglePerm(perm)}
                        className="w-4 h-4 accent-amber-400 rounded cursor-pointer"
                      />
                      <span>{PERMISSION_LABELS[perm] || perm}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <button
            type="submit"
            className="px-6 py-3 rounded-2xl bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-200 hover:from-amber-300 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/20 cursor-pointer transition-all active:scale-95 flex items-center gap-2"
          >
            <UserPlus className="w-4 h-4 text-slate-950" />
            <span>إضافة المستخدم ➕</span>
          </button>
        </form>
      </div>

      {/* Users List Table */}
      <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border-indigo-500/20">
        <div className="p-4 border-b border-indigo-500/20 bg-slate-900/80 flex items-center justify-between">
          <h3 className="font-bold font-fancy text-base text-amber-300 flex items-center gap-2">
            <Users className="w-4 h-4 text-amber-400" />
            <span>قائمة المستخدمين المسجلين في المنظومة</span>
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-xs">
            <thead>
              <tr className="bg-slate-900/90 text-amber-300 font-bold font-fancy border-b border-indigo-500/20">
                <th className="p-3.5">اسم المستخدم</th>
                <th className="p-3.5">نوع الحساب</th>
                <th className="p-3.5">الصلاحيات الممنوحة</th>
                <th className="p-3.5 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {usersList.map((user) => {
                const isOnlyAdmin = user.role === "admin" && adminCount <= 1;

                const isCurrentActive =
                  user.username.trim().toLowerCase() === currentUser.username.trim().toLowerCase();

                return (
                  <tr key={user.username} className="hover:bg-amber-500/5 transition-colors">
                    <td className="p-3.5 font-bold text-slate-100 font-fancy">
                      <div className="flex items-center gap-2">
                        <span>{user.username}</span>
                        {isCurrentActive && (
                          <span className="text-[10px] text-amber-400 font-bold bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full">
                            حسابك الحالي
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`px-3 py-1 rounded-xl font-bold text-[11px] inline-flex items-center gap-1 ${
                          user.role === "admin"
                            ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                            : "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                        }`}
                      >
                        {user.role === "admin" ? "👑 مسؤول كامل (أدمن)" : "👤 سكرتارية"}
                      </span>
                    </td>
                    <td className="p-3.5 text-slate-400 max-w-xs text-[11px] truncate">
                      {user.role === "admin"
                        ? "كافة الصلاحيات مفتوحة"
                        : user.permissions?.map((p) => PERMISSION_LABELS[p] || p).join("، ") ||
                          "بدون صلاحيات"}
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(user)}
                          className="px-3 py-1.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>تعديل</span>
                        </button>

                        {!isOnlyAdmin && !isCurrentActive && (
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`هل أنت متأكد من حذف حساب (${user.username})؟`)) {
                                onDeleteUser(user.username);
                              }
                            }}
                            className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>حذف</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="glass-panel border-amber-500/40 p-6 md:p-8 rounded-3xl max-w-md w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <h3 className="text-base font-bold font-fancy text-amber-300 border-b border-indigo-500/20 pb-3 flex items-center gap-2">
              <Edit3 className="w-4 h-4 text-amber-400" />
              <span>تعديل حساب المستخدم ({originalEditUsername})</span>
            </h3>

            <form onSubmit={handleSaveEditUser} className="space-y-4 text-xs font-bold font-tajawal">
              <div className="space-y-1.5">
                <label className="text-slate-300">اسم المستخدم:</label>
                <input
                  type="text"
                  required
                  value={editingUser.username}
                  onChange={(e) => setEditingUser({ ...editingUser, username: e.target.value })}
                  className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-100 px-4 py-2.5 rounded-2xl outline-none focus:border-amber-400"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300">
                  كلمة مرور جديدة (اتركها كما هي إذا لم ترغب في التغيير):
                </label>
                <input
                  type="password"
                  value={editingUser.pass}
                  onChange={(e) => setEditingUser({ ...editingUser, pass: e.target.value })}
                  className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-100 px-4 py-2.5 rounded-2xl outline-none focus:border-amber-400"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300">نوع الحساب:</label>
                <select
                  value={editingUser.role}
                  onChange={(e) =>
                    setEditingUser({
                      ...editingUser,
                      role: e.target.value as "admin" | "secretary",
                    })
                  }
                  className="w-full bg-[#080d1e] border border-indigo-500/30 text-slate-100 px-4 py-2.5 rounded-2xl outline-none focus:border-amber-400 cursor-pointer"
                >
                  <option value="secretary" className="bg-slate-900 text-white">سكرتارية</option>
                  <option value="admin" className="bg-slate-900 text-white">مسؤول كامل (أدمن)</option>
                </select>
              </div>

              {editingUser.role === "secretary" && (
                <div className="glass-card p-3.5 rounded-2xl border-indigo-500/30 space-y-2.5 max-h-48 overflow-y-auto">
                  <label className="text-amber-300 text-xs font-fancy block">الصلاحيات:</label>
                  {ALL_PERMISSIONS.map((perm) => {
                    const isChecked = editingUser.permissions?.includes(perm) ?? false;
                    return (
                      <label
                        key={perm}
                        className="flex items-center gap-2.5 text-slate-300 text-xs cursor-pointer p-1.5 rounded-xl hover:bg-white/5"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            const cur = editingUser.permissions || [];
                            const updated = cur.includes(perm)
                              ? cur.filter((p) => p !== perm)
                              : [...cur, perm];
                            setEditingUser({ ...editingUser, permissions: updated });
                          }}
                          className="w-4 h-4 accent-amber-400 cursor-pointer"
                        />
                        <span>{PERMISSION_LABELS[perm]}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-5 py-2.5 rounded-2xl bg-slate-800/80 text-slate-300 hover:bg-slate-700 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-200 hover:from-amber-300 text-slate-950 font-black cursor-pointer shadow-md active:scale-95"
                >
                  حفظ التعديلات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
