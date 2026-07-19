import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRiders } from "@/hooks/use-riders";
import { PageHeader, Card, Button, Currency, EmptyState, ConfirmDialog } from "@/components/ui-components";
import { DateRangeFilter, getDefaultDateRange, type CalendarMode } from "@/components/date-range-filter";
import { Banknote, AlertTriangle, Trash2, Calculator, CheckCircle, CheckCircle2, X, Users, ChevronDown, ChevronUp, AlertCircle, CalendarDays, XCircle, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";

const API_BASE = `${import.meta.env.BASE_URL}api`;

// ─── Types ────────────────────────────────────────────────────────────────

interface SalaryEntry {
  riderId: number;
  riderName: string;
  riderStatus: string;
  joiningDate?: string | null;
  joiningMidPeriod: boolean;
  effectiveDays: number;
  daysWorked: number;
  timesTargetMissed: number;
  baseSalary: string;
  totalAllowances: string;
  totalAdvances: string;
  totalCashVariance: string;
  finalSalary: string;
  salaryProcessed?: string;
  salaryDifference?: string;
  flagged: boolean;
  advanceIds: number[];
  notes?: string;
  payModel?: "legacy" | "vpe";
  daysLocked?: number;
  unlockedDays?: number;
  floorApplied?: boolean;
}

interface SalaryAdvance {
  id: number;
  riderId: number;
  riderName: string;
  date: string;
  amount: string;
  notes?: string | null;
  appliedAt?: string | null;
  salaryPaymentId?: number | null;
}

interface SalaryPayment {
  id: number;
  riderId: number;
  riderName: string;
  periodFrom: string;
  periodTo: string;
  daysWorked: number;
  timesTargetMissed: number;
  baseSalary: string;
  totalAllowances: string;
  totalAdvances: string;
  totalCashVariance?: string | null;
  finalSalary: string;
  salaryProcessed?: string | null;
  salaryDifference?: string | null;
  flagged: boolean;
  processedAt: string;
  processedBy?: string | null;
  notes?: string | null;
}

// ─── Hooks ────────────────────────────────────────────────────────────────

function useAdvances() {
  return useQuery({
    queryKey: ["salary-advances"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/salary/advances`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch advances");
      return res.json() as Promise<SalaryAdvance[]>;
    },
  });
}

function useSalaryHistory() {
  return useQuery({
    queryKey: ["salary-history"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/salary/history`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch salary history");
      return res.json() as Promise<SalaryPayment[]>;
    },
  });
}

// ─── GrowthBadge ─────────────────────────────────────────────────────────

function FlagBadge({ count }: { count: number }) {
  const flagged = count >= 3;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
      flagged ? "bg-red-100 text-red-700" : count > 0 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"
    }`}>
      {flagged && <AlertTriangle className="w-3 h-3" />}
      {count}×
    </span>
  );
}

// ─── Salary Modal ─────────────────────────────────────────────────────────

function gapDays(lastPeriodTo: string, currentPeriodFrom: string): number {
  const last = new Date(lastPeriodTo + "T00:00:00");
  const current = new Date(currentPeriodFrom + "T00:00:00");
  const dayAfterLast = new Date(last.getTime() + 86400000);
  return Math.round((current.getTime() - dayAfterLast.getTime()) / 86400000);
}

function LastPaidInfo({ lastPaid, periodFrom }: { lastPaid: string | undefined; periodFrom: string }) {
  if (!lastPaid) {
    return <span className="text-muted-foreground text-xs">First payment</span>;
  }
  const gap = gapDays(lastPaid, periodFrom);
  if (gap < 0) {
    return (
      <span className="text-orange-600 text-xs flex items-center gap-1">
        <AlertCircle className="w-3 h-3" /> Overlaps with last period ({lastPaid})
      </span>
    );
  }
  if (gap === 0) {
    return (
      <span className="text-emerald-600 text-xs flex items-center gap-1">
        <CheckCircle2 className="w-3 h-3" /> Continuous — last paid to {lastPaid}
      </span>
    );
  }
  const color = gap >= 7 ? "text-red-600" : "text-amber-600";
  return (
    <span className={`${color} text-xs flex items-center gap-1`}>
      <AlertTriangle className="w-3 h-3" /> Gap: {gap} day(s) — last paid to {lastPaid}
    </span>
  );
}

function SalaryModal({
  entries,
  periodFrom,
  periodTo,
  history,
  onClose,
  onProcess,
  isProcessing,
}: {
  entries: SalaryEntry[];
  periodFrom: string;
  periodTo: string;
  history: SalaryPayment[];
  onClose: () => void;
  onProcess: (entries: SalaryEntry[], force: boolean) => void;
  isProcessing: boolean;
}) {
  const [editedEntries, setEditedEntries] = useState<SalaryEntry[]>(entries.map(e => ({ ...e })));
  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false);
  const [selectedRiderIds, setSelectedRiderIds] = useState<Set<number>>(
    () => new Set(entries.map(e => e.riderId))
  );
  const selectAllRef = useRef<HTMLInputElement>(null);

  // Keep the "select all" checkbox indeterminate when only some are selected
  useEffect(() => {
    if (!selectAllRef.current) return;
    const allSelected = selectedRiderIds.size === editedEntries.length;
    const noneSelected = selectedRiderIds.size === 0;
    selectAllRef.current.indeterminate = !allSelected && !noneSelected;
    selectAllRef.current.checked = allSelected;
  }, [selectedRiderIds, editedEntries.length]);

  const alreadyPaidRiderIds = useMemo(() => {
    const set = new Set<number>();
    for (const p of history) {
      if (p.periodFrom <= periodTo && p.periodTo >= periodFrom) {
        set.add(p.riderId);
      }
    }
    return set;
  }, [history, periodFrom, periodTo]);

  const lastPaidByRider = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of history) {
      const existing = map.get(p.riderId);
      if (!existing || p.periodTo > existing) {
        map.set(p.riderId, p.periodTo);
      }
    }
    return map;
  }, [history]);

  // Only count/total the SELECTED riders
  const selectedEntries = editedEntries.filter(e => selectedRiderIds.has(e.riderId));
  const conflictCount = [...selectedRiderIds].filter(id => alreadyPaidRiderIds.has(id)).length;
  const hasConflicts = conflictCount > 0;
  const flaggedCount = selectedEntries.filter(e => e.flagged).length;
  const grandTotal = selectedEntries.reduce((s, e) => s + parseFloat(e.salaryProcessed || e.finalSalary || "0"), 0);

  // Working days = calendar days excluding Saturdays — matches server calculation
  const totalPeriodDays = useMemo(() => {
    const from = new Date(periodFrom + "T00:00:00");
    const to = new Date(periodTo + "T00:00:00");
    let count = 0;
    const d = new Date(from);
    while (d <= to) {
      if (d.getDay() !== 6) count++;
      d.setDate(d.getDate() + 1);
    }
    return Math.max(1, count);
  }, [periodFrom, periodTo]);

  const toggleRider = (riderId: number) => {
    setSelectedRiderIds(prev => {
      const next = new Set(prev);
      next.has(riderId) ? next.delete(riderId) : next.add(riderId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedRiderIds(
      selectedRiderIds.size === editedEntries.length
        ? new Set()
        : new Set(editedEntries.map(e => e.riderId))
    );
  };

  const updateSalaryProcessed = (riderId: number, val: string) =>
    setEditedEntries(prev => prev.map(e => {
      if (e.riderId !== riderId) return e;
      const processed = parseFloat(val) || 0;
      const final = parseFloat(e.finalSalary) || 0;
      const diff = final - processed;
      return { ...e, salaryProcessed: val, salaryDifference: diff.toFixed(2) };
    }));

  const updateNotes = (riderId: number, val: string) =>
    setEditedEntries(prev => prev.map(e => e.riderId === riderId ? { ...e, notes: val } : e));

  const handleProcessClick = () => {
    // Validate: notes required when salaryProcessed ≠ finalSalary
    const needsNotes = selectedEntries.filter(e => {
      const diff = Math.abs(parseFloat(e.salaryDifference || "0"));
      return diff > 0.001 && !e.notes?.trim();
    });
    if (needsNotes.length > 0) {
      alert(`Notes are required for riders where Salary Processed differs from Final Salary:\n${needsNotes.map(e => e.riderName).join(", ")}`);
      return;
    }
    if (hasConflicts) {
      setShowDuplicateConfirm(true);
    } else {
      onProcess(selectedEntries, false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-background w-full max-w-6xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          {/* Modal Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-primary/5 to-background">
            <div>
              <h2 className="text-xl font-bold text-foreground">Salary Processing</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Period: {periodFrom} → {periodTo} &nbsp;·&nbsp;
                <span className={selectedRiderIds.size === 0 ? "text-red-500 font-semibold" : ""}>
                  {selectedRiderIds.size} of {editedEntries.length} selected
                </span>
                {flaggedCount > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 text-red-600 font-semibold">
                    <AlertTriangle className="w-3.5 h-3.5" /> {flaggedCount} flagged
                  </span>
                )}
              </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg text-muted-foreground transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Duplicate Warning Banner */}
          {hasConflicts && (
            <div className="px-6 py-3 bg-orange-50 border-b border-orange-200 flex items-start gap-3 text-orange-800">
              <AlertCircle className="w-5 h-5 flex-shrink-0 text-orange-500 mt-0.5" />
              <div className="text-sm">
                <span className="font-semibold">Duplicate Payment Warning: </span>
                {conflictCount} of your selected rider(s) already have a payment record overlapping this period.
                Rows marked <span className="font-semibold text-orange-700">Already Paid</span> should be reviewed carefully before proceeding.
              </div>
            </div>
          )}

          {/* Table */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b sticky top-0">
                <tr>
                  <th className="px-4 py-3">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      onChange={toggleAll}
                      className="w-4 h-4 rounded border-border cursor-pointer accent-primary"
                      title="Select / deselect all"
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">Rider</th>
                  <th className="px-4 py-3 font-medium text-center">Days Worked</th>
                  <th className="px-4 py-3 font-medium text-center">Target Missed</th>
                  <th className="px-4 py-3 font-medium text-right">Base Salary</th>
                  <th className="px-4 py-3 font-medium text-right">Allowances</th>
                  <th className="px-4 py-3 font-medium text-right">Advances (−)</th>
                  <th className="px-4 py-3 font-medium text-right">Cash Check</th>
                  <th className="px-4 py-3 font-medium text-right">Final Salary</th>
                  <th className="px-4 py-3 font-medium text-right">Salary Processed</th>
                  <th className="px-4 py-3 font-medium text-right">Difference</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {editedEntries.map(e => {
                  const isPaid = alreadyPaidRiderIds.has(e.riderId);
                  const isSelected = selectedRiderIds.has(e.riderId);
                  return (
                    <tr
                      key={e.riderId}
                      onClick={() => toggleRider(e.riderId)}
                      className={`border-b last:border-0 cursor-pointer transition-opacity ${
                        !isSelected
                          ? "opacity-40 hover:opacity-60"
                          : isPaid
                          ? "bg-orange-50/60 hover:bg-orange-50/80"
                          : e.flagged
                          ? "bg-red-50/60 hover:bg-red-50/80"
                          : "hover:bg-muted/30"
                      }`}
                    >
                      <td className="px-4 py-3" onClick={ev => ev.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRider(e.riderId)}
                          className="w-4 h-4 rounded border-border cursor-pointer accent-primary"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2">
                          {e.flagged && isSelected && <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-1" />}
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold">{e.riderName}</span>
                              {e.riderStatus !== "active" && (
                                <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium border border-gray-300">
                                  Inactive
                                </span>
                              )}
                              {isPaid && (
                                <span className="inline-flex items-center gap-1 text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium border border-orange-200">
                                  <AlertCircle className="w-3 h-3" /> Already Paid
                                </span>
                              )}
                              {e.payModel === "vpe" && (
                                <span className="inline-flex items-center gap-1 text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-medium border border-violet-200"
                                      title={`Variable Pay Engine — sum of ${e.daysLocked ?? 0} locked day record(s)${e.floorApplied ? "; wage floor applied" : ""}`}>
                                  VPE · {e.daysLocked ?? 0}d
                                </span>
                              )}
                              {e.payModel === "vpe" && (e.unlockedDays ?? 0) > 0 && (
                                <span className="inline-flex items-center gap-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium border border-red-200"
                                      title="Days worked whose cash is not yet approved — they carry NO pay yet. Approve their cash collections first.">
                                  <AlertTriangle className="w-3 h-3" /> {e.unlockedDays} day(s) not locked
                                </span>
                              )}
                              {e.payModel === "vpe" && (
                                <a className="text-xs text-violet-700 underline"
                                   href={`${API_BASE}/salary/pay-records.csv?riderId=${e.riderId}&dateFrom=${periodFrom}&dateTo=${periodTo}`}>
                                  day breakdown
                                </a>
                              )}
                            </div>
                            <div className="mt-0.5">
                              <LastPaidInfo lastPaid={lastPaidByRider.get(e.riderId)} periodFrom={periodFrom} />
                            </div>
                            {e.joiningMidPeriod && e.joiningDate && (
                              <div className="mt-0.5">
                                <span className="text-blue-600 text-xs flex items-center gap-1">
                                  <CalendarDays className="w-3 h-3" />
                                  Joined {e.joiningDate} — {e.effectiveDays} working day(s) available
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">{e.daysWorked}</td>
                      <td className="px-4 py-3 text-center">
                        <FlagBadge count={e.timesTargetMissed} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        <Currency amount={e.baseSalary} />
                        {e.joiningMidPeriod && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            ({e.effectiveDays} of {totalPeriodDays} working days)
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-red-600">
                        − <Currency amount={e.totalAllowances} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-red-600">
                        − <Currency amount={e.totalAdvances} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {(() => {
                          const cv = parseFloat(e.totalCashVariance || "0");
                          if (Math.abs(cv) < 0.001) return <span className="text-muted-foreground text-xs">—</span>;
                          return cv > 0
                            ? <span className="text-red-600">− <Currency amount={cv.toFixed(2)} /></span>
                            : <span className="text-green-600">+ <Currency amount={Math.abs(cv).toFixed(2)} /></span>;
                        })()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-foreground">
                        <Currency amount={e.finalSalary} />
                      </td>
                      <td className="px-4 py-3 text-right" onClick={ev => ev.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-muted-foreground text-xs">रू</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={e.salaryProcessed ?? e.finalSalary}
                            onChange={ev => updateSalaryProcessed(e.riderId, ev.target.value)}
                            className="w-28 text-right font-mono font-bold text-foreground border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/30 bg-background"
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {(() => {
                          const diff = parseFloat(e.salaryDifference || "0");
                          if (Math.abs(diff) < 0.001) return <span className="text-muted-foreground text-xs">—</span>;
                          return (
                            <span className={diff > 0 ? "text-amber-600 font-semibold" : "text-green-600 font-semibold"}>
                              {diff > 0 ? "−" : "+"}<Currency amount={Math.abs(diff).toFixed(2)} />
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3" onClick={ev => ev.stopPropagation()}>
                        {(() => {
                          const diff = Math.abs(parseFloat(e.salaryDifference || "0"));
                          const needsNote = diff > 0.001;
                          return (
                            <div className="relative">
                              <input
                                type="text"
                                placeholder={needsNote ? "Required..." : "Optional note..."}
                                value={e.notes || ""}
                                onChange={ev => updateNotes(e.riderId, ev.target.value)}
                                className={`w-36 border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 bg-background placeholder:text-muted-foreground/50 ${needsNote && !e.notes?.trim() ? "border-red-400 focus:ring-red-300" : "focus:ring-primary/30"}`}
                              />
                              {needsNote && <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-muted/30 flex items-center justify-between gap-4">
            <div className="text-sm font-medium text-muted-foreground">
              Grand Total Payout{selectedRiderIds.size < editedEntries.length ? " (selected)" : ""}:{" "}
              <span className="text-xl font-bold text-foreground ml-1">
                रू {grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleProcessClick} disabled={isProcessing || selectedRiderIds.size === 0}>
                <CheckCircle className="w-4 h-4" />
                {isProcessing ? "Processing..." : `Process ${selectedRiderIds.size} Rider(s)`}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Duplicate Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDuplicateConfirm}
        onClose={() => setShowDuplicateConfirm(false)}
        title="Duplicate Payment Warning"
        description={`${conflictCount} of your selected rider(s) already have a payment record that overlaps this period (${periodFrom} → ${periodTo}). Processing will create a second payment entry for those riders. Are you sure you want to continue?`}
        onConfirm={() => onProcess(selectedEntries, true)}
        isPending={isProcessing}
      />
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────

export default function Salary() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: riders } = useRiders();
  const { data: advances, isLoading: advancesLoading } = useAdvances();
  const { data: history, isLoading: historyLoading } = useSalaryHistory();

  const [dateRange, setDateRange] = useState(getDefaultDateRange);
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("AD");
  const [calcLoading, setCalcLoading] = useState(false);
  const [modalEntries, setModalEntries] = useState<SalaryEntry[] | null>(null);
  const [deletingAdvance, setDeletingAdvance] = useState<SalaryAdvance | null>(null);
  const [voidingPayment, setVoidingPayment] = useState<SalaryPayment | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [advanceStatusFilter, setAdvanceStatusFilter] = useState<"all" | "pending" | "applied">("pending");
  const [advanceRiderSearch, setAdvanceRiderSearch] = useState("");

  const activeRiders = useMemo(() => riders?.filter(r => r.status === "active") ?? [], [riders]);
  const inactiveRiders = useMemo(() => riders?.filter(r => r.status !== "active") ?? [], [riders]);

  const filteredAdvances = useMemo(() => {
    if (!advances) return [];
    return advances.filter(a => {
      const matchesStatus =
        advanceStatusFilter === "all" ||
        (advanceStatusFilter === "pending" && !a.appliedAt) ||
        (advanceStatusFilter === "applied" && !!a.appliedAt);
      const matchesRider =
        !advanceRiderSearch.trim() ||
        a.riderName.toLowerCase().includes(advanceRiderSearch.trim().toLowerCase());
      return matchesStatus && matchesRider;
    });
  }, [advances, advanceStatusFilter, advanceRiderSearch]);

  const salaryStats = useMemo(() => {
    const pending = advances?.filter(a => !a.appliedAt) ?? [];
    const pendingTotal = pending.reduce((s, a) => s + parseFloat(a.amount ?? "0"), 0);
    const pendingRiderIds = new Set(pending.map(a => a.riderId));

    // Include payments whose pay period overlaps the current calendar month (not just when processed)
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
    const thisMonthPayments = history?.filter(p => p.periodFrom <= monthEnd && p.periodTo >= monthStart) ?? [];
    const paidTotal = thisMonthPayments.reduce((s, p) => s + parseFloat(p.salaryProcessed ?? p.finalSalary ?? "0"), 0);
    const paidRiderIds = new Set(thisMonthPayments.map(p => p.riderId));

    const unpaidCount = activeRiders.filter(r => !paidRiderIds.has(r.id)).length;

    return {
      pendingTotal,
      pendingCount: pending.length,
      pendingRiderCount: pendingRiderIds.size,
      paidTotal,
      paidRiderCount: paidRiderIds.size,
      unpaidCount,
      activeRiderCount: activeRiders.length,
      currentMonthLabel: new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    };
  }, [advances, history, activeRiders]);

  const { register, handleSubmit, reset, watch } = useForm<{ riderId: string; date: string; amount: string; notes: string }>();

  const handleCalculate = async () => {
    setCalcLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/salary/calculate?dateFrom=${dateRange.from}&dateTo=${dateRange.to}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to calculate salary");
      const data = await res.json();
      setModalEntries(data.entries.map((e: SalaryEntry) => ({
        ...e,
        salaryProcessed: e.finalSalary,
        salaryDifference: "0.00",
      })));
    } catch {
      toast({ title: "Error", description: "Failed to calculate salary. Try again.", variant: "destructive" });
    } finally {
      setCalcLoading(false);
    }
  };

  const processMutation = useMutation({
    mutationFn: async ({ entries, force }: { entries: SalaryEntry[]; force: boolean }) => {
      const res = await fetch(`${API_BASE}/salary/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ periodFrom: dateRange.from, periodTo: dateRange.to, entries, force }),
      });
      if (!res.ok) throw new Error("Failed to process salary");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-history"] });
      setModalEntries(null);
      toast({ title: "Salary Processed", description: `Salary run for ${dateRange.from} → ${dateRange.to} saved successfully.` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to process salary.", variant: "destructive" });
    },
  });

  const createAdvanceMutation = useMutation({
    mutationFn: async (data: { riderId: string; date: string; amount: string; notes: string }) => {
      const res = await fetch(`${API_BASE}/salary/advances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to record advance");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-advances"] });
      reset();
      toast({ title: "Advance Recorded", description: "Advance has been saved successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to record advance.", variant: "destructive" });
    },
  });

  const deleteAdvanceMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${API_BASE}/salary/advances/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to delete advance");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-advances"] });
      setDeletingAdvance(null);
      toast({ title: "Advance Deleted", description: "Advance record removed." });
    },
  });

  const voidPaymentMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${API_BASE}/salary/payments/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to void payment");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-history"] });
      queryClient.invalidateQueries({ queryKey: ["salary-advances"] });
      setVoidingPayment(null);
      toast({ title: "Payment Voided", description: "The salary payment has been removed. Any linked advances are back to Pending." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to void payment. Try again.", variant: "destructive" });
    },
  });

  const groupedHistory = useMemo(() => {
    if (!history) return [];
    const groups = new Map<string, SalaryPayment[]>();
    for (const p of history) {
      const key = `${p.periodFrom}|${p.periodTo}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    return Array.from(groups.entries()).map(([key, payments]) => {
      const [pf, pt] = key.split("|");
      const uniqueRunDates = [...new Set(payments.map(p => p.processedAt?.slice(0, 10)).filter(Boolean))].sort();
      const lastRunDate = uniqueRunDates.at(-1) ?? null;
      const lastRunPayment = [...payments].sort((a, b) =>
        (b.processedAt ?? "").localeCompare(a.processedAt ?? "")
      )[0];
      return {
        periodFrom: pf,
        periodTo: pt,
        payments,
        lastRunDate,
        runCount: uniqueRunDates.length,
        processedBy: lastRunPayment?.processedBy ?? null,
      };
    });
  }, [history]);

  return (
    <div>
      <PageHeader
        title="Salary Processing"
        description="Process rider salaries, record advances, and view payment history."
      />

      {/* ── Summary Stats ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {/* Pending Advances */}
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground font-medium">Pending Advances</p>
              <p className="text-2xl font-bold mt-1 font-mono">
                {advances ? `रू ${salaryStats.pendingTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {advances
                  ? `${salaryStats.pendingCount} advance${salaryStats.pendingCount !== 1 ? "s" : ""} · ${salaryStats.pendingRiderCount} rider${salaryStats.pendingRiderCount !== 1 ? "s" : ""}`
                  : "Loading…"}
              </p>
            </div>
            <div className="shrink-0 w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-amber-600" />
            </div>
          </div>
        </Card>

        {/* Salary Paid This Month */}
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground font-medium">Salary Paid This Month</p>
              <p className="text-2xl font-bold mt-1 font-mono">
                {history ? `रू ${salaryStats.paidTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {history
                  ? `${salaryStats.paidRiderCount} rider${salaryStats.paidRiderCount !== 1 ? "s" : ""} paid · ${salaryStats.currentMonthLabel}`
                  : "Loading…"}
              </p>
            </div>
            <div className="shrink-0 w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>
          </div>
        </Card>

        {/* Unpaid Active Riders */}
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground font-medium">Unpaid This Month</p>
              <p className={`text-2xl font-bold mt-1 ${salaryStats.unpaidCount > 0 ? "text-red-600" : "text-emerald-600"}`}>
                {riders && history ? salaryStats.unpaidCount : "—"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {riders && history
                  ? `of ${salaryStats.activeRiderCount} active rider${salaryStats.activeRiderCount !== 1 ? "s" : ""}`
                  : "Loading…"}
              </p>
            </div>
            <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${salaryStats.unpaidCount > 0 ? "bg-red-100" : "bg-emerald-100"}`}>
              <Users className={`w-5 h-5 ${salaryStats.unpaidCount > 0 ? "text-red-600" : "text-emerald-600"}`} />
            </div>
          </div>
        </Card>
      </div>

      {/* ── Section 1: Process Salary ── */}
      <Card className="mb-6 p-6">
        <div className="flex items-center gap-2 mb-5">
          <Calculator className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Process Salary</h2>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end gap-4">
          <div>
            <p className="text-sm text-muted-foreground mb-2">Select the salary period:</p>
            <DateRangeFilter
              dateFrom={dateRange.from}
              dateTo={dateRange.to}
              onChange={(from, to) => setDateRange({ from, to })}
              calendarMode={calendarMode}
              onCalendarModeChange={setCalendarMode}
            />
          </div>
          <Button onClick={handleCalculate} disabled={calcLoading || !dateRange.from || !dateRange.to}>
            <Calculator className="w-4 h-4" />
            {calcLoading ? "Calculating..." : "Calculate Salary"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Base salary: standard riders are prorated as Monthly Salary ÷ working days × days worked; <span className="font-medium text-violet-700">VPE pilots</span> earn the sum of their locked Variable-Pay-Engine day records instead. Daily allowances from logs are deducted (already paid in cash to riders). All <span className="font-medium text-amber-700">pending</span> advances (not yet applied to a previous run) are also deducted and marked as applied when you process.
        </p>
      </Card>

      {/* ── Section 2: Record Advance ── */}
      <Card className="mb-6 p-6">
        <div className="flex items-center gap-2 mb-5">
          <Banknote className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Record Advance</h2>
        </div>
        <form
          onSubmit={handleSubmit(d => createAdvanceMutation.mutate(d))}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6"
        >
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Rider *</label>
            <select {...register("riderId", { required: true })} className="premium-input">
              <option value="">Select rider...</option>
              {activeRiders.length > 0 && (
                <optgroup label="Active Riders">
                  {activeRiders.map(r => (
                    <option key={r.id} value={r.id}>{r.fullName}</option>
                  ))}
                </optgroup>
              )}
              {inactiveRiders.length > 0 && (
                <optgroup label="Inactive / Former Riders">
                  {inactiveRiders.map(r => (
                    <option key={r.id} value={r.id}>{r.fullName}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Date *</label>
            <input type="date" {...register("date", { required: true })} className="premium-input" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Amount (रू) *</label>
            <input type="number" step="0.01" min="0" {...register("amount", { required: true })} className="premium-input" placeholder="0.00" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Notes</label>
            <input type="text" {...register("notes")} className="premium-input" placeholder="Optional reason..." />
          </div>
          <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
            <Button type="submit" disabled={createAdvanceMutation.isPending}>
              {createAdvanceMutation.isPending ? "Saving..." : "Record Advance"}
            </Button>
          </div>
        </form>

        {/* Advances Filter Bar */}
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <div className="flex rounded-lg border overflow-hidden text-xs font-medium">
            {(["pending", "applied", "all"] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setAdvanceStatusFilter(f)}
                className={`px-3 py-1.5 transition-colors ${
                  advanceStatusFilter === f
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {f === "all" ? "All" : f === "pending" ? "Pending" : "Applied"}
              </button>
            ))}
          </div>
          <div className="relative min-w-[160px] max-w-xs flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search rider..."
              value={advanceRiderSearch}
              onChange={e => setAdvanceRiderSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs w-full border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 bg-background"
            />
          </div>
          <span className="text-xs text-muted-foreground ml-auto">
            {filteredAdvances.length} of {advances?.length ?? 0}
          </span>
        </div>

        {/* Advances Table */}
        <div className="border rounded-xl overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
              <tr>
                <th className="px-4 py-3 font-medium">Rider</th>
                <th className="px-4 py-3 font-medium">Date Recorded</th>
                <th className="px-4 py-3 font-medium text-right">Amount</th>
                <th className="px-4 py-3 font-medium">Notes</th>
                <th className="px-4 py-3 font-medium text-center">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {advancesLoading ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Loading...</td></tr>
              ) : filteredAdvances.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  <EmptyState
                    title={advances?.length === 0 ? "No advances recorded" : `No ${advanceStatusFilter !== "all" ? advanceStatusFilter : ""} advances found`}
                    description={advances?.length === 0 ? "Record an advance above to see it here." : "Try adjusting the filter or search above."}
                    icon={Banknote}
                  />
                </td></tr>
              ) : (
                filteredAdvances.map(a => {
                  const isApplied = !!a.appliedAt;
                  return (
                    <tr key={a.id} className={`border-b last:border-0 ${isApplied ? "bg-muted/20" : "hover:bg-muted/30"}`}>
                      <td className="px-4 py-3 font-semibold">{a.riderName}</td>
                      <td className="px-4 py-3 font-mono text-sm">{a.date}</td>
                      <td className="px-4 py-3 text-right"><Currency amount={a.amount} /></td>
                      <td className="px-4 py-3 text-muted-foreground">{a.notes || "—"}</td>
                      <td className="px-4 py-3 text-center">
                        {isApplied ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" /> Applied
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium border border-amber-200">
                            <AlertCircle className="w-3 h-3" /> Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isApplied ? (
                          <span
                            title="Applied advances cannot be deleted — they are part of a processed salary run."
                            className="p-1.5 text-muted-foreground/30 cursor-not-allowed inline-flex"
                          >
                            <Trash2 className="w-4 h-4" />
                          </span>
                        ) : (
                          <button
                            onClick={() => setDeletingAdvance(a)}
                            className="p-1.5 hover:bg-red-50 hover:text-red-600 text-muted-foreground rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Section 3: Salary History ── */}
      <Card className="p-6">
        <button
          className="flex items-center justify-between w-full gap-2 mb-1"
          onClick={() => setHistoryExpanded(p => !p)}
        >
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Salary History</h2>
            {history && <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{groupedHistory.length} run(s)</span>}
          </div>
          {historyExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>

        {historyExpanded && (
          <div className="mt-4 space-y-4">
            {historyLoading ? (
              <p className="text-center text-muted-foreground py-4">Loading...</p>
            ) : groupedHistory.length === 0 ? (
              <EmptyState title="No salary runs yet" description="Process a salary run to see it here." icon={Users} />
            ) : (
              groupedHistory.map((group, gi) => (
                <div key={gi} className="border rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-muted/50 border-b flex items-center justify-between gap-4">
                    <span className="text-sm font-semibold">
                      Period: {group.periodFrom} → {group.periodTo}
                    </span>
                    <span className="text-xs text-muted-foreground flex items-center gap-2">
                      Last processed {group.lastRunDate ?? "—"} by {group.processedBy ?? "—"}
                      {group.runCount > 1 && (
                        <span className="bg-amber-100 text-amber-700 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                          {group.runCount} runs
                        </span>
                      )}
                    </span>
                  </div>
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-muted-foreground uppercase bg-muted/30 border-b">
                      <tr>
                        <th className="px-4 py-2 font-medium">Rider</th>
                        <th className="px-4 py-2 font-medium text-center">Days</th>
                        <th className="px-4 py-2 font-medium text-center">Missed</th>
                        <th className="px-4 py-2 font-medium text-right">Base</th>
                        <th className="px-4 py-2 font-medium text-right">Allowances</th>
                        <th className="px-4 py-2 font-medium text-right">Advances</th>
                        <th className="px-4 py-2 font-medium text-right">Cash Check</th>
                        <th className="px-4 py-2 font-medium text-right">Final</th>
                        <th className="px-4 py-2 font-medium text-right">Processed</th>
                        <th className="px-4 py-2 font-medium text-right">Diff</th>
                        <th className="px-4 py-2 font-medium">Notes</th>
                        <th className="px-4 py-2 font-medium text-right">Void</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.payments.map(p => (
                        <tr key={p.id} className={`border-b last:border-0 ${p.flagged ? "bg-red-50/40" : ""}`}>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1.5">
                              {p.flagged && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
                              <span className="font-medium">{p.riderName}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-center">{p.daysWorked}</td>
                          <td className="px-4 py-2.5 text-center"><FlagBadge count={p.timesTargetMissed} /></td>
                          <td className="px-4 py-2.5 text-right font-mono"><Currency amount={p.baseSalary} /></td>
                          <td className="px-4 py-2.5 text-right font-mono text-red-600">−<Currency amount={p.totalAllowances} /></td>
                          <td className="px-4 py-2.5 text-right font-mono text-red-600">−<Currency amount={p.totalAdvances} /></td>
                          <td className="px-4 py-2.5 text-right font-mono">
                            {(() => {
                              const cv = parseFloat(p.totalCashVariance || "0");
                              if (Math.abs(cv) < 0.001) return <span className="text-muted-foreground text-xs">—</span>;
                              return cv > 0
                                ? <span className="text-red-600">−<Currency amount={cv.toFixed(2)} /></span>
                                : <span className="text-green-600">+<Currency amount={Math.abs(cv).toFixed(2)} /></span>;
                            })()}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono"><Currency amount={p.finalSalary} /></td>
                          <td className="px-4 py-2.5 text-right font-bold font-mono">
                            <Currency amount={p.salaryProcessed ?? p.finalSalary} />
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono">
                            {(() => {
                              const diff = parseFloat(p.salaryDifference || "0");
                              if (Math.abs(diff) < 0.001) return <span className="text-muted-foreground text-xs">—</span>;
                              return (
                                <span className={diff > 0 ? "text-amber-600 font-semibold" : "text-green-600 font-semibold"}>
                                  {diff > 0 ? "−" : "+"}<Currency amount={Math.abs(diff).toFixed(2)} />
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground text-xs">{p.notes || "—"}</td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              onClick={() => setVoidingPayment(p)}
                              title="Void this payment"
                              className="p-1.5 hover:bg-red-50 hover:text-red-600 text-muted-foreground rounded-lg transition-colors"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </div>
        )}
      </Card>

      {/* Salary Calculation Modal */}
      {modalEntries && (
        <SalaryModal
          entries={modalEntries}
          periodFrom={dateRange.from}
          periodTo={dateRange.to}
          history={history ?? []}
          onClose={() => setModalEntries(null)}
          onProcess={(entries, force) => processMutation.mutate({ entries, force })}
          isProcessing={processMutation.isPending}
        />
      )}

      {/* Confirm Delete Advance */}
      <ConfirmDialog
        isOpen={!!deletingAdvance}
        onClose={() => setDeletingAdvance(null)}
        title="Delete Advance"
        description={`Remove the रू ${deletingAdvance?.amount} advance for ${deletingAdvance?.riderName} on ${deletingAdvance?.date}? This cannot be undone.`}
        onConfirm={() => deletingAdvance && deleteAdvanceMutation.mutate(deletingAdvance.id)}
        isPending={deleteAdvanceMutation.isPending}
      />

      {/* Confirm Void Payment */}
      <ConfirmDialog
        isOpen={!!voidingPayment}
        onClose={() => setVoidingPayment(null)}
        title="Void Salary Payment"
        description={`This will permanently remove the salary payment for ${voidingPayment?.riderName} (period ${voidingPayment?.periodFrom} → ${voidingPayment?.periodTo}, final रू ${voidingPayment?.finalSalary}). Any advances that were applied in this run will be returned to Pending status. This cannot be undone.`}
        onConfirm={() => voidingPayment && voidPaymentMutation.mutate(voidingPayment.id)}
        isPending={voidPaymentMutation.isPending}
      />
    </div>
  );
}
