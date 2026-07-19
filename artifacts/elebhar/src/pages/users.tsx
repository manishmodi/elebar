import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type PermissionSet } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import {
  Pencil, Trash2, Check, Loader2, Shield, Eye, FilePlus, Edit, Trash,
  UserPlus, MoreVertical, UserCheck, UserX
} from "lucide-react";
import {
  PageHeader, Card, Button, Dialog, ConfirmDialog, DropdownMenu, StatusBadge
} from "@/components/ui-components";
import { TempProdSync } from "@/components/temp-prod-sync"; // TEMP MIGRATION — remove after cutover

type UserWithPerms = {
  id: number;
  fullName: string;
  email: string;
  isActive: boolean;
  createdAt: string;
  permissions: Record<string, PermissionSet>;
};

const SECTIONS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "daily-logs", label: "Daily Logs" },
  { key: "vehicles", label: "Vehicles" },
  { key: "riders", label: "Riders" },
  { key: "salary", label: "Salary" },
  { key: "assignments", label: "Assignments" },
  { key: "attendance", label: "Attendance" },
  { key: "maintenance", label: "Maintenance" },
  { key: "expenses", label: "Expenses" },
  { key: "cash-collection", label: "Cash Collection" },
  { key: "financials", label: "Financials" },
  { key: "reports", label: "Reports" },
];

const ACTIONS: { key: keyof PermissionSet; label: string; icon: typeof Eye }[] = [
  { key: "canView", label: "View", icon: Eye },
  { key: "canCreate", label: "Create", icon: FilePlus },
  { key: "canEdit", label: "Edit", icon: Edit },
  { key: "canDelete", label: "Delete", icon: Trash },
];

const API_BASE = `${import.meta.env.BASE_URL}api`;

function emptyPerms(): Record<string, PermissionSet> {
  const perms: Record<string, PermissionSet> = {};
  SECTIONS.forEach((s) => {
    perms[s.key] = { canView: false, canCreate: false, canEdit: false, canDelete: false };
  });
  return perms;
}

function fullPerms(): Record<string, PermissionSet> {
  const perms: Record<string, PermissionSet> = {};
  SECTIONS.forEach((s) => {
    perms[s.key] = { canView: true, canCreate: true, canEdit: true, canDelete: true };
  });
  return perms;
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...options });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(data.error || "Request failed");
  }
  return res.json();
}

function useUsers() {
  return useQuery<UserWithPerms[]>({
    queryKey: ["users"],
    queryFn: () => apiFetch<UserWithPerms[]>(`${API_BASE}/users`),
  });
}

function useUserPermissions(userId: number | null) {
  return useQuery<Record<string, PermissionSet>>({
    queryKey: ["user-permissions", userId],
    queryFn: () => apiFetch<Record<string, PermissionSet>>(`${API_BASE}/users/${userId}/permissions`),
    enabled: userId !== null,
  });
}

function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { fullName: string; email: string; password: string }) =>
      apiFetch(`${API_BASE}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      apiFetch(`${API_BASE}/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch(`${API_BASE}/users/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

function useSavePermissions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, permissions }: { userId: number; permissions: Record<string, PermissionSet> }) =>
      apiFetch(`${API_BASE}/users/${userId}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(permissions),
      }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["user-permissions", vars.userId] });
    },
  });
}

export default function UsersPage() {
  const { toast } = useToast();
  const { data: users = [], isLoading } = useUsers();
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<UserWithPerms | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserWithPerms | null>(null);
  const [createForm, setCreateForm] = useState({ fullName: "", email: "", password: "" });
  const [editForm, setEditForm] = useState({ fullName: "", email: "", password: "" });
  const [permMatrix, setPermMatrix] = useState<Record<string, PermissionSet>>(emptyPerms());

  const { data: selectedPerms } = useUserPermissions(selectedUserId);
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const savePermissions = useSavePermissions();

  const selectedUser = users.find((u) => u.id === selectedUserId) ?? null;

  useEffect(() => {
    if (selectedPerms) {
      const perms = emptyPerms();
      Object.keys(selectedPerms).forEach((section) => {
        if (perms[section]) perms[section] = { ...selectedPerms[section] };
      });
      setPermMatrix(perms);
    }
  }, [selectedPerms]);

  // Always ensure every current section has an entry — guards against stale state
  const safeMatrix = (() => {
    const base = emptyPerms();
    Object.keys(permMatrix).forEach((k) => {
      if (base[k]) base[k] = permMatrix[k];
    });
    return base;
  })();

  const handleSelectUser = (user: UserWithPerms) => {
    setSelectedUserId(user.id);
  };

  const handleOpenCreate = () => {
    setCreateForm({ fullName: "", email: "", password: "" });
    setShowCreateDialog(true);
  };

  const handleCreate = async () => {
    if (!createForm.fullName || !createForm.email || !createForm.password) {
      toast({ title: "Error", description: "All fields are required.", variant: "destructive" });
      return;
    }
    try {
      await createUser.mutateAsync(createForm);
      toast({ title: "User created", description: `${createForm.fullName} has been added.` });
      setShowCreateDialog(false);
    } catch (err: unknown) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to create user", variant: "destructive" });
    }
  };

  const handleOpenEdit = (user: UserWithPerms) => {
    setEditingUser(user);
    setEditForm({ fullName: user.fullName, email: user.email, password: "" });
    setShowEditDialog(true);
  };

  const handleEdit = async () => {
    if (!editingUser || !editForm.fullName || !editForm.email) {
      toast({ title: "Error", description: "Name and email are required.", variant: "destructive" });
      return;
    }
    try {
      const data: Record<string, unknown> = { fullName: editForm.fullName, email: editForm.email };
      if (editForm.password) data.password = editForm.password;
      await updateUser.mutateAsync({ id: editingUser.id, data });
      toast({ title: "User updated", description: `${editForm.fullName} has been updated.` });
      setShowEditDialog(false);
      setEditingUser(null);
    } catch (err: unknown) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to update user", variant: "destructive" });
    }
  };

  const handleToggleActive = async (user: UserWithPerms) => {
    try {
      await updateUser.mutateAsync({ id: user.id, data: { isActive: !user.isActive } });
      toast({
        title: user.isActive ? "User deactivated" : "User activated",
        description: `${user.fullName} is now ${user.isActive ? "inactive" : "active"}.`,
      });
    } catch (err: unknown) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to update status", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteUser.mutateAsync(deleteTarget.id);
      toast({ title: "User deleted", description: `${deleteTarget.fullName} has been removed.` });
      if (selectedUserId === deleteTarget.id) setSelectedUserId(null);
      setDeleteTarget(null);
    } catch (err: unknown) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to delete user", variant: "destructive" });
    }
  };

  const togglePerm = (section: string, action: keyof PermissionSet) => {
    setPermMatrix((prev) => ({
      ...prev,
      [section]: { ...prev[section], [action]: !prev[section][action] },
    }));
  };

  const toggleAllSection = (section: string) => {
    const allOn = ACTIONS.every((a) => safeMatrix[section]?.[a.key]);
    setPermMatrix((prev) => ({
      ...prev,
      [section]: { canView: !allOn, canCreate: !allOn, canEdit: !allOn, canDelete: !allOn },
    }));
  };

  const handleSavePermissions = async () => {
    if (!selectedUserId) return;
    try {
      await savePermissions.mutateAsync({ userId: selectedUserId, permissions: safeMatrix });
      toast({ title: "Permissions saved", description: `Permissions for ${selectedUser?.fullName} have been updated.` });
    } catch (err: unknown) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to save permissions", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const permCount = (perms: Record<string, PermissionSet>) => {
    let total = 0;
    let granted = 0;
    Object.values(perms).forEach((p) => {
      ACTIONS.forEach((a) => { total++; if (p[a.key]) granted++; });
    });
    return { total, granted };
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Management"
        description="Manage staff accounts and configure section permissions"
        actions={
          <Button onClick={handleOpenCreate}>
            <UserPlus className="w-4 h-4" />
            Add User
          </Button>
        }
      />

      <TempProdSync /> {/* TEMP MIGRATION — remove after cutover */}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Staff Accounts</h3>
            </div>
            <div className="divide-y divide-border">
              {users.map((u) => {
                const { granted, total } = permCount(u.permissions);
                const isSelected = selectedUserId === u.id;
                return (
                  <div
                    key={u.id}
                    onClick={() => handleSelectUser(u)}
                    className={`px-5 py-4 cursor-pointer transition-colors ${
                      isSelected ? "bg-primary/5 border-l-4 border-l-primary" : "hover:bg-muted/50 border-l-4 border-l-transparent"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{u.fullName}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        <div className="flex items-center gap-3 mt-1.5">
                          <StatusBadge status={u.isActive ? "active" : "inactive"} />
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Shield className="w-3 h-3" />
                            {granted}/{total}
                          </span>
                        </div>
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu
                          trigger={
                            <button className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors">
                              <MoreVertical className="w-4 h-4" />
                            </button>
                          }
                          items={[
                            {
                              label: "Edit",
                              icon: <Pencil className="w-4 h-4" />,
                              onClick: () => handleOpenEdit(u),
                            },
                            {
                              label: u.isActive ? "Deactivate" : "Activate",
                              icon: u.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />,
                              onClick: () => handleToggleActive(u),
                            },
                            {
                              label: "Delete",
                              icon: <Trash2 className="w-4 h-4" />,
                              onClick: () => setDeleteTarget(u),
                              variant: "destructive",
                            },
                          ]}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
              {users.length === 0 && (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                  No users found. Click "Add User" to create one.
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-3">
          <Card>
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" />
                {selectedUser ? `Permissions — ${selectedUser.fullName}` : "Permission Editor"}
              </h3>
              {selectedUser && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setPermMatrix(fullPerms())}
                    className="px-3 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors"
                  >
                    Grant All
                  </button>
                  <button
                    onClick={() => setPermMatrix(emptyPerms())}
                    className="px-3 py-1 text-xs font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                  >
                    Revoke All
                  </button>
                </div>
              )}
            </div>

            {!selectedUser ? (
              <div className="px-5 py-16 text-center text-sm text-muted-foreground">
                Select a user from the list to view and edit their permissions.
              </div>
            ) : (
              <div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-5 py-3 font-medium text-muted-foreground">Section</th>
                        {ACTIONS.map((a) => (
                          <th key={a.key} className="text-center px-3 py-3 font-medium text-muted-foreground">
                            <div className="flex flex-col items-center gap-1">
                              <a.icon className="w-3.5 h-3.5" />
                              <span className="text-[10px]">{a.label}</span>
                            </div>
                          </th>
                        ))}
                        <th className="text-center px-3 py-3 font-medium text-muted-foreground text-xs">All</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {SECTIONS.map((s) => (
                        <tr key={s.key} className="hover:bg-muted/30">
                          <td className="px-5 py-3 font-medium text-foreground">{s.label}</td>
                          {ACTIONS.map((a) => (
                            <td key={a.key} className="text-center px-3 py-3">
                              <button
                                onClick={() => togglePerm(s.key, a.key)}
                                className={`w-6 h-6 rounded-md flex items-center justify-center transition-all mx-auto ${
                                  safeMatrix[s.key][a.key]
                                    ? "bg-primary text-white"
                                    : "bg-gray-100 text-gray-300 hover:bg-gray-200"
                                }`}
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          ))}
                          <td className="text-center px-3 py-3">
                            <button
                              onClick={() => toggleAllSection(s.key)}
                              className="text-xs text-primary hover:underline"
                            >
                              {ACTIONS.every((a) => safeMatrix[s.key][a.key]) ? "None" : "All"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-5 py-4 border-t border-border bg-muted/30 flex justify-end">
                  <Button onClick={handleSavePermissions} disabled={savePermissions.isPending}>
                    {savePermissions.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                    Save Permissions
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Dialog isOpen={showCreateDialog} onClose={() => setShowCreateDialog(false)} title="Add New User">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Full Name *</label>
            <input
              type="text"
              value={createForm.fullName}
              onChange={(e) => setCreateForm((f) => ({ ...f, fullName: e.target.value }))}
              placeholder="Enter full name"
              className="w-full px-4 py-2.5 bg-muted/50 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Email *</label>
            <input
              type="email"
              value={createForm.email}
              onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="user@elebhar.com"
              className="w-full px-4 py-2.5 bg-muted/50 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Password *</label>
            <input
              type="password"
              value={createForm.password}
              onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="Enter password"
              className="w-full px-4 py-2.5 bg-muted/50 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createUser.isPending}>
              {createUser.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Create User
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog isOpen={showEditDialog} onClose={() => { setShowEditDialog(false); setEditingUser(null); }} title="Edit User">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Full Name *</label>
            <input
              type="text"
              value={editForm.fullName}
              onChange={(e) => setEditForm((f) => ({ ...f, fullName: e.target.value }))}
              className="w-full px-4 py-2.5 bg-muted/50 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Email *</label>
            <input
              type="email"
              value={editForm.email}
              onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full px-4 py-2.5 bg-muted/50 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Password (leave blank to keep current)</label>
            <input
              type="password"
              value={editForm.password}
              onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="New password"
              className="w-full px-4 py-2.5 bg-muted/50 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => { setShowEditDialog(false); setEditingUser(null); }}>Cancel</Button>
            <Button onClick={handleEdit} disabled={updateUser.isPending}>
              {updateUser.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Update User
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete User"
        description={`Are you sure you want to delete ${deleteTarget?.fullName}? This action cannot be undone.`}
        confirmLabel="Delete"
        isPending={deleteUser.isPending}
      />
    </div>
  );
}
