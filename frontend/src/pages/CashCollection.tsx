import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { useToast, apiErrorMessage } from "@/contexts/toast";
import { useRiderOptions } from "@/hooks/use-options";
import type { CashCollection as CashRow, Paginated } from "@/lib/types";
import { DataTable, type Column } from "@/components/DataTable";
import { Modal } from "@/components/Modal";
import { StatusBadge } from "@/components/StatusBadge";
import { Currency } from "@/components/Currency";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { TextField, SelectField } from "@/components/FormField";
import { formatDateTime, daysAgoISO, todayISO } from "@/lib/format";

const DENOMS = [1000, 500, 100, 50, 20, 10] as const;

type FormValues = {
  rider: string;
  english_date: string;
  nepali_date: string;
  denom_1000: number;
  denom_500: number;
  denom_100: number;
  denom_50: number;
  denom_20: number;
  denom_10: number;
  wallet_amount: string;
  note: string;
};

const EMPTY: FormValues = {
  rider: "",
  english_date: todayISO(),
  nepali_date: "",
  denom_1000: 0,
  denom_500: 0,
  denom_100: 0,
  denom_50: 0,
  denom_20: 0,
  denom_10: 0,
  wallet_amount: "0",
  note: "",
};

export function CashCollection() {
  const { hasPermission, isAdmin } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const riderOptions = useRiderOptions();

  const [range, setRange] = useState<DateRange>({ date_from: daysAgoISO(6), date_to: todayISO() });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CashRow | null>(null);
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [approveTarget, setApproveTarget] = useState<{ row: CashRow; kind: "approve" | "disapprove" } | null>(null);
  const [approveNote, setApproveNote] = useState("");
  const [detailRow, setDetailRow] = useState<CashRow | null>(null);

  const canCreate = hasPermission("cash-collection", "create");
  const canEdit = hasPermission("cash-collection", "edit");

  const listQuery = useQuery({
    queryKey: ["cash-collection", "list", range],
    queryFn: () =>
      api.get<Paginated<CashRow>>("/api/cash-collection/", {
        date_from: range.date_from,
        date_to: range.date_to,
        page_size: 100,
      }),
  });

  useEffect(() => {
    if (editing) {
      setValues({
        rider: editing.rider,
        english_date: editing.english_date,
        nepali_date: editing.nepali_date ?? "",
        denom_1000: editing.denom_1000,
        denom_500: editing.denom_500,
        denom_100: editing.denom_100,
        denom_50: editing.denom_50,
        denom_20: editing.denom_20,
        denom_10: editing.denom_10,
        wallet_amount: editing.wallet_amount,
        note: editing.note ?? "",
      });
    } else {
      setValues(EMPTY);
    }
  }, [editing]);

  const createMutation = useMutation({
    mutationFn: () => api.post<CashRow>("/api/cash-collection/", { ...values, note: values.note || "" }),
    onSuccess: () => {
      toast.success("Cash collection submitted.");
      void qc.invalidateQueries({ queryKey: ["cash-collection"] });
      setModalOpen(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not submit cash collection.")),
  });

  const updateMutation = useMutation({
    mutationFn: () => api.patch<CashRow>(`/api/cash-collection/${editing?.id}/`, { ...values, note: values.note || "" }),
    onSuccess: () => {
      toast.success("Cash collection updated.");
      void qc.invalidateQueries({ queryKey: ["cash-collection"] });
      setModalOpen(false);
      setEditing(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update cash collection.")),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, kind, note }: { id: string; kind: "approve" | "disapprove"; note: string }) =>
      api.post(`/api/cash-collection/${id}/${kind}/`, { note: note || undefined }),
    onSuccess: (_data, vars) => {
      toast.success(vars.kind === "approve" ? "Collection approved." : "Collection disapproved.");
      void qc.invalidateQueries({ queryKey: ["cash-collection"] });
      setApproveTarget(null);
      setApproveNote("");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Action failed.")),
  });

  const denomTotal = DENOMS.reduce((sum, d) => sum + d * (values[`denom_${d}` as keyof FormValues] as number), 0);
  const grandTotal = denomTotal + (parseFloat(values.wallet_amount) || 0);

  const canEditRow = (row: CashRow) => {
    if (isAdmin) return true;
    if (!canEdit) return false;
    const submitted = new Date(row.submitted_at).getTime();
    return Date.now() - submitted < 5 * 60 * 1000;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (editing) updateMutation.mutate();
    else createMutation.mutate();
  };

  const columns: Column<CashRow>[] = [
    { key: "english_date", header: "Date", render: (r) => r.english_date },
    { key: "rider_name", header: "Rider", render: (r) => r.rider_name ?? r.rider },
    { key: "cash_total", header: "Cash total", render: (r) => <Currency value={r.cash_total} /> },
    { key: "grand_total", header: "Grand total", render: (r) => <Currency value={r.grand_total} /> },
    {
      key: "cash_variance",
      header: "Variance",
      // variance = expected - collected: positive means the rider is short
      render: (r) => (
        <span className={r.cash_variance && parseFloat(r.cash_variance) > 0 ? "text-danger" : "text-success"}>
          <Currency value={r.cash_variance} />
        </span>
      ),
    },
    { key: "approval_status", header: "Status", render: (r) => <StatusBadge status={r.approval_status} /> },
    { key: "submitted_by_name", header: "Submitted by", render: (r) => r.submitted_by_name },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setDetailRow(r); }}>
            View
          </button>
          {canEditRow(r) && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setEditing(r); setModalOpen(true); }}>
              Edit
            </button>
          )}
          {canEdit && r.approval_status === "pending" && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setApproveTarget({ row: r, kind: "approve" }); }}>
                Approve
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setApproveTarget({ row: r, kind: "disapprove" }); }}>
                Disapprove
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Cash Collection</h1>
          <p className="page-subtitle">Rider cash submissions and approval workflow.</p>
        </div>
        <div className="page-actions">
          {canCreate && (
            <button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setModalOpen(true); }}>
              + New Submission
            </button>
          )}
        </div>
      </div>

      <div className="toolbar">
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      <DataTable columns={columns} rows={listQuery.data?.results ?? []} loading={listQuery.isLoading} rowKey={(r) => r.id} />

      <Modal open={modalOpen} title={editing ? "Edit cash collection" : "New cash collection"} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SelectField label="Rider" required value={values.rider} onChange={(e) => setValues((v) => ({ ...v, rider: e.target.value }))}>
            <option value="">Select rider…</option>
            {riderOptions.data?.results.map((r) => (
              <option key={r.id} value={r.id}>{r.full_name}</option>
            ))}
          </SelectField>
          <div className="form-grid">
            <TextField label="English date" type="date" required value={values.english_date} onChange={(e) => setValues((v) => ({ ...v, english_date: e.target.value }))} />
            <TextField label="Nepali date" value={values.nepali_date} onChange={(e) => setValues((v) => ({ ...v, nepali_date: e.target.value }))} />
          </div>
          <div className="form-grid">
            {DENOMS.map((d) => (
              <TextField
                key={d}
                label={`x${d} notes`}
                type="number"
                min={0}
                value={values[`denom_${d}` as keyof FormValues] as number}
                onChange={(e) => setValues((v) => ({ ...v, [`denom_${d}`]: Number(e.target.value) || 0 }))}
              />
            ))}
          </div>
          <TextField label="Wallet amount" type="number" step="0.01" value={values.wallet_amount} onChange={(e) => setValues((v) => ({ ...v, wallet_amount: e.target.value }))} />
          <TextField label="Note" value={values.note} onChange={(e) => setValues((v) => ({ ...v, note: e.target.value }))} />
          <div className="card" style={{ background: "var(--color-primary-light)" }}>
            <div className="stat-row"><span>Cash total</span><strong>{denomTotal.toFixed(2)}</strong></div>
            <div className="stat-row"><span>Grand total</span><strong>{grandTotal.toFixed(2)}</strong></div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={createMutation.isPending || updateMutation.isPending}>
              {createMutation.isPending || updateMutation.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(approveTarget)}
        title={approveTarget?.kind === "approve" ? "Approve collection" : "Disapprove collection"}
        onClose={() => setApproveTarget(null)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setApproveTarget(null)}>Cancel</button>
            <button
              type="button"
              className={`btn ${approveTarget?.kind === "approve" ? "btn-primary" : "btn-danger"}`}
              disabled={approveMutation.isPending}
              onClick={() => approveTarget && approveMutation.mutate({ id: approveTarget.row.id, kind: approveTarget.kind, note: approveNote })}
            >
              Confirm
            </button>
          </>
        }
      >
        <label className="form-field">
          <span className="form-label">Note (optional)</span>
          <textarea value={approveNote} onChange={(e) => setApproveNote(e.target.value)} rows={3} />
        </label>
      </Modal>

      <Modal open={Boolean(detailRow)} title="Cash collection detail" onClose={() => setDetailRow(null)}>
        {detailRow && (
          <div>
            <div className="stat-row"><span>Rider</span><strong>{detailRow.rider_name ?? detailRow.rider}</strong></div>
            <div className="stat-row"><span>Date</span><strong>{detailRow.english_date}</strong></div>
            {DENOMS.map((d) => (
              <div className="stat-row" key={d}><span>x{d} notes</span><strong>{detailRow[`denom_${d}` as keyof CashRow] as number}</strong></div>
            ))}
            <div className="stat-row"><span>Wallet amount</span><strong><Currency value={detailRow.wallet_amount} /></strong></div>
            <div className="stat-row"><span>Cash total</span><strong><Currency value={detailRow.cash_total} /></strong></div>
            <div className="stat-row"><span>Grand total</span><strong><Currency value={detailRow.grand_total} /></strong></div>
            <div className="stat-row"><span>Expected</span><strong><Currency value={detailRow.cash_expected} /></strong></div>
            <div className="stat-row"><span>Variance</span><strong><Currency value={detailRow.cash_variance} /></strong></div>
            <div className="stat-row"><span>Status</span><strong><StatusBadge status={detailRow.approval_status} /></strong></div>
            <div className="stat-row"><span>Submitted</span><strong>{formatDateTime(detailRow.submitted_at)}</strong></div>
            {detailRow.approved_by_name && (
              <div className="stat-row"><span>Approved by</span><strong>{detailRow.approved_by_name} — {formatDateTime(detailRow.approved_at)}</strong></div>
            )}
            {detailRow.note && <p className="form-hint" style={{ marginTop: 8 }}>Note: {detailRow.note}</p>}
            {detailRow.approval_note && <p className="form-hint">Approval note: {detailRow.approval_note}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
