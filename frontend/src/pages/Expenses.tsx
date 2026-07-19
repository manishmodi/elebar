import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { useToast, apiErrorMessage } from "@/contexts/toast";
import { useRiderOptions, useVehicleOptions } from "@/hooks/use-options";
import type { Expense, ExpenseCategory, Paginated } from "@/lib/types";
import { DataTable, type Column } from "@/components/DataTable";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Currency } from "@/components/Currency";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { TextField, SelectField, TextAreaField } from "@/components/FormField";
import { formatDate, daysAgoISO, todayISO } from "@/lib/format";

type ExpenseFormValues = Omit<Expense, "id" | "category_name" | "rider_name" | "vehicle_number" | "created_by">;

const EMPTY_EXPENSE: ExpenseFormValues = {
  category: "",
  date: todayISO(),
  amount: "0",
  notes: null,
  rider: null,
  vehicle: null,
};

export function Expenses() {
  const { hasPermission, isAdmin } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const riderOptions = useRiderOptions();
  const vehicleOptions = useVehicleOptions();

  const [category, setCategory] = useState("");
  const [range, setRange] = useState<DateRange>({ date_from: daysAgoISO(29), date_to: todayISO() });
  const [modalOpen, setModalOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [values, setValues] = useState<ExpenseFormValues>(EMPTY_EXPENSE);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);

  const canCreate = hasPermission("expenses", "create");
  const canDelete = hasPermission("expenses", "delete");

  const categoriesQuery = useQuery({
    queryKey: ["expense-categories"],
    queryFn: () => api.get<Paginated<ExpenseCategory>>("/api/expense-categories/", { page_size: 100 }),
  });

  const listQuery = useQuery({
    queryKey: ["expenses", "list", { category, range }],
    queryFn: () =>
      api.get<Paginated<Expense>>("/api/expenses/", {
        category: category || undefined,
        date_from: range.date_from,
        date_to: range.date_to,
        page_size: 100,
      }),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post<Expense>("/api/expenses/", values),
    onSuccess: () => {
      toast.success("Expense recorded.");
      void qc.invalidateQueries({ queryKey: ["expenses"] });
      setModalOpen(false);
      setValues(EMPTY_EXPENSE);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not record expense.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/expenses/${id}/`),
    onSuccess: () => {
      toast.success("Expense deleted.");
      void qc.invalidateQueries({ queryKey: ["expenses"] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not delete expense."));
      setDeleteTarget(null);
    },
  });

  const columns: Column<Expense>[] = [
    { key: "date", header: "Date", render: (e) => formatDate(e.date) },
    { key: "category_name", header: "Category", render: (e) => e.category_name ?? e.category },
    { key: "amount", header: "Amount", render: (e) => <Currency value={e.amount} /> },
    { key: "rider_name", header: "Rider", render: (e) => e.rider_name ?? "-" },
    { key: "vehicle_number", header: "Vehicle", render: (e) => e.vehicle_number ?? "-" },
    { key: "notes", header: "Notes", render: (e) => e.notes ?? "-" },
    {
      key: "actions",
      header: "",
      render: (e) =>
        canDelete ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleteTarget(e)}>
            Delete
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p className="page-subtitle">Operational expense tracking by category.</p>
        </div>
        <div className="page-actions">
          {isAdmin && (
            <button type="button" className="btn btn-ghost" onClick={() => setCategoriesOpen(true)}>
              Manage categories
            </button>
          )}
          {canCreate && (
            <button type="button" className="btn btn-primary" onClick={() => setModalOpen(true)}>
              + New Expense
            </button>
          )}
        </div>
      </div>

      <div className="toolbar">
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categoriesQuery.data?.results.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      <DataTable columns={columns} rows={listQuery.data?.results ?? []} loading={listQuery.isLoading} rowKey={(e) => e.id} />

      <Modal open={modalOpen} title="New expense" onClose={() => setModalOpen(false)}>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            createMutation.mutate();
          }}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <SelectField label="Category" required value={values.category} onChange={(e) => setValues((v) => ({ ...v, category: e.target.value }))}>
            <option value="">Select category…</option>
            {categoriesQuery.data?.results.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </SelectField>
          <TextField label="Date" type="date" required value={values.date} onChange={(e) => setValues((v) => ({ ...v, date: e.target.value }))} />
          <TextField label="Amount" type="number" step="0.01" required value={values.amount} onChange={(e) => setValues((v) => ({ ...v, amount: e.target.value }))} />
          <SelectField label="Rider (optional)" value={values.rider ?? ""} onChange={(e) => setValues((v) => ({ ...v, rider: e.target.value || null }))}>
            <option value="">None</option>
            {riderOptions.data?.results.map((r) => (
              <option key={r.id} value={r.id}>{r.full_name}</option>
            ))}
          </SelectField>
          <SelectField label="Vehicle (optional)" value={values.vehicle ?? ""} onChange={(e) => setValues((v) => ({ ...v, vehicle: e.target.value || null }))}>
            <option value="">None</option>
            {vehicleOptions.data?.results.map((v) => (
              <option key={v.id} value={v.id}>{v.vehicle_number}</option>
            ))}
          </SelectField>
          <TextAreaField label="Notes" value={values.notes ?? ""} onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value || null }))} />
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Create"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete expense"
        message="Delete this expense record? This cannot be undone."
        confirmLabel="Delete"
        danger
        busy={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />

      {isAdmin && (
        <CategoryManager open={categoriesOpen} onClose={() => setCategoriesOpen(false)} categories={categoriesQuery.data?.results ?? []} />
      )}
    </div>
  );
}

function CategoryManager({
  open,
  onClose,
  categories,
}: {
  open: boolean;
  onClose: () => void;
  categories: ExpenseCategory[];
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ExpenseCategory | null>(null);

  const createMutation = useMutation({
    mutationFn: () => api.post<ExpenseCategory>("/api/expense-categories/", { name, description: description || null }),
    onSuccess: () => {
      toast.success("Category created.");
      void qc.invalidateQueries({ queryKey: ["expense-categories"] });
      setName("");
      setDescription("");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not create category.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/expense-categories/${id}/`),
    onSuccess: () => {
      toast.success("Category deleted.");
      void qc.invalidateQueries({ queryKey: ["expense-categories"] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not delete category."));
      setDeleteTarget(null);
    },
  });

  return (
    <Modal open={open} title="Manage expense categories" onClose={onClose}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          createMutation.mutate();
        }}
        style={{ display: "flex", gap: 8, marginBottom: 16 }}
      >
        <input placeholder="Category name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <button type="submit" className="btn btn-primary btn-sm" disabled={createMutation.isPending}>
          Add
        </button>
      </form>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {categories.map((c) => (
          <li key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>
              <strong>{c.name}</strong>
              {c.description && <span className="text-muted"> — {c.description}</span>}
            </span>
            <button type="button" className="link-btn" onClick={() => setDeleteTarget(c)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete category"
        message={`Delete category "${deleteTarget?.name}"?`}
        confirmLabel="Delete"
        danger
        busy={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </Modal>
  );
}
