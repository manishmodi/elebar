import { useState } from "react";
import { useMaintenance, useMaintenanceMutations } from "@/hooks/use-maintenance";
import { useServicingStatus, useServiceHistory, useServicingMutations, type VehicleServiceStatus } from "@/hooks/use-servicing";
import { useVehicles } from "@/hooks/use-vehicles";
import { PageHeader, Card, Button, EmptyState, Dialog, Currency, ConfirmDialog } from "@/components/ui-components";
import { Wrench, Plus, Pencil, Trash2, CheckCircle2, AlertTriangle, XCircle, HelpCircle, History, Gauge, Send, Clock } from "lucide-react";
import { useForm } from "react-hook-form";
import { adToBSString } from "@/lib/nepali-date";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MaintenanceRecord {
  id: number;
  vehicleId: number;
  vehiclePlate?: string | null;
  date: string;
  maintenanceType: string;
  cost?: string | null;
  nextServiceDate?: string | null;
  description?: string | null;
}

interface MaintenanceFormData {
  vehicleId: string;
  date: string;
  maintenanceType: string;
  cost: string;
  nextServiceDate: string;
  description: string;
}

interface MaintenanceFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, string | number | undefined>) => Promise<void>;
  isPending: boolean;
  title?: string;
  defaultValues?: Partial<MaintenanceFormData>;
}

// ─── Service Status Badge ──────────────────────────────────────────────────────

function ServiceStatusBadge({ status }: { status: VehicleServiceStatus["serviceStatus"] }) {
  if (status === "ok") return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">
      <CheckCircle2 className="w-3 h-3" /> OK
    </span>
  );
  if (status === "due_soon") return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-amber-100 text-amber-700">
      <AlertTriangle className="w-3 h-3" /> Due Soon
    </span>
  );
  if (status === "overdue") return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-red-100 text-red-700">
      <XCircle className="w-3 h-3" /> Overdue
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-gray-100 text-gray-600">
      <HelpCircle className="w-3 h-3" /> Unknown
    </span>
  );
}

// ─── Mark as Serviced Modal ────────────────────────────────────────────────────

interface ServiceFormData {
  serviceDate: string;
  odometerAtService: string;
  notes: string;
  cost: string;
}

function MarkServicedModal({
  vehicle,
  isOpen,
  onClose,
  onSubmit,
  isPending,
}: {
  vehicle: VehicleServiceStatus | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ServiceFormData) => Promise<void>;
  isPending: boolean;
}) {
  const { register, handleSubmit, reset } = useForm<ServiceFormData>({
    defaultValues: {
      serviceDate: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })(),
      odometerAtService: vehicle?.currentOdometer?.toString() ?? "",
    },
  });

  const submit = async (data: ServiceFormData) => {
    await onSubmit(data);
    reset();
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={`Mark as Serviced — ${vehicle?.plateNumber ?? ""}`}>
      <form onSubmit={handleSubmit(submit)} className="space-y-5">
        <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Vehicle</span>
            <span className="font-medium">{vehicle?.plateNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Current Odometer</span>
            <span className="font-medium font-mono">{vehicle?.currentOdometer != null ? `${vehicle.currentOdometer} km` : "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">KM Since Last Service</span>
            <span className="font-medium font-mono">{vehicle?.kmSinceLast != null ? `${vehicle.kmSinceLast} km` : "—"}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Service Date *</label>
            <input type="date" {...register("serviceDate", { required: true })} className="premium-input" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Odometer at Service (km) *</label>
            <input type="number" {...register("odometerAtService", { required: true })} className="premium-input" placeholder={vehicle?.currentOdometer?.toString() ?? "0"} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Service Cost (रू)</label>
            <input type="number" step="0.01" {...register("cost")} className="premium-input" placeholder="0.00" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-sm font-medium">Notes</label>
            <textarea {...register("notes")} className="premium-input min-h-[70px]" placeholder="Parts replaced, technician notes..." />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isPending}>{isPending ? "Saving..." : "Log Service"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Servicing Tab ─────────────────────────────────────────────────────────────

function ServicingTab() {
  const { data: statusList, isLoading: statusLoading } = useServicingStatus();
  const { data: history, isLoading: historyLoading } = useServiceHistory();
  const { logService, isLogging, deleteService, isDeleting, sendForServicing, isSending, cancelServicing } = useServicingMutations();
  const [servicingVehicle, setServicingVehicle] = useState<VehicleServiceStatus | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmSendId, setConfirmSendId] = useState<number | null>(null);

  const overdueCount = statusList?.filter(v => v.serviceStatus === "overdue").length ?? 0;
  const dueSoonCount = statusList?.filter(v => v.serviceStatus === "due_soon").length ?? 0;
  const inServicingCount = statusList?.filter(v => v.inServicingSince).length ?? 0;

  return (
    <div className="space-y-6">
      {/* Summary KPIs */}
      {statusList && statusList.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4 flex items-center gap-3 border-red-200 bg-red-50">
            <XCircle className="w-7 h-7 text-red-500 shrink-0" />
            <div>
              <p className="text-xs text-red-600 font-medium">Overdue</p>
              <p className="text-2xl font-bold text-red-700 font-mono">{overdueCount}</p>
            </div>
          </Card>
          <Card className="p-4 flex items-center gap-3 border-amber-200 bg-amber-50">
            <AlertTriangle className="w-7 h-7 text-amber-500 shrink-0" />
            <div>
              <p className="text-xs text-amber-600 font-medium">Due Soon</p>
              <p className="text-2xl font-bold text-amber-700 font-mono">{dueSoonCount}</p>
            </div>
          </Card>
          <Card className="p-4 flex items-center gap-3 border-blue-200 bg-blue-50">
            <Clock className="w-7 h-7 text-blue-500 shrink-0" />
            <div>
              <p className="text-xs text-blue-600 font-medium">In Servicing</p>
              <p className="text-2xl font-bold text-blue-700 font-mono">{inServicingCount}</p>
            </div>
          </Card>
          <Card className="p-4 flex items-center gap-3 border-emerald-200 bg-emerald-50">
            <CheckCircle2 className="w-7 h-7 text-emerald-500 shrink-0" />
            <div>
              <p className="text-xs text-emerald-600 font-medium">OK</p>
              <p className="text-2xl font-bold text-emerald-700 font-mono">
                {statusList.filter(v => v.serviceStatus === "ok").length}
              </p>
            </div>
          </Card>
        </div>
      )}

      {/* Vehicle Service Status Table */}
      <Card className="overflow-x-auto">
        <div className="px-6 py-4 border-b flex items-center gap-2">
          <Gauge className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm">Vehicle Service Status</h3>
          <span className="text-xs text-muted-foreground ml-1">(service every 2,000 km)</span>
        </div>
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
            <tr>
              <th className="px-6 py-3 font-medium">Vehicle</th>
              <th className="px-6 py-3 font-medium">Last Service</th>
              <th className="px-6 py-3 font-medium">Last Service KM</th>
              <th className="px-6 py-3 font-medium">Current KM</th>
              <th className="px-6 py-3 font-medium">KM Since Service</th>
              <th className="px-6 py-3 font-medium">KM Until Due</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {statusLoading ? (
              <tr><td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">Loading…</td></tr>
            ) : !statusList?.length ? (
              <tr><td colSpan={8}>
                <EmptyState title="No active vehicles" description="Active vehicles will appear here with their service status." icon={Wrench} />
              </td></tr>
            ) : (
              [...statusList].sort((a, b) => {
                const order = { overdue: 0, due_soon: 1, ok: 2, unknown: 3 };
                return (order[a.serviceStatus] ?? 3) - (order[b.serviceStatus] ?? 3);
              }).map(v => (
                <tr key={v.id} className="border-b last:border-0 table-row-hover">
                  <td className="px-6 py-4 font-medium">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>{v.plateNumber}</span>
                      {v.inServicingSince && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700" title={`Sent for servicing on ${new Date(v.inServicingSince).toLocaleString()}`}>
                          <Clock className="w-3 h-3" /> In Servicing
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">{v.lastServiceDate ?? "—"}</td>
                  <td className="px-6 py-4 font-mono">{v.lastServiceOdometer != null ? `${v.lastServiceOdometer} km` : "—"}</td>
                  <td className="px-6 py-4 font-mono">
                    {v.currentOdometer != null ? `${v.currentOdometer} km` : "—"}
                    {v.lastOdometerDate && <div className="text-xs text-muted-foreground">{v.lastOdometerDate}</div>}
                  </td>
                  <td className="px-6 py-4 font-mono">
                    {v.kmSinceLast != null ? (
                      <span className={v.kmSinceLast >= 2000 ? "text-red-600 font-bold" : v.kmSinceLast >= 1500 ? "text-amber-600 font-semibold" : ""}>
                        {v.kmSinceLast} km
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-6 py-4 font-mono">
                    {v.kmUntilNext != null ? (
                      <span className={v.kmUntilNext <= 0 ? "text-red-600 font-bold" : v.kmUntilNext <= 500 ? "text-amber-600" : "text-emerald-600"}>
                        {v.kmUntilNext <= 0 ? `${Math.abs(v.kmUntilNext)} km overdue` : `${v.kmUntilNext} km`}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-6 py-4"><ServiceStatusBadge status={v.serviceStatus} /></td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {!v.inServicingSince && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirmSendId(v.id)}
                          disabled={isSending}
                          className="text-xs"
                        >
                          <Send className="w-3 h-3" /> Send for Servicing
                        </Button>
                      )}
                      {v.inServicingSince && (
                        <button
                          onClick={() => cancelServicing(v.id)}
                          className="text-xs text-muted-foreground hover:text-destructive underline-offset-2 hover:underline"
                          title="Cancel servicing flag without logging a service"
                        >
                          Cancel
                        </button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => setServicingVehicle(v)}
                        className="text-xs"
                      >
                        <Wrench className="w-3 h-3" /> Mark Serviced
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {/* Service History */}
      <Card className="overflow-x-auto">
        <div className="px-6 py-4 border-b flex items-center gap-2">
          <History className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm">Service History</h3>
        </div>
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
            <tr>
              <th className="px-6 py-3 font-medium">Date</th>
              <th className="px-6 py-3 font-medium">Vehicle</th>
              <th className="px-6 py-3 font-medium">Odometer at Service</th>
              <th className="px-6 py-3 font-medium">Cost</th>
              <th className="px-6 py-3 font-medium">Notes</th>
              <th className="px-6 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {historyLoading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">Loading…</td></tr>
            ) : !history?.length ? (
              <tr><td colSpan={6}>
                <EmptyState title="No service history" description="Logged services will appear here." icon={History} />
              </td></tr>
            ) : (
              history.map(h => (
                <tr key={h.id} className="border-b last:border-0 table-row-hover">
                  <td className="px-6 py-4">
                    <div>{h.serviceDate}</div>
                    <div className="text-xs text-muted-foreground">{adToBSString(h.serviceDate) || ""}</div>
                  </td>
                  <td className="px-6 py-4 font-medium">{h.vehiclePlate ?? `#${h.vehicleId}`}</td>
                  <td className="px-6 py-4 font-mono">{h.odometerAtService} km</td>
                  <td className="px-6 py-4 font-bold text-red-600"><Currency amount={h.cost} /></td>
                  <td className="px-6 py-4 text-muted-foreground text-xs max-w-[200px] truncate">{h.notes || "—"}</td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => setDeletingId(h.id)}
                      className="p-1.5 hover:bg-red-50 rounded-md text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {/* Mark Serviced Modal */}
      <MarkServicedModal
        vehicle={servicingVehicle}
        isOpen={!!servicingVehicle}
        onClose={() => setServicingVehicle(null)}
        onSubmit={async (data) => {
          if (!servicingVehicle) return;
          await logService({
            vehicleId: servicingVehicle.id,
            serviceDate: data.serviceDate,
            odometerAtService: parseInt(data.odometerAtService),
            notes: data.notes || undefined,
            cost: data.cost || undefined,
          });
          setServicingVehicle(null);
        }}
        isPending={isLogging}
      />

      <ConfirmDialog
        isOpen={deletingId !== null}
        onClose={() => setDeletingId(null)}
        title="Delete Service Record"
        description="Are you sure you want to delete this service record? This cannot be undone."
        onConfirm={async () => {
          if (deletingId !== null) {
            await deleteService(deletingId);
            setDeletingId(null);
          }
        }}
        isPending={isDeleting}
      />

      <ConfirmDialog
        isOpen={confirmSendId !== null}
        onClose={() => setConfirmSendId(null)}
        title="Send Vehicle for Servicing"
        description="Flag this vehicle as currently in servicing. It will show an 'In Servicing' badge in Vehicles and Attendance until you log a completed service for it."
        confirmLabel="Send for Servicing"
        onConfirm={async () => {
          if (confirmSendId !== null) {
            await sendForServicing(confirmSendId);
            setConfirmSendId(null);
          }
        }}
        isPending={isSending}
      />
    </div>
  );
}

// ─── Maintenance Tab ───────────────────────────────────────────────────────────

function MaintenanceTab() {
  const { data: records, isLoading } = useMaintenance();
  const { createRecord, updateRecord, deleteRecord, isCreating, isUpdating, isDeleting } = useMaintenanceMutations();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MaintenanceRecord | null>(null);
  const [deletingRecord, setDeletingRecord] = useState<MaintenanceRecord | null>(null);

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button onClick={() => setIsAddOpen(true)}>
          <Plus className="w-4 h-4" /> Add Record
        </Button>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
            <tr>
              <th className="px-6 py-4 font-medium">Date</th>
              <th className="px-6 py-4 font-medium">Vehicle</th>
              <th className="px-6 py-4 font-medium">Service Type</th>
              <th className="px-6 py-4 font-medium">Description</th>
              <th className="px-6 py-4 font-medium">Cost</th>
              <th className="px-6 py-4 font-medium">Next Due</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : records?.length === 0 ? (
              <tr><td colSpan={7}><EmptyState title="No maintenance records" description="Vehicle maintenance history will appear here." icon={Wrench} /></td></tr>
            ) : (
              records?.map(r => (
                <tr key={r.id} className="border-b last:border-0 table-row-hover">
                  <td className="px-6 py-4">
                    <div>{r.date.split('T')[0]}</div>
                    <div className="text-xs text-muted-foreground">{adToBSString(r.date) || ''}</div>
                  </td>
                  <td className="px-6 py-4 font-medium text-foreground">{r.vehiclePlate || `#${r.vehicleId}`}</td>
                  <td className="px-6 py-4 capitalize">{r.maintenanceType.replace('_', ' ')}</td>
                  <td className="px-6 py-4 text-muted-foreground text-xs max-w-[200px] truncate">{r.description || '-'}</td>
                  <td className="px-6 py-4 font-bold text-red-600"><Currency amount={r.cost} /></td>
                  <td className="px-6 py-4 text-muted-foreground">{r.nextServiceDate ? r.nextServiceDate.split('T')[0] : '-'}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setEditingRecord(r as MaintenanceRecord)} className="p-1.5 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground transition-colors" title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeletingRecord(r as MaintenanceRecord)} className="p-1.5 hover:bg-red-50 rounded-md text-muted-foreground hover:text-destructive transition-colors" title="Delete">
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

      <MaintenanceFormModal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} onSubmit={async (data) => {
        await createRecord({ data });
        setIsAddOpen(false);
      }} isPending={isCreating} />

      {editingRecord && (
        <MaintenanceFormModal
          isOpen={true}
          title="Edit Maintenance Record"
          onClose={() => setEditingRecord(null)}
          defaultValues={{
            vehicleId: editingRecord.vehicleId?.toString() || "",
            date: editingRecord.date?.split('T')[0] || "",
            maintenanceType: editingRecord.maintenanceType || "",
            cost: editingRecord.cost || "",
            nextServiceDate: editingRecord.nextServiceDate?.split('T')[0] || "",
            description: editingRecord.description || "",
          }}
          onSubmit={async (data) => {
            await updateRecord({ id: editingRecord.id, data });
            setEditingRecord(null);
          }}
          isPending={isUpdating}
        />
      )}

      <ConfirmDialog
        isOpen={!!deletingRecord}
        onClose={() => setDeletingRecord(null)}
        title="Delete Maintenance Record"
        description={`Are you sure you want to delete this maintenance record for ${deletingRecord?.vehiclePlate || 'this vehicle'}? This action cannot be undone.`}
        onConfirm={async () => {
          if (deletingRecord) {
            await deleteRecord({ id: deletingRecord.id });
            setDeletingRecord(null);
          }
        }}
        isPending={isDeleting}
      />
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

type Tab = "maintenance" | "servicing";

export default function Maintenance() {
  const [activeTab, setActiveTab] = useState<Tab>("servicing");

  return (
    <div>
      <PageHeader
        title="Vehicle Maintenance & Servicing"
        description="Track repairs, scheduled servicing, and odometer-based maintenance alerts."
      />

      {/* Tabs */}
      <div className="flex items-center bg-muted rounded-lg p-0.5 w-fit mb-6">
        <button
          onClick={() => setActiveTab("servicing")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
            activeTab === "servicing" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Gauge className="w-4 h-4" /> Servicing
        </button>
        <button
          onClick={() => setActiveTab("maintenance")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
            activeTab === "maintenance" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Wrench className="w-4 h-4" /> Maintenance Logs
        </button>
      </div>

      {activeTab === "servicing" ? <ServicingTab /> : <MaintenanceTab />}
    </div>
  );
}

// ─── Maintenance Form Modal ────────────────────────────────────────────────────

function MaintenanceFormModal({ isOpen, onClose, onSubmit, isPending, title = "Log Maintenance", defaultValues }: MaintenanceFormModalProps) {
  const { register, handleSubmit, reset } = useForm<MaintenanceFormData>({ defaultValues });
  const { data: vehicles } = useVehicles();

  const submit = (data: MaintenanceFormData) => {
    const payload: Record<string, string | number | undefined> = { ...data, vehicleId: parseInt(data.vehicleId) };
    Object.keys(payload).forEach((k) => {
      if (payload[k] === "" || payload[k] === undefined) delete payload[k];
    });
    onSubmit(payload);
    reset();
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit(submit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-sm font-medium">Vehicle *</label>
            <select {...register("vehicleId", { required: true })} className="premium-input bg-white">
              <option value="">Select Vehicle</option>
              {vehicles?.map(v => (
                <option key={v.id} value={v.id}>{v.plateNumber}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Date *</label>
            <input type="date" {...register("date", { required: true })} className="premium-input" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Service Type *</label>
            <select {...register("maintenanceType", { required: true })} className="premium-input bg-white">
              <option value="battery_service">Battery Service</option>
              <option value="tire_replacement">Tire Replacement</option>
              <option value="brake_service">Brake Service</option>
              <option value="electrical_repair">Electrical Repair</option>
              <option value="accident_repair">Accident Repair</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Total Cost (रू)</label>
            <input type="number" step="0.01" {...register("cost")} className="premium-input" placeholder="0.00" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Next Service Due (Optional)</label>
            <input type="date" {...register("nextServiceDate")} className="premium-input" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-sm font-medium">Description</label>
            <textarea {...register("description")} className="premium-input min-h-[80px]" placeholder="Parts replaced, notes..."></textarea>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isPending}>{isPending ? "Saving..." : defaultValues ? "Update Record" : "Save Record"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
