import { useState, useMemo, useEffect } from "react";
import { useAttendance, useAttendanceMutations } from "@/hooks/use-attendance";
import { useRiders } from "@/hooks/use-riders";
import { useVehicles } from "@/hooks/use-vehicles";
import { useAssignments } from "@/hooks/use-assignments";
import { PageHeader, Card, StatusBadge, Button, EmptyState, Dialog, ConfirmDialog } from "@/components/ui-components";
import { CalendarDays, Plus, Trash2, Pencil, Table, ChevronLeft, ChevronRight, Car, Battery, Clock, Gauge, TrendingUp, Wrench } from "lucide-react";
import { useForm } from "react-hook-form";
import { adToBSString, adToBS, getBSMonthName } from "@/lib/nepali-date";

interface AttendanceRecord {
  id: number;
  riderId: number;
  riderName?: string | null;
  date: string;
  nepaliDate?: string | null;
  type: string;
  remarks?: string | null;
  vehicleId?: number | null;
  vehiclePlate?: string | null;
  batteryOut?: number | null;
  batteryIn?: number | null;
  scooterOut?: string | null;
  scooterIn?: string | null;
  riderTimeIn?: string | null;
  riderTimeOut?: string | null;
  distanceIn?: string | null;
  distanceOut?: string | null;
  vehicleOverrideReason?: string | null;
}

type ViewMode = "table" | "calendar";

const ATTENDANCE_TYPES = ["present", "absent", "leave", "holiday", "half_day", "compensatory"] as const;

const STATUS_COLORS: Record<string, string> = {
  present: "bg-emerald-500",
  absent: "bg-red-500",
  leave: "bg-amber-500",
  holiday: "bg-blue-500",
  half_day: "bg-orange-500",
  compensatory: "bg-purple-500",
};

const TYPE_LABELS: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  leave: "Leave",
  holiday: "Holiday",
  half_day: "Half Day",
  compensatory: "Compensatory",
};

const GUARD_LOG_TYPES = new Set(["present", "half_day", "compensatory"]);

function isSaturday(dateStr: string) {
  return new Date(dateStr + "T00:00:00").getDay() === 6;
}

function kmDriven(record: AttendanceRecord): string | null {
  const dIn = parseFloat(record.distanceIn ?? "");
  const dOut = parseFloat(record.distanceOut ?? "");
  if (!isNaN(dIn) && !isNaN(dOut) && dOut > dIn) {
    return (dOut - dIn).toFixed(1);
  }
  return null;
}

function countWorkingDays(from: string, to: string): number {
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  let count = 0;
  const d = new Date(start);
  while (d <= end) {
    if (d.getDay() !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return Math.max(1, count);
}

export default function Attendance() {
  const { data: attendance, isLoading } = useAttendance();
  const { data: ridersData } = useRiders();
  const { markAttendance, isMarking, updateAttendance, isUpdating, deleteAttendance, isDeleting } = useAttendanceMutations();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [deletingRecord, setDeletingRecord] = useState<AttendanceRecord | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [prefillDate, setPrefillDate] = useState<string | undefined>();
  const [prefillType, setPrefillType] = useState<string | undefined>();

  // Date range filter — default to current month
  const [dateFrom, setDateFrom] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);

  const handleOpenAddWithDate = (date?: string, type?: string) => {
    setPrefillDate(date);
    setPrefillType(type);
    setIsAddOpen(true);
  };

  // Filtered records for the selected date range
  const filteredAttendance = useMemo(() => {
    if (!attendance) return [];
    return attendance.filter(a => {
      const d = a.date.split('T')[0];
      return d >= dateFrom && d <= dateTo;
    });
  }, [attendance, dateFrom, dateTo]);

  // Fleet Utilization %
  const fleetStats = useMemo(() => {
    const activeRiders = (ridersData ?? []).filter((r: { status: string }) => r.status === 'active').length;
    const workingDays = countWorkingDays(dateFrom, dateTo);
    const presentCount = filteredAttendance.filter(a => GUARD_LOG_TYPES.has(a.type)).length;
    const denominator = activeRiders * workingDays;
    const utilization = denominator > 0 ? Math.min(100, (presentCount / denominator) * 100) : 0;
    return { utilization, activeRiders, workingDays, presentCount };
  }, [filteredAttendance, ridersData, dateFrom, dateTo]);

  return (
    <div>
      <PageHeader
        title="Attendance"
        description="Daily guard log and rider attendance records."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-muted rounded-lg p-0.5">
              <button
                onClick={() => setViewMode("table")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === "table" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Table className="w-4 h-4 inline mr-1.5" />Table
              </button>
              <button
                onClick={() => setViewMode("calendar")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === "calendar" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <CalendarDays className="w-4 h-4 inline mr-1.5" />Calendar
              </button>
            </div>
            <Button onClick={() => handleOpenAddWithDate()}>
              <Plus className="w-4 h-4" /> Mark Attendance
            </Button>
          </div>
        }
      />

      {/* Date Range Filter + KPI */}
      <div className="mb-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-card border rounded-xl px-4 py-2.5 shadow-sm">
            <span className="text-sm text-muted-foreground font-medium">From</span>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="text-sm border-0 bg-transparent focus:outline-none"
            />
            <span className="text-sm text-muted-foreground font-medium">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="text-sm border-0 bg-transparent focus:outline-none"
            />
          </div>
        </div>

        {/* Fleet Utilization KPI */}
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground font-medium">Fleet Utilization</p>
              <p className="text-2xl font-bold mt-1 font-mono">
                {attendance ? `${fleetStats.utilization.toFixed(1)}%` : "—"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {attendance
                  ? `${fleetStats.presentCount} rider-days present · ${fleetStats.activeRiders} active riders · ${fleetStats.workingDays} working days`
                  : "Loading…"}
              </p>
            </div>
            <div className="shrink-0 w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
            </div>
          </div>
          {attendance && (
            <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${fleetStats.utilization}%` }}
              />
            </div>
          )}
        </Card>
      </div>

      {viewMode === "table" ? (
        <AttendanceTable
          attendance={filteredAttendance}
          isLoading={isLoading}
          onEdit={(r) => setEditingRecord(r)}
          onDelete={(r) => setDeletingRecord(r)}
        />
      ) : (
        <AttendanceCalendar
          attendance={attendance}
          isLoading={isLoading}
          calendarMonth={calendarMonth}
          onMonthChange={setCalendarMonth}
          onDayClick={handleOpenAddWithDate}
        />
      )}

      <AttendanceFormModal
        isOpen={isAddOpen}
        onClose={() => { setIsAddOpen(false); setPrefillDate(undefined); setPrefillType(undefined); }}
        onSubmit={async (data) => {
          await markAttendance({ data });
          setIsAddOpen(false);
          setPrefillDate(undefined);
          setPrefillType(undefined);
        }}
        isPending={isMarking}
        defaultDate={prefillDate}
        defaultType={prefillType}
      />

      <AttendanceFormModal
        isOpen={!!editingRecord}
        onClose={() => setEditingRecord(null)}
        onSubmit={async (data) => {
          if (!editingRecord) return;
          await updateAttendance({ id: editingRecord.id, data });
          setEditingRecord(null);
        }}
        isPending={isUpdating}
        editingRecord={editingRecord ?? undefined}
      />

      <ConfirmDialog
        isOpen={!!deletingRecord}
        onClose={() => setDeletingRecord(null)}
        title="Delete Attendance Record"
        description={`Are you sure you want to delete the attendance record for ${deletingRecord?.riderName || 'this rider'} on ${deletingRecord?.date.split('T')[0]}?`}
        onConfirm={async () => {
          if (deletingRecord) {
            await deleteAttendance({ id: deletingRecord.id });
            setDeletingRecord(null);
          }
        }}
        isPending={isDeleting}
      />
    </div>
  );
}

// ─── Table View ───────────────────────────────────────────────────────────────

function AttendanceTable({ attendance, isLoading, onEdit, onDelete }: {
  attendance: AttendanceRecord[] | undefined;
  isLoading: boolean;
  onEdit: (r: AttendanceRecord) => void;
  onDelete: (r: AttendanceRecord) => void;
}) {
  const { data: vehiclesData } = useVehicles();
  const inServicingByVehicleId = useMemo(() => {
    const map = new Map<number, string>();
    const list = (vehiclesData ?? []) as Array<{ id: number; inServicingSince?: string | null }>;
    for (const v of list) {
      if (v.inServicingSince) map.set(v.id, v.inServicingSince);
    }
    return map;
  }, [vehiclesData]);
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm text-left min-w-[900px]">
        <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
          <tr>
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 font-medium">Rider</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Vehicle</th>
            <th className="px-4 py-3 font-medium">Battery Out / In</th>
            <th className="px-4 py-3 font-medium">Scooter Out / In</th>
            <th className="px-4 py-3 font-medium">Rider In / Out</th>
            <th className="px-4 py-3 font-medium">Distance (km)</th>
            <th className="px-4 py-3 font-medium">Remarks</th>
            <th className="px-4 py-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
          ) : attendance?.length === 0 ? (
            <tr><td colSpan={10}><EmptyState title="No records" description="No attendance records found." icon={CalendarDays} /></td></tr>
          ) : (
            attendance?.map(a => {
              const km = kmDriven(a);
              const showGuard = GUARD_LOG_TYPES.has(a.type);
              return (
                <tr key={a.id} className="border-b last:border-0 table-row-hover">
                  <td className="px-4 py-3">
                    <div className="font-medium">{a.date.split('T')[0]}</div>
                    <div className="text-xs text-muted-foreground">{a.nepaliDate || adToBSString(a.date) || ''}</div>
                  </td>
                  <td className="px-4 py-3 font-medium">{a.riderName || `#${a.riderId}`}</td>
                  <td className="px-4 py-3"><StatusBadge status={a.type} /></td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {showGuard && a.vehiclePlate ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="flex items-center gap-1"><Car className="w-3.5 h-3.5" />{a.vehiclePlate}</span>
                        {a.vehicleId != null && inServicingByVehicleId.has(a.vehicleId) && (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200"
                            title={`Assigned vehicle is in servicing since ${new Date(inServicingByVehicleId.get(a.vehicleId) as string).toLocaleString()}`}
                          >
                            <Wrench className="w-3 h-3" /> In Servicing
                          </span>
                        )}
                      </div>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                    {showGuard && (a.batteryOut != null || a.batteryIn != null) ? (
                      <span className="flex items-center gap-1">
                        <Battery className="w-3.5 h-3.5" />
                        {a.batteryOut != null ? `${a.batteryOut}%` : "—"} / {a.batteryIn != null ? `${a.batteryIn}%` : "—"}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                    {showGuard && (a.scooterOut || a.scooterIn) ? `${a.scooterOut || "—"} / ${a.scooterIn || "—"}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                    {showGuard && (a.riderTimeIn || a.riderTimeOut) ? `${a.riderTimeIn || "—"} / ${a.riderTimeOut || "—"}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {showGuard && (a.distanceIn || a.distanceOut) ? (
                      <div>
                        <div className="font-mono text-xs text-muted-foreground">{a.distanceIn || "—"} → {a.distanceOut || "—"}</div>
                        {km && <div className="font-mono text-xs font-medium text-foreground">{km} km</div>}
                      </div>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs max-w-[120px] truncate">{a.remarks || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onEdit(a)}
                        className="p-1.5 hover:bg-blue-50 rounded-md text-muted-foreground hover:text-blue-600 transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDelete(a)}
                        className="p-1.5 hover:bg-red-50 rounded-md text-muted-foreground hover:text-destructive transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </Card>
  );
}

// ─── Calendar View ────────────────────────────────────────────────────────────

function AttendanceCalendar({ attendance, isLoading, calendarMonth, onMonthChange, onDayClick }: {
  attendance: AttendanceRecord[] | undefined;
  isLoading: boolean;
  calendarMonth: { year: number; month: number };
  onMonthChange: (m: { year: number; month: number }) => void;
  onDayClick: (date: string, type?: string) => void;
}) {
  const { year, month } = calendarMonth;

  const bsHeader = useMemo(() => {
    const firstDay = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const bs = adToBS(firstDay);
    if (!bs) return "";
    return `${getBSMonthName(bs.month)} ${bs.year}`;
  }, [year, month]);

  const calendarDays = useMemo(() => {
    const firstOfMonth = new Date(year, month, 1);
    const lastOfMonth = new Date(year, month + 1, 0);
    const startDay = firstOfMonth.getDay();
    const totalDays = lastOfMonth.getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < startDay; i++) days.push(null);
    for (let d = 1; d <= totalDays; d++) days.push(d);
    return days;
  }, [year, month]);

  const attendanceByDate = useMemo(() => {
    const map: Record<string, { riderName: string; type: string }[]> = {};
    attendance?.forEach(a => {
      const dateKey = a.date.split('T')[0];
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push({ riderName: a.riderName || `#${a.riderId}`, type: a.type });
    });
    return map;
  }, [attendance]);

  const prevMonth = () => {
    if (month === 0) onMonthChange({ year: year - 1, month: 11 });
    else onMonthChange({ year, month: month - 1 });
  };

  const nextMonth = () => {
    if (month === 11) onMonthChange({ year: year + 1, month: 0 });
    else onMonthChange({ year, month: month + 1 });
  };

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  if (isLoading) return <div className="p-8 text-center animate-pulse">Loading...</div>;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-6">
        <button onClick={prevMonth} className="p-2 hover:bg-muted rounded-lg transition-colors"><ChevronLeft className="w-5 h-5" /></button>
        <div className="text-center">
          <h3 className="font-display font-semibold text-lg">{monthNames[month]} {year}</h3>
          {bsHeader && <p className="text-sm text-muted-foreground">{bsHeader}</p>}
        </div>
        <button onClick={nextMonth} className="p-2 hover:bg-muted rounded-lg transition-colors"><ChevronRight className="w-5 h-5" /></button>
      </div>

      <div className="grid grid-cols-7 gap-px bg-muted/50 rounded-xl overflow-hidden border">
        {dayNames.map((d, i) => (
          <div key={d} className={`px-2 py-2 text-center text-xs font-medium uppercase ${i === 6 ? "bg-red-50 text-red-400" : "bg-muted/80 text-muted-foreground"}`}>
            {d}
          </div>
        ))}
        {calendarDays.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} className="bg-background min-h-[80px]" />;
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const sat = isSaturday(dateStr);
          const dayEntries = attendanceByDate[dateStr] || [];
          const visibleEntries = dayEntries.slice(0, 3);
          const overflowCount = dayEntries.length - 3;
          const isToday = dateStr === new Date().toISOString().split('T')[0];

          return (
            <div
              key={dateStr}
              className={`min-h-[80px] p-1.5 transition-colors ${sat ? "bg-red-50/60 cursor-pointer hover:bg-red-50" : "bg-background cursor-pointer hover:bg-muted/30"} ${isToday ? "ring-2 ring-primary ring-inset" : ""}`}
              onClick={() => onDayClick(dateStr, sat ? "compensatory" : undefined)}
            >
              <div className={`text-xs font-medium mb-1 ${isToday ? "text-primary font-bold" : sat ? "text-red-400" : "text-foreground"}`}>
                {day}
              </div>
              {sat && dayEntries.length === 0 && (
                <div className="text-[9px] text-red-300 font-medium">Holiday</div>
              )}
              <div className="space-y-0.5">
                {visibleEntries.map((entry, idx) => {
                  const initials = entry.riderName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
                  return (
                    <div key={idx} className="flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLORS[entry.type] || 'bg-gray-400'}`} />
                      <span className="text-[10px] text-muted-foreground truncate">{initials}</span>
                    </div>
                  );
                })}
                {overflowCount > 0 && (
                  <div className="text-[10px] text-muted-foreground font-medium pl-2.5">+{overflowCount} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-4 mt-4 pt-4 border-t flex-wrap">
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <div key={status} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`w-2 h-2 rounded-full ${color}`} />
            <span className="capitalize">{TYPE_LABELS[status] || status}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto">
          <span className="w-3 h-3 rounded bg-red-50/60 border border-red-200 inline-block" />
          <span>Saturday (Holiday)</span>
        </div>
      </div>
    </Card>
  );
}

// ─── Attendance Form Modal ────────────────────────────────────────────────────

interface AttendanceFormData {
  riderId: string;
  date: string;
  nepaliDate: string;
  type: string;
  remarks: string;
  vehicleId: string;
  batteryOut: string;
  batteryIn: string;
  scooterOut: string;
  scooterIn: string;
  riderTimeIn: string;
  riderTimeOut: string;
  distanceIn: string;
  distanceOut: string;
  vehicleOverrideReason: string;
}

interface AttendanceFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, string | number | null | undefined>) => Promise<void>;
  isPending: boolean;
  defaultDate?: string;
  defaultType?: string;
  editingRecord?: AttendanceRecord;
}

function AttendanceFormModal({ isOpen, onClose, onSubmit, isPending, defaultDate, defaultType, editingRecord }: AttendanceFormModalProps) {
  const todayStr = new Date().toISOString().split('T')[0];
  const { register, handleSubmit, reset, watch, setValue } = useForm<AttendanceFormData>();
  const { data: riders } = useRiders();
  const { data: vehiclesData } = useVehicles();
  const { data: assignmentsData, isLoading: assignmentsLoading } = useAssignments();
  const vehicles = (vehiclesData ?? []) as Array<{ id: number; plateNumber: string; vehicleNumber: string }>;
  const assignments = (assignmentsData ?? []) as Array<{ riderId: number; vehicleId: number; status: string; vehiclePlate?: string }>;
  const isEditing = !!editingRecord;

  useEffect(() => {
    if (isOpen) {
      if (editingRecord) {
        reset({
          riderId: String(editingRecord.riderId),
          date: editingRecord.date.split('T')[0],
          nepaliDate: editingRecord.nepaliDate ?? "",
          type: editingRecord.type,
          remarks: editingRecord.remarks ?? "",
          vehicleId: editingRecord.vehicleId != null ? String(editingRecord.vehicleId) : "",
          vehicleOverrideReason: editingRecord.vehicleOverrideReason ?? "",
          batteryOut: editingRecord.batteryOut != null ? String(editingRecord.batteryOut) : "",
          batteryIn: editingRecord.batteryIn != null ? String(editingRecord.batteryIn) : "",
          scooterOut: editingRecord.scooterOut ?? "",
          scooterIn: editingRecord.scooterIn ?? "",
          riderTimeIn: editingRecord.riderTimeIn ?? "",
          riderTimeOut: editingRecord.riderTimeOut ?? "",
          distanceIn: editingRecord.distanceIn ?? "",
          distanceOut: editingRecord.distanceOut ?? "",
        });
      } else {
        reset({
          date: defaultDate || todayStr,
          type: defaultType || "",
          riderId: "", nepaliDate: "", remarks: "",
          vehicleId: "", vehicleOverrideReason: "", batteryOut: "", batteryIn: "",
          scooterOut: "", scooterIn: "", riderTimeIn: "", riderTimeOut: "",
          distanceIn: "", distanceOut: "",
        });
      }
    }
  }, [isOpen, editingRecord, defaultDate, defaultType, reset, todayStr]);

  const dateVal = watch("date");
  const typeVal = watch("type");
  const riderIdVal = watch("riderId");
  const vehicleIdVal = watch("vehicleId");
  const autoBS = dateVal ? adToBSString(dateVal) : "";
  const showGuard = GUARD_LOG_TYPES.has(typeVal);
  const dateSat = dateVal ? isSaturday(dateVal) : false;

  // Find the rider's currently active assigned vehicle
  const assignedVehicle = useMemo(() => {
    if (!riderIdVal) return null;
    const rid = parseInt(riderIdVal);
    if (Number.isNaN(rid)) return null;
    const a = assignments.find(x => x.riderId === rid && x.status === "active");
    if (!a) return null;
    const v = vehicles.find(v => v.id === a.vehicleId);
    return { vehicleId: a.vehicleId, plate: v?.plateNumber ?? a.vehiclePlate ?? `#${a.vehicleId}` };
  }, [riderIdVal, assignments, vehicles]);

  // Auto-fill vehicle on rider change — only when creating new record (not editing)
  useEffect(() => {
    if (isEditing) return;
    if (!showGuard) return;
    if (assignedVehicle) {
      setValue("vehicleId", String(assignedVehicle.vehicleId));
      setValue("vehicleOverrideReason", "");
    }
  }, [riderIdVal, assignedVehicle, isEditing, showGuard, setValue]);

  // Detect override: a vehicle is selected and it differs from the assigned one
  const isOverride = !!(
    showGuard &&
    assignedVehicle &&
    vehicleIdVal &&
    parseInt(vehicleIdVal) !== assignedVehicle.vehicleId
  );

  const submit = (data: AttendanceFormData) => {
    const payload: Record<string, string | number | null | undefined> = {
      riderId: parseInt(data.riderId),
      date: data.date,
      nepaliDate: data.nepaliDate || autoBS || undefined,
      type: data.type,
      remarks: data.remarks || undefined,
    };
    if (showGuard) {
      payload.vehicleId = data.vehicleId ? parseInt(data.vehicleId) : undefined;
      payload.vehicleOverrideReason = isOverride && data.vehicleOverrideReason
        ? data.vehicleOverrideReason.trim()
        : undefined;
      payload.batteryOut = data.batteryOut !== "" && data.batteryOut != null ? parseInt(data.batteryOut) : undefined;
      payload.batteryIn = data.batteryIn !== "" && data.batteryIn != null ? parseInt(data.batteryIn) : undefined;
      payload.scooterOut = data.scooterOut || undefined;
      payload.scooterIn = data.scooterIn || undefined;
      payload.riderTimeIn = data.riderTimeIn || undefined;
      payload.riderTimeOut = data.riderTimeOut || undefined;
      payload.distanceIn = data.distanceIn || undefined;
      payload.distanceOut = data.distanceOut || undefined;
    }
    onSubmit(payload);
    reset();
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={isEditing ? "Edit Attendance" : "Mark Attendance"}>
      <form onSubmit={handleSubmit(submit)} className="space-y-5">

        {/* Basic Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-sm font-medium">Rider *</label>
            <select {...register("riderId", { required: true })} className="premium-input bg-white">
              <option value="">Select Rider</option>
              {(riders ?? []).filter((r: { status: string }) => r.status === 'active').map((r: { id: number; fullName: string }) => (
                <option key={r.id} value={r.id}>{r.fullName}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Date *</label>
            <input type="date" {...register("date", { required: true })} className="premium-input" />
            {dateSat && (
              <p className="text-xs text-amber-600 font-medium">Saturday — marking as compensatory work only</p>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Nepali Date (BS)</label>
            <input {...register("nepaliDate")} className="premium-input" placeholder={autoBS || "Auto-calculated"} />
            {autoBS && <p className="text-[10px] text-muted-foreground mt-0.5">Auto: {autoBS}</p>}
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-sm font-medium">Status *</label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {ATTENDANCE_TYPES.map(type => (
                <label
                  key={type}
                  className={`flex items-center justify-center p-2.5 border rounded-xl cursor-pointer hover:bg-muted/50 transition-colors has-[:checked]:bg-primary/10 has-[:checked]:border-primary has-[:checked]:text-primary font-medium text-xs text-center ${dateSat && type !== "compensatory" ? "opacity-40 pointer-events-none" : ""}`}
                >
                  <input type="radio" value={type} {...register("type", { required: true })} className="sr-only" />
                  {TYPE_LABELS[type]}
                </label>
              ))}
            </div>
            {dateSat && <p className="text-xs text-muted-foreground">Saturday entries can only be logged as Compensatory.</p>}
          </div>
        </div>

        {/* Guard Log Fields — shown for present / half_day / compensatory */}
        {showGuard && (
          <div className="border rounded-xl p-4 space-y-4 bg-muted/20">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Car className="w-4 h-4 text-primary" />
              Guard Log Details
            </div>

            {/* Vehicle */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Vehicle
                {!isEditing && assignedVehicle && (
                  <span className="ml-2 text-[11px] font-normal text-emerald-600">
                    Auto-filled from assignment ({assignedVehicle.plate})
                  </span>
                )}
              </label>
              <select {...register("vehicleId")} className="premium-input bg-white">
                <option value="">Select Vehicle</option>
                {vehicles.filter(v => v).map(v => (
                  <option key={v.id} value={v.id}>{v.plateNumber} {v.vehicleNumber ? `(${v.vehicleNumber})` : ""}</option>
                ))}
              </select>
              {!isEditing && riderIdVal && !assignedVehicle && !assignmentsLoading && (
                <p className="text-xs text-amber-600 font-medium">
                  No vehicle currently assigned to this rider — please pick one manually.
                </p>
              )}
              {isOverride && (
                <div className="space-y-1.5 pt-2">
                  <label className="text-xs font-medium text-amber-700">
                    Override Reason * <span className="font-normal text-muted-foreground">(differs from assigned {assignedVehicle?.plate})</span>
                  </label>
                  <input
                    {...register("vehicleOverrideReason", { required: isOverride })}
                    className="premium-input"
                    placeholder="e.g. Spare scooter — assigned bike under maintenance"
                  />
                </div>
              )}
            </div>

            {/* Battery */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5"><Battery className="w-3.5 h-3.5" />Battery % Out</label>
                <input type="number" min="0" max="100" {...register("batteryOut")} className="premium-input" placeholder="e.g. 100" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5"><Battery className="w-3.5 h-3.5" />Battery % In</label>
                <input type="number" min="0" max="100" {...register("batteryIn")} className="premium-input" placeholder="e.g. 25" />
              </div>
            </div>

            {/* Scooter Times */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />Scooter Out Time</label>
                <input type="time" {...register("scooterOut")} className="premium-input" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />Scooter In Time</label>
                <input type="time" {...register("scooterIn")} className="premium-input" />
              </div>
            </div>

            {/* Rider Times */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Rider Check-In Time</label>
                <input type="time" {...register("riderTimeIn")} className="premium-input" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Rider Check-Out Time</label>
                <input type="time" {...register("riderTimeOut")} className="premium-input" />
              </div>
            </div>

            {/* Odometer */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5" />Odometer Out (km)</label>
                <input type="number" step="0.1" {...register("distanceIn")} className="premium-input font-mono" placeholder="e.g. 12282" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5" />Odometer In (km)</label>
                <input type="number" step="0.1" {...register("distanceOut")} className="premium-input font-mono" placeholder="e.g. 12533" />
              </div>
            </div>
          </div>
        )}

        {/* Remarks */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Remarks</label>
          <textarea {...register("remarks")} className="premium-input min-h-[70px]" placeholder="Optional notes..." />
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isPending}>{isPending ? (isEditing ? "Updating..." : "Saving...") : (isEditing ? "Update Attendance" : "Save Attendance")}</Button>
        </div>
      </form>
    </Dialog>
  );
}
