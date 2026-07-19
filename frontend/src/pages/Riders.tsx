import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { useToast, apiErrorMessage } from "@/contexts/toast";
import type {
  Paginated,
  Rider,
  RiderListItem,
  RiderStats,
  YangoDriversResponse,
  YangoStatus,
} from "@/lib/types";
import { DataTable, type Column } from "@/components/DataTable";
import { Pagination } from "@/components/Pagination";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { Currency } from "@/components/Currency";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { formatDate, daysAgoISO, todayISO } from "@/lib/format";
import { RiderForm, type RiderFormValues } from "@/pages/riders/RiderForm";

export function Riders() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [range, setRange] = useState<DateRange>({ date_from: daysAgoISO(29), date_to: todayISO() });
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RiderListItem | null>(null);
  const [yangoRider, setYangoRider] = useState<RiderListItem | null>(null);
  const [yangoId, setYangoId] = useState("");
  const [yangoDriverName, setYangoDriverName] = useState("");
  const [yangoSearch, setYangoSearch] = useState("");

  const canCreate = hasPermission("riders", "create");
  const canEdit = hasPermission("riders", "edit");
  const canDelete = hasPermission("riders", "delete");

  const listQuery = useQuery({
    queryKey: ["riders", "list", { search, status, page }],
    queryFn: () =>
      api.get<Paginated<RiderListItem>>("/api/riders/", {
        search: search || undefined,
        status: status || undefined,
        page,
        page_size: 20,
      }),
  });

  const statsQuery = useQuery({
    queryKey: ["riders", "stats", range],
    queryFn: () => api.get<RiderStats>("/api/riders/stats/", range),
  });

  const detailQuery = useQuery({
    queryKey: ["riders", "detail", selectedId],
    queryFn: () => api.get<Rider>(`/api/riders/${selectedId}/`),
    enabled: Boolean(selectedId),
  });

  const createMutation = useMutation({
    mutationFn: (body: RiderFormValues) => api.post<Rider>("/api/riders/", body),
    onSuccess: () => {
      toast.success("Rider created.");
      void qc.invalidateQueries({ queryKey: ["riders"] });
      closeModal();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not create rider.")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: RiderFormValues }) =>
      api.patch<Rider>(`/api/riders/${id}/`, body),
    onSuccess: () => {
      toast.success("Rider updated.");
      void qc.invalidateQueries({ queryKey: ["riders"] });
      closeModal();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update rider.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/riders/${id}/`),
    onSuccess: () => {
      toast.success("Rider deleted.");
      void qc.invalidateQueries({ queryKey: ["riders"] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not delete rider."));
      setDeleteTarget(null);
    },
  });

  const yangoLinkMutation = useMutation({
    mutationFn: ({ id, yango_driver_id }: { id: string; yango_driver_id: string }) =>
      api.put(`/api/yango/riders/${id}/link/`, { yango_driver_id }),
    onSuccess: () => {
      toast.success("Yango driver linked.");
      void qc.invalidateQueries({ queryKey: ["riders"] });
      setYangoRider(null);
    },
    // Surfaces both validation errors and the 409 "already linked to <rider>" conflict.
    onError: (err) => toast.error(apiErrorMessage(err, "Could not link Yango driver.")),
  });

  // Driver picker: falls back to the paste-an-id input when the integration
  // has no credentials configured (GET /drivers/ would 503 in that case).
  const yangoStatusQuery = useQuery({
    queryKey: ["yango", "status"],
    queryFn: () => api.get<YangoStatus>("/api/yango/status/"),
    enabled: Boolean(yangoRider),
    staleTime: 60_000,
  });
  const yangoConfigured = yangoStatusQuery.data?.configured ?? false;

  const yangoDriversQuery = useQuery({
    queryKey: ["yango", "drivers", yangoSearch],
    queryFn: () => api.get<YangoDriversResponse>("/api/yango/drivers/", { q: yangoSearch || undefined }),
    enabled: Boolean(yangoRider) && yangoConfigured,
  });

  const closeModal = () => {
    setModalMode(null);
    setSelectedId(null);
  };

  const openCreate = () => {
    setModalMode("create");
    setSelectedId(null);
  };

  const openEdit = (row: RiderListItem) => {
    setSelectedId(row.id);
    setModalMode("edit");
  };

  const handleSubmit = async (values: RiderFormValues) => {
    if (modalMode === "edit" && selectedId) {
      await updateMutation.mutateAsync({ id: selectedId, body: values });
    } else {
      await createMutation.mutateAsync(values);
    }
  };

  const columns: Column<RiderListItem>[] = [
    { key: "full_name", header: "Name", render: (r) => r.full_name },
    { key: "phone_number", header: "Phone", render: (r) => r.phone_number },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "employment_type",
      header: "Employment",
      render: (r) => r.employment_type.replace("_", " "),
    },
    { key: "joining_date", header: "Joined", render: (r) => formatDate(r.joining_date) },
    { key: "monthly_salary", header: "Salary", render: (r) => <Currency value={r.monthly_salary} /> },
    { key: "target", header: "Daily target", render: (r) => r.daily_ride_target },
    {
      key: "yango",
      header: "Yango",
      render: (r) =>
        r.yango_driver_id ? (
          <span className="badge badge-info">{r.yango_driver_id}</span>
        ) : (
          <button
            type="button"
            className="link-btn"
            onClick={(e) => {
              e.stopPropagation();
              setYangoRider(r);
              setYangoId("");
              setYangoDriverName("");
              setYangoSearch("");
            }}
          >
            Link
          </button>
        ),
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <div style={{ display: "flex", gap: 6 }}>
          {canEdit && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); openEdit(r); }}>
              Edit
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget(r);
              }}
            >
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
          <h1 className="page-title">Riders</h1>
          <p className="page-subtitle">Manage rider KYC records, employment terms, and Yango linkage.</p>
        </div>
        <div className="page-actions">
          {canCreate && (
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              + New Rider
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Log days</div>
          <div className="kpi-value">{statsQuery.data?.log_days ?? "-"}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Total rides</div>
          <div className="kpi-value">{statsQuery.data?.total_rides ?? "-"}</div>
          <div className={`kpi-sub ${(statsQuery.data?.growth.rides ?? 0) >= 0 ? "positive" : "negative"}`}>
            {statsQuery.data?.growth.rides != null
              ? `${statsQuery.data.growth.rides >= 0 ? "+" : ""}${statsQuery.data.growth.rides.toFixed(1)}%`
              : ""}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Total income</div>
          <div className="kpi-value"><Currency value={statsQuery.data?.total_income} /></div>
          <div className={`kpi-sub ${(statsQuery.data?.growth.income ?? 0) >= 0 ? "positive" : "negative"}`}>
            {statsQuery.data?.growth.income != null
              ? `${statsQuery.data.growth.income >= 0 ? "+" : ""}${statsQuery.data.growth.income.toFixed(1)}%`
              : ""}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Avg rides / day</div>
          <div className="kpi-value">{statsQuery.data?.avg_rides_per_day.toFixed(1) ?? "-"}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Avg income / day</div>
          <div className="kpi-value"><Currency value={statsQuery.data?.avg_income_per_day} /></div>
        </div>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search by name or phone…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        rows={listQuery.data?.results ?? []}
        loading={listQuery.isLoading}
        rowKey={(r) => r.id}
        onRowClick={canEdit ? openEdit : undefined}
      />
      <Pagination page={page} pageSize={20} count={listQuery.data?.count ?? 0} onPageChange={setPage} />

      <Modal
        open={modalMode !== null}
        title={modalMode === "edit" ? "Edit rider" : "New rider"}
        onClose={closeModal}
        wide
      >
        {modalMode === "edit" && detailQuery.isLoading ? (
          <p className="text-muted">Loading rider…</p>
        ) : (
          <RiderForm
            initial={modalMode === "edit" ? detailQuery.data ?? null : null}
            onSubmit={handleSubmit}
            onCancel={closeModal}
            submitting={createMutation.isPending || updateMutation.isPending}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete rider"
        message={`Delete ${deleteTarget?.full_name ?? "this rider"}? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        busy={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />

      <Modal
        open={Boolean(yangoRider)}
        title={`Link Yango driver — ${yangoRider?.full_name ?? ""}`}
        onClose={() => setYangoRider(null)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setYangoRider(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!yangoId || yangoLinkMutation.isPending}
              onClick={() => yangoRider && yangoLinkMutation.mutate({ id: yangoRider.id, yango_driver_id: yangoId })}
            >
              Link
            </button>
          </>
        }
      >
        {!yangoStatusQuery.isLoading && yangoConfigured ? (
          <div>
            <label className="form-field">
              <span className="form-label">Search Yango drivers</span>
              <input
                value={yangoSearch}
                onChange={(e) => setYangoSearch(e.target.value)}
                placeholder="Search by name or phone…"
              />
            </label>
            {yangoId && (
              <p className="form-hint">
                Selected: {yangoDriverName || yangoId} ({yangoId})
              </p>
            )}
            <div className="yango-rider-picklist" style={{ marginTop: 8 }}>
              {yangoDriversQuery.isLoading ? (
                <p className="text-muted">Loading drivers…</p>
              ) : (yangoDriversQuery.data?.drivers.length ?? 0) === 0 ? (
                <p className="text-muted">No drivers found.</p>
              ) : (
                yangoDriversQuery.data?.drivers.map((d) => (
                  <button
                    type="button"
                    key={d.driver_profile_id}
                    className={`link-btn ${yangoId === d.driver_profile_id ? "yango-driver-selected" : ""}`}
                    style={{ textAlign: "left" }}
                    onClick={() => {
                      setYangoId(d.driver_profile_id);
                      setYangoDriverName(d.name);
                    }}
                  >
                    {d.name} — {(d.phones ?? []).join(", ") || d.driver_profile_id}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <label className="form-field">
            <span className="form-label">Yango driver ID</span>
            <input value={yangoId} onChange={(e) => setYangoId(e.target.value)} placeholder="Paste Yango driver ID" />
            {!yangoStatusQuery.isLoading && !yangoConfigured && (
              <span className="form-hint">
                Yango integration is not configured — paste the driver ID directly.
              </span>
            )}
          </label>
        )}
      </Modal>
    </div>
  );
}
