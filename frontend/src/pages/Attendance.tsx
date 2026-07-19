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
import {
  BS_MAX_YEAR,
  BS_MIN_YEAR,
  bsToAd,
  getBsMonthLength,
  getBsMonthName,
  getTodayBs,
  shiftBsMonth,
} from "@/lib/nepali-date";

type FormValues = Omit<AttendanceRow, "id" | "rider_name" | "vehicle_number" | "day_closed">;
type ViewMode = "table" | "calendar";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TYPE_DOT_CLASS: Record<AttendanceType, string> = {
  present: "bs-cal-dot-present",
  absent: "bs-cal-dot-absent",
  leave: "bs-cal-dot-leave",
  holiday: "bs-cal-dot-holiday",
  half_day: "bs-cal-dot-halfday",
};

interface CalendarCell {
  bsDay: number;
  adIso: string;
  weekday: number;
}

function buildCalendarCells(year: number, month: number, length: number): { leading: number; cells: CalendarCell[] } {
  const startAd = bsToAd({ year, month, day: 1 });
  if (!startAd) return { leading: 0, cells: [] };
  const startDate = new Date(startAd + "T00:00:00");
  const leading = startDate.getDay();
  const cells: CalendarCell[] = [];
  for (let day = 1; day <= length; day++) {
    const cellDate = new Date(startDate);
    cellDate.setDate(startDate.getDate() + (day - 1));
    const yyyy = cellDate.getFullYear();
    const mm = String(cellDate.getMonth() + 1).padStart(2, "0");
    const dd = String(cellDate.getDate()).padStart(2, "0");
    cells.push({ bsDay: day, adIso: `${yyyy}-${mm}-${dd}`, weekday: cellDate.getDay() });
  }
  return { leading, cells };
}

function formatAdShort(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

// Text fields must be "" not null — the serializer's CharFields are
// blank-but-not-null and reject null with a 400 (numeric/FK nulls are fine).
const EMPTY: FormValues = {
  rider: "",
  date: todayISO(),
  nepali_date: "",
  type: "present",
  remarks: "",
  vehicle: null,
  battery_out: null,
  battery_in: null,
  scooter_out: "",
  scooter_in: "",
  rider_time_in: "",
  rider_time_out: "",
  morning_odometer: null,
  evening_odometer: null,
  vehicle_override_reason: "",
};

const TEXT_FIELDS = [
  "nepali_date", "remarks", "scooter_out", "scooter_in",
  "rider_time_in", "rider_time_out", "vehicle_override_reason",
] as const;

/** Belt-and-braces: rows loaded for editing can carry nulls from the API. */
function sanitize(body: FormValues): FormValues {
  const out = { ...body };
  for (const field of TEXT_FIELDS) out[field] = out[field] ?? "";
  return out;
}

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
  const [dayPrefillDate, setDayPrefillDate] = useState<string | null>(null);

  const [view, setView] = useState<ViewMode>("table");
  const todayBs = useMemo(() => getTodayBs(), []);
  const [bsYear, setBsYear] = useState<number>(todayBs?.year ?? BS_MIN_YEAR);
  const [bsMonth, setBsMonth] = useState<number>(todayBs?.month ?? 0);

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

  const monthLength = getBsMonthLength(bsYear, bsMonth) ?? 30;
  const calendarRange = useMemo(() => {
    const startAd = bsToAd({ year: bsYear, month: bsMonth, day: 1 });
    const endAd = bsToAd({ year: bsYear, month: bsMonth, day: monthLength });
    return { date_from: startAd ?? todayISO(), date_to: endAd ?? todayISO() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bsYear, bsMonth, monthLength]);

  const calendarQuery = useQuery({
    queryKey: ["attendance", "calendar", { rider, calendarRange }],
    queryFn: () =>
      api.get<Paginated<AttendanceRow>>("/api/attendance/", {
        rider: rider || undefined,
        date_from: calendarRange.date_from,
        date_to: calendarRange.date_to,
        page_size: 100,
      }),
    enabled: view === "calendar",
  });

  useEffect(() => {
    if (editing) {
      const { id: _id, rider_name: _rn, vehicle_number: _vn, day_closed: _dc, ...rest } = editing;
      setValues(rest);
    } else {
      setValues({ ...EMPTY, date: dayPrefillDate ?? EMPTY.date });
    }
  }, [editing, dayPrefillDate]);

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

  const calendarGrouped = useMemo(() => {
    const rows = calendarQuery.data?.results ?? [];
    const map = new Map<string, AttendanceRow[]>();
    for (const row of rows) {
      const list = map.get(row.date) ?? [];
      list.push(row);
      map.set(row.date, list);
    }
    return map;
  }, [calendarQuery.data]);

  const { leading: calendarLeading, cells: calendarCells } = useMemo(
    () => buildCalendarCells(bsYear, bsMonth, monthLength),
    [bsYear, bsMonth, monthLength],
  );

  const canGoPrevMonth = !(bsYear === BS_MIN_YEAR && bsMonth === 0);
  const canGoNextMonth = !(bsYear === BS_MAX_YEAR && bsMonth === 11);

  const goToMonth = (delta: number) => {
    const next = shiftBsMonth(bsYear, bsMonth, delta);
    if (next.year < BS_MIN_YEAR || next.year > BS_MAX_YEAR) return;
    setBsYear(next.year);
    setBsMonth(next.month);
  };

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const body = sanitize(values);
    if (editing) {
      updateMutation.mutate({ id: editing.id, body });
    } else {
      createMutation.mutate(body);
    }
  };

  const openCreate = () => {
    setDayPrefillDate(null);
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (row: AttendanceRow) => {
    if (row.day_closed && !isAdmin) {
      toast.info("This day is closed and can only be edited by an administrator.");
      return;
    }
    setDayPrefillDate(null);
    setEditing(row);
    setModalOpen(true);
  };

  const openDayCell = (dateAd: string, rows: AttendanceRow[]) => {
    const match = rider ? rows.find((r) => r.rider === rider) : rows.length === 1 ? rows[0] : undefined;
    if (match) {
      if (canEdit) openEdit(match);
      return;
    }
    if (canCreate) {
      setDayPrefillDate(dateAd);
      setEditing(null);
      setModalOpen(true);
    }
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
        {view === "table" && <DateRangeFilter value={range} onChange={setRange} />}
        <div className="view-toggle">
          <button
            type="button"
            className={`view-toggle-btn ${view === "table" ? "is-active" : ""}`}
            onClick={() => setView("table")}
          >
            Table
          </button>
          <button
            type="button"
            className={`view-toggle-btn ${view === "calendar" ? "is-active" : ""}`}
            onClick={() => setView("calendar")}
          >
            Calendar
          </button>
        </div>
      </div>

      {view === "table" ? (
        listQuery.isLoading ? (
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
        )
      ) : (
        <div className="bs-calendar">
          <div className="bs-calendar-header">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!canGoPrevMonth}
              onClick={() => goToMonth(-1)}
            >
              ← Prev
            </button>
            <h3 className="bs-calendar-title">
              {getBsMonthName(bsMonth)} {bsYear} <span className="text-muted">(BS)</span>
            </h3>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!canGoNextMonth}
              onClick={() => goToMonth(1)}
            >
              Next →
            </button>
          </div>

          {calendarQuery.isLoading ? (
            <p className="text-muted">Loading…</p>
          ) : (
            <>
              <div className="bs-calendar-grid bs-calendar-weekdays">
                {WEEKDAY_LABELS.map((label, idx) => (
                  <div key={label} className={`bs-calendar-weekday ${idx === 6 ? "is-saturday" : ""}`}>
                    {label}
                  </div>
                ))}
              </div>
              <div className="bs-calendar-grid">
                {Array.from({ length: calendarLeading }).map((_, idx) => (
                  <div key={`lead-${idx}`} className="bs-calendar-cell is-empty" />
                ))}
                {calendarCells.map((cell) => {
                  const rows = calendarGrouped.get(cell.adIso) ?? [];
                  const isSaturday = cell.weekday === 6;
                  const isToday = cell.adIso === todayISO();
                  const classes = [
                    "bs-calendar-cell",
                    isSaturday ? "is-saturday" : "",
                    isToday ? "is-today" : "",
                    canCreate || canEdit ? "is-clickable" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <div key={cell.adIso} className={classes} onClick={() => openDayCell(cell.adIso, rows)}>
                      <div className="bs-calendar-cell-head">
                        <span className="bs-calendar-day-number">{cell.bsDay}</span>
                        <span className="bs-calendar-ad-date">{formatAdShort(cell.adIso)}</span>
                      </div>
                      {rows.length > 0 && (
                        <div className="bs-calendar-dots">
                          {rows.map((row) => (
                            <span
                              key={row.id}
                              className={`bs-calendar-dot ${TYPE_DOT_CLASS[row.type]}`}
                              title={`${row.rider_name ?? row.rider} — ${row.type.replace(/_/g, " ")}`}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="bs-calendar-legend">
                <span><span className="bs-calendar-dot bs-cal-dot-present" /> Present</span>
                <span><span className="bs-calendar-dot bs-cal-dot-absent" /> Absent</span>
                <span><span className="bs-calendar-dot bs-cal-dot-leave" /> Leave</span>
                <span><span className="bs-calendar-dot bs-cal-dot-holiday" /> Holiday</span>
                <span><span className="bs-calendar-dot bs-cal-dot-halfday" /> Half day</span>
              </div>
            </>
          )}
        </div>
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
