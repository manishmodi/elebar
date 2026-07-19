import { useState, useMemo, useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { useVehicles, useVehicleMutations } from "@/hooks/use-vehicles";
import { useDailyLogs } from "@/hooks/use-daily-logs";
import { useAttendance } from "@/hooks/use-attendance";
import { PageHeader, Card, StatusBadge, Button, EmptyState, Dialog, DropdownMenu, ConfirmDialog, Currency } from "@/components/ui-components";
import { DateRangeFilter, getDefaultDateRange, type CalendarMode } from "@/components/date-range-filter";
import { AssignmentHistory } from "@/components/assignment-history";
import { VehicleUsageHistory } from "@/components/vehicle-usage-history";
import { Car, Plus, Search, MoreVertical, Pencil, Trash2, ToggleLeft, X, Cpu, Palette, FileText, Wrench, TrendingUp, Calendar, Route, DollarSign, Target, MapPin, Clock, QrCode, Download, Printer } from "lucide-react";
import { useForm } from "react-hook-form";
import { bsStringToAD } from "@/lib/nepali-date";

interface VehicleFormData {
  plateNumber: string;
  vehicleType: string;
  brand: string;
  model: string;
  manufactureYear: string;
  color: string;
  status: string;
  purchaseDate: string;
  purchaseCost: string;
  insuranceIssueDate: string;
  insuranceExpiry: string;
  taxExpiry: string;
  bluebookIssueDate: string;
  bluebookExpiryDate: string;
  serviceDueDate: string;
  lastServiceDate: string;
  lastServiceOdometer: string;
  servicingPayment: string;
  batteryDetails: string;
  odometerReading: string;
  locationBranch: string;
  gpsInstalled: string;
  gpsNumber: string;
  gpsIdPassword: string;
  scooterBranding: string;
  yangoBrandingDate: string;
  brandingPayment: string;
  brandwrapExpireDate: string;
}

interface VehicleRecord {
  id: number;
  vehicleNumber: string;
  plateNumber: string;
  vehicleType?: string | null;
  brand?: string | null;
  model?: string | null;
  manufactureYear?: number | null;
  color?: string | null;
  status: string;
  inServicingSince?: string | null;
  purchaseDate?: string | null;
  purchaseCost?: string | null;
  insuranceIssueDate?: string | null;
  insuranceExpiry?: string | null;
  taxExpiry?: string | null;
  bluebookIssueDate?: string | null;
  bluebookExpiryDate?: string | null;
  serviceDueDate?: string | null;
  lastServiceDate?: string | null;
  lastServiceOdometer?: number | null;
  servicingPayment?: string | null;
  batteryDetails?: string | null;
  odometerReading?: string | null;
  locationBranch?: string | null;
  gpsInstalled?: string | null;
  gpsNumber?: string | null;
  gpsIdPassword?: string | null;
  scooterBranding?: string | null;
  yangoBrandingDate?: string | null;
  brandingPayment?: string | null;
  brandwrapExpireDate?: string | null;
}

interface VehicleFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<VehicleFormData>) => Promise<void>;
  isPending: boolean;
  title?: string;
  defaultValues?: Partial<VehicleFormData>;
}

interface DailyLogEntry {
  id: number;
  riderId: number;
  vehicleId: number;
  englishDate: string;
  ridesCompleted?: number | null;
  totalRidesReceived?: number | null;
  totalIncome?: string | null;
  totalRideDistanceKm?: string | null;
  bonusTargetCompletion?: boolean | null;
}

export default function Vehicles() {
  const { data: vehicles, isLoading } = useVehicles();
  const { data: dailyLogs } = useDailyLogs();
  const { data: attendance } = useAttendance();
  const { createVehicle, updateVehicle, isCreating, isUpdating, deleteVehicle, isDeleting } = useVehicleMutations();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<VehicleRecord | null>(null);
  const [deletingVehicle, setDeletingVehicle] = useState<VehicleRecord | null>(null);
  const [profileVehicle, setProfileVehicle] = useState<VehicleRecord | null>(null);
  const [search, setSearch] = useState("");
  const [dateMode, setDateMode] = useState<"AD" | "BS">("AD");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

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

  const revenueMap = useMemo(() => {
    const map: Record<number, number> = {};
    if (!dailyLogs) return map;
    for (const log of dailyLogs) {
      if (!log.vehicleId || !log.totalIncome) continue;
      const logDate = log.englishDate?.split("T")[0];
      if (!logDate) continue;
      if (fromAD && logDate < fromAD) continue;
      if (toAD && logDate > toAD) continue;
      const amount = parseFloat(String(log.totalIncome)) || 0;
      map[log.vehicleId] = (map[log.vehicleId] || 0) + amount;
    }
    return map;
  }, [dailyLogs, fromAD, toAD]);

  const daysActiveMap = useMemo(() => {
    const dateSets: Record<number, Set<string>> = {};
    if (attendance) {
      for (const record of attendance) {
        if (!record.vehicleId) continue;
        const recDate = record.date?.split("T")[0];
        if (!recDate) continue;
        if (fromAD && recDate < fromAD) continue;
        if (toAD && recDate > toAD) continue;
        if (!dateSets[record.vehicleId]) dateSets[record.vehicleId] = new Set();
        dateSets[record.vehicleId].add(recDate);
      }
    }
    const counts: Record<number, number> = {};
    for (const vid of Object.keys(dateSets)) {
      counts[Number(vid)] = dateSets[Number(vid)].size;
    }
    return counts;
  }, [attendance, fromAD, toAD]);

  const filtered = vehicles?.filter(v =>
    v.vehicleNumber.toLowerCase().includes(search.toLowerCase()) ||
    v.plateNumber.toLowerCase().includes(search.toLowerCase())
  );

  const handleStatusToggle = async (vehicle: VehicleRecord, newStatus: string) => {
    await updateVehicle({ id: vehicle.id, data: { vehicleNumber: vehicle.vehicleNumber, plateNumber: vehicle.plateNumber, status: newStatus } });
  };

  const getNextStatuses = (current: string) => {
    const all = ["active", "maintenance", "inactive"];
    return all.filter(s => s !== current);
  };

  const hasDateFilter = fromDate || toDate;
  const clearDates = () => { setFromDate(""); setToDate(""); };

  return (
    <div>
      <PageHeader
        title="Vehicle Fleet"
        description="Manage your fleet, track statuses, and view vehicle details."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => (window.location.href = "/vehicle-qr")}>
              QR Stickers
            </Button>
            <Button onClick={() => setIsAddOpen(true)}>
              <Plus className="w-4 h-4" /> Add Vehicle
            </Button>
          </div>
        }
      />

      <Card className="mb-6 p-4 space-y-3">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by plate or vehicle ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="premium-input pl-9"
          />
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
              Revenue &amp; Days Active filtered by {dateMode} date range
            </span>
          )}
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
            <tr>
              <th className="px-6 py-4 font-medium">Vehicle ID</th>
              <th className="px-6 py-4 font-medium">Plate Number</th>
              <th className="px-6 py-4 font-medium">Type</th>
              <th className="px-6 py-4 font-medium">Brand/Model</th>
              <th className="px-6 py-4 font-medium">Color</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium text-right">Days Active</th>
              <th className="px-6 py-4 font-medium text-right text-emerald-700">Revenue (रू)</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={9} className="px-6 py-8 text-center text-muted-foreground">Loading vehicles...</td></tr>
            ) : filtered?.length === 0 ? (
              <tr><td colSpan={9}><EmptyState title="No vehicles found" description="Add a vehicle to get started." icon={Car} /></td></tr>
            ) : (
              filtered?.map(v => {
                const revenue = revenueMap[v.id];
                const daysActive = daysActiveMap[v.id] || 0;
                return (
                  <tr key={v.id} className="border-b last:border-0 table-row-hover">
                    <td className="px-6 py-4">
                      <button
                        onClick={() => setProfileVehicle(v as VehicleRecord)}
                        className="font-semibold text-primary hover:underline underline-offset-2 text-left transition-colors"
                      >
                        {v.vehicleNumber}
                      </button>
                    </td>
                    <td className="px-6 py-4 font-mono">{v.plateNumber}</td>
                    <td className="px-6 py-4">{v.vehicleType || '-'}</td>
                    <td className="px-6 py-4">{v.brand || '-'} {v.model || ''}</td>
                    <td className="px-6 py-4">{v.color || '-'}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge status={v.status} />
                        {(v as VehicleRecord).inServicingSince && (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200"
                            title={`Sent for servicing on ${new Date((v as VehicleRecord).inServicingSince as string).toLocaleString()}`}
                          >
                            <Clock className="w-3 h-3" /> In Servicing
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right font-semibold">
                      {daysActive > 0 ? <span>{daysActive} {daysActive === 1 ? "day" : "days"}</span> : <span className="text-muted-foreground font-normal">—</span>}
                    </td>
                    <td className="px-6 py-4 text-right font-semibold text-emerald-700">
                      {revenue != null && revenue > 0 ? <Currency amount={String(revenue.toFixed(2))} /> : <span className="text-muted-foreground font-normal">—</span>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <DropdownMenu
                        trigger={<button className="p-2 hover:bg-muted rounded-md text-muted-foreground transition-colors"><MoreVertical className="w-4 h-4" /></button>}
                        items={[
                          { label: "Edit", icon: <Pencil className="w-4 h-4" />, onClick: () => setEditingVehicle(v as VehicleRecord) },
                          ...getNextStatuses(v.status).map(s => ({
                            label: `Set ${s.charAt(0).toUpperCase() + s.slice(1)}`,
                            icon: <ToggleLeft className="w-4 h-4" />,
                            onClick: () => handleStatusToggle(v as VehicleRecord, s),
                          })),
                          { label: "Delete", icon: <Trash2 className="w-4 h-4" />, onClick: () => setDeletingVehicle(v as VehicleRecord), variant: "destructive" as const },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>

      <VehicleFormModal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} onSubmit={async (data) => {
        await createVehicle({ data });
        setIsAddOpen(false);
      }} isPending={isCreating} />

      {editingVehicle && (
        <VehicleFormModal
          isOpen={true}
          title="Edit Vehicle"
          onClose={() => setEditingVehicle(null)}
          defaultValues={{
            plateNumber: editingVehicle.plateNumber,
            vehicleType: editingVehicle.vehicleType || "",
            brand: editingVehicle.brand || "",
            model: editingVehicle.model || "",
            manufactureYear: editingVehicle.manufactureYear?.toString() || "",
            color: editingVehicle.color || "",
            status: editingVehicle.status,
            purchaseDate: editingVehicle.purchaseDate?.split('T')[0] || "",
            purchaseCost: editingVehicle.purchaseCost || "",
            insuranceIssueDate: editingVehicle.insuranceIssueDate?.split('T')[0] || "",
            insuranceExpiry: editingVehicle.insuranceExpiry?.split('T')[0] || "",
            taxExpiry: editingVehicle.taxExpiry?.split('T')[0] || "",
            bluebookIssueDate: editingVehicle.bluebookIssueDate?.split('T')[0] || "",
            bluebookExpiryDate: editingVehicle.bluebookExpiryDate?.split('T')[0] || "",
            serviceDueDate: editingVehicle.serviceDueDate?.split('T')[0] || "",
            lastServiceDate: editingVehicle.lastServiceDate?.split('T')[0] || "",
            lastServiceOdometer: editingVehicle.lastServiceOdometer?.toString() || "",
            servicingPayment: editingVehicle.servicingPayment || "",
            batteryDetails: editingVehicle.batteryDetails || "",
            odometerReading: editingVehicle.odometerReading || "",
            locationBranch: editingVehicle.locationBranch || "",
            gpsInstalled: editingVehicle.gpsInstalled || "",
            gpsNumber: editingVehicle.gpsNumber || "",
            gpsIdPassword: editingVehicle.gpsIdPassword || "",
            scooterBranding: editingVehicle.scooterBranding || "",
            yangoBrandingDate: editingVehicle.yangoBrandingDate?.split('T')[0] || "",
            brandingPayment: editingVehicle.brandingPayment || "",
            brandwrapExpireDate: editingVehicle.brandwrapExpireDate?.split('T')[0] || "",
          }}
          onSubmit={async (data) => {
            await updateVehicle({ id: editingVehicle.id, data });
            setEditingVehicle(null);
          }}
          isPending={isUpdating}
        />
      )}

      <ConfirmDialog
        isOpen={!!deletingVehicle}
        onClose={() => setDeletingVehicle(null)}
        title="Delete Vehicle"
        description={`Are you sure you want to delete vehicle ${deletingVehicle?.vehicleNumber} (${deletingVehicle?.plateNumber})? This action cannot be undone.`}
        onConfirm={async () => {
          if (deletingVehicle) {
            await deleteVehicle({ id: deletingVehicle.id });
            setDeletingVehicle(null);
          }
        }}
        isPending={isDeleting}
      />

      {profileVehicle && (
        <VehicleProfileDrawer
          vehicle={profileVehicle}
          logs={(dailyLogs || []) as DailyLogEntry[]}
          onClose={() => setProfileVehicle(null)}
        />
      )}
    </div>
  );
}

// ─── Vehicle Profile Drawer ────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
      <p className="text-sm font-medium text-foreground">{value || <span className="text-muted-foreground/60 font-normal">—</span>}</p>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, sub, highlight }: { label: string; value: string | number; icon: React.ElementType; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 space-y-1 ${highlight ? "bg-primary/5 border-primary/20" : "bg-muted/40"}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wide">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <p className={`text-xl font-bold ${highlight ? "text-primary" : "text-foreground"}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function VehicleProfileDrawer({ vehicle, logs, onClose }: { vehicle: VehicleRecord; logs: DailyLogEntry[]; onClose: () => void }) {
  const [dateRange, setDateRange] = useState(getDefaultDateRange);
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("AD");

  const vehicleLogs = useMemo(() => {
    return logs.filter(l => {
      if (l.vehicleId !== vehicle.id) return false;
      const d = l.englishDate?.split("T")[0];
      if (!d) return false;
      if (dateRange.from && d < dateRange.from) return false;
      if (dateRange.to && d > dateRange.to) return false;
      return true;
    });
  }, [logs, vehicle.id, dateRange.from, dateRange.to]);

  const stats = useMemo(() => {
    const daysInService = vehicleLogs.length;
    const totalRidesCompleted = vehicleLogs.reduce((s, l) => s + (l.ridesCompleted || 0), 0);
    const totalRidesReceived = vehicleLogs.reduce((s, l) => s + (l.totalRidesReceived || 0), 0);
    const totalIncome = vehicleLogs.reduce((s, l) => s + parseFloat(l.totalIncome || "0"), 0);
    const totalDistanceKm = vehicleLogs.reduce((s, l) => s + parseFloat(l.totalRideDistanceKm || "0"), 0);
    const avgDailyIncome = daysInService > 0 ? totalIncome / daysInService : 0;
    const avgDailyRides = daysInService > 0 ? totalRidesCompleted / daysInService : 0;
    return { daysInService, totalRidesCompleted, totalRidesReceived, totalIncome, totalDistanceKm, avgDailyIncome, avgDailyRides };
  }, [vehicleLogs]);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-background shadow-2xl z-50 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b bg-gradient-to-r from-primary/5 to-background">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Car className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">{vehicle.vehicleNumber}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-mono text-sm text-muted-foreground">{vehicle.plateNumber}</span>
                <StatusBadge status={vehicle.status} />
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg text-muted-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-5 space-y-6">

            {/* Basic Info */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Car className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm uppercase tracking-wider text-primary">Basic Information</h3>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <InfoRow label="Vehicle Type" value={vehicle.vehicleType} />
                <InfoRow label="Brand / Model" value={[vehicle.brand, vehicle.model].filter(Boolean).join(' ') || null} />
                <InfoRow label="Color" value={vehicle.color} />
                <InfoRow label="Manufacture Year" value={vehicle.manufactureYear} />
                <InfoRow label="Location / Branch" value={vehicle.locationBranch} />
                <InfoRow label="Odometer (km)" value={vehicle.odometerReading} />
                <InfoRow label="Battery Details" value={vehicle.batteryDetails} />
              </div>
            </div>

            {/* Documents */}
            <div className="border-t pt-5">
              <div className="flex items-center gap-2 mb-3">
                <FileText className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm uppercase tracking-wider text-primary">Purchase & Documents</h3>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <InfoRow label="Purchase Date" value={vehicle.purchaseDate?.split('T')[0]} />
                <InfoRow label="Purchase Cost" value={vehicle.purchaseCost ? `रू ${vehicle.purchaseCost}` : null} />
                <InfoRow label="Bluebook Issue" value={vehicle.bluebookIssueDate?.split('T')[0]} />
                <InfoRow label="Bluebook Expiry" value={vehicle.bluebookExpiryDate?.split('T')[0]} />
                <InfoRow label="Insurance Issue" value={vehicle.insuranceIssueDate?.split('T')[0]} />
                <InfoRow label="Insurance Expiry" value={vehicle.insuranceExpiry?.split('T')[0]} />
                <InfoRow label="Tax Expiry" value={vehicle.taxExpiry?.split('T')[0]} />
              </div>
            </div>

            {/* Servicing */}
            <div className="border-t pt-5">
              <div className="flex items-center gap-2 mb-3">
                <Wrench className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm uppercase tracking-wider text-primary">Servicing</h3>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <InfoRow label="Last Service Date" value={vehicle.lastServiceDate?.split('T')[0]} />
                <InfoRow label="Last Service Odometer" value={vehicle.lastServiceOdometer != null ? `${vehicle.lastServiceOdometer} km` : null} />
                <InfoRow label="Servicing Payment" value={vehicle.servicingPayment ? `रू ${vehicle.servicingPayment}` : null} />
              </div>
            </div>

            {/* GPS */}
            <div className="border-t pt-5">
              <div className="flex items-center gap-2 mb-3">
                <Cpu className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm uppercase tracking-wider text-primary">GPS & Tracking</h3>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <InfoRow label="GPS Installed" value={vehicle.gpsInstalled} />
                <InfoRow label="GPS Number" value={vehicle.gpsNumber} />
                <InfoRow label="GPS ID / Password" value={vehicle.gpsIdPassword} />
              </div>
            </div>

            {/* Branding */}
            <div className="border-t pt-5">
              <div className="flex items-center gap-2 mb-3">
                <Palette className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm uppercase tracking-wider text-primary">Branding</h3>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <InfoRow label="Scooter Branding" value={vehicle.scooterBranding} />
                <InfoRow label="Yango Branding Date" value={vehicle.yangoBrandingDate?.split('T')[0]} />
                <InfoRow label="Branding Payment" value={vehicle.brandingPayment ? `रू ${vehicle.brandingPayment}` : null} />
                <InfoRow label="Brandwrap Expires" value={vehicle.brandwrapExpireDate?.split('T')[0]} />
              </div>
            </div>

            {/* Performance */}
            <div className="border-t pt-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-primary">Performance</h3>
                </div>
                <DateRangeFilter
                  dateFrom={dateRange.from}
                  dateTo={dateRange.to}
                  onChange={(from, to) => setDateRange({ from, to })}
                  calendarMode={calendarMode}
                  onCalendarModeChange={setCalendarMode}
                />
              </div>

              {vehicleLogs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm bg-muted/30 rounded-xl border">
                  No logs found for the selected date range.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="Days in Service" value={stats.daysInService} icon={Calendar} />
                  <StatCard label="Rides Received" value={stats.totalRidesReceived} icon={Target} sub={`${stats.totalRidesCompleted} completed`} />
                  <StatCard label="Total Revenue" value={`रू ${stats.totalIncome.toFixed(2)}`} icon={DollarSign} highlight sub={`रू ${stats.avgDailyIncome.toFixed(2)} / day`} />
                  <StatCard label="Avg Rides/Day" value={stats.avgDailyRides.toFixed(1)} icon={Route} />
                  <StatCard label="Total Distance" value={`${stats.totalDistanceKm.toFixed(1)} km`} icon={MapPin} />
                </div>
              )}
            </div>

            <VehicleQrSection vehicleNumber={vehicle.vehicleNumber ?? String(vehicle.id)} plateNumber={vehicle.plateNumber ?? ""} />

            {/* Assignment History */}
            <AssignmentHistory vehicleId={vehicle.id} />

            {/* Vehicle Usage (by attendance) */}
            <VehicleUsageHistory vehicleId={vehicle.id} dateFrom={dateRange.from} dateTo={dateRange.to} />

          </div>
        </div>
      </div>
    </>
  );
}

// ─── Vehicle Form Modal ────────────────────────────────────────────────────

function VehicleFormModal({ isOpen, onClose, onSubmit, isPending, title = "Add New Vehicle", defaultValues }: VehicleFormModalProps) {
  const { register, handleSubmit, reset } = useForm<VehicleFormData>({ defaultValues });

  const submit = (data: VehicleFormData) => {
    const payload: Record<string, string | number | undefined> = {
      ...data,
      status: data.status || "active",
      manufactureYear: data.manufactureYear ? parseInt(data.manufactureYear) : undefined,
      lastServiceOdometer: data.lastServiceOdometer ? parseInt(data.lastServiceOdometer) : undefined,
    };
    Object.keys(payload).forEach((k) => {
      if (payload[k] === "" || payload[k] === undefined) delete payload[k];
    });
    onSubmit(payload as Partial<VehicleFormData>);
    reset();
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit(submit)} className="space-y-6">

        <div className="bg-muted/40 p-4 rounded-xl space-y-4 border">
          <h3 className="font-semibold text-sm text-primary uppercase tracking-wider">Basic Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Plate Number *</label>
              <input {...register("plateNumber", { required: true })} className="premium-input" placeholder="e.g. Ba 2 Pa 1234" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Vehicle Type</label>
              <select {...register("vehicleType")} className="premium-input bg-white">
                <option value="">Select Type</option>
                <option value="Electric Scooter">Electric Scooter</option>
                <option value="Electric Bike">Electric Bike</option>
                <option value="Petrol Bike">Petrol Bike</option>
                <option value="Petrol Scooter">Petrol Scooter</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Brand</label>
              <input {...register("brand")} className="premium-input" placeholder="e.g. NIU" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Model</label>
              <input {...register("model")} className="premium-input" placeholder="e.g. NQi GT" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Color</label>
              <input {...register("color")} className="premium-input" placeholder="e.g. White" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Manufacture Year</label>
              <input type="number" {...register("manufactureYear")} className="premium-input" placeholder="2024" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Status *</label>
              <select {...register("status")} className="premium-input bg-white">
                <option value="active">Active</option>
                <option value="maintenance">Maintenance</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Location/Branch</label>
              <input {...register("locationBranch")} className="premium-input" placeholder="Kathmandu" />
            </div>
          </div>
        </div>

        <div className="bg-muted/40 p-4 rounded-xl space-y-4 border">
          <h3 className="font-semibold text-sm text-primary uppercase tracking-wider">Purchase & Documents</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Purchase Date</label>
              <input type="date" {...register("purchaseDate")} className="premium-input" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Purchase Cost (रू)</label>
              <input type="number" {...register("purchaseCost")} className="premium-input" placeholder="350000" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Bluebook Issue Date</label>
              <input type="date" {...register("bluebookIssueDate")} className="premium-input" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Bluebook Expiry Date</label>
              <input type="date" {...register("bluebookExpiryDate")} className="premium-input" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Insurance Issue Date</label>
              <input type="date" {...register("insuranceIssueDate")} className="premium-input" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Insurance Expiry Date</label>
              <input type="date" {...register("insuranceExpiry")} className="premium-input" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tax Expiry</label>
              <input type="date" {...register("taxExpiry")} className="premium-input" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Battery Details</label>
              <input {...register("batteryDetails")} className="premium-input" placeholder="72V 26Ah Lithium" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Odometer (km)</label>
              <input {...register("odometerReading")} className="premium-input" placeholder="12500" />
            </div>
          </div>
        </div>

        <div className="bg-muted/40 p-4 rounded-xl space-y-4 border">
          <h3 className="font-semibold text-sm text-primary uppercase tracking-wider">Servicing</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Last Service Date</label>
              <input type="date" {...register("lastServiceDate")} className="premium-input" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Last Service Odometer (km)</label>
              <input type="number" {...register("lastServiceOdometer")} className="premium-input" placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Servicing Payment (रू)</label>
              <input type="number" {...register("servicingPayment")} className="premium-input" placeholder="0" />
            </div>
          </div>
        </div>

        <div className="bg-muted/40 p-4 rounded-xl space-y-4 border">
          <h3 className="font-semibold text-sm text-primary uppercase tracking-wider">GPS & Tracking</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">GPS Installed</label>
              <select {...register("gpsInstalled")} className="premium-input bg-white">
                <option value="">Select</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">GPS Number</label>
              <input {...register("gpsNumber")} className="premium-input" placeholder="GPS device number" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-sm font-medium">GPS ID / Password</label>
              <input {...register("gpsIdPassword")} className="premium-input" placeholder="ID:Password" />
            </div>
          </div>
        </div>

        <div className="bg-muted/40 p-4 rounded-xl space-y-4 border">
          <h3 className="font-semibold text-sm text-primary uppercase tracking-wider">Branding</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Scooter Branding</label>
              <input {...register("scooterBranding")} className="premium-input" placeholder="e.g. Yango" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Yango Branding Date</label>
              <input type="date" {...register("yangoBrandingDate")} className="premium-input" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Branding Payment (रू)</label>
              <input type="number" {...register("brandingPayment")} className="premium-input" placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Brandwrap Expire Date</label>
              <input type="date" {...register("brandwrapExpireDate")} className="premium-input" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isPending}>{isPending ? "Saving..." : defaultValues ? "Update Vehicle" : "Save Vehicle"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Scooter QR (profile drawer) ─────────────────────────────────────────────
// Drawn live from the vehicle number — nothing is generated or stored, so the
// QR exists automatically the moment a vehicle is added.
function VehicleQrSection({ vehicleNumber, plateNumber }: { vehicleNumber: string; plateNumber: string }) {
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  const dataUrl = () => canvasWrapRef.current?.querySelector("canvas")?.toDataURL("image/png") ?? null;

  const download = () => {
    const url = dataUrl();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `qr-${(plateNumber || vehicleNumber).replace(/[^a-zA-Z0-9]+/g, "-")}.png`;
    a.click();
  };

  const printOne = () => {
    const url = dataUrl();
    if (!url) return;
    const w = window.open("", "_blank", "width=420,height=520");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>QR ${plateNumber}</title>
      <style>body{font-family:sans-serif;text-align:center;padding:24px}
      .sticker{display:inline-block;border:1.5px dashed #999;border-radius:10px;padding:18px}
      .plate{font-weight:700;font-size:16px;margin-top:10px;letter-spacing:.5px}
      .num{color:#555;font-size:12px;margin-top:2px}
      .brand{color:#888;font-size:10px;margin-top:8px}</style></head><body>
      <div class="sticker"><img src="${url}" width="220" height="220" />
      <div class="plate">${plateNumber}</div><div class="num">${vehicleNumber}</div>
      <div class="brand">Elebhar Fleet — scan at check-out</div></div>
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };

  return (
    <div className="border-t pt-5">
      <div className="flex items-center gap-2 mb-3">
        <QrCode className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm uppercase tracking-wider text-primary">Scooter QR</h3>
      </div>
      <div className="flex items-center gap-4 p-4 rounded-xl border bg-muted/20">
        <div ref={canvasWrapRef} className="bg-white p-2 rounded-lg border flex-shrink-0">
          <QRCodeCanvas value={vehicleNumber} size={132} marginSize={2} />
        </div>
        <div className="space-y-2 min-w-0">
          <p className="text-xs text-muted-foreground">
            Riders scan this at check-out and exchange. Encodes <span className="font-mono">{vehicleNumber}</span> — valid
            for this scooter forever, even after re-plating.
          </p>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={download}>
              <Download className="w-3.5 h-3.5" /> Download PNG
            </Button>
            <Button variant="outline" onClick={printOne}>
              <Printer className="w-3.5 h-3.5" /> Print sticker
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
