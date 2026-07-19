import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { useToast, apiErrorMessage } from "@/contexts/toast";
import { useRiderOptions, useVehicleOptions } from "@/hooks/use-options";
import type { Assignment, Attendance as AttendanceRow, AttendanceType, Paginated } from "@/lib/types";
import { DataTable, type Column } from "@/components/DataTable";
import { Modal } from "@/components/Modal";
import { StatusBadge } from "@/components/StatusBadge";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { formatDate, daysAgoISO, todayISO } from "@/lib/format";
import { TextField, SelectField } from "@/components/FormField";

type FormValues = Omit<AttendanceRow, "id" | "rider_name" | "vehicle_number" | "day_closed">;

const EMPTY: FormValues = {
  rider: "",
  date: todayISO(),
  nepali_date: null,
  type: "present",
  remarks: null,
  vehicle: null,
  battery_out: null,
  battery_in: null,
  scooter_out: null,
  scooter_in: null,
  rider_time_in: null,
  rider_time_out: null,
  morning_odometer: null,
  evening_odometer: null,
  vehicle_override_reason: null,
};

function str(v: string | null | undefined) {
  return v ?? "";
}
function num(v: number | null | undefined) {
  return v ?? "";
}

export function Attendance() {
  const { hasPermission, isAdmin } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const riderOptions = useRiderOptions();
  const vehicleOptions = useVehicleOptions();

  const [rider, setRider] = useState("");
  const [range, setRange] = useState<DateRange>({ date_from: daysAgoISO(6), date_to: todayISO() });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AttendanceRow | null>(null);
  const [values, setValues] = useState<FormValues>(EMPTY);

  const canCreate = hasPermission("attendance", "create");
  const canEdit = hasPermission("attendance", "edit");

  const listQuery = useQuery({
    queryKey: ["attendance", "list", { rider, range }],
    queryFn: () =>
      api.get<Paginated<AttendanceRow>>("/api/attendance/", {
        rider: rider || undefined,
        date_from: range.date_from,
        date_to: range.date_to,
        page_size: 100,
      }),
  });

  const assignmentsQuery = useQuery({
    queryKey: ["assignments", "active"],
    queryFn: () => api.get<Paginated<Assignment>>("/api/assignments/", { status: "active", page_size: 100 }),
    enabled: modalOpen,
  });

  useEffect(() => {
    if (editing) {
      const { id: _id, rider_name: _rn, vehicle_number: _vn, day_closed: _dc, ...rest } = editing;
      setValues(rest);
    } else {
      setValues(EMPTY);
    }
  }, [editing]);

  // Auto-prefill vehicle from rider's active assignment when creating.
  useEffect(() => {
    if (!editing && values.rider && assignmentsQuery.data) {
      const match = assignmentsQuery.data.results.find((a) => a.rider === values.rider);
      if (match && values.vehicle !== match.vehicle) {
        setValues((v) => ({ ...v, vehicle: match.vehicle }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.rider, assignmentsQuery.data, editing]);

  const createMutation = useMutation({
    mutationFn: (body: FormValues) => api.post<AttendanceRow>("/api/attendance/", body),
    onSuccess: () => {
      toast.success("Attendance recorded.");
      void qc.invalidateQueries({ queryKey: ["attendance"] });
      setModalOpen(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not record attendance.")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: FormValues }) => api.patch<AttendanceRow>(`/api/attendance/${id}/`, body),
    onSuccess: () => {
      toast.success("Attendance updated.");
      void qc.invalidateQueries({ queryKey: ["attendance"] });
      setModalOpen(false);
      setEditing(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update attendance.")),
  });

  const grouped = useMemo(() => {
    const rows = listQuery.data?.results ?? [];
    const map = new Map<string, AttendanceRow[]>();
    for (const row of rows) {
      const list = map.get(row.date) ?? [];
      list.push(row);
      map.set(row.date, list);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [listQuery.data]);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (editing) {
      updateMutation.mutate({ id: editing.id, body: values });
    } else {
      createMutation.mutate(values);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (row: AttendanceRow) => {
    if (row.day_closed && !isAdmin) {
      toast.info("This day is closed and can only be edited by an administrator.");
      return;
    }
    setEditing(row);
    setModalOpen(true);
  };

  const columns: Column<AttendanceRow>[] = [
    { key: "rider_name", header: "Rider", render: (a) => a.rider_name ?? a.rider },
    { key: "type", header: "Type", render: (a) => <StatusBadge status={a.type} /> },
    { key: "vehicle_number", header: "Vehicle", render: (a) => a.vehicle_number ?? a.vehicle ?? "-" },
    { key: "rider_time_in", header: "Time in", render: (a) => a.rider_time_in ?? "-" },
    { key: "rider_time_out", header: "Time out", render: (a) => a.rider_time_out ?? "-" },
    { key: "battery_out", header: "Battery out/in", render: (a) => `${a.battery_out ?? "-"} / ${a.battery_in ?? "-"}` },
    {
      key: "day_closed",
      header: "Day",
      render: (a) => (a.day_closed ? <span className="badge badge-neutral">Closed</span> : <span className="badge badge-success">Open</span>),
    },
    {
      key: "actions",
      header: "",
      render: (a) =>
        canEdit ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); openEdit(a); }}>
            {a.day_closed && !isAdmin ? "Locked" : "Edit"}
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Attendance</h1>
          <p className="page-subtitle">Daily check-in/out, battery and odometer readings.</p>
        </div>
        <div className="page-actions">
          {canCreate && (
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              + Mark Attendance
            </button>
          )}
        </div>
      </div>

      <div className="toolbar">
        <select value={rider} onChange={(e) => setRider(e.target.value)}>
          <option value="">All riders</option>
          {riderOptions.data?.results.map((r) => (
            <option key={r.id} value={r.id}>{r.full_name}</option>
          ))}
        </select>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {listQuery.isLoading ? (
        <p className="text-muted">Loading…</p>
      ) : grouped.length === 0 ? (
        <div className="empty-state">No attendance records for this range.</div>
      ) : (
        grouped.map(([date, rows]) => (
          <div key={date} style={{ marginBottom: 20 }}>
            <h3 className="section-title">{formatDate(date)}</h3>
            <DataTable columns={columns} rows={rows} rowKey={(a) => a.id} onRowClick={canEdit ? openEdit : undefined} />
          </div>
        ))
      )}

      <Modal open={modalOpen} title={editing ? "Edit attendance" : "Mark attendance"} onClose={() => setModalOpen(false)} wide>
        <form onSubmit={handleSubmit}>
          {editing?.day_closed && (
            <div className="error-banner" style={{ background: "var(--color-warning-bg)", color: "var(--color-warning)" }}>
              This day has been closed. Only administrators can edit it.
            </div>
          )}
          <div className="form-grid">
            <SelectField label="Rider" required value={values.rider} onChange={(e) => set("rider", e.target.value)}>
              <option value="">Select rider…</option>
              {riderOptions.data?.results.map((r) => (
                <option key={r.id} value={r.id}>{r.full_name}</option>
              ))}
            </SelectField>
            <TextField label="Date" type="date" required value={values.date} onChange={(e) => set("date", e.target.value)} />
            <SelectField label="Type" value={values.type} onChange={(e) => set("type", e.target.value as AttendanceType)}>
              <option value="present">Present</option>
              <option value="absent">Absent</option>
              <option value="leave">Leave</option>
              <option value="holiday">Holiday</option>
              <option value="half_day">Half day</option>
            </SelectField>
            <SelectField label="Vehicle" value={values.vehicle ?? ""} onChange={(e) => set("vehicle", e.target.value || null)}>
              <option value="">None</option>
              {vehicleOptions.data?.results.map((v) => (
                <option key={v.id} value={v.id}>{v.vehicle_number}</option>
              ))}
            </SelectField>
            <TextField label="Rider time in" type="time" value={str(values.rider_time_in)} onChange={(e) => set("rider_time_in", e.target.value || null)} />
            <TextField label="Rider time out" type="time" value={str(values.rider_time_out)} onChange={(e) => set("rider_time_out", e.target.value || null)} />
            <TextField label="Battery out (%)" type="number" min={0} max={100} value={num(values.battery_out)} onChange={(e) => set("battery_out", e.target.value ? Number(e.target.value) : null)} />
            <TextField label="Battery in (%)" type="number" min={0} max={100} value={num(values.battery_in)} onChange={(e) => set("battery_in", e.target.value ? Number(e.target.value) : null)} />
            <TextField label="Scooter out" type="time" value={str(values.scooter_out)} onChange={(e) => set("scooter_out", e.target.value || null)} />
            <TextField label="Scooter in" type="time" value={str(values.scooter_in)} onChange={(e) => set("scooter_in", e.target.value || null)} />
            <TextField label="Morning odometer" type="number" value={num(values.morning_odometer)} onChange={(e) => set("morning_odometer", e.target.value ? Number(e.target.value) : null)} />
            <TextField label="Evening odometer" type="number" value={num(values.evening_odometer)} onChange={(e) => set("evening_odometer", e.target.value ? Number(e.target.value) : null)} />
            <TextField label="Vehicle override reason" value={str(values.vehicle_override_reason)} onChange={(e) => set("vehicle_override_reason", e.target.value || null)} />
            <TextField label="Remarks" value={str(values.remarks)} onChange={(e) => set("remarks", e.target.value || null)} />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={createMutation.isPending || updateMutation.isPending}>
              {createMutation.isPending || updateMutation.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
