import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { useToast, apiErrorMessage } from "@/contexts/toast";
import { useRiderOptions } from "@/hooks/use-options";
import type {
  DailyLog,
  Paginated,
  RiderListItem,
  YangoStatus,
  YangoSyncPersistResult,
  YangoSyncPreviewJob,
} from "@/lib/types";
import { DataTable, type Column } from "@/components/DataTable";
import { Pagination } from "@/components/Pagination";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Currency } from "@/components/Currency";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { formatDate, daysAgoISO, todayISO, toCsv, downloadCsvString } from "@/lib/format";
import { DailyLogForm, type DailyLogFormValues } from "@/pages/daily-logs/DailyLogForm";

export function DailyLogs() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const riderOptions = useRiderOptions();

  const [rider, setRider] = useState("");
  const [range, setRange] = useState<DateRange>({ date_from: daysAgoISO(6), date_to: todayISO() });
  const [page, setPage] = useState(1);
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [selected, setSelected] = useState<DailyLog | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DailyLog | null>(null);
  const [yangoModalOpen, setYangoModalOpen] = useState(false);

  const canCreate = hasPermission("daily-logs", "create");
  const canEdit = hasPermission("daily-logs", "edit");
  const canDelete = hasPermission("daily-logs", "delete");

  // Checked once on mount (per-page, not per-modal-open) so the Yango Sync
  // button can be disabled up front when the integration has no credentials.
  const yangoStatusQuery = useQuery({
    queryKey: ["yango", "status"],
    queryFn: () => api.get<YangoStatus>("/api/yango/status/"),
    enabled: canCreate,
    staleTime: Infinity,
    retry: false,
  });
  const yangoConfigured = yangoStatusQuery.data?.configured ?? true; // optimistic until checked

  const listQuery = useQuery({
    queryKey: ["daily-logs", "list", { rider, range, page }],
    queryFn: () =>
      api.get<Paginated<DailyLog>>("/api/daily-logs/", {
        rider: rider || undefined,
        date_from: range.date_from,
        date_to: range.date_to,
        page,
        page_size: 25,
      }),
  });

  const createMutation = useMutation({
    mutationFn: (body: DailyLogFormValues) => api.post<DailyLog>("/api/daily-logs/", body),
    onSuccess: () => {
      toast.success("Daily log created.");
      void qc.invalidateQueries({ queryKey: ["daily-logs"] });
      closeModal();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not create log.")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: DailyLogFormValues }) =>
      api.patch<DailyLog>(`/api/daily-logs/${id}/`, body),
    onSuccess: () => {
      toast.success("Daily log updated.");
      void qc.invalidateQueries({ queryKey: ["daily-logs"] });
      closeModal();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update log.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/daily-logs/${id}/`),
    onSuccess: () => {
      toast.success("Daily log deleted.");
      void qc.invalidateQueries({ queryKey: ["daily-logs"] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not delete log."));
      setDeleteTarget(null);
    },
  });

  const closeModal = () => {
    setModalMode(null);
    setSelected(null);
  };

  const handleSubmit = async (values: DailyLogFormValues) => {
    if (modalMode === "edit" && selected) {
      await updateMutation.mutateAsync({ id: selected.id, body: values });
    } else {
      await createMutation.mutateAsync(values);
    }
  };

  const handleExport = () => {
    const rows = listQuery.data?.results ?? [];
    if (rows.length === 0) {
      toast.info("Nothing to export.");
      return;
    }
    const csv = toCsv(rows as unknown as Record<string, unknown>[]);
    downloadCsvString(`daily-logs-${range.date_from}_${range.date_to}.csv`, csv);
  };

  const columns: Column<DailyLog>[] = [
    { key: "english_date", header: "Date", render: (l) => formatDate(l.english_date) },
    { key: "rider_name", header: "Rider", render: (l) => l.rider_name ?? l.rider },
    { key: "vehicle_number", header: "Vehicle", render: (l) => l.vehicle_number ?? l.vehicle },
    { key: "rides_completed", header: "Rides", render: (l) => `${l.rides_completed ?? 0}/${l.total_rides_received ?? 0}` },
    { key: "total_income", header: "Income", render: (l) => <Currency value={l.total_income} /> },
    { key: "cash_check", header: "Cash check", render: (l) => <Currency value={l.cash_check} /> },
    {
      key: "draft",
      header: "Draft",
      render: (l) => (l.is_draft ? <span className="badge badge-warning">Draft</span> : <span className="badge badge-success">Final</span>),
    },
    {
      key: "actions",
      header: "",
      render: (l) => (
        <div style={{ display: "flex", gap: 6 }}>
          {canEdit && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setSelected(l); setModalMode("edit"); }}>
              Edit
            </button>
          )}
          {canDelete && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setDeleteTarget(l); }}>
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
          <h1 className="page-title">Daily Logs</h1>
          <p className="page-subtitle">Per-ride performance and cash reconciliation, synced from Yango.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-ghost" onClick={handleExport}>
            Export CSV
          </button>
          {canCreate && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!yangoConfigured}
              title={yangoConfigured ? undefined : "Yango integration is not configured."}
              onClick={() => setYangoModalOpen(true)}
            >
              Yango Sync
            </button>
          )}
          {canCreate && (
            <button type="button" className="btn btn-primary" onClick={() => setModalMode("create")}>
              + New Log
            </button>
          )}
        </div>
      </div>

      {canCreate && !yangoStatusQuery.isLoading && !yangoConfigured && (
        <p className="form-hint yango-unconfigured-notice">
          Yango integration is not configured — sync is unavailable until credentials are set.
        </p>
      )}

      <div className="toolbar">
        <select value={rider} onChange={(e) => { setRider(e.target.value); setPage(1); }}>
          <option value="">All riders</option>
          {riderOptions.data?.results.map((r) => (
            <option key={r.id} value={r.id}>{r.full_name}</option>
          ))}
        </select>
        <DateRangeFilter value={range} onChange={(v) => { setRange(v); setPage(1); }} />
      </div>

      <DataTable
        columns={columns}
        rows={listQuery.data?.results ?? []}
        loading={listQuery.isLoading}
        rowKey={(l) => l.id}
        onRowClick={canEdit ? (l) => { setSelected(l); setModalMode("edit"); } : undefined}
      />
      <Pagination page={page} pageSize={25} count={listQuery.data?.count ?? 0} onPageChange={setPage} />

      <Modal open={modalMode !== null} title={modalMode === "edit" ? "Edit daily log" : "New daily log"} onClose={closeModal} wide>
        <DailyLogForm
          initial={modalMode === "edit" ? selected : null}
          onSubmit={handleSubmit}
          onCancel={closeModal}
          submitting={createMutation.isPending || updateMutation.isPending}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete daily log"
        message="Delete this daily log entry? This cannot be undone."
        confirmLabel="Delete"
        danger
        busy={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />

      <YangoSyncModal
        open={yangoModalOpen}
        riders={riderOptions.data?.results ?? []}
        onClose={() => setYangoModalOpen(false)}
        onSynced={() => setYangoModalOpen(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Yango Sync modal — closes the gap from review finding #6 (backend sync
// endpoints with no frontend consumer). Flow: pick a date + optional riders
// -> POST preview/start -> poll status every 2s -> show the result table ->
// "Save drafts" persists the already-computed preview (POST /sync/ {job_id}).
// ---------------------------------------------------------------------------

interface YangoSyncModalProps {
  open: boolean;
  riders: RiderListItem[];
  onClose: () => void;
  onSynced: () => void;
}

function YangoSyncModal({ open, riders, onClose, onSynced }: YangoSyncModalProps) {
  const toast = useToast();
  const qc = useQueryClient();

  const [date, setDate] = useState(daysAgoISO(1));
  const [riderFilter, setRiderFilter] = useState<string[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);

  // Fresh form every time the modal is (re)opened.
  useEffect(() => {
    if (open) {
      setDate(daysAgoISO(1));
      setRiderFilter([]);
      setJobId(null);
    }
  }, [open]);

  const linkedRiders = riders.filter((r) => r.yango_driver_id);
  const unlinkedCount = riders.length - linkedRiders.length;

  const startMutation = useMutation({
    mutationFn: (body: { date: string; riders?: string[] }) =>
      api.post<YangoSyncPreviewJob>("/api/yango/sync/preview/start/", body),
    onSuccess: (job) => setJobId(job.job_id),
    onError: (err) => toast.error(apiErrorMessage(err, "Could not start Yango sync.")),
  });

  const statusQuery = useQuery({
    queryKey: ["yango", "preview-status", jobId],
    queryFn: () => api.get<YangoSyncPreviewJob>(`/api/yango/sync/preview/status/${jobId}/`),
    enabled: open && Boolean(jobId),
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2000 : false),
  });

  // 404 => the job expired from cache; reset to the form instead of polling forever.
  useEffect(() => {
    if (!statusQuery.error) return;
    if (statusQuery.error instanceof ApiError && statusQuery.error.status === 404) {
      toast.error(apiErrorMessage(statusQuery.error, "Sync job expired. Please start again."));
      setJobId(null);
    } else {
      toast.error(apiErrorMessage(statusQuery.error, "Could not check sync status."));
    }
  }, [statusQuery.error]);

  const persistMutation = useMutation({
    mutationFn: (id: string) => api.post<YangoSyncPersistResult>("/api/yango/sync/", { job_id: id }),
    onSuccess: (result) => {
      toast.success(
        `Yango sync saved — ${result.created} created, ${result.updated} updated, ${result.skipped} skipped.`,
      );
      void qc.invalidateQueries({ queryKey: ["daily-logs"] });
      onSynced();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save synced drafts.")),
  });

  const toggleRider = (id: string) => {
    setRiderFilter((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  };

  const handleStart = () => {
    const body: { date: string; riders?: string[] } = { date };
    if (riderFilter.length > 0) body.riders = riderFilter;
    startMutation.mutate(body);
  };

  const handleClose = () => {
    setJobId(null);
    onClose();
  };

  const job = statusQuery.data;
  const isRunning = Boolean(jobId) && (!job || job.status === "running");
  const isDone = job?.status === "done";
  const isJobError = job?.status === "error";
  const rows = job?.result?.riders ?? [];

  const statusLabel = (status: string) => {
    switch (status) {
      case "new":
        return <span className="badge badge-warning">New draft</span>;
      case "draft_exists":
        return <span className="badge badge-warning">Draft updated</span>;
      case "finalized_exists":
        return <span className="badge badge-success">Already finalized</span>;
      case "error":
        return <span className="badge badge-danger">Error</span>;
      default:
        return <span className="badge badge-neutral">{status}</span>;
    }
  };

  return (
    <Modal
      open={open}
      title="Yango Sync"
      onClose={handleClose}
      wide
      footer={
        jobId === null ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={handleClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={startMutation.isPending || !date}
              onClick={handleStart}
            >
              {startMutation.isPending ? "Starting…" : "Start"}
            </button>
          </>
        ) : isDone ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={handleClose}>
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={persistMutation.isPending || rows.length === 0}
              onClick={() => jobId && persistMutation.mutate(jobId)}
            >
              {persistMutation.isPending ? "Saving…" : "Save drafts"}
            </button>
          </>
        ) : isJobError ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={handleClose}>
              Close
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setJobId(null)}>
              Start again
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={handleClose}>
            Close
          </button>
        )
      }
    >
      {jobId === null && (
        <div className="form-grid">
          <label className="form-field">
            <span className="form-label">Date</span>
            <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
      )}

      {jobId === null && (
        <div style={{ marginTop: 14 }}>
          <span className="form-label">Riders (optional — leave empty for all linked riders)</span>
          {unlinkedCount > 0 && (
            <p className="form-hint">
              {unlinkedCount} rider{unlinkedCount === 1 ? "" : "s"} not linked to a Yango driver — link them on the
              Riders page to include them here.
            </p>
          )}
          <div className="yango-rider-picklist">
            {linkedRiders.length === 0 ? (
              <p className="text-muted">No riders are linked to Yango driver profiles yet.</p>
            ) : (
              linkedRiders.map((r) => (
                <label key={r.id} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={riderFilter.includes(r.id)}
                    onChange={() => toggleRider(r.id)}
                  />
                  <span>{r.full_name}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}

      {jobId !== null && isRunning && (
        <div className="yango-progress">
          <p>Fetching figures from Yango — this can take a while for many riders.</p>
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{
                width: job && job.progress.total > 0 ? `${(job.progress.completed / job.progress.total) * 100}%` : "5%",
              }}
            />
          </div>
          <p className="form-hint">
            {job ? `${job.progress.completed} / ${job.progress.total} riders processed` : "Starting…"}
          </p>
        </div>
      )}

      {jobId !== null && isJobError && (
        <p className="form-error">{job?.error ?? "The sync job failed. Please try again."}</p>
      )}

      {jobId !== null && isDone && (
        <div>
          {rows.length === 0 ? (
            <p className="text-muted">No rider activity found for {job?.date}.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rider</th>
                  <th>Rides</th>
                  <th>Cash (app)</th>
                  <th>Income</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.rider_id}>
                    <td>{row.rider_name}</td>
                    <td>
                      {row.rides_completed ?? "-"}
                      {row.total_rides_received != null ? ` / ${row.total_rides_received}` : ""}
                    </td>
                    <td><Currency value={row.cash_as_per_app ?? null} /></td>
                    <td><Currency value={row.total_income ?? null} /></td>
                    <td>{statusLabel(row.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Modal>
  );
}
