import { useState, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRiders, useRiderMutations } from "@/hooks/use-riders";
import { useDailyLogs } from "@/hooks/use-daily-logs";
import { getListRidersQueryKey } from "@workspace/api-client-react";
import { PageHeader, Card, StatusBadge, Button, EmptyState, Dialog, DropdownMenu, ConfirmDialog, Currency } from "@/components/ui-components";
import { DateRangeFilter, getDefaultDateRange, type CalendarMode } from "@/components/date-range-filter";
import { AssignmentHistory } from "@/components/assignment-history";
import { Users, Plus, Search, MoreVertical, Pencil, Trash2, ToggleLeft, X, Phone, MapPin, Shield, Briefcase, TrendingUp, Calendar, Target, DollarSign, Route, Upload, Eye, Link, Unlink } from "lucide-react";
import { useForm } from "react-hook-form";
import { useAuth } from "@/contexts/auth-context";

const API_BASE = `${import.meta.env.BASE_URL}api`;

interface RiderStat {
  riderId: number;
  avgRidesPerDay: string;
  avgRevenuePerDay: string;
  avgRidesGrowth: number | null;
}

function GrowthBadge({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) return null;
  const isPos = pct >= 0;
  const isFlat = pct === 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full mt-0.5 ${
        isFlat
          ? "bg-gray-100 text-gray-500"
          : isPos
          ? "bg-emerald-100 text-emerald-700"
          : "bg-red-100 text-red-600"
      }`}
    >
      {isFlat ? "=" : isPos ? "↑" : "↓"} {isPos && !isFlat ? "+" : ""}{pct}%
    </span>
  );
}

function useRiderStats(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: ["rider-stats", dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/riders/stats?dateFrom=${dateFrom}&dateTo=${dateTo}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch rider stats");
      return res.json() as Promise<RiderStat[]>;
    },
    enabled: !!dateFrom && !!dateTo,
  });
}

interface RiderFormData {
  kycSubmissionDate: string;
  fullName: string;
  phoneNumber: string;
  secondaryPhone: string;
  dateOfBirth: string;
  gender: string;
  maritalStatus: string;
  bloodGroup: string;
  permanentAddress: string;
  temporaryAddress: string;
  address: string;
  email: string;
  emergencyContact: string;
  citizenshipNumber: string;
  citizenshipIssueDate: string;
  citizenshipIssueDistrict: string;
  citizenshipImageUrl: string;
  nidNumber: string;
  nidIssueDate: string;
  nidIssueDistrict: string;
  licenseNumber: string;
  licenseExpiryDate: string;
  licenseIssueDate: string;
  licenseIssueDistrict: string;
  licenseType: string;
  licenseImageUrl: string;
  drivingExperience: string;
  fatherName: string;
  fatherPhone: string;
  motherName: string;
  motherPhone: string;
  spouseName: string;
  spousePhone: string;
  grandfatherName: string;
  grandmotherName: string;
  familyAddress: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  relationshipProofUrl: string;
  joiningDate: string;
  employmentType: string;
  salaryStructure: string;
  monthlySalary: string;
  dailyRideTarget: string;
  assignedSupervisor: string;
  securityDeposit: string;
  bankAccountDetails: string;
  status: string;
  fleetPilot: boolean;
}

interface RiderRecord {
  id: number;
  kycSubmissionDate?: string | null;
  fullName: string;
  phoneNumber: string;
  secondaryPhone?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  maritalStatus?: string | null;
  bloodGroup?: string | null;
  permanentAddress?: string | null;
  temporaryAddress?: string | null;
  address?: string | null;
  email?: string | null;
  emergencyContact?: string | null;
  citizenshipNumber?: string | null;
  citizenshipIssueDate?: string | null;
  citizenshipIssueDistrict?: string | null;
  citizenshipImageUrl?: string | null;
  nidNumber?: string | null;
  nidIssueDate?: string | null;
  nidIssueDistrict?: string | null;
  licenseNumber?: string | null;
  licenseExpiryDate?: string | null;
  licenseIssueDate?: string | null;
  licenseIssueDistrict?: string | null;
  licenseType?: string | null;
  licenseImageUrl?: string | null;
  drivingExperience?: string | null;
  fatherName?: string | null;
  fatherPhone?: string | null;
  motherName?: string | null;
  motherPhone?: string | null;
  spouseName?: string | null;
  spousePhone?: string | null;
  grandfatherName?: string | null;
  grandmotherName?: string | null;
  familyAddress?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelationship?: string | null;
  relationshipProofUrl?: string | null;
  joiningDate?: string | null;
  employmentType?: string | null;
  salaryStructure?: string | null;
  monthlySalary?: string | null;
  dailyRideTarget?: number | null;
  assignedSupervisor?: string | null;
  securityDeposit?: string | null;
  bankAccountDetails?: string | null;
  status: string;
  yangoDriverId?: string | null;
  fleetPilot?: boolean;
}

interface RiderFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, string | number | boolean | undefined>) => Promise<void>;
  isPending: boolean;
  title?: string;
  defaultValues?: Partial<RiderFormData>;
}

interface DailyLogEntry {
  id: number;
  riderId: number;
  vehicleId: number;
  englishDate: string;
  nepaliDate?: string | null;
  ridesCompleted?: number | null;
  totalRidesReceived?: number | null;
  acceptanceRate?: string | null;
  totalIncome?: string | null;
  totalRideDistanceKm?: string | null;
  bonusTargetCompletion?: boolean | null;
  dailyBonusSet?: number | null;
}

export default function Riders() {
  const { data: riders, isLoading } = useRiders();
  const { data: allLogs } = useDailyLogs();
  const { createRider, updateRider, isCreating, isUpdating, deleteRider, isDeleting } = useRiderMutations();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingRider, setEditingRider] = useState<RiderRecord | null>(null);
  const [deletingRider, setDeletingRider] = useState<RiderRecord | null>(null);
  const [profileRider, setProfileRider] = useState<RiderRecord | null>(null);
  const [search, setSearch] = useState("");

  const [dateRange, setDateRange] = useState(getDefaultDateRange);
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("AD");
  const { data: riderStats, isLoading: statsLoading } = useRiderStats(dateRange.from, dateRange.to);

  const statsMap = new Map<number, RiderStat>();
  if (riderStats) {
    for (const s of riderStats) {
      statsMap.set(s.riderId, s);
    }
  }

  const filtered = riders
    ?.filter(r =>
      r.fullName.toLowerCase().includes(search.toLowerCase()) ||
      r.phoneNumber.includes(search)
    )
    .sort((a, b) => {
      if (a.status === b.status) return 0;
      return a.status === "active" ? -1 : 1;
    });

  const handleStatusToggle = async (rider: RiderRecord) => {
    const newStatus = rider.status === "active" ? "inactive" : "active";
    await updateRider({ id: rider.id, data: { fullName: rider.fullName, phoneNumber: rider.phoneNumber, status: newStatus } });
  };

  return (
    <div>
      <PageHeader 
        title="Rider Management" 
        description="Manage rider profiles, documents, and employment details."
        actions={
          <Button onClick={() => setIsAddOpen(true)}>
            <Plus className="w-4 h-4" /> Add Rider
          </Button>
        }
      />

      <Card className="mb-6 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Search by name or phone..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="premium-input pl-9"
            />
          </div>
          <DateRangeFilter
            dateFrom={dateRange.from}
            dateTo={dateRange.to}
            onChange={(from, to) => setDateRange({ from, to })}
            calendarMode={calendarMode}
            onCalendarModeChange={setCalendarMode}
          />
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
            <tr>
              <th className="px-6 py-4 font-medium">Full Name</th>
              <th className="px-6 py-4 font-medium">Phone Number</th>
              <th className="px-6 py-4 font-medium">License No</th>
              <th className="px-6 py-4 font-medium">Type</th>
              <th className="px-6 py-4 font-medium">Avg Rides/Day</th>
              <th className="px-6 py-4 font-medium">Avg Revenue/Day (रू)</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">Loading riders...</td></tr>
            ) : filtered?.length === 0 ? (
              <tr><td colSpan={8}><EmptyState title="No riders found" description="Add a rider to get started." icon={Users} /></td></tr>
            ) : (
              filtered?.map(r => {
                const stat = statsMap.get(r.id);
                return (
                  <tr key={r.id} className="border-b last:border-0 table-row-hover">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setProfileRider(r as RiderRecord)}
                          className="font-semibold text-primary hover:underline underline-offset-2 text-left transition-colors"
                        >
                          {r.fullName}
                        </button>
                        {(r as RiderRecord).yangoDriverId && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 border border-yellow-300">YANGO</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono">{r.phoneNumber}</td>
                    <td className="px-6 py-4">{r.licenseNumber || '-'}</td>
                    <td className="px-6 py-4 capitalize">{r.employmentType?.replace('_', ' ') || '-'}</td>
                    <td className="px-6 py-4">
                      {statsLoading ? (
                        <span className="text-muted-foreground font-mono">—</span>
                      ) : stat ? (
                        <div className="flex flex-col">
                          <span className="font-mono tabular-nums">{stat.avgRidesPerDay}</span>
                          <GrowthBadge pct={stat.avgRidesGrowth} />
                        </div>
                      ) : (
                        <span className="text-muted-foreground font-mono">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {statsLoading ? (
                        <span className="text-muted-foreground">—</span>
                      ) : stat ? (
                        <Currency amount={stat.avgRevenuePerDay} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4"><StatusBadge status={r.status} /></td>
                    <td className="px-6 py-4 text-right">
                      <DropdownMenu
                        trigger={<button className="p-2 hover:bg-muted rounded-md text-muted-foreground transition-colors"><MoreVertical className="w-4 h-4" /></button>}
                        items={[
                          { label: "Edit", icon: <Pencil className="w-4 h-4" />, onClick: () => setEditingRider(r as RiderRecord) },
                          { label: r.status === "active" ? "Set Inactive" : "Set Active", icon: <ToggleLeft className="w-4 h-4" />, onClick: () => handleStatusToggle(r as RiderRecord) },
                          { label: "Delete", icon: <Trash2 className="w-4 h-4" />, onClick: () => setDeletingRider(r as RiderRecord), variant: "destructive" as const },
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

      <RiderFormModal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} onSubmit={async (data) => {
        await createRider({ data });
        setIsAddOpen(false);
      }} isPending={isCreating} />

      {editingRider && (
        <RiderFormModal
          isOpen={true}
          title="Edit Rider"
          onClose={() => setEditingRider(null)}
          defaultValues={{
            kycSubmissionDate: editingRider.kycSubmissionDate?.split('T')[0] || "",
            fullName: editingRider.fullName,
            phoneNumber: editingRider.phoneNumber,
            secondaryPhone: editingRider.secondaryPhone || "",
            dateOfBirth: editingRider.dateOfBirth?.split('T')[0] || "",
            gender: editingRider.gender || "",
            maritalStatus: editingRider.maritalStatus || "",
            bloodGroup: editingRider.bloodGroup || "",
            permanentAddress: editingRider.permanentAddress || "",
            temporaryAddress: editingRider.temporaryAddress || "",
            address: editingRider.address || "",
            email: editingRider.email || "",
            emergencyContact: editingRider.emergencyContact || "",
            citizenshipNumber: editingRider.citizenshipNumber || "",
            citizenshipIssueDate: editingRider.citizenshipIssueDate?.split('T')[0] || "",
            citizenshipIssueDistrict: editingRider.citizenshipIssueDistrict || "",
            citizenshipImageUrl: editingRider.citizenshipImageUrl || "",
            nidNumber: editingRider.nidNumber || "",
            nidIssueDate: editingRider.nidIssueDate?.split('T')[0] || "",
            nidIssueDistrict: editingRider.nidIssueDistrict || "",
            licenseNumber: editingRider.licenseNumber || "",
            licenseExpiryDate: editingRider.licenseExpiryDate?.split('T')[0] || "",
            licenseIssueDate: editingRider.licenseIssueDate?.split('T')[0] || "",
            licenseIssueDistrict: editingRider.licenseIssueDistrict || "",
            licenseType: editingRider.licenseType || "",
            licenseImageUrl: editingRider.licenseImageUrl || "",
            drivingExperience: editingRider.drivingExperience || "",
            fatherName: editingRider.fatherName || "",
            fatherPhone: editingRider.fatherPhone || "",
            motherName: editingRider.motherName || "",
            motherPhone: editingRider.motherPhone || "",
            spouseName: editingRider.spouseName || "",
            spousePhone: editingRider.spousePhone || "",
            grandfatherName: editingRider.grandfatherName || "",
            grandmotherName: editingRider.grandmotherName || "",
            familyAddress: editingRider.familyAddress || "",
            emergencyContactName: editingRider.emergencyContactName || "",
            emergencyContactPhone: editingRider.emergencyContactPhone || "",
            emergencyContactRelationship: editingRider.emergencyContactRelationship || "",
            relationshipProofUrl: editingRider.relationshipProofUrl || "",
            joiningDate: editingRider.joiningDate?.split('T')[0] || "",
            employmentType: editingRider.employmentType || "full_time",
            salaryStructure: editingRider.salaryStructure || "",
            monthlySalary: editingRider.monthlySalary || "",
            dailyRideTarget: editingRider.dailyRideTarget?.toString() || "",
            assignedSupervisor: editingRider.assignedSupervisor || "",
            securityDeposit: editingRider.securityDeposit || "",
            bankAccountDetails: editingRider.bankAccountDetails || "",
            status: editingRider.status,
            fleetPilot: editingRider.fleetPilot ?? false,
          }}
          onSubmit={async (data) => {
            await updateRider({ id: editingRider.id, data });
            setEditingRider(null);
          }}
          isPending={isUpdating}
        />
      )}

      <ConfirmDialog
        isOpen={!!deletingRider}
        onClose={() => setDeletingRider(null)}
        title="Delete Rider"
        description={`Are you sure you want to delete rider ${deletingRider?.fullName}? This action cannot be undone.`}
        onConfirm={async () => {
          if (deletingRider) {
            await deleteRider({ id: deletingRider.id });
            setDeletingRider(null);
          }
        }}
        isPending={isDeleting}
      />

      {profileRider && (
        <RiderProfileDrawer
          rider={profileRider}
          logs={(allLogs || []) as DailyLogEntry[]}
          onClose={() => setProfileRider(null)}
        />
      )}
    </div>
  );
}

// ─── Rider Profile Drawer ──────────────────────────────────────────────────

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

function DirectYangoIdLink({ onLink, isLinking }: { onLink: (id: string) => void; isLinking: boolean }) {
  const [idInput, setIdInput] = useState("");

  const extractId = (value: string): string => {
    // Accept full URL like fleet.yango.com/contractors/UUID/details or just the UUID
    const match = value.match(/contractors\/([a-f0-9]{32})/i) || value.match(/([a-f0-9]{32})/i);
    return match ? match[1] : value.trim();
  };

  const handleSubmit = () => {
    const id = extractId(idInput);
    if (id) onLink(id);
  };

  return (
    <div className="border-t pt-2 space-y-1.5">
      <p className="text-xs text-muted-foreground font-medium">Or paste the driver's Yango URL / ID directly:</p>
      <div className="flex gap-2">
        <input
          type="text"
          value={idInput}
          onChange={e => setIdInput(e.target.value)}
          placeholder="fleet.yango.com/contractors/abc123... or just the ID"
          className="premium-input text-xs flex-1"
        />
        <button
          onClick={handleSubmit}
          disabled={!idInput.trim() || isLinking}
          className="px-3 py-1.5 text-xs bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors whitespace-nowrap"
        >
          Link
        </button>
      </div>
    </div>
  );
}

interface YangoDriver {
  driver_profile_id: string;
  name: string;
  phones?: string[];
}

interface YangoDriversResponse {
  drivers: YangoDriver[];
  cache: {
    ready: boolean;
    loading: boolean;
    total: number;
    progress: number;
    loadedAt: string | null;
    error: string | null;
  };
}

function RiderProfileDrawer({ rider, logs, onClose }: { rider: RiderRecord; logs: DailyLogEntry[]; onClose: () => void }) {
  const [dateRange, setDateRange] = useState(getDefaultDateRange);
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("AD");
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [showYangoLink, setShowYangoLink] = useState(false);
  const [yangoSearch, setYangoSearch] = useState("");
  const [isLinking, setIsLinking] = useState(false);
  const [linkMsg, setLinkMsg] = useState<string | null>(null);

  const { data: yangoResp, isLoading: driversLoading, error: driversError } = useQuery<YangoDriversResponse>({
    queryKey: ["yango-drivers"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/yango/drivers`, { credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      return json;
    },
    enabled: showYangoLink,
    staleTime: 0,
    retry: 1,
    refetchInterval: (query) => {
      // Keep polling every 5s while cache is still loading
      const data = query.state.data as YangoDriversResponse | undefined;
      return data && !data.cache.ready && data.cache.loading ? 5_000 : false;
    },
  });

  const yangoDrivers = yangoResp?.drivers ?? [];
  const yangoCache = yangoResp?.cache;

  const filteredYangoDrivers = useMemo(() => {
    const q = yangoSearch.toLowerCase();
    if (!q) return [];
    return yangoDrivers.filter(d =>
      d.name.toLowerCase().includes(q) ||
      (d.phones || []).some(p => p.includes(q)) ||
      d.driver_profile_id.includes(q)
    ).slice(0, 50);
  }, [yangoDrivers, yangoSearch]);

  const handleLink = async (driverId: string) => {
    setIsLinking(true);
    setLinkMsg(null);
    try {
      const res = await fetch(`${API_BASE}/yango/riders/${rider.id}/link`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ yangoDriverId: driverId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Link failed");
      queryClient.invalidateQueries({ queryKey: getListRidersQueryKey() });
      setShowYangoLink(false);
      setLinkMsg("Linked successfully");
    } catch (err: unknown) {
      setLinkMsg(err instanceof Error ? err.message : "Link failed");
    } finally {
      setIsLinking(false);
    }
  };

  const handleUnlink = async () => {
    setIsLinking(true);
    setLinkMsg(null);
    try {
      const res = await fetch(`${API_BASE}/yango/riders/${rider.id}/link`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Unlink failed");
      }
      queryClient.invalidateQueries({ queryKey: getListRidersQueryKey() });
      setLinkMsg("Unlinked successfully");
    } catch (err: unknown) {
      setLinkMsg(err instanceof Error ? err.message : "Unlink failed");
    } finally {
      setIsLinking(false);
    }
  };

  const riderLogs = useMemo(() => {
    return logs.filter(l => {
      if (l.riderId !== rider.id) return false;
      const d = l.englishDate?.split("T")[0];
      if (!d) return false;
      if (dateRange.from && d < dateRange.from) return false;
      if (dateRange.to && d > dateRange.to) return false;
      return true;
    });
  }, [logs, rider.id, dateRange.from, dateRange.to]);

  const stats = useMemo(() => {
    const daysWorked = riderLogs.length;
    const totalRidesReceived = riderLogs.reduce((s, l) => s + (l.totalRidesReceived || 0), 0);
    const totalRidesCompleted = riderLogs.reduce((s, l) => s + (l.ridesCompleted || 0), 0);
    const totalIncome = riderLogs.reduce((s, l) => s + parseFloat(l.totalIncome || "0"), 0);
    const totalDistanceKm = riderLogs.reduce((s, l) => s + parseFloat(l.totalRideDistanceKm || "0"), 0);
    const bonusHit = riderLogs.filter(l => l.bonusTargetCompletion === true).length;

    const logsWithRate = riderLogs.filter(l => l.acceptanceRate && parseFloat(l.acceptanceRate) > 0);
    const avgAcceptance = logsWithRate.length > 0
      ? logsWithRate.reduce((s, l) => s + parseFloat(l.acceptanceRate || "0"), 0) / logsWithRate.length
      : 0;

    // Working days in selected range (excluding Saturdays) — used for fleet-productivity averages
    const countWorkingDays = (from: string, to: string): number => {
      const start = new Date(from + "T00:00:00");
      const end = new Date(to + "T00:00:00");
      let count = 0;
      const d = new Date(start);
      while (d <= end) {
        if (d.getDay() !== 6) count++;
        d.setDate(d.getDate() + 1);
      }
      return Math.max(1, count);
    };
    const workingDaysInRange = (dateRange.from && dateRange.to)
      ? countWorkingDays(dateRange.from, dateRange.to)
      : Math.max(1, daysWorked);

    const avgDailyIncome = totalIncome / workingDaysInRange;
    const avgDailyRides = totalRidesCompleted / workingDaysInRange;

    return { daysWorked, totalRidesReceived, totalRidesCompleted, totalIncome, totalDistanceKm, bonusHit, avgAcceptance, avgDailyIncome, avgDailyRides };
  }, [riderLogs, dateRange.from, dateRange.to]);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-background shadow-2xl z-50 flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b bg-gradient-to-r from-primary/5 to-background">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <span className="text-lg font-bold text-primary">{rider.fullName.charAt(0)}</span>
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">{rider.fullName}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <StatusBadge status={rider.status} />
                <span className="text-xs text-muted-foreground capitalize">{rider.employmentType?.replace('_', ' ') || ''}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg text-muted-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">

          {/* Profile Details */}
          <div className="px-6 py-5 space-y-6">

            {/* KYC */}
            {rider.kycSubmissionDate && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="w-4 h-4 text-primary" />
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-primary">KYC</h3>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <InfoRow label="Submission Date" value={rider.kycSubmissionDate?.split('T')[0]} />
                </div>
              </div>
            )}

            {/* Personal Information */}
            <div className={rider.kycSubmissionDate ? "border-t pt-5" : ""}>
              <div className="flex items-center gap-2 mb-3">
                <Phone className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm uppercase tracking-wider text-primary">Personal Information</h3>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <InfoRow label="Phone Number" value={rider.phoneNumber} />
                <InfoRow label="Office Number" value={rider.secondaryPhone} />
                <InfoRow label="Date of Birth" value={rider.dateOfBirth?.split('T')[0]} />
                <InfoRow label="Gender" value={rider.gender} />
                <InfoRow label="Marital Status" value={rider.maritalStatus} />
                <InfoRow label="Blood Group" value={rider.bloodGroup} />
                <InfoRow label="Email" value={rider.email} />
                <InfoRow label="Permanent Address" value={rider.permanentAddress} />
                <InfoRow label="Temporary Address" value={rider.temporaryAddress} />
              </div>
            </div>

            {/* Citizenship */}
            <div className="border-t pt-5">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm uppercase tracking-wider text-primary">Citizenship</h3>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <InfoRow label="Citizenship Number" value={rider.citizenshipNumber} />
                <InfoRow label="Issue Date" value={rider.citizenshipIssueDate?.split('T')[0]} />
                <InfoRow label="Issue District" value={rider.citizenshipIssueDistrict} />
              </div>
              {rider.citizenshipImageUrl && (
                <div className="mt-3">
                  <a href={`${API_BASE}/storage${rider.citizenshipImageUrl}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary border border-primary/20 rounded-lg text-sm font-medium hover:bg-primary/20 transition-colors">
                    <Eye className="w-4 h-4" /> View Citizenship
                  </a>
                </div>
              )}
            </div>

            {/* NID */}
            {(rider.nidNumber || rider.nidIssueDate) && (
              <div className="border-t pt-5">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="w-4 h-4 text-primary" />
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-primary">National Identity Card</h3>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <InfoRow label="NID Number" value={rider.nidNumber} />
                  <InfoRow label="Issue Date" value={rider.nidIssueDate?.split('T')[0]} />
                  <InfoRow label="Issue District" value={rider.nidIssueDistrict} />
                </div>
              </div>
            )}

            {/* License */}
            <div className="border-t pt-5">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm uppercase tracking-wider text-primary">Driving License</h3>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <InfoRow label="License Number" value={rider.licenseNumber} />
                <InfoRow label="License Type" value={rider.licenseType} />
                <InfoRow label="Issue Date" value={rider.licenseIssueDate?.split('T')[0]} />
                <InfoRow label="Issue District" value={rider.licenseIssueDistrict} />
                <InfoRow label="Expiry Date" value={rider.licenseExpiryDate?.split('T')[0]} />
                <InfoRow label="Driving Experience" value={rider.drivingExperience} />
              </div>
              {rider.licenseImageUrl && (
                <div className="mt-3">
                  <a href={`${API_BASE}/storage${rider.licenseImageUrl}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary border border-primary/20 rounded-lg text-sm font-medium hover:bg-primary/20 transition-colors">
                    <Eye className="w-4 h-4" /> View License
                  </a>
                </div>
              )}
            </div>

            {/* Family Details */}
            {(rider.fatherName || rider.motherName || rider.spouseName || rider.grandfatherName) && (
              <div className="border-t pt-5">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-4 h-4 text-primary" />
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-primary">Family Details</h3>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <InfoRow label="Father's Name" value={rider.fatherName} />
                  <InfoRow label="Father's Number" value={rider.fatherPhone} />
                  <InfoRow label="Mother's Name" value={rider.motherName} />
                  <InfoRow label="Mother's Number" value={rider.motherPhone} />
                  <InfoRow label="Spouse Name" value={rider.spouseName} />
                  <InfoRow label="Spouse's Number" value={rider.spousePhone} />
                  <InfoRow label="Grandfather's Name" value={rider.grandfatherName} />
                  <InfoRow label="Grandmother's Name" value={rider.grandmotherName} />
                  {rider.familyAddress && <InfoRow label="Family Address" value={rider.familyAddress} />}
                </div>
              </div>
            )}

            {/* Emergency Contact */}
            {(rider.emergencyContactName || rider.emergencyContact) && (
              <div className="border-t pt-5">
                <div className="flex items-center gap-2 mb-3">
                  <Phone className="w-4 h-4 text-primary" />
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-primary">Emergency Contact</h3>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <InfoRow label="Full Name" value={rider.emergencyContactName || rider.emergencyContact} />
                  <InfoRow label="Number" value={rider.emergencyContactPhone} />
                  <InfoRow label="Relationship" value={rider.emergencyContactRelationship} />
                </div>
                {rider.relationshipProofUrl && (
                  <div className="mt-3">
                    <a href={`${API_BASE}/storage${rider.relationshipProofUrl}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary border border-primary/20 rounded-lg text-sm font-medium hover:bg-primary/20 transition-colors">
                      <Eye className="w-4 h-4" /> View Relationship Proof
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Employment Details */}
            <div className="border-t pt-5">
              <div className="flex items-center gap-2 mb-3">
                <Briefcase className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm uppercase tracking-wider text-primary">Employment Details</h3>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <InfoRow label="Employment Type" value={rider.employmentType?.replace('_', ' ')} />
                <InfoRow label="Joining Date" value={rider.joiningDate?.split('T')[0]} />
                <InfoRow label="Monthly Salary" value={rider.monthlySalary ? `रू ${rider.monthlySalary}` : undefined} />
                <InfoRow label="Salary Structure" value={rider.salaryStructure} />
                <InfoRow label="Daily Ride Target" value={rider.dailyRideTarget} />
                <InfoRow label="Assigned Supervisor" value={rider.assignedSupervisor} />
                <InfoRow label="Security Deposit" value={rider.securityDeposit ? `रू ${rider.securityDeposit}` : undefined} />
                <InfoRow label="Bank Account" value={rider.bankAccountDetails} />
              </div>
            </div>

            {/* Yango Integration */}
            {isAdmin && (
              <div className="border-t pt-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-bold px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 border border-yellow-300">Y</span>
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-primary">Yango Integration</h3>
                </div>
                {rider.yangoDriverId ? (
                  <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-yellow-50 border border-yellow-200">
                    <div>
                      <p className="text-xs text-muted-foreground">Linked Driver ID</p>
                      <p className="text-sm font-mono font-medium">{rider.yangoDriverId}</p>
                    </div>
                    <button
                      onClick={handleUnlink}
                      disabled={isLinking}
                      className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                    >
                      <Unlink className="w-3.5 h-3.5" /> Unlink
                    </button>
                  </div>
                ) : (
                  <div>
                    <button
                      onClick={() => setShowYangoLink(v => !v)}
                      className="flex items-center gap-1.5 text-sm text-primary hover:underline font-medium"
                    >
                      <Link className="w-3.5 h-3.5" /> Link to Yango Driver Profile
                    </button>
                    {showYangoLink && (
                      <div className="mt-3 border rounded-lg p-3 bg-muted/30 space-y-3">
                        {/* Search */}
                        <div className="space-y-1.5">
                          <input
                            type="text"
                            placeholder="Search by name or phone..."
                            value={yangoSearch}
                            onChange={e => setYangoSearch(e.target.value)}
                            className="premium-input text-sm"
                          />
                          {driversLoading && <p className="text-xs text-muted-foreground">Connecting to Yango...</p>}
                          {yangoCache?.loading && !driversLoading && (
                            <p className="text-xs text-amber-600">
                              Loading all drivers from Yango{yangoCache.progress > 0 ? ` (${yangoCache.progress.toLocaleString()} loaded…)` : " — please wait"}
                            </p>
                          )}
                          {yangoCache?.ready && !yangoSearch && (
                            <p className="text-xs text-muted-foreground">{yangoCache.total.toLocaleString()} active drivers — type a name or phone to search</p>
                          )}
                          {driversError && (
                            <p className="text-xs text-destructive">Error: {(driversError as Error).message}</p>
                          )}
                          {!driversLoading && !driversError && yangoSearch && filteredYangoDrivers.length === 0 && (
                            <p className="text-xs text-muted-foreground">No drivers match your search.</p>
                          )}
                          <div className="max-h-40 overflow-y-auto space-y-1">
                            {filteredYangoDrivers.map(d => (
                              <button
                                key={d.driver_profile_id}
                                onClick={() => handleLink(d.driver_profile_id)}
                                disabled={isLinking}
                                className="w-full text-left px-3 py-2 rounded-md hover:bg-primary/10 transition-colors flex items-center justify-between group"
                              >
                                <div>
                                  <p className="text-sm font-medium">{d.name}</p>
                                  {d.phones && d.phones.length > 0 && (
                                    <p className="text-xs text-muted-foreground font-mono">{d.phones[0]}</p>
                                  )}
                                </div>
                                <span className="text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">Select</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Direct ID link */}
                        <DirectYangoIdLink onLink={handleLink} isLinking={isLinking} />
                      </div>
                    )}
                  </div>
                )}
                {linkMsg && <p className="text-xs mt-2 text-muted-foreground">{linkMsg}</p>}
              </div>
            )}

            {/* Performance Section */}
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

              {riderLogs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm bg-muted/30 rounded-xl border">
                  No logs found for the selected date range.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="Days Worked" value={stats.daysWorked} icon={Calendar} />
                  <StatCard label="Rides Received" value={stats.totalRidesReceived} icon={Target} sub={`${stats.totalRidesCompleted} completed`} />
                  <StatCard label="Avg Acceptance" value={`${stats.avgAcceptance.toFixed(1)}%`} icon={TrendingUp} />
                  <StatCard label="Avg Rides/Day" value={stats.avgDailyRides.toFixed(1)} icon={Route} />
                  <StatCard label="Total Income" value={`रू ${stats.totalIncome.toFixed(2)}`} icon={DollarSign} highlight sub={`रू ${stats.avgDailyIncome.toFixed(2)} / day`} />
                  <StatCard label="Total Distance" value={`${stats.totalDistanceKm.toFixed(1)} km`} icon={MapPin} />
                  <StatCard label="Bonus Targets Hit" value={`${stats.bonusHit} / ${stats.daysWorked}`} icon={Target} sub={stats.daysWorked > 0 ? `${((stats.bonusHit / stats.daysWorked) * 100).toFixed(0)}% hit rate` : ''} />
                </div>
              )}
            </div>

            {/* Assignment History */}
            <AssignmentHistory riderId={rider.id} />
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Rider Form Modal ──────────────────────────────────────────────────────

function DocumentUpload({ value, onChange, label = "Upload Document" }: { value: string; onChange: (url: string) => void; label?: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/storage/upload?name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { objectPath } = await res.json();
      onChange(objectPath);
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
        >
          <Upload className="w-4 h-4" />
          {uploading ? "Uploading..." : value ? "Replace" : label}
        </button>
        {value && (
          <a href={`${API_BASE}/storage${value}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm text-primary hover:underline">
            <Eye className="w-3.5 h-3.5" /> View
          </a>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {value && <p className="text-xs text-muted-foreground truncate">Saved: {value.split('/').pop()}</p>}
      <input ref={fileInputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleFileChange} />
    </div>
  );
}

function RiderFormModal({ isOpen, onClose, onSubmit, isPending, title = "Add New Rider", defaultValues }: RiderFormModalProps) {
  const { register, handleSubmit, reset, watch, setValue } = useForm<RiderFormData>({ defaultValues });
  const licenseImageUrl = watch("licenseImageUrl");
  const citizenshipImageUrl = watch("citizenshipImageUrl");
  const relationshipProofUrl = watch("relationshipProofUrl");

  const submit = (data: RiderFormData) => {
    const payload: Record<string, string | number | boolean | undefined> = {
      ...data,
      status: data.status || "active",
      dailyRideTarget: data.dailyRideTarget ? parseInt(data.dailyRideTarget) : undefined,
      // Explicit boolean so unticking the pilot persists false (empty-string cleanup below skips booleans)
      fleetPilot: !!data.fleetPilot,
    };
    Object.keys(payload).forEach((k) => {
      if (payload[k] === "" || payload[k] === undefined) delete payload[k];
    });
    onSubmit(payload);
    reset();
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit(submit)} className="space-y-6">

        {/* KYC */}
        <div className="bg-muted/40 p-4 rounded-xl space-y-4 border">
          <h3 className="font-semibold text-sm text-primary uppercase tracking-wider">KYC</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Date of Submission</label>
              <input type="date" {...register("kycSubmissionDate")} className="premium-input" />
            </div>
          </div>
        </div>

        {/* Personal Information */}
        <div className="bg-muted/40 p-4 rounded-xl space-y-4 border">
          <h3 className="font-semibold text-sm text-primary uppercase tracking-wider">Personal Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Full Name *</label>
              <input {...register("fullName", {required:true})} className="premium-input" placeholder="Ram Bahadur Tamang" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Date of Birth</label>
              <input type="date" {...register("dateOfBirth")} className="premium-input" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Gender</label>
              <select {...register("gender")} className="premium-input bg-white">
                <option value="">Select</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Marital Status</label>
              <select {...register("maritalStatus")} className="premium-input bg-white">
                <option value="">Select</option>
                <option value="single">Single</option>
                <option value="married">Married</option>
                <option value="divorced">Divorced</option>
                <option value="widowed">Widowed</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Blood Group</label>
              <select {...register("bloodGroup")} className="premium-input bg-white">
                <option value="">Select</option>
                {["A+","A-","B+","B-","AB+","AB-","O+","O-"].map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Personal Number *</label>
              <input {...register("phoneNumber", {required:true})} className="premium-input" placeholder="98XXXXXXXX" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Office Number</label>
              <input {...register("secondaryPhone")} className="premium-input" placeholder="98XXXXXXXX" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Email</label>
              <input type="email" {...register("email")} className="premium-input" placeholder="example@email.com" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Permanent Address</label>
              <input {...register("permanentAddress")} className="premium-input" placeholder="Village/Municipality, District" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Temporary Address</label>
              <input {...register("temporaryAddress")} className="premium-input" placeholder="Current address" />
            </div>
          </div>
        </div>

        {/* Citizenship */}
        <div className="bg-muted/40 p-4 rounded-xl space-y-4 border">
          <h3 className="font-semibold text-sm text-primary uppercase tracking-wider">Citizenship</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Citizenship Number</label>
              <input {...register("citizenshipNumber")} className="premium-input" placeholder="27-01-77-12345" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Issue Date</label>
              <input type="date" {...register("citizenshipIssueDate")} className="premium-input" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-sm font-medium">Issue District</label>
              <input {...register("citizenshipIssueDistrict")} className="premium-input" placeholder="e.g. Kathmandu" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Citizenship Image</label>
            <DocumentUpload value={citizenshipImageUrl || ""} onChange={(url) => setValue("citizenshipImageUrl", url)} label="Upload Citizenship" />
            <input type="hidden" {...register("citizenshipImageUrl")} />
          </div>
        </div>

        {/* NID */}
        <div className="bg-muted/40 p-4 rounded-xl space-y-4 border">
          <h3 className="font-semibold text-sm text-primary uppercase tracking-wider">National Identity Card (NID)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">NID Number</label>
              <input {...register("nidNumber")} className="premium-input" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Issue Date</label>
              <input type="date" {...register("nidIssueDate")} className="premium-input" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-sm font-medium">Issue District</label>
              <input {...register("nidIssueDistrict")} className="premium-input" placeholder="e.g. Kathmandu" />
            </div>
          </div>
        </div>

        {/* License */}
        <div className="bg-muted/40 p-4 rounded-xl space-y-4 border">
          <h3 className="font-semibold text-sm text-primary uppercase tracking-wider">Driving License</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">License Number</label>
              <input {...register("licenseNumber")} className="premium-input" placeholder="DL-2024-001234" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">License Type</label>
              <input {...register("licenseType")} className="premium-input" placeholder="e.g. A, B, C" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Issue Date</label>
              <input type="date" {...register("licenseIssueDate")} className="premium-input" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Expiry Date</label>
              <input type="date" {...register("licenseExpiryDate")} className="premium-input" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Issue District</label>
              <input {...register("licenseIssueDistrict")} className="premium-input" placeholder="e.g. Kathmandu" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Driving Experience</label>
              <input {...register("drivingExperience")} className="premium-input" placeholder="e.g. 3 years" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">License Image</label>
            <DocumentUpload value={licenseImageUrl || ""} onChange={(url) => setValue("licenseImageUrl", url)} label="Upload License" />
            <input type="hidden" {...register("licenseImageUrl")} />
          </div>
        </div>

        {/* Family Details */}
        <div className="bg-muted/40 p-4 rounded-xl space-y-4 border">
          <h3 className="font-semibold text-sm text-primary uppercase tracking-wider">Family Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Father's Name</label>
              <input {...register("fatherName")} className="premium-input" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Father's Number</label>
              <input {...register("fatherPhone")} className="premium-input" placeholder="98XXXXXXXX" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Mother's Name</label>
              <input {...register("motherName")} className="premium-input" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Mother's Number</label>
              <input {...register("motherPhone")} className="premium-input" placeholder="98XXXXXXXX" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Spouse Name</label>
              <input {...register("spouseName")} className="premium-input" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Spouse's Number</label>
              <input {...register("spousePhone")} className="premium-input" placeholder="98XXXXXXXX" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Grandfather's Name</label>
              <input {...register("grandfatherName")} className="premium-input" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Grandmother's Name</label>
              <input {...register("grandmotherName")} className="premium-input" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-sm font-medium">Family Address (if different)</label>
              <input {...register("familyAddress")} className="premium-input" placeholder="Village/Municipality, District" />
            </div>
          </div>
        </div>

        {/* Emergency Contact */}
        <div className="bg-muted/40 p-4 rounded-xl space-y-4 border">
          <h3 className="font-semibold text-sm text-primary uppercase tracking-wider">Emergency Contact</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Full Name</label>
              <input {...register("emergencyContactName")} className="premium-input" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Number</label>
              <input {...register("emergencyContactPhone")} className="premium-input" placeholder="98XXXXXXXX" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-sm font-medium">Relationship</label>
              <input {...register("emergencyContactRelationship")} className="premium-input" placeholder="e.g. Father, Spouse" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Relationship Proof</label>
            <DocumentUpload value={relationshipProofUrl || ""} onChange={(url) => setValue("relationshipProofUrl", url)} label="Upload Proof Document" />
            <input type="hidden" {...register("relationshipProofUrl")} />
          </div>
        </div>

        {/* Employment Details */}
        <div className="bg-muted/40 p-4 rounded-xl space-y-4 border">
          <h3 className="font-semibold text-sm text-primary uppercase tracking-wider">Employment Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Employment Type</label>
              <select {...register("employmentType")} className="premium-input bg-white">
                <option value="full_time">Full Time</option>
                <option value="part_time">Part Time</option>
                <option value="contract">Contract</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Joining Date</label>
              <input type="date" {...register("joiningDate")} className="premium-input" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Daily Ride Target</label>
              <input type="number" {...register("dailyRideTarget")} className="premium-input" defaultValue="20" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Monthly Salary (रू)</label>
              <input {...register("monthlySalary")} className="premium-input" placeholder="25000" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Salary Structure</label>
              <input {...register("salaryStructure")} className="premium-input" placeholder="Base + Commission" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Assigned Supervisor</label>
              <input {...register("assignedSupervisor")} className="premium-input" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Security Deposit (रू)</label>
              <input {...register("securityDeposit")} className="premium-input" placeholder="5000" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Bank Account Details</label>
              <input {...register("bankAccountDetails")} className="premium-input" placeholder="Bank Name - A/C No" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Status *</label>
              <select {...register("status")} className="premium-input bg-white">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Fleet App Pilot</label>
              <label className="flex items-center gap-2.5 premium-input bg-amber-50/50 border-amber-200 cursor-pointer">
                <input type="checkbox" {...register("fleetPilot")} className="w-4 h-4 accent-amber-600" />
                <span className="text-sm text-amber-800">Rider uses the Fleet tab in the Riders Club app</span>
              </label>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isPending}>{isPending ? "Saving..." : defaultValues ? "Update Rider" : "Save Rider"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
