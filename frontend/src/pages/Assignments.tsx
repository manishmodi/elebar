import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { useToast, apiErrorMessage } from "@/contexts/toast";
import { useRiderOptions, useVehicleOptions } from "@/hooks/use-options";
import type { Assignment, Paginated, ShiftType } from "@/lib/types";
import { DataTable, type Column } from "@/components/DataTable";
import { Pagination } from "@/components/Pagination";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, todayISO } from "@/lib/format";
import { TextField, SelectField } from "@/components/FormField";

interface AssignmentFormValues {
  rider: string;
  vehicle: string;
  start_date: string;
  end_date: string | null;
  shift_type: ShiftType;
  status: "active" | "ended";
}

const EMPTY: AssignmentFormValues = {
  rider: "",
  vehicle: "",
  start_date: todayISO(),
  end_date: null,
  shift_type: "morning",
  status: "active",
};

export function Assignments() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const riderOptions = useRiderOptions();
  const vehicleOptions = useVehicleOptions();

  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [values, setValues] = useState<AssignmentFormValues>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<Assignment | null>(null);
  const [endTarget, setEndTarget] = useState<Assignment | null>(null);

  const canCreate = hasPermission("assignments", "create");
  const canEdit = hasPermission("assignments", "edit");
  const canDelete = hasPermission("assignments", "delete");

  useEffect(() => {
    if (!modalOpen) setValues(EMPTY);
  }, [modalOpen]);

  const listQuery = useQuery({
    queryKey: ["assignments", "list", { status, page }],
    queryFn: () =>
      api.get<Paginated<Assignment>>("/api/assignments/", {
        status: status || undefined,
        page,
        page_size: 20,
      }),
  });

  const createMutation = useMutation({
    mutationFn: (body: AssignmentFormValues) => api.post<Assignment>("/api/assignments/", body),
    onSuccess: () => {
      toast.success("Assignment created.");
      void qc.invalidateQueries({ queryKey: ["assignments"] });
      setModalOpen(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not create assignment.")),
  });

  const endMutation = useMutation({
    mutationFn: (id: string) => api.patch<Assignment>(`/api/assignments/${id}/`, { status: "ended", end_date: todayISO() }),
    onSuccess: () => {
      toast.success("Assignment ended.");
      void qc.invalidateQueries({ queryKey: ["assignments"] });
      setEndTarget(null);
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not end assignment."));
      setEndTarget(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/assignments/${id}/`),
    onSuccess: () => {
      toast.success("Assignment deleted.");
      void qc.invalidateQueries({ queryKey: ["assignments"] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not delete assignment."));
      setDeleteTarget(null);
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    createMutation.mutate(values);
  };

  const columns: Column<Assignment>[] = [
    { key: "rider_name", header: "Rider", render: (a) => a.rider_name ?? a.rider },
    { key: "vehicle_number", header: "Vehicle", render: (a) => a.vehicle_number ?? a.vehicle },
    { key: "shift_type", header: "Shift", render: (a) => a.shift_type },
    { key: "start_date", header: "Start", render: (a) => formatDate(a.start_date) },
    { key: "end_date", header: "End", render: (a) => formatDate(a.end_date) },
    { key: "status", header: "Status", render: (a) => <StatusBadge status={a.status} /> },
    {
      key: "actions",
      header: "",
      render: (a) => (
        <div style={{ display: "flex", gap: 6 }}>
          {canEdit && a.status === "active" && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEndTarget(a)}>
              End
            </button>
          )}
          {canDelete && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleteTarget(a)}>
              Delete
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Assignments</h1>
          <p className="page-subtitle">Rider-to-vehicle assignments by shift.</p>
        </div>
        <div className="page-actions">
          {canCreate && (
            <button type="button" className="btn btn-primary" onClick={() => setModalOpen(true)}>
              + New Assignment
            </button>
          )}
        </div>
      </div>

      <div className="toolbar">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="ended">Ended</option>
        </select>
      </div>

      <DataTable columns={columns} rows={listQuery.data?.results ?? []} loading={listQuery.isLoading} rowKey={(a) => a.id} />
      <Pagination page={page} pageSize={20} count={listQuery.data?.count ?? 0} onPageChange={setPage} />

      <Modal open={modalOpen} title="New assignment" onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SelectField
            label="Rider"
            required
            value={values.rider}
            onChange={(e) => setValues((v) => ({ ...v, rider: e.target.value }))}
          >
            <option value="">Select rider…</option>
            {riderOptions.data?.results.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Vehicle"
            required
            value={values.vehicle}
            onChange={(e) => setValues((v) => ({ ...v, vehicle: e.target.value }))}
          >
            <option value="">Select vehicle…</option>
            {vehicleOptions.data?.results.map((v) => (
              <option key={v.id} value={v.id}>
                {v.vehicle_number} — {v.plate_number}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Start date"
            type="date"
            required
            value={values.start_date}
            onChange={(e) => setValues((v) => ({ ...v, start_date: e.target.value }))}
          />
          <SelectField
            label="Shift type"
            value={values.shift_type}
            onChange={(e) => setValues((v) => ({ ...v, shift_type: e.target.value as ShiftType }))}
          >
            <option value="morning">Morning</option>
            <option value="day">Day</option>
            <option value="evening">Evening</option>
            <option value="night">Night</option>
          </SelectField>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Create assignment"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(endTarget)}
        title="End assignment"
        message="End this assignment as of today?"
        confirmLabel="End assignment"
        busy={endMutation.isPending}
        onConfirm={() => endTarget && endMutation.mutate(endTarget.id)}
        onCancel={() => setEndTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete assignment"
        message="Delete this assignment record? This cannot be undone."
        confirmLabel="Delete"
        danger
        busy={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
