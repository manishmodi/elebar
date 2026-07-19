import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { useToast, apiErrorMessage } from "@/contexts/toast";
import type { Handover } from "@/lib/types";
import { Modal } from "@/components/Modal";
import { formatDateTime } from "@/lib/format";
import { Currency } from "@/components/Currency";

export function Handovers() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [rejectTarget, setRejectTarget] = useState<Handover | null>(null);
  const [reason, setReason] = useState("");

  const canEdit = hasPermission("attendance", "edit");

  const listQuery = useQuery({
    queryKey: ["handovers", "pending"],
    queryFn: () => api.get<Handover[]>("/api/fleet/handovers/pending/"),
    refetchInterval: 5000,
    // The guard console often runs on an unfocused/idle screen — keep
    // polling even when the window doesn't have focus.
    refetchIntervalInBackground: true,
  });

  const verifyMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/fleet/handovers/${id}/verify/`),
    onSuccess: () => {
      toast.success("Handover verified.");
      void qc.invalidateQueries({ queryKey: ["handovers"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not verify handover.")),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason: r }: { id: string; reason: string }) =>
      api.post(`/api/fleet/handovers/${id}/reject/`, { reason: r }),
    onSuccess: () => {
      toast.success("Handover rejected.");
      void qc.invalidateQueries({ queryKey: ["handovers"] });
      setRejectTarget(null);
      setReason("");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not reject handover.")),
  });

  const items = listQuery.data ?? [];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Handover Queue</h1>
          <p className="page-subtitle">Guard console — live queue, refreshes every 5 seconds.</p>
        </div>
      </div>

      {listQuery.isLoading ? (
        <p className="text-muted">Loading queue…</p>
      ) : items.length === 0 ? (
        <div className="empty-state">No pending handovers right now.</div>
      ) : (
        <div className="card-grid">
          {items.map((h) => (
            <div key={h.id} className="stat-card">
              <div className="stat-card-header">
                <span className={`badge badge-info`}>{h.kind}</span>
                <span className="text-muted" style={{ fontSize: 12 }}>{formatDateTime(h.submitted_at)}</span>
              </div>
              <h3 style={{ marginBottom: 6 }}>{h.rider_name}</h3>
              <p className="text-muted" style={{ marginBottom: 10 }}>{h.vehicle_number ?? "No vehicle"}</p>
              <div>
                {Object.entries(h.payload ?? {}).map(([key, value]) => {
                  if (value == null) return null;
                  if (typeof value === "object" && Object.keys(value).length === 0) return null;
                  const display =
                    typeof value === "object"
                      ? key === "photo_paths"
                        ? `${Object.keys(value).length} photo(s)`
                        : JSON.stringify(value)
                      : String(value);
                  return (
                    <div className="stat-row" key={key}>
                      <span>{key.replace(/_/g, " ")}</span>
                      <strong>{display}</strong>
                    </div>
                  );
                })}
                {h.cash_expected != null && (
                  <div className="stat-row">
                    <span>Cash expected</span>
                    <strong><Currency value={h.cash_expected} /></strong>
                  </div>
                )}
                {h.cash_variance != null && (
                  <div className="stat-row">
                    <span>Cash variance</span>
                    <strong className={parseFloat(h.cash_variance) < 0 ? "text-danger" : "text-success"}>
                      <Currency value={h.cash_variance} />
                    </strong>
                  </div>
                )}
              </div>
              {canEdit && (
                <div className="form-actions" style={{ marginTop: 12 }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRejectTarget(h)}>
                    Reject
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={verifyMutation.isPending}
                    onClick={() => verifyMutation.mutate(h.id)}
                  >
                    Verify
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(rejectTarget)}
        title={`Reject handover — ${rejectTarget?.rider_name ?? ""}`}
        onClose={() => setRejectTarget(null)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setRejectTarget(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={!reason.trim() || rejectMutation.isPending}
              onClick={() => rejectTarget && rejectMutation.mutate({ id: rejectTarget.id, reason })}
            >
              Reject handover
            </button>
          </>
        }
      >
        <label className="form-field">
          <span className="form-label">Reason (required)</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </label>
      </Modal>
    </div>
  );
}
