import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useToast, apiErrorMessage } from "@/contexts/toast";
import type { Paginated, User, UserPermissionRow } from "@/lib/types";
import { DataTable, type Column } from "@/components/DataTable";
import { Modal } from "@/components/Modal";
import { StatusBadge } from "@/components/StatusBadge";
import { TextField } from "@/components/FormField";
import { PermissionMatrix, SECTIONS } from "@/pages/users/PermissionMatrix";

interface UserFormValues {
  full_name: string;
  email: string;
  password: string;
  is_active: boolean;
}

const EMPTY_FORM: UserFormValues = { full_name: "", email: "", password: "", is_active: true };

function emptyPermissions(): UserPermissionRow[] {
  return SECTIONS.map((section) => ({ section, can_view: false, can_create: false, can_edit: false, can_delete: false }));
}

export function Users() {
  const toast = useToast();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<UserFormValues>(EMPTY_FORM);
  const [permissions, setPermissions] = useState<UserPermissionRow[]>(emptyPermissions());

  const listQuery = useQuery({
    queryKey: ["users", "list"],
    queryFn: () => api.get<Paginated<User>>("/api/users/", { page_size: 100 }),
  });

  const permsQuery = useQuery({
    queryKey: ["users", "permissions", editing?.id],
    queryFn: () => api.get<UserPermissionRow[]>(`/api/users/${editing?.id}/permissions/`),
    enabled: Boolean(editing),
  });

  useEffect(() => {
    if (editing) {
      setForm({ full_name: editing.full_name, email: editing.email, password: "", is_active: editing.is_active });
    } else {
      setForm(EMPTY_FORM);
      setPermissions(emptyPermissions());
    }
  }, [editing]);

  useEffect(() => {
    if (permsQuery.data) setPermissions(permsQuery.data);
  }, [permsQuery.data]);

  const createMutation = useMutation({
    mutationFn: () => api.post<User>("/api/users/", { ...form, permissions }),
    onSuccess: () => {
      toast.success("User created.");
      void qc.invalidateQueries({ queryKey: ["users"] });
      closeModal();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not create user.")),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const body: Partial<UserFormValues> = { full_name: form.full_name, email: form.email, is_active: form.is_active };
      if (form.password) body.password = form.password;
      await api.patch(`/api/users/${editing?.id}/`, body);
      await api.put(`/api/users/${editing?.id}/permissions/`, permissions);
    },
    onSuccess: () => {
      toast.success("User updated.");
      void qc.invalidateQueries({ queryKey: ["users"] });
      closeModal();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update user.")),
  });

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (editing) updateMutation.mutate();
    else createMutation.mutate();
  };

  const columns: Column<User>[] = [
    { key: "full_name", header: "Name", render: (u) => u.full_name },
    { key: "email", header: "Email", render: (u) => u.email },
    { key: "is_active", header: "Status", render: (u) => <StatusBadge status={u.is_active ? "active" : "inactive"} /> },
    { key: "is_admin", header: "Role", render: (u) => (u.is_admin ? <span className="badge badge-info">Admin</span> : "Staff") },
    {
      key: "actions",
      header: "",
      render: (u) => (
        <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setEditing(u); setModalOpen(true); }}>
          Edit
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle">Manage staff accounts and section permissions.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setModalOpen(true); }}>
            + New User
          </button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={listQuery.data?.results ?? []}
        loading={listQuery.isLoading}
        rowKey={(u) => u.id}
        onRowClick={(u) => { setEditing(u); setModalOpen(true); }}
      />

      <Modal open={modalOpen} title={editing ? "Edit user" : "New user"} onClose={closeModal} wide>
        <form onSubmit={handleSubmit}>
          <div className="form-grid" style={{ marginBottom: 16 }}>
            <TextField label="Full name" required value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
            <TextField label="Email" type="email" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            <TextField
              label={editing ? "New password (optional)" : "Password"}
              type="password"
              required={!editing}
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
            <label className="checkbox-row" style={{ alignSelf: "end" }}>
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
              Active
            </label>
          </div>

          <h3 style={{ marginBottom: 10, fontSize: 14 }}>Section permissions</h3>
          <PermissionMatrix rows={permissions} onChange={setPermissions} />

          <div className="form-actions" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-ghost" onClick={closeModal}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={createMutation.isPending || updateMutation.isPending}>
              {createMutation.isPending || updateMutation.isPending ? "Saving…" : editing ? "Save changes" : "Create user"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
