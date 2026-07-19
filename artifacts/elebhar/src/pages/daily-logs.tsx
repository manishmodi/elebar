import { useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import { useDailyLogs, useDailyLogMutations } from "@/hooks/use-daily-logs";
import { useRiders } from "@/hooks/use-riders";
import { useVehicles } from "@/hooks/use-vehicles";
import { useAssignments } from "@/hooks/use-assignments";
import { PageHeader, Card, Button, EmptyState, Dialog, Currency, ConfirmDialog } from "@/components/ui-components";
import { ClipboardList, Plus, Search, Pencil, Trash2, AlertTriangle, Download, RefreshCw, Check, AlertCircle, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useForm } from "react-hook-form";
import { adToBSString, bsStringToAD } from "@/lib/nepali-date";
import { useAuth } from "@/contexts/auth-context";

// Nepal is UTC+5:45
function getYesterdayNepalClient(): string {
  const nepalNow = new Date(Date.now() + (5 * 60 + 45) * 60 * 1000);
  nepalNow.setUTCDate(nepalNow.getUTCDate() - 1);
  return nepalNow.toISOString().slice(0, 10);
}

interface PreviewRider {
  riderId: number;
  riderName: string;
  yangoDriverId: string;
  status: "new" | "draft_exists" | "finalized_exists" | "error";
  existingLogId?: number;
  error?: string;
  ridesCompleted?: number;
  totalRidesReceived?: number;
  acceptanceRate?: string;
  totalRideDistanceKm?: string;
  totalIncome?: string;
  cashAsPerApp?: string;
  goalBonus?: string;
  promotionBonusOther?: string;
  totalAppOnline?: string;
}

interface PreviewResult {
  date: string;
  riders: PreviewRider[];
}

interface PreviewJobStatus {
  id: string;
  date: string;
  status: "running" | "done" | "error";
  completed: number;
  total: number;
  result?: PreviewResult;
  error?: string;
}

function YangoSyncDialog({ isOpen, onClose, onDone }: { isOpen: boolean; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<"date" | "previewing" | "preview" | "creating" | "done">("date");
  const [selectedDate, setSelectedDate] = useState(getYesterdayNepalClient());
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number; errors: string[] } | null>(null);
  // Rider scoping: which linked riders to sync. Empty => all linked riders (default).
  const [linkedRiders, setLinkedRiders] = useState<{ id: number; fullName: string }[]>([]);
  const [selectedRiderIds, setSelectedRiderIds] = useState<number[]>([]);
  const [riderSearch, setRiderSearch] = useState("");
  // Flipped true when the dialog closes so any in-flight polling loop stops touching state.
  const cancelledRef = useRef(false);
  // Bumped on every dialog-open and every new fetch so a stale polling loop from a
  // previous session/fetch can detect it's been superseded and stop touching state.
  const pollTokenRef = useRef(0);

  useEffect(() => {
    if (isOpen) {
      cancelledRef.current = false;
      pollTokenRef.current++;
      setStep("date");
      setSelectedDate(getYesterdayNepalClient());
      setPreview(null);
      setPreviewError(null);
      setProgress(null);
      setResult(null);
      setSelectedRiderIds([]);
      setRiderSearch("");
      // Load the riders that are linked to a Yango driver — only those can be synced.
      fetch(`${import.meta.env.BASE_URL}api/riders`, { credentials: "include" })
        .then(r => (r.ok ? r.json() : []))
        .then((rs: Array<{ id: number; fullName: string; yangoDriverId?: string | null }>) =>
          setLinkedRiders(
            rs.filter(r => r.yangoDriverId)
              .map(r => ({ id: r.id, fullName: r.fullName }))
              .sort((a, b) => a.fullName.localeCompare(b.fullName)),
          ),
        )
        .catch(() => setLinkedRiders([]));
    }
    return () => { cancelledRef.current = true; };
  }, [isOpen]);

  // Parses JSON safely. If the response isn't JSON (e.g. the deployment proxy
  // returns a plain-text "upstream request timed out" error), surface a
  // human-readable message instead of "Unexpected token 'u' in JSON".
  const parseResponse = async (res: Response, fallback: string): Promise<unknown> => {
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) {
      const errMsg =
        (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
          ? (data as { error: string }).error
          : null) ||
        (text && text.length < 300 ? text.trim() : null) ||
        `${fallback} (HTTP ${res.status})`;
      // Add hint for the common Yango 429/timeout case so users know it's
      // upstream throttling, not a bug in our recent changes.
      const hint = res.status === 502 || res.status === 504 || /upstream|timed out|gateway/i.test(errMsg)
        ? " — Yango is rate-limiting; please wait a minute and try again."
        : "";
      throw new Error(errMsg + hint);
    }
    return data;
  };

  const handleFetchPreview = async () => {
    const myToken = ++pollTokenRef.current;
    const superseded = () => cancelledRef.current || pollTokenRef.current !== myToken;
    setStep("previewing");
    setPreviewError(null);
    setProgress(null);
    try {
      // Start the fetch in the background. Yango rate-limits the shared park hard, so a
      // full preview can take minutes — far longer than the ~60s HTTP proxy timeout.
      // We get a job id back immediately, then poll for progress and the final result.
      const startRes = await fetch(`${import.meta.env.BASE_URL}api/yango/sync/preview/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          date: selectedDate,
          // Empty selection => all linked riders (omit so the backend defaults to all).
          ...(selectedRiderIds.length > 0 ? { riderIds: selectedRiderIds } : {}),
        }),
      });
      const startData = (await parseResponse(startRes, "Could not start sync")) as { id: string };
      const jobId = startData.id;

      // Poll until the job finishes. ~10 min ceiling so a stuck job can't poll forever.
      const deadline = Date.now() + 10 * 60 * 1000;
      let data: PreviewJobStatus | null = null;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000));
        if (superseded()) return;
        const res = await fetch(`${import.meta.env.BASE_URL}api/yango/sync/preview/status/${jobId}`, {
          credentials: "include",
        });
        data = (await parseResponse(res, "Sync status check failed")) as PreviewJobStatus;
        if (superseded()) return;
        if (data) setProgress({ completed: data.completed, total: data.total });
        if (data?.status === "done") break;
        if (data?.status === "error") throw new Error(data.error || "Sync failed");
      }

      if (!data || data.status !== "done") {
        throw new Error("Sync is taking longer than expected. Please try again in a few minutes.");
      }
      setPreview(data.result as PreviewResult);
      setStep("preview");
    } catch (err) {
      if (superseded()) return;
      setPreviewError(err instanceof Error ? err.message : "Failed to fetch preview");
      setStep("date");
    }
  };

  const handleApprove = async () => {
    setStep("creating");
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/yango/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        // Send the preview rows we already fetched so the backend doesn't
        // re-hit Yango (avoids 429 storm + deployment HTTP timeout). Use the date the
        // server actually previewed (preview.date) so we can never persist results to a
        // different day than the one they were fetched for.
        body: JSON.stringify({ date: preview?.date ?? selectedDate, riders: preview?.riders ?? [] }),
      });
      const data = await parseResponse(res, "Sync failed");
      setResult(data);
      setStep("done");
      onDone();
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Sync failed");
      setStep("preview");
    }
  };

  const actionableRiders = preview?.riders.filter(r => r.status !== "finalized_exists") ?? [];
  const skippedRiders = preview?.riders.filter(r => r.status === "finalized_exists") ?? [];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-semibold">Sync from Yango</h2>
            <p className="text-sm text-muted-foreground">
              {step === "date" && "Pick a date, and optionally choose which riders to sync."}
              {step === "previewing" && "Fetching data from Yango..."}
              {step === "preview" && `Preview for ${selectedDate} — review before creating drafts.`}
              {step === "creating" && "Creating draft logs..."}
              {step === "done" && "Sync complete."}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground transition-colors">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">

          {/* Step: date picker */}
          {(step === "date" || step === "previewing") && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Date to sync</label>
                <input
                  type="date"
                  value={selectedDate}
                  max={getYesterdayNepalClient()}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="premium-input w-full max-w-xs"
                  disabled={step === "previewing"}
                />
                <p className="text-xs text-muted-foreground">Defaults to yesterday (Nepal time). You can pick any past date.</p>
              </div>

              {/* Rider scope: default = all linked riders; pick one or more to narrow it. */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Riders to sync</label>
                  <span className="text-xs text-muted-foreground">
                    {selectedRiderIds.length === 0
                      ? `All linked riders (${linkedRiders.length})`
                      : `${selectedRiderIds.length} selected`}
                  </span>
                </div>
                {linkedRiders.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No riders are linked to Yango yet — link drivers in Rider Management.
                  </p>
                ) : (
                  <div className="rounded-lg border">
                    <div className="flex items-center gap-2 border-b p-2">
                      <input
                        type="text"
                        value={riderSearch}
                        onChange={e => setRiderSearch(e.target.value)}
                        placeholder="Search riders…"
                        disabled={step === "previewing"}
                        className="premium-input flex-1 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setSelectedRiderIds([])}
                        disabled={step === "previewing" || selectedRiderIds.length === 0}
                        className="text-xs px-2.5 py-1 rounded-md hover:bg-muted disabled:opacity-40"
                      >
                        Select all
                      </button>
                    </div>
                    <div className="max-h-44 overflow-y-auto p-1">
                      {linkedRiders
                        .filter(r => r.fullName.toLowerCase().includes(riderSearch.toLowerCase()))
                        .map(r => {
                          const checked = selectedRiderIds.includes(r.id);
                          return (
                            <label
                              key={r.id}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer text-sm"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={step === "previewing"}
                                onChange={() =>
                                  setSelectedRiderIds(prev =>
                                    checked ? prev.filter(id => id !== r.id) : [...prev, r.id],
                                  )
                                }
                              />
                              <span className="truncate">{r.fullName}</span>
                            </label>
                          );
                        })}
                    </div>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Leave all unchecked to sync every linked rider, or pick specific riders to sync only those.
                </p>
              </div>

              {step === "previewing" && (
                <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
                    <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                    {progress && progress.total > 0
                      ? `Fetching from Yango… ${progress.completed} of ${progress.total} riders`
                      : "Starting sync…"}
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all duration-500"
                      style={{ width: progress && progress.total > 0 ? `${Math.round((progress.completed / progress.total) * 100)}%` : "8%" }}
                    />
                  </div>
                  <p className="text-xs text-blue-700">
                    Yango limits how fast we can pull data, so this can take a few minutes. You can keep this open — it'll finish on its own.
                  </p>
                </div>
              )}

              {previewError && (
                <div className="flex items-start gap-2 text-sm text-destructive bg-red-50 border border-red-200 rounded-lg p-3">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {previewError}
                </div>
              )}
            </div>
          )}

          {/* Step: preview table */}
          {step === "preview" && preview && (
            <div className="space-y-4">
              {/* Summary badges */}
              <div className="flex flex-wrap gap-2">
                <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                  {preview.riders.filter(r => r.status === "new").length} new drafts will be created
                </span>
                {preview.riders.filter(r => r.status === "draft_exists").length > 0 && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-medium">
                    {preview.riders.filter(r => r.status === "draft_exists").length} existing drafts will be updated
                  </span>
                )}
                {skippedRiders.length > 0 && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium">
                    {skippedRiders.length} finalized — will be skipped
                  </span>
                )}
                {preview.riders.filter(r => r.status === "error").length > 0 && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-medium">
                    {preview.riders.filter(r => r.status === "error").length} errors
                  </span>
                )}
              </div>

              {preview.riders.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No riders are linked to Yango yet. Go to Rider Management to link drivers.
                </div>
              )}

              {actionableRiders.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Rider</th>
                        <th className="px-3 py-2 text-center">Status</th>
                        <th className="px-3 py-2 text-center">Rides</th>
                        <th className="px-3 py-2 text-center">Online</th>
                        <th className="px-3 py-2 text-right">Cash (Rs)</th>
                        <th className="px-3 py-2 text-right">Promo & Others</th>
                        <th className="px-3 py-2 text-right">Goal Bonus</th>
                        <th className="px-3 py-2 text-right">Distance (km)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {actionableRiders.map(r => (
                        <tr key={r.riderId} className={`border-t hover:bg-muted/20 ${r.status === "error" ? "bg-red-50/40" : ""}`}>
                          <td className="px-3 py-2.5">
                            <div className="font-medium">{r.riderName}</div>
                            {r.status === "error" && r.error && (
                              <div className="text-xs text-red-600 mt-0.5 max-w-[220px] truncate" title={r.error}>{r.error}</div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {r.status === "new" && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">New Draft</span>}
                            {r.status === "draft_exists" && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Update Draft</span>}
                            {r.status === "error" && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Error</span>}
                          </td>
                          <td className="px-3 py-2.5 text-center font-mono">
                            {r.status === "error" ? "—" : `${r.totalRidesReceived ?? 0} / ${r.ridesCompleted ?? 0}`}
                          </td>
                          <td className="px-3 py-2.5 text-center font-mono text-xs">{r.totalAppOnline ?? "—"}</td>
                          <td className="px-3 py-2.5 text-right font-mono">{r.status === "error" ? "—" : (parseFloat(r.cashAsPerApp ?? "0") > 0 ? `Rs ${r.cashAsPerApp}` : "—")}</td>
                          <td className="px-3 py-2.5 text-right font-mono">{r.status === "error" ? "—" : (parseFloat(r.promotionBonusOther ?? "0") > 0 ? `Rs ${r.promotionBonusOther}` : "—")}</td>
                          <td className="px-3 py-2.5 text-right font-mono">{r.status === "error" ? "—" : (parseFloat(r.goalBonus ?? "0") > 0 ? `Rs ${r.goalBonus}` : "—")}</td>
                          <td className="px-3 py-2.5 text-right font-mono">{r.status === "error" ? "—" : (parseFloat(r.totalRideDistanceKm ?? "0") > 0 ? `${r.totalRideDistanceKm} km` : "—")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {skippedRiders.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{skippedRiders.length} finalized log(s) will be skipped (already confirmed)</summary>
                  <ul className="mt-2 space-y-1 pl-4">
                    {skippedRiders.map(r => <li key={r.riderId} className="text-muted-foreground text-xs">• {r.riderName}</li>)}
                  </ul>
                </details>
              )}

              {previewError && (
                <div className="flex items-start gap-2 text-sm text-destructive bg-red-50 border border-red-200 rounded-lg p-3">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {previewError}
                </div>
              )}
            </div>
          )}

          {/* Step: creating */}
          {step === "creating" && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
              <RefreshCw className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm">Creating draft logs...</p>
            </div>
          )}

          {/* Step: done */}
          {step === "done" && result && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                <Check className="w-5 h-5 shrink-0" />
                <div>
                  <p className="font-medium">Drafts created successfully for {selectedDate}</p>
                  <p className="text-sm mt-0.5">
                    {result.created} created · {result.updated} updated · {result.skipped} skipped
                    {result.errors?.length > 0 && ` · ${result.errors.length} errors`}
                  </p>
                </div>
              </div>
              {result.errors?.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Errors:</p>
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-destructive pl-2">• {e}</p>
                  ))}
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                The new drafts are now visible in the log table below. Open each one, fill in the remaining details, and save to finalize.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t bg-muted/30">
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            {step === "done" ? "Close" : "Cancel"}
          </button>
          <div className="flex gap-2">
            {step === "preview" && (
              <button onClick={() => setStep("date")} className="px-4 py-2 text-sm border rounded-lg hover:bg-muted transition-colors">
                ← Change Date
              </button>
            )}
            {(step === "date" || step === "previewing") && (
              <button
                onClick={handleFetchPreview}
                disabled={!selectedDate || step === "previewing"}
                className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                {step === "previewing" && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                {step === "previewing" ? "Fetching..." : "Fetch Preview →"}
              </button>
            )}
            {step === "preview" && actionableRiders.filter(r => r.status !== "error").length > 0 && (
              <button
                onClick={handleApprove}
                className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-2"
              >
                <Check className="w-3.5 h-3.5" />
                Approve & Create {actionableRiders.filter(r => r.status !== "error").length} Draft{actionableRiders.filter(r => r.status !== "error").length !== 1 ? "s" : ""}
              </button>
            )}
            {step === "done" && (
              <button onClick={onClose} className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors">
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface DailyLogFormData {
  nepaliDate: string;
  englishDate: string;
  riderId: string;
  vehicleId: string;
  checkInTime: string;
  checkOutTime: string;
  totalAppOnline: string;
  totalRideHours: string;
  totalRidesReceived: string;
  ridesCompleted: string;
  acceptanceRate: string;
  dailyBonusSet: string;
  bonusTargetCompletion: string;
  totalRideDistanceKm: string;
  cashAsPerApp: string;
  goalBonus: string;
  promotionBonusOther: string;
  totalIncome: string;
  cashGivenByDriver: string;
  cashTransferredOnline: string;
  cashCheck: string;
  dailyAllowance: string;
  remarks: string;
}

interface DailyLogRecord {
  id: number;
  riderId: number;
  vehicleId: number;
  riderName?: string | null;
  vehiclePlate?: string | null;
  nepaliDate: string;
  englishDate: string;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  totalAppOnline?: string | null;
  totalRideHours?: string | null;
  totalRidesReceived?: number | null;
  ridesCompleted?: number | null;
  acceptanceRate?: string | null;
  dailyBonusSet?: number | null;
  bonusTargetCompletion?: boolean | null;
  totalRideDistanceKm?: string | null;
  cashAsPerApp?: string | null;
  goalBonus?: string | null;
  promotionBonusOther?: string | null;
  totalIncome?: string | null;
  cashGivenByDriver?: string | null;
  cashTransferredOnline?: string | null;
  cashCheck?: string | null;
  dailyAllowance?: string | null;
  remarks?: string | null;
  isDraft?: boolean | null;
  yangoSyncedAt?: string | null;
  computedBSDate: string;
}

interface LogFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, string | number | boolean | undefined>) => Promise<void>;
  isPending: boolean;
  title?: string;
  defaultValues?: Partial<DailyLogFormData>;
}

export default function DailyLogs() {
  const { data: logs, isLoading, refetch } = useDailyLogs();
  const { createLog, isCreating, updateLog, isUpdating, deleteLog, isDeleting } = useDailyLogMutations();
  const { isAdmin } = useAuth();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingLog, setEditingLog] = useState<DailyLogRecord | null>(null);
  const [deletingLog, setDeletingLog] = useState<DailyLogRecord | null>(null);
  const [searchRider, setSearchRider] = useState("");
  const [showSyncDialog, setShowSyncDialog] = useState(false);
  const [dateMode, setDateMode] = useState<"AD" | "BS">("AD");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const fromAD = useMemo(() => {
    if (!fromDate) return null;
    if (dateMode === "BS") return bsStringToAD(fromDate);
    return fromDate;
  }, [fromDate, dateMode]);

  const toAD = useMemo(() => {
    if (!toDate) return null;
    if (dateMode === "BS") return bsStringToAD(toDate);
    return toDate;
  }, [toDate, dateMode]);

  const enrichedLogs = useMemo(() => {
    return logs?.map((l) => ({
      ...l,
      computedBSDate: l.nepaliDate || adToBSString(l.englishDate),
    }));
  }, [logs]);

  const filtered = enrichedLogs?.filter(l => {
    const logDate = l.englishDate?.split("T")[0];
    const fromMatch = !fromAD || (!!logDate && logDate >= fromAD);
    const toMatch = !toAD || (!!logDate && logDate <= toAD);
    const riderMatch = !searchRider || (l.riderName || "").toLowerCase().includes(searchRider.toLowerCase());
    return fromMatch && toMatch && riderMatch;
  });

  const totals = useMemo(() => {
    const sum = { distance: 0, appCash: 0, goalBonus: 0, promoBonus: 0, totalIncome: 0, driverCash: 0, onlineXfer: 0, cashCheck: 0, allowance: 0 };
    if (!filtered) return sum;
    for (const l of filtered) {
      sum.distance += parseFloat(String(l.totalRideDistanceKm ?? "0")) || 0;
      sum.appCash += parseFloat(String(l.cashAsPerApp ?? "0")) || 0;
      sum.goalBonus += parseFloat(String(l.goalBonus ?? "0")) || 0;
      sum.promoBonus += parseFloat(String(l.promotionBonusOther ?? "0")) || 0;
      sum.totalIncome += parseFloat(String(l.totalIncome ?? "0")) || 0;
      sum.driverCash += parseFloat(String(l.cashGivenByDriver ?? "0")) || 0;
      sum.onlineXfer += parseFloat(String(l.cashTransferredOnline ?? "0")) || 0;
      sum.cashCheck += parseFloat(String(l.cashCheck ?? "0")) || 0;
      sum.allowance += parseFloat(String(l.dailyAllowance ?? "0")) || 0;
    }
    return sum;
  }, [filtered]);

  const PAGE_SIZE = 50;
  const totalRecords = filtered?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = filtered?.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => { setCurrentPage(1); }, [fromAD, toAD, searchRider]);

  const hasDateFilter = fromDate || toDate;
  const clearDates = () => { setFromDate(""); setToDate(""); };

  const summaryCards: { label: string; node: ReactNode; highlight?: boolean }[] = [
    { label: "Total Distance", node: `${totals.distance.toLocaleString(undefined, { maximumFractionDigits: 1 })} km` },
    { label: "App Cash", node: <Currency amount={totals.appCash} /> },
    { label: "Goal Bonus", node: <Currency amount={totals.goalBonus} /> },
    { label: "Promo Bonus", node: <Currency amount={totals.promoBonus} /> },
    { label: "Total Income", node: <Currency amount={totals.totalIncome} />, highlight: true },
    { label: "Driver Cash", node: <Currency amount={totals.driverCash} /> },
    { label: "Online XFER", node: <Currency amount={totals.onlineXfer} /> },
    { label: "Cash Check", node: <Currency amount={totals.cashCheck} /> },
    { label: "Allowance", node: <Currency amount={totals.allowance} /> },
  ];

  const openEdit = (log: DailyLogRecord) => {
    setEditingLog(log);
  };

  const exportAllLogs = () => {
    if (!enrichedLogs || enrichedLogs.length === 0) return;
    const headers = [
      "Nepali Date", "Date (AD)", "Rider", "Vehicle",
      "Check-in", "Check-out", "Total Online", "Ride Hours",
      "Rides Received", "Rides Completed", "Acceptance Rate (%)",
      "Daily Bonus Target", "Target Hit?", "Distance (km)",
      "App Cash (Rs)", "Goal Bonus (Rs)", "Promo Bonus (Rs)", "Total Income (Rs)",
      "Driver Cash (Rs)", "Online Transfer (Rs)", "Cash Check (Rs)",
      "Daily Allowance (Rs)", "Remarks"
    ];
    const escape = (val: string | number | boolean | null | undefined) => {
      if (val === null || val === undefined) return "";
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    const rows = enrichedLogs.map(l => [
      escape(l.computedBSDate),
      escape(l.englishDate?.split("T")[0]),
      escape(l.riderName),
      escape(l.vehiclePlate),
      escape(l.checkInTime),
      escape(l.checkOutTime),
      escape(l.totalAppOnline),
      escape(l.totalRideHours),
      escape(l.totalRidesReceived),
      escape(l.ridesCompleted),
      escape(l.acceptanceRate),
      escape(l.dailyBonusSet),
      escape(l.bonusTargetCompletion ? "Yes" : "No"),
      escape(l.totalRideDistanceKm),
      escape(l.cashAsPerApp),
      escape(l.goalBonus),
      escape(l.promotionBonusOther),
      escape(l.totalIncome),
      escape(l.cashGivenByDriver),
      escape(l.cashTransferredOnline),
      escape(l.cashCheck),
      escape(l.dailyAllowance),
      escape(l.remarks),
    ].join(","));
    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `elebhar-daily-logs-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader 
        title="Daily Operations Log" 
        description="Core operational metrics, cash reconciliation, and ride statistics."
        actions={
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              {isAdmin && (
                <Button variant="outline" onClick={exportAllLogs} disabled={isLoading}>
                  <Download className="w-4 h-4" /> Export All Logs
                </Button>
              )}
              {isAdmin && (
                <Button variant="outline" onClick={() => setShowSyncDialog(true)}>
                  <RefreshCw className="w-4 h-4" /> Sync from Yango
                </Button>
              )}
              <Button onClick={() => setIsAddOpen(true)}>
                <Plus className="w-4 h-4" /> Enter Daily Log
              </Button>
            </div>
          </div>
        }
      />

      <Card className="mb-6 p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Filter by Rider Name..."
              value={searchRider}
              onChange={(e) => setSearchRider(e.target.value)}
              className="premium-input pl-9"
            />
          </div>
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {totalRecords} record{totalRecords !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-lg border overflow-hidden text-sm">
            <button
              onClick={() => { setDateMode("AD"); setFromDate(""); setToDate(""); }}
              className={`px-3 py-1.5 font-medium transition-colors ${dateMode === "AD" ? "bg-primary text-primary-foreground" : "bg-white text-muted-foreground hover:bg-muted"}`}
            >
              AD (English)
            </button>
            <button
              onClick={() => { setDateMode("BS"); setFromDate(""); setToDate(""); }}
              className={`px-3 py-1.5 font-medium transition-colors ${dateMode === "BS" ? "bg-primary text-primary-foreground" : "bg-white text-muted-foreground hover:bg-muted"}`}
            >
              BS (Nepali)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">From:</span>
            {dateMode === "AD" ? (
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="premium-input text-sm py-1.5 w-38" />
            ) : (
              <input type="text" value={fromDate} onChange={(e) => setFromDate(e.target.value)} placeholder="2081-01-01" className="premium-input text-sm py-1.5 w-32 font-mono" />
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">To:</span>
            {dateMode === "AD" ? (
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="premium-input text-sm py-1.5 w-38" />
            ) : (
              <input type="text" value={toDate} onChange={(e) => setToDate(e.target.value)} placeholder="2081-12-30" className="premium-input text-sm py-1.5 w-32 font-mono" />
            )}
          </div>

          {hasDateFilter && (
            <button onClick={clearDates} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors px-2 py-1.5 rounded-md hover:bg-red-50">
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          )}
          {hasDateFilter && (
            <span className="text-xs text-primary font-medium bg-primary/10 px-2 py-1 rounded-full">
              Totals &amp; logs filtered by {dateMode} date range
            </span>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {summaryCards.map((c) => (
          <Card key={c.label} className="p-4">
            <p className="text-xs text-muted-foreground font-medium mb-1">{c.label}</p>
            <p className={`text-lg font-bold ${c.highlight ? "text-primary" : "text-foreground"}`}>{c.node}</p>
          </Card>
        ))}
      </div>

      <Card className="overflow-x-auto relative shadow-md">
        <table className="w-full text-sm text-left whitespace-nowrap min-w-[2600px]">
          <thead className="text-xs text-muted-foreground uppercase bg-muted/80 border-b sticky top-0">
            <tr>
              <th className="px-4 py-3 font-semibold sticky left-0 z-10 bg-muted/90 backdrop-blur">Nepali Date</th>
              <th className="px-4 py-3 font-semibold">Date (AD)</th>
              <th className="px-4 py-3 font-semibold">Rider</th>
              <th className="px-4 py-3 font-semibold">Vehicle</th>
              <th className="px-4 py-3 font-semibold">Time (In - Out)</th>
              <th className="px-4 py-3 font-semibold text-center">Bonus Set</th>
              <th className="px-4 py-3 font-semibold text-center">Rides (Rec / Comp)</th>
              <th className="px-4 py-3 font-semibold text-center">Acc. Rate</th>
              <th className="px-4 py-3 font-semibold text-center">Target Hit?</th>
              <th className="px-4 py-3 font-semibold text-right">Distance (km)</th>
              <th className="px-4 py-3 font-semibold text-right">App Cash</th>
              <th className="px-4 py-3 font-semibold text-right">Goal Bonus</th>
              <th className="px-4 py-3 font-semibold text-right">Promo Bonus</th>
              <th className="px-4 py-3 font-semibold text-right">Total Income</th>
              <th className="px-4 py-3 font-semibold text-right">Driver Cash</th>
              <th className="px-4 py-3 font-semibold text-right">Online Xfer</th>
              <th className="px-4 py-3 font-semibold text-right bg-amber-50 text-amber-800">Cash Check</th>
              <th className="px-4 py-3 font-semibold text-right">Allowance</th>
              <th className="px-4 py-3 font-semibold">Remarks</th>
              <th className="px-4 py-3 font-semibold text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={21} className="px-6 py-8 text-center text-muted-foreground">Loading logs...</td></tr>
            ) : filtered?.length === 0 ? (
              <tr><td colSpan={21}><EmptyState title="No logs found" description="No operation records found for this filter." icon={ClipboardList} /></td></tr>
            ) : (
              paginated?.map(log => (
                <tr key={log.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground sticky left-0 bg-white/90 backdrop-blur shadow-[2px_0_5px_rgba(0,0,0,0.02)]">{log.computedBSDate}</td>
                  <td className="px-4 py-3">{log.englishDate.split('T')[0]}</td>
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-1.5">
                      {log.riderName || `#${log.riderId}`}
                      {log.isDraft && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-300">DRAFT</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{log.vehiclePlate || `#${log.vehicleId}`}</td>
                  <td className="px-4 py-3 text-xs">{log.checkInTime} - {log.checkOutTime}</td>
                  <td className="px-4 py-3 text-center">{log.dailyBonusSet}</td>
                  <td className="px-4 py-3 text-center">{log.totalRidesReceived} / <span className="font-bold text-emerald-600">{log.ridesCompleted}</span></td>
                  <td className="px-4 py-3 text-center font-mono">{log.acceptanceRate}%</td>
                  <td className="px-4 py-3 text-center">{log.bonusTargetCompletion ? <span className="text-emerald-600 font-bold">Yes</span> : <span className="text-red-500">No</span>}</td>
                  <td className="px-4 py-3 text-right font-mono">{log.totalRideDistanceKm || '-'}</td>
                  <td className="px-4 py-3 text-right"><Currency amount={log.cashAsPerApp} /></td>
                  <td className="px-4 py-3 text-right"><Currency amount={log.goalBonus} /></td>
                  <td className="px-4 py-3 text-right"><Currency amount={log.promotionBonusOther} /></td>
                  <td className="px-4 py-3 text-right font-bold text-primary"><Currency amount={log.totalIncome} /></td>
                  <td className="px-4 py-3 text-right"><Currency amount={log.cashGivenByDriver} /></td>
                  <td className="px-4 py-3 text-right text-blue-600"><Currency amount={log.cashTransferredOnline} /></td>
                  <td className="px-4 py-3 text-right font-bold bg-amber-50/50 text-amber-700"><Currency amount={log.cashCheck} /></td>
                  <td className="px-4 py-3 text-right"><Currency amount={log.dailyAllowance} /></td>
                  <td className="px-4 py-3 text-muted-foreground text-xs max-w-[120px] truncate">{log.remarks || '-'}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => openEdit(log as DailyLogRecord)} className="p-1.5 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground transition-colors" title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeletingLog(log as DailyLogRecord)} className="p-1.5 hover:bg-red-50 rounded-md text-muted-foreground hover:text-destructive transition-colors" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-1 flex-wrap gap-3">
          <span className="text-sm text-muted-foreground">
            Page {safePage} of {totalPages} · Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, totalRecords)} of {totalRecords}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}>
              <ChevronLeft className="w-4 h-4" /> Previous
            </Button>
            <Button variant="outline" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      <LogFormModal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} onSubmit={async (data) => {
        await createLog({ data });
        setIsAddOpen(false);
      }} isPending={isCreating} />

      {editingLog && (
        <LogFormModal
          isOpen={true}
          title="Edit Daily Log"
          onClose={() => setEditingLog(null)}
          defaultValues={{
            nepaliDate: editingLog.nepaliDate || "",
            englishDate: editingLog.englishDate?.split('T')[0] || "",
            riderId: editingLog.riderId?.toString() || "",
            vehicleId: editingLog.vehicleId?.toString() || "",
            checkInTime: editingLog.checkInTime || "",
            checkOutTime: editingLog.checkOutTime || "",
            totalAppOnline: editingLog.totalAppOnline || "",
            totalRideHours: editingLog.totalRideHours || "",
            totalRidesReceived: editingLog.totalRidesReceived?.toString() || "",
            ridesCompleted: editingLog.ridesCompleted?.toString() || "",
            acceptanceRate: editingLog.acceptanceRate || "",
            dailyBonusSet: editingLog.dailyBonusSet?.toString() || "",
            bonusTargetCompletion: editingLog.bonusTargetCompletion ? "true" : "false",
            totalRideDistanceKm: editingLog.totalRideDistanceKm || "",
            cashAsPerApp: editingLog.cashAsPerApp || "",
            goalBonus: editingLog.goalBonus || "",
            promotionBonusOther: editingLog.promotionBonusOther || "",
            totalIncome: editingLog.totalIncome || "",
            cashGivenByDriver: editingLog.cashGivenByDriver || "",
            cashTransferredOnline: editingLog.cashTransferredOnline || "",
            cashCheck: editingLog.cashCheck || "",
            dailyAllowance: editingLog.dailyAllowance || "",
            remarks: editingLog.remarks || "",
          }}
          onSubmit={async (data) => {
            await updateLog({ id: editingLog.id, data });
            setEditingLog(null);
          }}
          isPending={isUpdating}
        />
      )}

      <ConfirmDialog
        isOpen={!!deletingLog}
        onClose={() => setDeletingLog(null)}
        title="Delete Daily Log"
        description={`Are you sure you want to delete the log for ${deletingLog?.computedBSDate} (${deletingLog?.riderName || 'Rider #' + deletingLog?.riderId})? This action cannot be undone.`}
        onConfirm={async () => {
          if (deletingLog) {
            await deleteLog({ id: deletingLog.id });
            setDeletingLog(null);
          }
        }}
        isPending={isDeleting}
      />

      <YangoSyncDialog
        isOpen={showSyncDialog}
        onClose={() => setShowSyncDialog(false)}
        onDone={() => refetch()}
      />
    </div>
  );
}

function LogFormModal({ isOpen, onClose, onSubmit, isPending, title = "New Daily Operations Log", defaultValues }: LogFormModalProps) {
  const { register, handleSubmit, reset, watch, setValue } = useForm<DailyLogFormData>({ defaultValues });
  const { data: riders } = useRiders();
  const { data: vehicles } = useVehicles();
  const { data: assignments } = useAssignments();
  const { data: existingLogs } = useDailyLogs();
  const englishDate = watch("englishDate");
  const selectedRiderId = watch("riderId");
  const cashAsPerApp = watch("cashAsPerApp");
  const cashGivenByDriver = watch("cashGivenByDriver");
  const cashTransferredOnline = watch("cashTransferredOnline");
  const goalBonus = watch("goalBonus");
  const promotionBonusOther = watch("promotionBonusOther");
  const ridesCompleted = watch("ridesCompleted");
  const totalRidesReceived = watch("totalRidesReceived");
  const dailyBonusSet = watch("dailyBonusSet");
  const isEditing = !!defaultValues?.englishDate;

  const autoBS = englishDate ? adToBSString(englishDate) : "";

  const duplicateLog = useMemo(() => {
    if (!selectedRiderId || !englishDate || isEditing) return null;
    const dateStr = englishDate.split("T")[0];
    return existingLogs?.find(
      (l) =>
        String(l.riderId) === String(selectedRiderId) &&
        l.englishDate.split("T")[0] === dateStr
    ) ?? null;
  }, [selectedRiderId, englishDate, existingLogs, isEditing]);

  const duplicateRiderName = useMemo(() => {
    if (!duplicateLog) return null;
    return riders?.find(r => r.id === duplicateLog.riderId)?.fullName || `Rider #${duplicateLog.riderId}`;
  }, [duplicateLog, riders]);

  useEffect(() => {
    if (!selectedRiderId || !assignments) return;
    const activeAssignment = assignments.find(
      (a) => String(a.riderId) === String(selectedRiderId) && a.status === "active"
    );
    if (activeAssignment?.vehicleId) {
      setValue("vehicleId", String(activeAssignment.vehicleId));
    }
  }, [selectedRiderId, assignments, setValue]);

  useEffect(() => {
    const app = parseFloat(cashAsPerApp) || 0;
    const goal = parseFloat(goalBonus) || 0;
    const promo = parseFloat(promotionBonusOther) || 0;
    const total = app + goal + promo;
    setValue("totalIncome", total > 0 ? total.toFixed(2) : "");
  }, [cashAsPerApp, goalBonus, promotionBonusOther, setValue]);

  useEffect(() => {
    const app = parseFloat(cashAsPerApp) || 0;
    const driver = parseFloat(cashGivenByDriver) || 0;
    const online = parseFloat(cashTransferredOnline) || 0;
    const diff = app - driver - online;
    setValue("cashCheck", (app > 0 || driver > 0 || online > 0) ? diff.toFixed(2) : "");
  }, [cashAsPerApp, cashGivenByDriver, cashTransferredOnline, setValue]);

  useEffect(() => {
    const completed = parseFloat(ridesCompleted) || 0;
    const received = parseFloat(totalRidesReceived) || 0;
    if (received > 0 && completed >= 0) {
      setValue("acceptanceRate", ((completed / received) * 100).toFixed(2));
    } else {
      setValue("acceptanceRate", "");
    }
  }, [ridesCompleted, totalRidesReceived, setValue]);

  useEffect(() => {
    const completed = parseInt(ridesCompleted);
    const target = parseInt(dailyBonusSet);
    if (!isNaN(completed) && !isNaN(target) && target > 0) {
      setValue("bonusTargetCompletion", completed >= target ? "true" : "false");
    }
  }, [ridesCompleted, dailyBonusSet, setValue]);

  const submit = (data: DailyLogFormData) => {
    const payload: Record<string, string | number | boolean | undefined> = {
      ...data,
      nepaliDate: data.nepaliDate || autoBS,
      riderId: parseInt(data.riderId),
      vehicleId: parseInt(data.vehicleId),
      dailyBonusSet: parseInt(data.dailyBonusSet) || 0,
      totalRidesReceived: parseInt(data.totalRidesReceived) || 0,
      ridesCompleted: parseInt(data.ridesCompleted) || 0,
      bonusTargetCompletion: data.bonusTargetCompletion === "true",
    };
    onSubmit(payload);
    reset();
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit(submit)} className="space-y-6">

        {duplicateLog && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold">Duplicate log detected</p>
              <p className="text-amber-800 mt-0.5">
                A log for <span className="font-medium">{duplicateRiderName}</span> on{" "}
                <span className="font-medium">{englishDate}</span> already exists. Please edit the existing entry instead of creating a new one.
              </p>
            </div>
          </div>
        )}

        <div className="bg-muted/40 p-4 rounded-xl space-y-4 border">
          <h3 className="font-semibold text-sm text-primary uppercase tracking-wider">Identifiers & Time</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Date (AD) *</label>
              <input type="date" {...register("englishDate", {required:true})} max={new Date().toISOString().split('T')[0]} className="premium-input text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Nepali Date (BS)</label>
              <input {...register("nepaliDate")} className="premium-input text-sm" placeholder={autoBS || "Auto-calculated"} />
              {autoBS && <p className="text-[10px] text-muted-foreground">Auto: {autoBS}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Rider *</label>
              <select {...register("riderId", {required:true})} className="premium-input text-sm bg-white">
                <option value="">Select Rider</option>
                {riders?.map(r => <option key={r.id} value={r.id}>{r.fullName}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Vehicle *</label>
              <select {...register("vehicleId", {required:true})} className="premium-input text-sm bg-white">
                <option value="">Select Vehicle</option>
                {vehicles?.map(v => <option key={v.id} value={v.id}>{v.plateNumber}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Check-in</label>
              <input {...register("checkInTime")} className="premium-input text-sm" placeholder="6:00 AM" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Check-out</label>
              <input {...register("checkOutTime")} className="premium-input text-sm" placeholder="7:00 PM" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Total Online (hh:mm)</label>
              <input {...register("totalAppOnline")} className="premium-input text-sm" placeholder="10:30" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Ride Hrs (hh:mm)</label>
              <input {...register("totalRideHours")} className="premium-input text-sm" placeholder="08:15" />
            </div>
          </div>
        </div>

        <div className="bg-muted/40 p-4 rounded-xl space-y-4 border">
          <h3 className="font-semibold text-sm text-primary uppercase tracking-wider">Ride Statistics</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Rides Received</label>
              <input type="number" {...register("totalRidesReceived")} className="premium-input text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Rides Completed</label>
              <input type="number" {...register("ridesCompleted")} className="premium-input text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Acceptance Rate <span className="text-emerald-600">(Completed ÷ Received × 100)</span>
              </label>
              <div className="relative">
                <input
                  {...register("acceptanceRate")}
                  readOnly
                  tabIndex={-1}
                  className="premium-input text-sm pr-8 cursor-not-allowed bg-muted/40"
                  placeholder="Auto-calculated"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">%</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Daily Bonus Target</label>
              <input type="number" {...register("dailyBonusSet")} className="premium-input text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Target Hit?</label>
              <select {...register("bonusTargetCompletion")} className="premium-input text-sm bg-white">
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Total Distance (km)</label>
              <input {...register("totalRideDistanceKm")} className="premium-input text-sm" placeholder="125.4" />
            </div>
          </div>
        </div>

        <div className="bg-emerald-50/50 p-4 rounded-xl space-y-4 border border-emerald-100">
          <h3 className="font-semibold text-sm text-emerald-700 uppercase tracking-wider">Financials (रू)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">App Cash</label>
              <input type="number" step="0.01" {...register("cashAsPerApp")} className="premium-input text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Goal Bonus</label>
              <input type="number" step="0.01" {...register("goalBonus")} className="premium-input text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Promo & Other</label>
              <input type="number" step="0.01" {...register("promotionBonusOther")} className="premium-input text-sm" />
            </div>
            <div className="space-y-1.5 lg:col-span-3">
              <label className="text-xs font-bold text-emerald-800">
                Total Income <span className="font-normal text-emerald-600">(App Cash + Goal Bonus + Promo)</span>
              </label>
              <input type="number" step="0.01" {...register("totalIncome")} className="premium-input text-lg font-bold border-emerald-300 bg-emerald-50" />
            </div>
            
            <div className="col-span-full border-t border-emerald-100 my-2"></div>
            
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Driver Cash (Physical)</label>
              <input type="number" step="0.01" {...register("cashGivenByDriver")} className="premium-input text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Online Transfer</label>
              <input type="number" step="0.01" {...register("cashTransferredOnline")} className="premium-input text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-amber-700">
                Cash Check <span className="font-normal text-amber-600">(App − Driver − Online)</span>
              </label>
              <input
                type="number"
                step="0.01"
                {...register("cashCheck")}
                readOnly
                className="premium-input text-sm border-amber-300 bg-amber-50/80 text-amber-900 cursor-not-allowed select-none"
                placeholder="Auto-calculated"
                tabIndex={-1}
              />
            </div>
          </div>
        </div>

        <div className="bg-muted/40 p-4 rounded-xl space-y-4 border">
          <h3 className="font-semibold text-sm text-primary uppercase tracking-wider">Allowances</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Daily Allowance (रू)</label>
              <input type="number" step="0.01" {...register("dailyAllowance")} className="premium-input text-sm" placeholder="0.00" />
            </div>
            <div className="space-y-1.5 lg:col-span-1">
              <label className="text-xs font-medium text-muted-foreground">Remarks</label>
              <input {...register("remarks")} className="premium-input text-sm" placeholder="Any notes..." />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 sticky bottom-0 bg-background/90 backdrop-blur py-4 border-t">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isPending || !!duplicateLog}>
            {isPending ? "Saving..." : defaultValues ? "Update Log" : "Save Daily Log"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
