import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { useToast, apiErrorMessage } from "@/contexts/toast";
import type { Paginated, Vehicle } from "@/lib/types";
import { DataTable, type Column } from "@/components/DataTable";
import { Pagination } from "@/components/Pagination";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/format";
import { VehicleForm, type VehicleFormValues } from "@/pages/vehicles/VehicleForm";

export function Vehicles() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [selected, setSelected] = useState<Vehicle | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Vehicle | null>(null);

  const canCreate = hasPermission("vehicles", "create");
  const canEdit = hasPermission("vehicles", "edit");
  const canDelete = hasPermission("vehicles", "delete");

  const listQuery = useQuery({
    queryKey: ["vehicles", "list", { search, status, page }],
    queryFn: () =>
      api.get<Paginated<Vehicle>>("/api/vehicles/", {
        search: search || undefined,
        status: status || undefined,
        page,
        page_size: 20,
      }),
  });

  const createMutation = useMutation({
    mutationFn: (body: VehicleFormValues) => api.post<Vehicle>("/api/vehicles/", body),
    onSuccess: () => {
      toast.success("Vehicle created.");
      void qc.invalidateQueries({ queryKey: ["vehicles"] });
      closeModal();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not create vehicle.")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: VehicleFormValues }) =>
      api.patch<Vehicle>(`/api/vehicles/${id}/`, body),
    onSuccess: () => {
      toast.success("Vehicle updated.");
      void qc.invalidateQueries({ queryKey: ["vehicles"] });
      closeModal();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update vehicle.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/vehicles/${id}/`),
    onSuccess: () => {
      toast.success("Vehicle deleted.");
      void qc.invalidateQueries({ queryKey: ["vehicles"] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not delete vehicle."));
      setDeleteTarget(null);
    },
  });

  const closeModal = () => {
    setModalMode(null);
    setSelected(null);
  };

  const handleSubmit = async (values: VehicleFormValues) => {
    if (modalMode === "edit" && selected) {
      await updateMutation.mutateAsync({ id: selected.id, body: values });
    } else {
      await createMutation.mutateAsync(values);
    }
  };

  const columns: Column<Vehicle>[] = [
    { key: "vehicle_number", header: "Number", render: (v) => <strong>{v.vehicle_number}</strong> },
    { key: "plate_number", header: "Plate", render: (v) => v.plate_number },
    { key: "brand", header: "Brand / model", render: (v) => `${v.brand} ${v.model}` },
    { key: "status", header: "Status", render: (v) => <StatusBadge status={v.status} /> },
    { key: "odometer_reading", header: "Odometer", render: (v) => `${v.odometer_reading ?? 0} km` },
    { key: "location_branch", header: "Branch", render: (v) => v.location_branch ?? "-" },
    { key: "insurance_expiry", header: "Insurance expiry", render: (v) => formatDate(v.insurance_expiry) },
    {
      key: "actions",
      header: "",
      render: (v) => (
        <div style={{ display: "flex", gap: 6 }}>
          {canEdit && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                setSelected(v);
                setModalMode("edit");
              }}
            >
              Edit
            </button>
          )}
          {canDelete && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setDeleteTarget(v); }}>
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
          <h1 className="page-title">Vehicles</h1>
          <p className="page-subtitle">Fleet inventory, documents, servicing, and branding.</p>
        </div>
        <div className="page-actions">
          {canCreate && (
            <button type="button" className="btn btn-primary" onClick={() => setModalMode("create")}>
              + New Vehicle
            </button>
          )}
        </div>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search by plate or number…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="maintenance">Maintenance</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        rows={listQuery.data?.results ?? []}
        loading={listQuery.isLoading}
        rowKey={(v) => v.id}
        onRowClick={canEdit ? (v) => { setSelected(v); setModalMode("edit"); } : undefined}
      />
      <Pagination page={page} pageSize={20} count={listQuery.data?.count ?? 0} onPageChange={setPage} />

      <Modal open={modalMode !== null} title={modalMode === "edit" ? "Edit vehicle" : "New vehicle"} onClose={closeModal} wide>
        <VehicleForm
          initial={modalMode === "edit" ? selected : null}
          onSubmit={handleSubmit}
          onCancel={closeModal}
          submitting={createMutation.isPending || updateMutation.isPending}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete vehicle"
        message={`Delete ${deleteTarget?.vehicle_number ?? "this vehicle"}? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        busy={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
