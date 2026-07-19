import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { useToast, apiErrorMessage } from "@/contexts/toast";
import { useRiderOptions } from "@/hooks/use-options";
import type { DailyLog, Paginated } from "@/lib/types";
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

  const canCreate = hasPermission("daily-logs", "create");
  const canEdit = hasPermission("daily-logs", "edit");
  const canDelete = hasPermission("daily-logs", "delete");

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
            <button type="button" className="btn btn-primary" onClick={() => setModalMode("create")}>
              + New Log
            </button>
          )}
        </div>
      </div>

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
    </div>
  );
}
