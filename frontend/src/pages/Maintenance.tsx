import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { useToast, apiErrorMessage } from "@/contexts/toast";
import { useVehicleOptions } from "@/hooks/use-options";
import type { MaintenanceRecord, MaintenanceType, Paginated, ServicingHistoryEntry, ServicingStatusRow } from "@/lib/types";
import { DataTable, type Column } from "@/components/DataTable";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { Currency } from "@/components/Currency";
import { TextField, SelectField, TextAreaField } from "@/components/FormField";
import { formatDate, todayISO } from "@/lib/format";

type MaintenanceFormValues = Omit<MaintenanceRecord, "id" | "vehicle_number">;

const EMPTY_MAINT: MaintenanceFormValues = {
  vehicle: "",
  maintenance_type: "battery_service",
  date: todayISO(),
  cost: "0",
  description: null,
  next_service_date: null,
};

export function Maintenance() {
  const [tab, setTab] = useState<"servicing" | "records">("servicing");
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Maintenance</h1>
          <p className="page-subtitle">Servicing schedule and repair history.</p>
        </div>
      </div>
      <div className="tabs">
        <button type="button" className={`tab-btn ${tab === "servicing" ? "active" : ""}`} onClick={() => setTab("servicing")}>
          Servicing
        </button>
        <button type="button" className={`tab-btn ${tab === "records" ? "active" : ""}`} onClick={() => setTab("records")}>
          Maintenance Records
        </button>
      </div>
      {tab === "servicing" ? <ServicingBoard /> : <MaintenanceRecords />}
    </div>
  );
}

function ServicingBoard() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canEdit = hasPermission("maintenance", "edit");
  const [logTarget, setLogTarget] = useState<ServicingStatusRow | null>(null);
  const [logValues, setLogValues] = useState({ service_date: todayISO(), odometer_at_service: "", notes: "", cost: "" });

  const statusQuery = useQuery({
    queryKey: ["servicing", "status"],
    queryFn: () => api.get<ServicingStatusRow[]>("/api/servicing/status/"),
  });

  const sendMutation = useMutation({
    mutationFn: (vehicle: string) => api.post("/api/servicing/send/", { vehicle }),
    onSuccess: () => {
      toast.success("Vehicle sent to servicing.");
      void qc.invalidateQueries({ queryKey: ["servicing"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not send to servicing.")),
  });

  const cancelMutation = useMutation({
    mutationFn: (vehicle: string) => api.post("/api/servicing/cancel/", { vehicle }),
    onSuccess: () => {
      toast.success("Servicing cancelled.");
      void qc.invalidateQueries({ queryKey: ["servicing"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not cancel servicing.")),
  });

  const logMutation = useMutation({
    mutationFn: () =>
      api.post<ServicingHistoryEntry>("/api/servicing/history/", {
        vehicle: logTarget?.vehicle,
        service_date: logValues.service_date,
        odometer_at_service: Number(logValues.odometer_at_service),
        notes: logValues.notes || null,
        cost: logValues.cost || "0",
      }),
    onSuccess: () => {
      toast.success("Service logged.");
      void qc.invalidateQueries({ queryKey: ["servicing"] });
      setLogTarget(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not log service.")),
  });

  const rows = statusQuery.data ?? [];

  return (
    <div>
      {statusQuery.isLoading ? (
        <p className="text-muted">Loading servicing status…</p>
      ) : rows.length === 0 ? (
        <div className="empty-state">No vehicles found.</div>
      ) : (
        <div className="card-grid">
          {rows.map((r) => (
            <div className="stat-card" key={r.vehicle}>
              <div className="stat-card-header">
                <strong>{r.vehicle_number}</strong>
                <StatusBadge status={r.service_status} />
              </div>
              <p className="text-muted" style={{ marginBottom: 8 }}>{r.plate_number}</p>
              <div className="stat-row"><span>Status</span><strong>{r.status}</strong></div>
              <div className="stat-row"><span>Current odometer</span><strong>{r.current_odometer ?? "-"} km</strong></div>
              <div className="stat-row"><span>Last service odometer</span><strong>{r.last_service_odometer ?? "-"} km</strong></div>
              <div className="stat-row"><span>Last service date</span><strong>{formatDate(r.last_service_date)}</strong></div>
              <div className="stat-row"><span>Km since service</span><strong>{r.km_since_service ?? "-"}</strong></div>
              <div className="stat-row"><span>Km until due</span><strong>{r.km_until_due ?? "-"}</strong></div>
              {r.in_servicing_since && (
                <div className="stat-row"><span>In servicing since</span><strong>{formatDate(r.in_servicing_since)}</strong></div>
              )}
              {canEdit && (
                <div className="form-actions" style={{ marginTop: 10 }}>
                  {r.status === "maintenance" ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => cancelMutation.mutate(r.vehicle)}>
                      Cancel servicing
                    </button>
                  ) : (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => sendMutation.mutate(r.vehicle)}>
                      Send to servicing
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setLogTarget(r);
                      setLogValues({ service_date: todayISO(), odometer_at_service: String(r.current_odometer ?? ""), notes: "", cost: "" });
                    }}
                  >
                    Log service
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={Boolean(logTarget)} title={`Log service — ${logTarget?.vehicle_number ?? ""}`} onClose={() => setLogTarget(null)}>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            logMutation.mutate();
          }}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <TextField label="Service date" type="date" required value={logValues.service_date} onChange={(e) => setLogValues((v) => ({ ...v, service_date: e.target.value }))} />
          <TextField label="Odometer at service" type="number" required value={logValues.odometer_at_service} onChange={(e) => setLogValues((v) => ({ ...v, odometer_at_service: e.target.value }))} />
          <TextField label="Cost" type="number" step="0.01" value={logValues.cost} onChange={(e) => setLogValues((v) => ({ ...v, cost: e.target.value }))} />
          <TextAreaField label="Notes" value={logValues.notes} onChange={(e) => setLogValues((v) => ({ ...v, notes: e.target.value }))} />
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setLogTarget(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={logMutation.isPending}>
              {logMutation.isPending ? "Saving…" : "Log service"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function MaintenanceRecords() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const vehicleOptions = useVehicleOptions();
  const [modalOpen, setModalOpen] = useState(false);
  const [values, setValues] = useState<MaintenanceFormValues>(EMPTY_MAINT);
  const [deleteTarget, setDeleteTarget] = useState<MaintenanceRecord | null>(null);

  const canCreate = hasPermission("maintenance", "create");
  const canDelete = hasPermission("maintenance", "delete");

  const listQuery = useQuery({
    queryKey: ["maintenance", "list"],
    queryFn: () => api.get<Paginated<MaintenanceRecord>>("/api/maintenance/", { page_size: 100 }),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post<MaintenanceRecord>("/api/maintenance/", values),
    onSuccess: () => {
      toast.success("Maintenance record created.");
      void qc.invalidateQueries({ queryKey: ["maintenance"] });
      setModalOpen(false);
      setValues(EMPTY_MAINT);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not create record.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/maintenance/${id}/`),
    onSuccess: () => {
      toast.success("Record deleted.");
      void qc.invalidateQueries({ queryKey: ["maintenance"] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not delete record."));
      setDeleteTarget(null);
    },
  });

  const columns: Column<MaintenanceRecord>[] = [
    { key: "date", header: "Date", render: (m) => formatDate(m.date) },
    { key: "vehicle_number", header: "Vehicle", render: (m) => m.vehicle_number ?? m.vehicle },
    { key: "maintenance_type", header: "Type", render: (m) => m.maintenance_type.replace(/_/g, " ") },
    { key: "cost", header: "Cost", render: (m) => <Currency value={m.cost} /> },
    { key: "next_service_date", header: "Next service", render: (m) => formatDate(m.next_service_date) },
    { key: "description", header: "Notes", render: (m) => m.description ?? "-" },
    {
      key: "actions",
      header: "",
      render: (m) =>
        canDelete ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleteTarget(m)}>
            Delete
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      <div className="page-actions" style={{ marginBottom: 12, justifyContent: "flex-end", display: "flex" }}>
        {canCreate && (
          <button type="button" className="btn btn-primary" onClick={() => setModalOpen(true)}>
            + New Record
          </button>
        )}
      </div>
      <DataTable columns={columns} rows={listQuery.data?.results ?? []} loading={listQuery.isLoading} rowKey={(m) => m.id} />

      <Modal open={modalOpen} title="New maintenance record" onClose={() => setModalOpen(false)}>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            createMutation.mutate();
          }}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <SelectField label="Vehicle" required value={values.vehicle} onChange={(e) => setValues((v) => ({ ...v, vehicle: e.target.value }))}>
            <option value="">Select vehicle…</option>
            {vehicleOptions.data?.results.map((v) => (
              <option key={v.id} value={v.id}>{v.vehicle_number}</option>
            ))}
          </SelectField>
          <SelectField label="Maintenance type" value={values.maintenance_type} onChange={(e) => setValues((v) => ({ ...v, maintenance_type: e.target.value as MaintenanceType }))}>
            <option value="battery_service">Battery service</option>
            <option value="tire_replacement">Tire replacement</option>
            <option value="brake_service">Brake service</option>
            <option value="electrical_repair">Electrical repair</option>
            <option value="accident_repair">Accident repair</option>
          </SelectField>
          <TextField label="Date" type="date" required value={values.date} onChange={(e) => setValues((v) => ({ ...v, date: e.target.value }))} />
          <TextField label="Cost" type="number" step="0.01" required value={values.cost} onChange={(e) => setValues((v) => ({ ...v, cost: e.target.value }))} />
          <TextField label="Next service date" type="date" value={values.next_service_date ?? ""} onChange={(e) => setValues((v) => ({ ...v, next_service_date: e.target.value || null }))} />
          <TextAreaField label="Description" value={values.description ?? ""} onChange={(e) => setValues((v) => ({ ...v, description: e.target.value || null }))} />
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Create"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete maintenance record"
        message="Delete this maintenance record? This cannot be undone."
        confirmLabel="Delete"
        danger
        busy={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
