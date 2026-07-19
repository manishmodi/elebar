import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, downloadBlob } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { useToast, apiErrorMessage } from "@/contexts/toast";
import { useRiderOptions } from "@/hooks/use-options";
import type { Advance, Paginated, SalaryCalculation, SalaryPayment, SalaryProcessResponse } from "@/lib/types";
import { DataTable, type Column } from "@/components/DataTable";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Currency } from "@/components/Currency";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { TextField, SelectField } from "@/components/FormField";
import { formatDate, startOfMonthISO, todayISO } from "@/lib/format";

export function Salary() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const riderOptions = useRiderOptions();

  const [period, setPeriod] = useState<DateRange>({ date_from: startOfMonthISO(), date_to: todayISO() });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, { amount: string; notes: string }>>({});
  const [processErrors, setProcessErrors] = useState<SalaryProcessResponse["errors"]>([]);
  const [confirmProcess, setConfirmProcess] = useState(false);
  const [forceProcess, setForceProcess] = useState(false);
  const [advanceModalOpen, setAdvanceModalOpen] = useState(false);
  const [advanceForm, setAdvanceForm] = useState({ rider: "", date: todayISO(), amount: "0", notes: "" });
  const [voidTarget, setVoidTarget] = useState<SalaryPayment | null>(null);
  const [deleteAdvance, setDeleteAdvance] = useState<Advance | null>(null);

  const canCreate = hasPermission("salary", "create");
  const canEdit = hasPermission("salary", "edit");
  const canDelete = hasPermission("salary", "delete");

  const calcQuery = useQuery({
    queryKey: ["salary", "calculate", period],
    queryFn: () => api.get<SalaryCalculation[]>("/api/salary/calculate/", period),
  });

  const advancesQuery = useQuery({
    queryKey: ["salary", "advances"],
    queryFn: () => api.get<Paginated<Advance>>("/api/salary/advances/", { page_size: 100 }),
  });

  const historyQuery = useQuery({
    queryKey: ["salary", "history"],
    queryFn: () => api.get<SalaryPayment[]>("/api/salary/history/"),
  });

  const processMutation = useMutation({
    mutationFn: (force: boolean) => {
      const riders = Array.from(selected).map((riderId) => {
        const row = calcQuery.data?.find((r) => r.rider === riderId);
        const override = overrides[riderId];
        const body: { rider: string; salary_processed?: string; notes?: string } = { rider: riderId };
        if (override?.amount) body.salary_processed = override.amount;
        if (override?.notes) body.notes = override.notes;
        else if (!override?.amount && row) body.salary_processed = String(row.final_salary);
        return body;
      });
      return api.post<SalaryProcessResponse>("/api/salary/process/", {
        period_from: period.date_from,
        period_to: period.date_to,
        force,
        riders,
      });
    },
    onSuccess: (data) => {
      setProcessErrors(data.errors ?? []);
      if ((data.errors ?? []).length === 0) {
        toast.success(`Processed ${data.processed.length} salary payment(s).`);
        setSelected(new Set());
        setOverrides({});
      } else {
        toast.error(`${data.errors.length} rider(s) failed to process.`);
      }
      void qc.invalidateQueries({ queryKey: ["salary"] });
      setConfirmProcess(false);
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not process salaries."));
      setConfirmProcess(false);
    },
  });

  const addAdvanceMutation = useMutation({
    mutationFn: () => api.post<Advance>("/api/salary/advances/", advanceForm),
    onSuccess: () => {
      toast.success("Advance recorded.");
      void qc.invalidateQueries({ queryKey: ["salary", "advances"] });
      setAdvanceModalOpen(false);
      setAdvanceForm({ rider: "", date: todayISO(), amount: "0", notes: "" });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not record advance.")),
  });

  const deleteAdvanceMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/salary/advances/${id}/`),
    onSuccess: () => {
      toast.success("Advance deleted.");
      // Advances feed the calculation table too — refresh everything salary.
      void qc.invalidateQueries({ queryKey: ["salary"] });
      setDeleteAdvance(null);
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not delete advance."));
      setDeleteAdvance(null);
    },
  });

  const voidMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/salary/payments/${id}/`),
    onSuccess: () => {
      toast.success("Payment voided.");
      // Voiding releases advances and changes the calculation — refresh all.
      void qc.invalidateQueries({ queryKey: ["salary"] });
      setVoidTarget(null);
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not void payment."));
      setVoidTarget(null);
    },
  });

  const rows = calcQuery.data ?? [];

  const validationErrors = useMemo(() => {
    const errs: string[] = [];
    for (const riderId of selected) {
      const row = rows.find((r) => r.rider === riderId);
      const override = overrides[riderId];
      if (row && override?.amount && Number(override.amount) !== Number(row.final_salary) && !override.notes.trim()) {
        errs.push(`${row.rider_name}: notes are required when processed amount differs from calculated.`);
      }
    }
    return errs;
  }, [selected, overrides, rows]);

  const toggleAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.rider)));
  };

  const toggleRow = (riderId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(riderId)) next.delete(riderId);
      else next.add(riderId);
      return next;
    });
  };

  const handleProcess = () => {
    if (validationErrors.length > 0) {
      toast.error(validationErrors[0] ?? "Please add notes for overridden amounts.");
      return;
    }
    setConfirmProcess(true);
  };

  const handleCsvDownload = async () => {
    try {
      await downloadBlob("/api/salary/pay-records.csv", `pay-records-${period.date_from}_${period.date_to}.csv`, period);
    } catch {
      toast.error("Could not download CSV.");
    }
  };

  const columns: Column<SalaryCalculation>[] = [
    {
      key: "select",
      header: "",
      render: (r) => (
        <input type="checkbox" checked={selected.has(r.rider)} onChange={() => toggleRow(r.rider)} disabled={!canCreate} />
      ),
    },
    { key: "rider_name", header: "Rider", render: (r) => (
      <span>
        {r.rider_name}
        {r.flagged && <span className="chip">Flagged</span>}
      </span>
    ) },
    { key: "pay_model", header: "Model", render: (r) => <span className="badge badge-info">{r.pay_model}</span> },
    { key: "days_worked", header: "Days", render: (r) => r.days_worked },
    { key: "times_target_missed", header: "Target missed", render: (r) => r.times_target_missed },
    { key: "base_salary", header: "Base", render: (r) => <Currency value={r.base_salary} /> },
    { key: "total_allowances", header: "Allowances", render: (r) => <Currency value={r.total_allowances} /> },
    { key: "total_advances", header: "Advances", render: (r) => <Currency value={r.total_advances} /> },
    { key: "total_cash_variance", header: "Cash variance", render: (r) => <Currency value={r.total_cash_variance} /> },
    { key: "final_salary", header: "Final (calculated)", render: (r) => <Currency value={r.final_salary} /> },
    {
      key: "processed",
      header: "Salary processed",
      render: (r) => (
        <input
          type="number"
          step="0.01"
          style={{ width: 110 }}
          placeholder={String(r.final_salary)}
          value={overrides[r.rider]?.amount ?? ""}
          onChange={(e) =>
            setOverrides((prev) => ({ ...prev, [r.rider]: { amount: e.target.value, notes: prev[r.rider]?.notes ?? "" } }))
          }
          disabled={!canCreate}
        />
      ),
    },
    {
      key: "notes",
      header: "Notes",
      render: (r) => (
        <input
          style={{ width: 140 }}
          value={overrides[r.rider]?.notes ?? ""}
          onChange={(e) =>
            setOverrides((prev) => ({ ...prev, [r.rider]: { amount: prev[r.rider]?.amount ?? "", notes: e.target.value } }))
          }
          disabled={!canCreate}
        />
      ),
    },
  ];

  const advanceColumns: Column<Advance>[] = [
    { key: "date", header: "Date", render: (a) => formatDate(a.date) },
    { key: "rider_name", header: "Rider", render: (a) => a.rider_name ?? a.rider },
    { key: "amount", header: "Amount", render: (a) => <Currency value={a.amount} /> },
    { key: "notes", header: "Notes", render: (a) => a.notes ?? "-" },
    {
      key: "actions",
      header: "",
      render: (a) =>
        canDelete ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleteAdvance(a)}>
            Delete
          </button>
        ) : null,
    },
  ];

  const historyColumns: Column<SalaryPayment>[] = [
    { key: "period_from", header: "Period", render: (p) => `${formatDate(p.period_from)} – ${formatDate(p.period_to)}` },
    { key: "rider_name", header: "Rider", render: (p) => p.rider_name ?? p.rider },
    { key: "salary_processed", header: "Paid", render: (p) => <Currency value={p.salary_processed} /> },
    { key: "notes", header: "Notes", render: (p) => p.notes ?? "-" },
    { key: "created_at", header: "Processed on", render: (p) => formatDate(p.created_at) },
    {
      key: "actions",
      header: "",
      render: (p) =>
        canDelete ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVoidTarget(p)}>
            Void
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Salary</h1>
          <p className="page-subtitle">Calculate, process, and track rider salary payments.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-ghost" onClick={handleCsvDownload}>
            Export pay-records CSV
          </button>
        </div>
      </div>

      <div className="toolbar">
        <DateRangeFilter value={period} onChange={setPeriod} />
      </div>

      {processErrors.length > 0 && (
        <div className="error-banner" style={{ marginBottom: 12 }}>
          {processErrors.map((e, i) => (
            <div key={i}>{e.rider}: {e.detail}</div>
          ))}
        </div>
      )}

      <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label className="checkbox-row">
          <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} />
          Select all
        </label>
        {canCreate && (
          <button type="button" className="btn btn-primary" disabled={selected.size === 0} onClick={handleProcess}>
            Process {selected.size} payment(s)
          </button>
        )}
      </div>

      <DataTable columns={columns} rows={rows} loading={calcQuery.isLoading} rowKey={(r) => r.rider} />

      <h2 className="section-title">Advances</h2>
      <div className="page-actions" style={{ marginBottom: 10 }}>
        {canCreate && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdvanceModalOpen(true)}>
            + Add advance
          </button>
        )}
      </div>
      <DataTable columns={advanceColumns} rows={advancesQuery.data?.results ?? []} loading={advancesQuery.isLoading} rowKey={(a) => a.id} />

      <h2 className="section-title">Payment history</h2>
      <DataTable columns={historyColumns} rows={historyQuery.data ?? []} loading={historyQuery.isLoading} rowKey={(p) => p.id} />

      <ConfirmDialog
        open={confirmProcess}
        title="Process salaries"
        message={`Process salary for ${selected.size} rider(s) for ${period.date_from} to ${period.date_to}?${forceProcess ? " (Forcing re-process of an existing period.)" : ""}`}
        confirmLabel="Process"
        busy={processMutation.isPending}
        onConfirm={() => processMutation.mutate(forceProcess)}
        onCancel={() => setConfirmProcess(false)}
      />

      {processErrors.some((e) => e.detail.toLowerCase().includes("already")) && (
        <div className="toolbar">
          <label className="checkbox-row">
            <input type="checkbox" checked={forceProcess} onChange={(e) => setForceProcess(e.target.checked)} />
            Force re-process duplicate period
          </label>
        </div>
      )}

      <Modal open={advanceModalOpen} title="Add advance" onClose={() => setAdvanceModalOpen(false)}>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            addAdvanceMutation.mutate();
          }}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <SelectField label="Rider" required value={advanceForm.rider} onChange={(e) => setAdvanceForm((v) => ({ ...v, rider: e.target.value }))}>
            <option value="">Select rider…</option>
            {riderOptions.data?.results.map((r) => (
              <option key={r.id} value={r.id}>{r.full_name}</option>
            ))}
          </SelectField>
          <TextField label="Date" type="date" required value={advanceForm.date} onChange={(e) => setAdvanceForm((v) => ({ ...v, date: e.target.value }))} />
          <TextField label="Amount" type="number" step="0.01" required value={advanceForm.amount} onChange={(e) => setAdvanceForm((v) => ({ ...v, amount: e.target.value }))} />
          <TextField label="Notes" value={advanceForm.notes} onChange={(e) => setAdvanceForm((v) => ({ ...v, notes: e.target.value }))} />
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setAdvanceModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={addAdvanceMutation.isPending}>
              {addAdvanceMutation.isPending ? "Saving…" : "Add advance"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteAdvance)}
        title="Delete advance"
        message="Delete this advance record?"
        confirmLabel="Delete"
        danger
        busy={deleteAdvanceMutation.isPending}
        onConfirm={() => deleteAdvance && deleteAdvanceMutation.mutate(deleteAdvance.id)}
        onCancel={() => setDeleteAdvance(null)}
      />

      <ConfirmDialog
        open={Boolean(voidTarget)}
        title="Void payment"
        message="Void this salary payment record?"
        confirmLabel="Void"
        danger
        busy={voidMutation.isPending}
        onConfirm={() => voidTarget && voidMutation.mutate(voidTarget.id)}
        onCancel={() => setVoidTarget(null)}
      />
    </div>
  );
}
