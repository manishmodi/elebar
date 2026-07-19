import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { useToast, apiErrorMessage } from "@/contexts/toast";
import type { PayConfig } from "@/lib/types";
import { TextField, TextAreaField } from "@/components/FormField";
import { formatDate, todayISO } from "@/lib/format";

export function PaySettings() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canCreate = hasPermission("salary", "create");

  const [form, setForm] = useState({ parameter: "", value: "", effective_from: todayISO() });

  const configQuery = useQuery({
    queryKey: ["salary", "pay-config"],
    queryFn: () => api.get<PayConfig>("/api/salary/pay-config/"),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post("/api/salary/pay-config/", form),
    onSuccess: () => {
      toast.success("Pay config rule added.");
      void qc.invalidateQueries({ queryKey: ["salary", "pay-config"] });
      setForm({ parameter: "", value: "", effective_from: todayISO() });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save pay config.")),
  });

  const grouped = useMemo(() => {
    const rows = configQuery.data?.rows ?? [];
    const map = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = map.get(row.parameter) ?? [];
      list.push(row);
      map.set(row.parameter, list);
    }
    return Array.from(map.entries()).map(([parameter, list]) => ({
      parameter,
      rows: list.slice().sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1)),
    }));
  }, [configQuery.data]);

  const isLongValue = form.parameter.includes("ramp") || form.parameter.includes("yango_bonus_table");

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Pay Settings</h1>
          <p className="page-subtitle">Effective-dated pay configuration parameters.</p>
        </div>
      </div>

      {configQuery.isLoading ? (
        <p className="text-muted">Loading…</p>
      ) : grouped.length === 0 ? (
        <div className="empty-state">No pay configuration rows yet.</div>
      ) : (
        grouped.map((group) => (
          <div key={group.parameter} className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3>{group.parameter}</h3>
              {configQuery.data?.defaults[group.parameter] !== undefined && (
                <span className="badge badge-neutral">Default: {configQuery.data.defaults[group.parameter]}</span>
              )}
            </div>
            <table className="permission-matrix">
              <thead>
                <tr>
                  <th>Effective from</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDate(row.effective_from)}</td>
                    <td style={{ textAlign: "left", fontFamily: "monospace", fontSize: 12 }}>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}

      {configQuery.data && Object.keys(configQuery.data.defaults).length > 0 && (
        <div className="card" style={{ marginBottom: 14, opacity: 0.7 }}>
          <h3 style={{ marginBottom: 8 }}>System defaults</h3>
          {Object.entries(configQuery.data.defaults).map(([k, v]) => (
            <div className="stat-row" key={k}><span>{k}</span><strong>{v}</strong></div>
          ))}
        </div>
      )}

      {canCreate && (
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Add new rule</h3>
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              createMutation.mutate();
            }}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <TextField
              label="Parameter"
              required
              placeholder="e.g. base_daily_rate, ramp_schedule, yango_bonus_table"
              value={form.parameter}
              onChange={(e) => setForm((f) => ({ ...f, parameter: e.target.value }))}
            />
            {isLongValue ? (
              <TextAreaField
                label="Value (JSON)"
                required
                rows={6}
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              />
            ) : (
              <TextField label="Value" required value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} />
            )}
            <TextField
              label="Effective from"
              type="date"
              required
              value={form.effective_from}
              onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))}
            />
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Saving…" : "Add rule"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
