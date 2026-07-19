import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useAuth } from "@/contexts/auth-context";
import { useRiders } from "@/hooks/use-riders";
import { PageHeader, Card, Dialog, ConfirmDialog, EmptyState } from "@/components/ui-components";
import { useToast } from "@/hooks/use-toast";
import { DateRangeFilter, type CalendarMode } from "@/components/date-range-filter";
import { adToBSString } from "@/lib/nepali-date";
import {
  Banknote, Plus, Pencil, Trash2, CheckCircle, XCircle, Clock,
  ChevronDown, ChevronUp, AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const API_BASE = `${import.meta.env.BASE_URL}api`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface CashCollectionRecord {
  id: number;
  riderId: number;
  riderName: string | null;
  englishDate: string;
  nepaliDate: string | null;
  cashTotal: string;
  walletAmount: string;
  grandTotal: string;
  note: string | null;
  submittedBy: number | null;
  submittedByName: string | null;
  submittedAt: string;
  approvalStatus: string;
  approvedBy: number | null;
  approvedByName: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  dailyLogCash: string;
  dailyLogOnline: string;
  dailyAllowance: string;
  varianceCash: string;
  varianceOnline: string;
  varianceTotal: string;
}

interface FormData {
  riderId: string;
  englishDate: string;
  nepaliDate: string;
  cashAmount: string;
  walletAmount: string;
  note: string;
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Request failed");
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useCashCollection(dateFrom: string, dateTo: string) {
  return useQuery<CashCollectionRecord[]>({
    queryKey: ["cash-collection", dateFrom, dateTo],
    queryFn: () => apiFetch(`${API_BASE}/cash-collection?dateFrom=${dateFrom}&dateTo=${dateTo}`),
  });
}

function useMutations() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["cash-collection"] });

  const create = useMutation({
    mutationFn: (body: object) =>
      apiFetch<CashCollectionRecord>(`${API_BASE}/cash-collection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => { invalidate(); toast({ title: "Collection submitted" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      apiFetch<CashCollectionRecord>(`${API_BASE}/cash-collection/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => { invalidate(); toast({ title: "Collection updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`${API_BASE}/cash-collection/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast({ title: "Record deleted" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const approve = useMutation({
    mutationFn: (id: number) =>
      apiFetch<CashCollectionRecord>(`${API_BASE}/cash-collection/${id}/approve`, { method: "POST" }),
    onSuccess: () => { invalidate(); toast({ title: "Record approved" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const disapprove = useMutation({
    mutationFn: ({ id, approvalNote }: { id: number; approvalNote: string }) =>
      apiFetch<CashCollectionRecord>(`${API_BASE}/cash-collection/${id}/disapprove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalNote }),
      }),
    onSuccess: () => { invalidate(); toast({ title: "Record disapproved" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return { create, update, remove, approve, disapprove };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function localDateString(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function timeLeftMs(submittedAt: string) {
  const WINDOW = 5 * 60 * 1000;
  return WINDOW - (Date.now() - new Date(submittedAt).getTime());
}

function formatCountdown(ms: number) {
  if (ms <= 0) return null;
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function VarianceBadge({ value }: { value: string }) {
  const n = parseFloat(value);
  if (n === 0) return <span className="text-emerald-600 font-medium">रू 0</span>;
  return (
    <span className={cn("font-medium", n < 0 ? "text-red-600" : "text-amber-600")}>
      {n > 0 ? "+" : ""}रू {Math.abs(n).toFixed(2)}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "approved") return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Approved</Badge>;
  if (status === "disapproved") return <Badge className="bg-red-100 text-red-700 border-red-200">Disapproved</Badge>;
  return <Badge className="bg-amber-100 text-amber-700 border-amber-200">Pending</Badge>;
}

// ─── Submission Drawer ────────────────────────────────────────────────────────

function SubmitDrawer({
  open,
  onClose,
  editRecord,
  onSubmit,
  isLoading,
}: {
  open: boolean;
  onClose: () => void;
  editRecord: CashCollectionRecord | null;
  onSubmit: (data: FormData) => void;
  isLoading: boolean;
}) {
  const { data: riders = [] } = useRiders();
  const today = localDateString();

  const { register, handleSubmit, watch, setValue, reset } = useForm<FormData>({
    defaultValues: {
      riderId: "",
      englishDate: today,
      nepaliDate: adToBSString(today),
      cashAmount: "0",
      walletAmount: "0",
      note: "",
    },
  });

  useEffect(() => {
    if (editRecord) {
      reset({
        riderId: String(editRecord.riderId),
        englishDate: editRecord.englishDate,
        nepaliDate: editRecord.nepaliDate ?? "",
        cashAmount: editRecord.cashTotal,
        walletAmount: editRecord.walletAmount,
        note: editRecord.note ?? "",
      });
    } else {
      reset({
        riderId: "",
        englishDate: today,
        nepaliDate: adToBSString(today),
        cashAmount: "0",
        walletAmount: "0",
        note: "",
      });
    }
  }, [editRecord, open]);

  const fd = watch();
  const cashAmt = parseFloat(fd.cashAmount || "0") || 0;
  const walletAmt = parseFloat(fd.walletAmount || "0") || 0;
  const grandTotal = cashAmt + walletAmt;

  const handleDateChange = (v: string) => {
    setValue("englishDate", v);
    setValue("nepaliDate", adToBSString(v));
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-white h-full overflow-y-auto shadow-2xl flex flex-col">
        <div className="p-6 border-b">
          <h2 className="text-lg font-semibold">{editRecord ? "Edit Collection" : "Submit Cash Collection"}</h2>
          <p className="text-sm text-muted-foreground mt-1">Record cash and wallet amounts collected from a rider</p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex-1 flex flex-col">
          <div className="flex-1 p-6 space-y-6">
            {/* Rider */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Rider *</label>
              <select {...register("riderId", { required: true })} className="w-full border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="">Select rider…</option>
                {riders.map((r) => (
                  <option key={r.id} value={r.id}>{r.fullName}</option>
                ))}
              </select>
            </div>

            {/* Date */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Date *</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={fd.englishDate}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="flex-1 border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <input
                  readOnly
                  value={fd.nepaliDate}
                  className="w-36 border border-input rounded-md px-3 py-2 text-sm bg-muted/50 text-muted-foreground"
                  placeholder="BS date"
                />
              </div>
            </div>

            {/* Cash */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Cash (रू)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                {...register("cashAmount")}
                className="w-full border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="0"
              />
            </div>

            {/* Wallet */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Wallet / Online Transfer (रू)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                {...register("walletAmount")}
                className="w-full border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="0"
              />
            </div>

            {/* Grand total summary */}
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-center justify-between">
              <span className="text-sm font-semibold text-primary">Grand Total</span>
              <span className="text-xl font-bold text-primary">रू {grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>

            {/* Note */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Note / Remarks</label>
              <Textarea {...register("note")} placeholder="Any remarks or discrepancies…" rows={3} />
            </div>
          </div>

          <div className="p-6 border-t flex gap-3">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1" disabled={isLoading}>
              {isLoading ? "Saving…" : editRecord ? "Save Changes" : "Submit Collection"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Disapprove modal ─────────────────────────────────────────────────────────

function DisapproveModal({ open, onClose, onConfirm, isLoading }: { open: boolean; onClose: () => void; onConfirm: (note: string) => void; isLoading: boolean }) {
  const [note, setNote] = useState("");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
            <XCircle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">Disapprove Record</h3>
            <p className="text-sm text-muted-foreground">Please provide a reason for disapproving.</p>
          </div>
        </div>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason (e.g. cash short by रू 200)…"
          rows={3}
        />
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" className="flex-1" disabled={isLoading || !note.trim()} onClick={() => onConfirm(note)}>
            {isLoading ? "Saving…" : "Disapprove"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Countdown live timer ─────────────────────────────────────────────────────

function EditCountdown({ submittedAt }: { submittedAt: string }) {
  const [left, setLeft] = useState(() => timeLeftMs(submittedAt));
  useEffect(() => {
    if (left <= 0) return;
    const t = setInterval(() => setLeft(timeLeftMs(submittedAt)), 1000);
    return () => clearInterval(t);
  }, [submittedAt]);
  if (left <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium">
      <Clock className="w-3 h-3" />
      {formatCountdown(left)}
    </span>
  );
}

// ─── Row expanded detail ──────────────────────────────────────────────────────

function ExpandedRow({ record }: { record: CashCollectionRecord }) {
  return (
    <div className="bg-slate-50 px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
      <div>
        <p className="font-medium text-muted-foreground mb-2">Variance vs Daily Log</p>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Daily Log Cash</span>
            <span>रू {parseFloat(record.dailyLogCash).toLocaleString()}</span>
          </div>
          {parseFloat(record.dailyAllowance) > 0 && (
            <div className="flex justify-between text-amber-700">
              <span>Allowance (deducted)</span>
              <span>− रू {parseFloat(record.dailyAllowance).toLocaleString()}</span>
            </div>
          )}
          <div className="flex justify-between font-medium">
            <span className="text-muted-foreground">Expected Cash</span>
            <span>रू {Math.max(0, parseFloat(record.dailyLogCash) - parseFloat(record.dailyAllowance)).toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Daily Log Online</span>
            <span>रू {parseFloat(record.dailyLogOnline).toLocaleString()}</span>
          </div>
          <div className="border-t pt-1 flex justify-between">
            <span className="text-muted-foreground">Cash Variance</span>
            <VarianceBadge value={record.varianceCash} />
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Online Variance</span>
            <VarianceBadge value={record.varianceOnline} />
          </div>
          <div className="flex justify-between font-semibold">
            <span>Total Variance</span>
            <VarianceBadge value={record.varianceTotal} />
          </div>
        </div>
      </div>
      <div>
        <p className="font-medium text-muted-foreground mb-2">Submission Info</p>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Submitted by</span>
            <span>{record.submittedByName ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Submitted at</span>
            <span>{new Date(record.submittedAt).toLocaleTimeString()}</span>
          </div>
          {record.approvalStatus !== "pending" && record.approvedByName && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{record.approvalStatus === "approved" ? "Approved" : "Disapproved"} by</span>
                <span>{record.approvedByName}</span>
              </div>
              {record.approvedAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">At</span>
                  <span>{new Date(record.approvedAt).toLocaleString()}</span>
                </div>
              )}
            </>
          )}
          {record.approvalNote && (
            <div className="mt-2 bg-red-50 border border-red-200 rounded-lg p-2 text-red-700 text-xs">
              {record.approvalNote}
            </div>
          )}
          {record.note && (
            <div className="mt-2 bg-slate-100 rounded-lg p-2 text-muted-foreground text-xs">
              Note: {record.note}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CashCollection() {
  const { hasPermission, isAdmin } = useAuth();
  const { toast } = useToast();

  const canCreate = hasPermission("cash-collection", "canCreate");
  const canEdit = hasPermission("cash-collection", "canEdit");
  const canDelete = hasPermission("cash-collection", "canDelete");

  const today = localDateString();
  const [calMode, setCalMode] = useState<CalendarMode>("AD");
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);

  const { data: records = [], isLoading } = useCashCollection(dateFrom, dateTo);
  const mutations = useMutations();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<CashCollectionRecord | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CashCollectionRecord | null>(null);
  const [disapproveTarget, setDisapproveTarget] = useState<CashCollectionRecord | null>(null);

  const stats = useMemo(() => {
    const totalCash = records.reduce((a, r) => a + parseFloat(r.cashTotal || "0"), 0);
    const totalWallet = records.reduce((a, r) => a + parseFloat(r.walletAmount || "0"), 0);
    const totalGrand = records.reduce((a, r) => a + parseFloat(r.grandTotal || "0"), 0);
    const totalVariance = records.reduce((a, r) => a + parseFloat(r.varianceTotal || "0"), 0);
    const pending = records.filter((r) => r.approvalStatus === "pending").length;
    const approved = records.filter((r) => r.approvalStatus === "approved").length;
    const disapproved = records.filter((r) => r.approvalStatus === "disapproved").length;
    return { totalCash, totalWallet, totalGrand, totalVariance, pending, approved, disapproved };
  }, [records]);

  function handleSubmit(data: FormData) {
    const cashAmount = parseFloat(data.cashAmount || "0") || 0;
    const walletAmount = parseFloat(data.walletAmount || "0") || 0;
    const body = {
      riderId: parseInt(data.riderId),
      englishDate: data.englishDate,
      nepaliDate: data.nepaliDate || null,
      cashTotal: cashAmount.toFixed(2),
      walletAmount: walletAmount.toFixed(2),
      grandTotal: (cashAmount + walletAmount).toFixed(2),
      note: data.note || null,
    };
    if (editRecord) {
      mutations.update.mutate(
        { id: editRecord.id, body },
        { onSuccess: () => { setDrawerOpen(false); setEditRecord(null); } }
      );
    } else {
      mutations.create.mutate(body, { onSuccess: () => setDrawerOpen(false) });
    }
  }

  function openEdit(record: CashCollectionRecord) {
    const left = timeLeftMs(record.submittedAt);
    if (!isAdmin && left <= 0) {
      toast({ title: "Edit window expired", description: "This record is locked. Only admins can edit it.", variant: "destructive" });
      return;
    }
    setEditRecord(record);
    setDrawerOpen(true);
  }

  function canEditRecord(record: CashCollectionRecord) {
    if (isAdmin) return true;
    return timeLeftMs(record.submittedAt) > 0;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cash Collection"
        description="Record and reconcile daily cash and wallet collections from riders"
        actions={
          canCreate ? (
            <Button onClick={() => { setEditRecord(null); setDrawerOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              Submit Collection
            </Button>
          ) : undefined
        }
      />

      <div className="flex items-center gap-3 flex-wrap">
        <DateRangeFilter
          dateFrom={dateFrom}
          dateTo={dateTo}
          calendarMode={calMode}
          onCalendarModeChange={setCalMode}
          onChange={(from, to) => { setDateFrom(from); setDateTo(to); }}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total Cash</p>
          <p className="text-xl font-bold mt-1">रू {stats.totalCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total Wallet</p>
          <p className="text-xl font-bold mt-1">रू {stats.totalWallet.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Grand Total</p>
          <p className="text-xl font-bold mt-1 text-primary">रू {stats.totalGrand.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total Variance</p>
          <p className={cn("text-xl font-bold mt-1", stats.totalVariance === 0 ? "text-emerald-600" : "text-red-600")}>
            {stats.totalVariance >= 0 ? "+" : ""}रू {stats.totalVariance.toFixed(2)}
          </p>
        </Card>
      </div>

      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">Status:</span>
        <span className="inline-flex items-center gap-1 text-amber-600"><Clock className="w-3.5 h-3.5" />{stats.pending} Pending</span>
        <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle className="w-3.5 h-3.5" />{stats.approved} Approved</span>
        <span className="inline-flex items-center gap-1 text-red-600"><XCircle className="w-3.5 h-3.5" />{stats.disapproved} Disapproved</span>
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading…</div>
        ) : records.length === 0 ? (
          <EmptyState
            icon={Banknote}
            title="No records for this period"
            description="Submit a collection entry to get started."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground w-8"></th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Rider</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Cash</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Wallet</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Grand Total</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Variance</th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => {
                  const isExpanded = expandedId === record.id;
                  const hasVariance = parseFloat(record.varianceTotal) !== 0;
                  return (
                    <>
                      <tr
                        key={record.id}
                        className={cn(
                          "border-b border-border hover:bg-muted/30 transition-colors cursor-pointer",
                          hasVariance && record.approvalStatus === "pending" && "bg-red-50/30"
                        )}
                        onClick={() => setExpandedId(isExpanded ? null : record.id)}
                      >
                        <td className="px-4 py-3">
                          {isExpanded
                            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                            : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                        </td>
                        <td className="px-4 py-3 font-medium">
                          <div className="flex items-center gap-2">
                            {hasVariance && record.approvalStatus === "pending" && (
                              <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                            )}
                            {record.riderName ?? "—"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          <div>{record.nepaliDate || record.englishDate}</div>
                          <div className="text-xs">{record.englishDate}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-medium">रू {parseFloat(record.cashTotal).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">रू {parseFloat(record.walletAmount).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-bold">रू {parseFloat(record.grandTotal).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right"><VarianceBadge value={record.varianceTotal} /></td>
                        <td className="px-4 py-3 text-center"><StatusBadge status={record.approvalStatus} /></td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1 justify-end">
                            <EditCountdown submittedAt={record.submittedAt} />
                            {canEdit && record.approvalStatus === "pending" && (
                              <>
                                <button
                                  title="Approve"
                                  onClick={() => mutations.approve.mutate(record.id)}
                                  className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </button>
                                <button
                                  title="Disapprove"
                                  onClick={() => setDisapproveTarget(record)}
                                  className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                                >
                                  <XCircle className="w-4 h-4" />
                                </button>
                              </>
                            )}
                            {canEditRecord(record) && (
                              <button
                                title="Edit"
                                onClick={() => openEdit(record)}
                                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                title="Delete"
                                onClick={() => setDeleteTarget(record)}
                                className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${record.id}-expanded`}>
                          <td colSpan={9} className="p-0 border-b border-border">
                            <ExpandedRow record={record} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <SubmitDrawer
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setEditRecord(null); }}
        editRecord={editRecord}
        onSubmit={handleSubmit}
        isLoading={mutations.create.isPending || mutations.update.isPending}
      />

      <DisapproveModal
        open={!!disapproveTarget}
        onClose={() => setDisapproveTarget(null)}
        isLoading={mutations.disapprove.isPending}
        onConfirm={(note) =>
          mutations.disapprove.mutate(
            { id: disapproveTarget!.id, approvalNote: note },
            { onSuccess: () => setDisapproveTarget(null) }
          )
        }
      />

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Record"
        description={`Delete cash collection for ${deleteTarget?.riderName ?? "this rider"} on ${deleteTarget?.englishDate}? This cannot be undone.`}
        confirmLabel="Delete"
        isPending={mutations.remove.isPending}
        onConfirm={() => {
          if (deleteTarget) {
            mutations.remove.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
          }
        }}
      />
    </div>
  );
}
