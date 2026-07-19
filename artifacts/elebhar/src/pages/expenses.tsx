import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useAuth } from "@/contexts/auth-context";
import { useRiders } from "@/hooks/use-riders";
import { useVehicles } from "@/hooks/use-vehicles";
import { PageHeader, Card, Currency, Dialog, ConfirmDialog, EmptyState } from "@/components/ui-components";
import { useToast } from "@/hooks/use-toast";
import {
  Receipt, Plus, Pencil, Trash2, Tag, ChevronDown, ChevronUp,
} from "lucide-react";
import { adToBSString } from "@/lib/nepali-date";

const API_BASE = `${import.meta.env.BASE_URL}api`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExpenseCategory {
  id: number;
  name: string;
  description?: string | null;
}

interface ExpenseRecord {
  id: number;
  categoryId: number;
  categoryName: string | null;
  date: string;
  amount: string;
  notes?: string | null;
  riderId?: number | null;
  riderName?: string | null;
  vehicleId?: number | null;
  vehiclePlate?: string | null;
  createdBy?: string | null;
  createdAt: string;
}

interface CategoryFormData { name: string; description: string; }
interface ExpenseFormData {
  categoryId: string;
  date: string;
  amount: string;
  notes: string;
  riderId: string;
  vehicleId: string;
}

// ─── API Helpers ──────────────────────────────────────────────────────────────

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

function useCategories() {
  return useQuery<ExpenseCategory[]>({
    queryKey: ["expense-categories"],
    queryFn: () => apiFetch(`${API_BASE}/expense-categories`),
  });
}

function useExpenses() {
  return useQuery<ExpenseRecord[]>({
    queryKey: ["expenses"],
    queryFn: () => apiFetch(`${API_BASE}/expenses`),
  });
}

function useCategoryMutations() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["expense-categories"] });

  const create = useMutation({
    mutationFn: (data: Partial<ExpenseCategory>) =>
      apiFetch(`${API_BASE}/expense-categories`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
    onSuccess: () => { invalidate(); toast({ title: "Category created" }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const update = useMutation({
    mutationFn: ({ id, ...data }: Partial<ExpenseCategory> & { id: number }) =>
      apiFetch(`${API_BASE}/expense-categories/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
    onSuccess: () => { invalidate(); toast({ title: "Category updated" }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`${API_BASE}/expense-categories/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast({ title: "Category deleted" }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  return { create, update, remove };
}

function useExpenseMutations() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["expenses"] });

  const create = useMutation({
    mutationFn: (data: object) =>
      apiFetch(`${API_BASE}/expenses`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
    onSuccess: () => { invalidate(); toast({ title: "Expense booked" }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const update = useMutation({
    mutationFn: ({ id, ...data }: { id: number } & object) =>
      apiFetch(`${API_BASE}/expenses/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
    onSuccess: () => { invalidate(); toast({ title: "Expense updated" }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`${API_BASE}/expenses/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast({ title: "Expense deleted" }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  return { create, update, remove };
}

// ─── Category Dialog ──────────────────────────────────────────────────────────

function CategoryDialog({
  isOpen, onClose, onSubmit, isPending, title, defaultValues,
}: {
  isOpen: boolean; onClose: () => void;
  onSubmit: (data: CategoryFormData) => Promise<void>;
  isPending: boolean; title: string;
  defaultValues?: Partial<CategoryFormData>;
}) {
  const { register, handleSubmit, reset } = useForm<CategoryFormData>({ defaultValues });
  return (
    <Dialog isOpen={isOpen} onClose={() => { onClose(); reset(); }} title={title}>
      <form onSubmit={handleSubmit(async (d) => { await onSubmit(d); reset(); })} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Category Name *</label>
          <input {...register("name", { required: true })} className="premium-input text-sm" placeholder="e.g. Fuel, Office Rent, Equipment" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Description</label>
          <input {...register("description")} className="premium-input text-sm" placeholder="Optional description" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => { onClose(); reset(); }} className="px-4 py-2 text-sm rounded-lg border hover:bg-muted transition-colors">Cancel</button>
          <button type="submit" disabled={isPending} className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
            {isPending ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Expense Dialog ───────────────────────────────────────────────────────────

function ExpenseDialog({
  isOpen, onClose, onSubmit, isPending, title, defaultValues, categories, riders, vehicles,
}: {
  isOpen: boolean; onClose: () => void;
  onSubmit: (data: ExpenseFormData) => Promise<void>;
  isPending: boolean; title: string;
  defaultValues?: Partial<ExpenseFormData>;
  categories: ExpenseCategory[];
  riders: { id: number; fullName: string }[];
  vehicles: { id: number; plateNumber: string }[];
}) {
  const { register, handleSubmit, reset } = useForm<ExpenseFormData>({ defaultValues });
  return (
    <Dialog isOpen={isOpen} onClose={() => { onClose(); reset(); }} title={title}>
      <form onSubmit={handleSubmit(async (d) => { await onSubmit(d); reset(); })} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Date *</label>
            <input type="date" {...register("date", { required: true })} className="premium-input text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Amount (रू) *</label>
            <input type="number" step="0.01" {...register("amount", { required: true })} className="premium-input text-sm" placeholder="0.00" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Category *</label>
          <select {...register("categoryId", { required: true })} className="premium-input text-sm">
            <option value="">Select category...</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Rider (optional)</label>
            <select {...register("riderId")} className="premium-input text-sm">
              <option value="">None</option>
              {riders.map(r => <option key={r.id} value={r.id}>{r.fullName}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Vehicle (optional)</label>
            <select {...register("vehicleId")} className="premium-input text-sm">
              <option value="">None</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.plateNumber}</option>)}
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Notes</label>
          <input {...register("notes")} className="premium-input text-sm" placeholder="Optional description..." />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => { onClose(); reset(); }} className="px-4 py-2 text-sm rounded-lg border hover:bg-muted transition-colors">Cancel</button>
          <button type="submit" disabled={isPending} className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
            {isPending ? "Saving..." : "Book Expense"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Expenses() {
  const { isAdmin, hasPermission } = useAuth();
  const { data: expenses, isLoading } = useExpenses();
  const { data: categories = [] } = useCategories();
  const { data: ridersData } = useRiders();
  const { data: vehiclesData } = useVehicles();
  const { toast } = useToast();

  const riders = (ridersData ?? []) as Array<{ id: number; fullName: string }>;
  const vehicles = (vehiclesData ?? []) as Array<{ id: number; plateNumber: string }>;

  const catMutations = useCategoryMutations();
  const expMutations = useExpenseMutations();

  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseRecord | null>(null);
  const [deletingExpense, setDeletingExpense] = useState<ExpenseRecord | null>(null);

  const [isAddCatOpen, setIsAddCatOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<ExpenseCategory | null>(null);
  const [deletingCat, setDeletingCat] = useState<ExpenseCategory | null>(null);
  const [catSectionOpen, setCatSectionOpen] = useState(false);

  const [filterCategory, setFilterCategory] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterRider, setFilterRider] = useState("");

  const filtered = useMemo(() => {
    return (expenses ?? []).filter(e => {
      if (filterCategory && String(e.categoryId) !== filterCategory) return false;
      if (filterFrom && e.date < filterFrom) return false;
      if (filterTo && e.date > filterTo) return false;
      if (filterRider && String(e.riderId) !== filterRider) return false;
      return true;
    });
  }, [expenses, filterCategory, filterFrom, filterTo, filterRider]);

  const totalFiltered = filtered.reduce((s, e) => s + parseFloat(e.amount || "0"), 0);

  const thisMonth = new Date().toISOString().slice(0, 7);
  const thisMonthExpenses = (expenses ?? []).filter(e => e.date.startsWith(thisMonth));
  const thisMonthTotal = thisMonthExpenses.reduce((s, e) => s + parseFloat(e.amount || "0"), 0);

  const canCreate = hasPermission("expenses", "canCreate");
  const canEdit   = hasPermission("expenses", "canEdit");
  const canDelete = hasPermission("expenses", "canDelete");

  // ── Handlers ─────────────────────────────────────────────────────────────────

  async function handleAddExpense(data: ExpenseFormData) {
    await expMutations.create.mutateAsync({
      categoryId: parseInt(data.categoryId),
      date: data.date,
      amount: data.amount,
      notes: data.notes || undefined,
      riderId: data.riderId ? parseInt(data.riderId) : null,
      vehicleId: data.vehicleId ? parseInt(data.vehicleId) : null,
    });
    setIsAddExpenseOpen(false);
  }

  async function handleEditExpense(data: ExpenseFormData) {
    if (!editingExpense) return;
    await expMutations.update.mutateAsync({
      id: editingExpense.id,
      categoryId: parseInt(data.categoryId),
      date: data.date,
      amount: data.amount,
      notes: data.notes || undefined,
      riderId: data.riderId ? parseInt(data.riderId) : null,
      vehicleId: data.vehicleId ? parseInt(data.vehicleId) : null,
    });
    setEditingExpense(null);
  }

  async function handleDeleteExpense() {
    if (!deletingExpense) return;
    await expMutations.remove.mutateAsync(deletingExpense.id);
    setDeletingExpense(null);
  }

  async function handleAddCat(data: CategoryFormData) {
    await catMutations.create.mutateAsync({ name: data.name, description: data.description || undefined });
    setIsAddCatOpen(false);
  }

  async function handleEditCat(data: CategoryFormData) {
    if (!editingCat) return;
    await catMutations.update.mutateAsync({ id: editingCat.id, name: data.name, description: data.description || undefined });
    setEditingCat(null);
  }

  async function handleDeleteCat() {
    if (!deletingCat) return;
    await catMutations.remove.mutateAsync(deletingCat.id);
    setDeletingCat(null);
  }

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Book and track all operational expenses."
        actions={canCreate ? (
          <button onClick={() => setIsAddExpenseOpen(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm">
            <Plus className="w-4 h-4" /> Book Expense
          </button>
        ) : undefined}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground font-medium">This Month</p>
              <p className="text-2xl font-bold mt-1 font-mono">
                {expenses ? `रू ${thisMonthTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{thisMonthExpenses.length} expense{thisMonthExpenses.length !== 1 ? "s" : ""}</p>
            </div>
            <div className="shrink-0 w-9 h-9 rounded-full bg-red-100 flex items-center justify-center">
              <Receipt className="w-5 h-5 text-red-600" />
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground font-medium">Total (All Time)</p>
              <p className="text-2xl font-bold mt-1 font-mono">
                {expenses ? `रू ${(expenses.reduce((s, e) => s + parseFloat(e.amount || "0"), 0)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{(expenses ?? []).length} total entries</p>
            </div>
            <div className="shrink-0 w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center">
              <Receipt className="w-5 h-5 text-orange-600" />
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground font-medium">Categories</p>
              <p className="text-2xl font-bold mt-1">{categories.length}</p>
              <p className="text-xs text-muted-foreground mt-1">active {categories.length === 1 ? "category" : "categories"}</p>
            </div>
            <div className="shrink-0 w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
              <Tag className="w-5 h-5 text-blue-600" />
            </div>
          </div>
        </Card>
      </div>

      {/* Category Management — Admin Only */}
      {isAdmin && (
        <div className="mb-6 border rounded-xl overflow-hidden">
          <button
            onClick={() => setCatSectionOpen(o => !o)}
            className="w-full flex items-center justify-between px-5 py-3.5 bg-muted/50 hover:bg-muted transition-colors text-sm font-semibold"
          >
            <span className="flex items-center gap-2"><Tag className="w-4 h-4 text-primary" /> Expense Categories (Admin)</span>
            {catSectionOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {catSectionOpen && (
            <div className="p-4 space-y-4">
              <div className="flex justify-end">
                <button onClick={() => setIsAddCatOpen(true)} className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                  <Plus className="w-3.5 h-3.5" /> Add Category
                </button>
              </div>
              {categories.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No categories yet. Add one to get started.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground uppercase border-b">
                        <th className="py-2 px-3 text-left font-semibold">Name</th>
                        <th className="py-2 px-3 text-left font-semibold">Description</th>
                        <th className="py-2 px-3 text-center font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categories.map(cat => (
                        <tr key={cat.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="py-2.5 px-3 font-medium">{cat.name}</td>
                          <td className="py-2.5 px-3 text-muted-foreground">{cat.description || "—"}</td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => setEditingCat(cat)} className="p-1.5 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground transition-colors" title="Edit">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => setDeletingCat(cat)} className="p-1.5 hover:bg-red-50 rounded-md text-muted-foreground hover:text-red-600 transition-colors" title="Delete">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="premium-input text-sm w-auto min-w-[160px]">
          <option value="">All Categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterRider} onChange={e => setFilterRider(e.target.value)} className="premium-input text-sm w-auto min-w-[160px]">
          <option value="">All Riders</option>
          {riders.map(r => <option key={r.id} value={r.id}>{r.fullName}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="premium-input text-sm" />
          <span className="text-muted-foreground text-sm">→</span>
          <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="premium-input text-sm" />
        </div>
        {(filterCategory || filterRider || filterFrom || filterTo) && (
          <button onClick={() => { setFilterCategory(""); setFilterRider(""); setFilterFrom(""); setFilterTo(""); }}
            className="px-3 py-1.5 text-xs rounded-lg border hover:bg-muted transition-colors text-muted-foreground">
            Clear Filters
          </button>
        )}
      </div>

      {/* Expenses Table */}
      <div className="border rounded-xl overflow-hidden">
        {(filterCategory || filterRider || filterFrom || filterTo) && filtered.length > 0 && (
          <div className="px-5 py-2.5 bg-muted/30 border-b flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{filtered.length} record{filtered.length !== 1 ? "s" : ""} matched</span>
            <span className="font-semibold"><Currency amount={String(totalFiltered)} /></span>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground uppercase bg-muted/80 border-b sticky top-0">
              <tr>
                <th className="px-4 py-3 font-semibold text-left">Date (BS)</th>
                <th className="px-4 py-3 font-semibold text-left">Date (AD)</th>
                <th className="px-4 py-3 font-semibold text-left">Category</th>
                <th className="px-4 py-3 font-semibold text-right">Amount</th>
                <th className="px-4 py-3 font-semibold text-left">Rider</th>
                <th className="px-4 py-3 font-semibold text-left">Vehicle</th>
                <th className="px-4 py-3 font-semibold text-left">Notes</th>
                <th className="px-4 py-3 font-semibold text-left">Booked By</th>
                <th className="px-4 py-3 font-semibold text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="text-center py-12 text-muted-foreground">Loading expenses...</td></tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16">
                    <EmptyState icon={Receipt} title="No expenses found" description={expenses?.length === 0 ? "Book your first expense using the button above." : "Try adjusting your filters."} />
                  </td>
                </tr>
              ) : filtered.map(e => (
                <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-xs">{adToBSString(e.date)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{e.date}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                      <Tag className="w-3 h-3" />{e.categoryName ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-red-600"><Currency amount={e.amount} /></td>
                  <td className="px-4 py-3 text-muted-foreground">{e.riderName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{e.vehiclePlate ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[180px] truncate">{e.notes || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{e.createdBy ?? "—"}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {canEdit && (
                        <button onClick={() => setEditingExpense(e)} className="p-1.5 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground transition-colors" title="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => setDeletingExpense(e)} className="p-1.5 hover:bg-red-50 rounded-md text-muted-foreground hover:text-red-600 transition-colors" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dialogs */}
      <ExpenseDialog
        isOpen={isAddExpenseOpen}
        onClose={() => setIsAddExpenseOpen(false)}
        onSubmit={handleAddExpense}
        isPending={expMutations.create.isPending}
        title="Book Expense"
        categories={categories}
        riders={riders}
        vehicles={vehicles}
      />
      {editingExpense && (
        <ExpenseDialog
          isOpen
          onClose={() => setEditingExpense(null)}
          onSubmit={handleEditExpense}
          isPending={expMutations.update.isPending}
          title="Edit Expense"
          defaultValues={{
            categoryId: String(editingExpense.categoryId),
            date: editingExpense.date,
            amount: editingExpense.amount,
            notes: editingExpense.notes ?? "",
            riderId: editingExpense.riderId ? String(editingExpense.riderId) : "",
            vehicleId: editingExpense.vehicleId ? String(editingExpense.vehicleId) : "",
          }}
          categories={categories}
          riders={riders}
          vehicles={vehicles}
        />
      )}
      <ConfirmDialog
        isOpen={!!deletingExpense}
        onClose={() => setDeletingExpense(null)}
        onConfirm={handleDeleteExpense}
        title="Delete Expense"
        description={`Delete रू${deletingExpense?.amount} expense on ${deletingExpense?.date}? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
      />

      {/* Category Dialogs */}
      <CategoryDialog
        isOpen={isAddCatOpen}
        onClose={() => setIsAddCatOpen(false)}
        onSubmit={handleAddCat}
        isPending={catMutations.create.isPending}
        title="Add Category"
      />
      {editingCat && (
        <CategoryDialog
          isOpen
          onClose={() => setEditingCat(null)}
          onSubmit={handleEditCat}
          isPending={catMutations.update.isPending}
          title="Edit Category"
          defaultValues={{ name: editingCat.name, description: editingCat.description ?? "" }}
        />
      )}
      <ConfirmDialog
        isOpen={!!deletingCat}
        onClose={() => setDeletingCat(null)}
        onConfirm={handleDeleteCat}
        title="Delete Category"
        description={`Delete category "${deletingCat?.name}"? Expenses under this category cannot be deleted if any exist.`}
        confirmLabel="Delete"
        variant="destructive"
      />
    </div>
  );
}
