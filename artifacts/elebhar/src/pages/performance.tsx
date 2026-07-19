import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Card, Currency, EmptyState, Button } from "@/components/ui-components";
import { DateRangeFilter, getDefaultDateRange, type CalendarMode } from "@/components/date-range-filter";
import {
  Trophy, Search, Download, AlertTriangle, Star, TrendingUp,
  TrendingDown, Activity, Users, Target, Percent, Wallet,
  ChevronRight, X, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar,
} from "recharts";

const API_BASE = `${import.meta.env.BASE_URL}api`;

type Tier = "A+" | "A" | "B" | "C" | "D" | "Inactive";

interface RiderPerformance {
  riderId: number;
  riderName: string;
  phoneNumber: string;
  status: string;
  dailyRideTarget: number | null;
  presentDays: number;
  absentDays: number;
  workingDays: number;
  attendanceRate: number;
  totalRidesReceived: number;
  totalRidesCompleted: number;
  avgRidesPerDay: number;
  acceptanceRate: number;
  targetHitDays: number;
  targetMissedDays: number;
  targetHitRate: number;
  totalRevenue: number;
  avgRevenuePerDay: number;
  totalGoalBonus: number;
  totalPromoBonus: number;
  totalDistanceKm: number;
  totalOnlineHours: number;
  cashVarianceDays: number;
  fraudDays: number;
  evaluableDays: number;
  fraudDates: string[];
  tier: Tier;
  flags: string[];
}

interface PerformanceResponse {
  period: { dateFrom: string; dateTo: string; workingDays: number };
  summary: {
    totalRiders: number;
    activeRiders: number;
    avgFleetRidesPerDay: number;
    avgFleetAcceptance: number;
    totalRevenue: number;
    totalRides: number;
  };
  tierDistribution: Record<Tier, number>;
  riders: RiderPerformance[];
}

interface RiderDetailLog {
  id: number;
  englishDate: string;
  nepaliDate: string | null;
  vehiclePlate: string | null;
  totalRidesReceived: number | null;
  ridesCompleted: number | null;
  acceptanceRate: string | null;
  dailyBonusSet: number | null;
  bonusTargetCompletion: boolean | null;
  totalRideDistanceKm: string | null;
  totalAppOnline: string | null;
  totalIncome: string | null;
  goalBonus: string | null;
  promotionBonusOther: string | null;
  cashCheck: string | null;
  isDraft: boolean;
}

interface RiderDetailResponse {
  rider: { id: number; fullName: string; phoneNumber: string; status: string; dailyRideTarget: number | null };
  logs: RiderDetailLog[];
}

const TIER_STYLES: Record<Tier, { label: string; bg: string; text: string; ring: string; emoji: string }> = {
  "A+":       { label: "A+", bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200", emoji: "🥇" },
  "A":        { label: "A",  bg: "bg-blue-50",    text: "text-blue-700",    ring: "ring-blue-200",    emoji: "🥈" },
  "B":        { label: "B",  bg: "bg-amber-50",   text: "text-amber-700",   ring: "ring-amber-200",   emoji: "🥉" },
  "C":        { label: "C",  bg: "bg-orange-50",  text: "text-orange-700",  ring: "ring-orange-200",  emoji: "⚠️" },
  "D":        { label: "D",  bg: "bg-red-50",     text: "text-red-700",     ring: "ring-red-200",     emoji: "🚨" },
  "Inactive": { label: "—",  bg: "bg-slate-100",  text: "text-slate-500",   ring: "ring-slate-200",   emoji: "⏸️" },
};

const FLAG_META: Record<string, { label: string; tone: "danger" | "warn" | "good"; icon: typeof Star }> = {
  fraud_risk:      { label: "Fraud Risk",      tone: "danger", icon: ShieldAlert },
  low_acceptance:  { label: "Low Acceptance",  tone: "danger", icon: AlertTriangle },
  absentee:        { label: "Absentee Risk",   tone: "danger", icon: AlertTriangle },
  volatile:        { label: "Volatile",        tone: "warn",   icon: AlertTriangle },
  cash_discipline: { label: "Cash Variance",   tone: "warn",   icon: AlertTriangle },
  bonus_hunter:    { label: "Bonus Hunter",    tone: "good",   icon: Star },
  high_earner:     { label: "High Earner",     tone: "good",   icon: TrendingUp },
};

type SortKey =
  | "riderName" | "tier" | "presentDays" | "avgRidesPerDay" | "acceptanceRate"
  | "targetHitRate" | "totalRevenue" | "avgRevenuePerDay" | "fraudDays";

export default function PerformancePage() {
  const defaults = getDefaultDateRange();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [calMode, setCalMode] = useState<CalendarMode>("AD");
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<"all" | Tier>("all");
  const [flagFilter, setFlagFilter] = useState<"all" | string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("avgRidesPerDay");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedRiderId, setSelectedRiderId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery<PerformanceResponse>({
    queryKey: ["performance", dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/performance?dateFrom=${dateFrom}&dateTo=${dateTo}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed: ${res.status}`);
      }
      return res.json();
    },
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    let rows = data.riders;
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) => r.riderName.toLowerCase().includes(q) || r.phoneNumber.toLowerCase().includes(q),
      );
    }
    if (tierFilter !== "all") rows = rows.filter((r) => r.tier === tierFilter);
    if (flagFilter !== "all") rows = rows.filter((r) => r.flags.includes(flagFilter));
    rows = [...rows].sort((a, b) => {
      const av = a[sortKey] as number | string;
      const bv = b[sortKey] as number | string;
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "desc" ? bv - av : av - bv;
      }
      const aS = String(av);
      const bS = String(bv);
      return sortDir === "desc" ? bS.localeCompare(aS) : aS.localeCompare(bS);
    });
    return rows;
  }, [data, search, tierFilter, flagFilter, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(sortDir === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const exportCSV = () => {
    if (!filtered.length) return;
    const headers = [
      "Rider", "Phone", "Tier", "Flags", "Present", "Absent", "Working Days",
      "Attendance %", "Total Rides Received", "Total Rides Completed",
      "Avg Rides/Day", "Acceptance %", "Target Hit", "Target Missed",
      "Hit Rate %", "Fraud Days", "Evaluable Days", "Fraud Dates",
      "Total Revenue", "Avg Revenue/Day",
      "Goal Bonus", "Promo Bonus", "Distance (km)", "Online Hours",
    ];
    const rows = filtered.map((r) => [
      r.riderName, r.phoneNumber, r.tier,
      r.flags.map((f) => FLAG_META[f]?.label ?? f).join("; "),
      r.presentDays, r.absentDays, r.workingDays, r.attendanceRate,
      r.totalRidesReceived, r.totalRidesCompleted, r.avgRidesPerDay,
      r.acceptanceRate, r.targetHitDays, r.targetMissedDays, r.targetHitRate,
      r.fraudDays, r.evaluableDays, r.fraudDates.join("; "),
      r.totalRevenue, r.avgRevenuePerDay, r.totalGoalBonus, r.totalPromoBonus,
      r.totalDistanceKm, r.totalOnlineHours,
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rider-performance_${dateFrom}_to_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Rider Performance"
        description="Each rider's productivity, acceptance, attendance and revenue — all derived from saved daily logs."
        actions={
          <Button variant="outline" onClick={exportCSV} disabled={!filtered.length}>
            <Download className="w-4 h-4" /> Export CSV
          </Button>
        }
      />

      {/* Filters */}
      <Card className="p-5 mb-6">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1">
            <DateRangeFilter
              dateFrom={dateFrom}
              dateTo={dateTo}
              onChange={(f, t) => { setDateFrom(f); setDateTo(t); }}
              calendarMode={calMode}
              onCalendarModeChange={setCalMode}
            />
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search rider..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-4 py-2 bg-muted/50 border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value as "all" | Tier)}
              className="px-3 py-2 bg-muted/50 border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="all">All tiers</option>
              <option value="A+">A+ Tier</option>
              <option value="A">A Tier</option>
              <option value="B">B Tier</option>
              <option value="C">C Tier</option>
              <option value="D">D Tier</option>
              <option value="Inactive">Inactive</option>
            </select>
            <select
              value={flagFilter}
              onChange={(e) => setFlagFilter(e.target.value)}
              className="px-3 py-2 bg-muted/50 border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="all">All flags</option>
              {Object.entries(FLAG_META).map(([k, m]) => (
                <option key={k} value={k}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Summary Cards */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <SummaryCard icon={Users} label="Total Riders" value={String(data.summary.totalRiders)} color="slate" />
          <SummaryCard icon={Activity} label="Active Riders" value={String(data.summary.activeRiders)} color="emerald" />
          <SummaryCard icon={Target} label="Avg Rides/Day" value={data.summary.avgFleetRidesPerDay.toFixed(1)} color="blue" />
          <SummaryCard icon={Percent} label="Avg Acceptance" value={`${data.summary.avgFleetAcceptance.toFixed(1)}%`} color="amber" />
          <SummaryCard icon={TrendingUp} label="Total Rides" value={data.summary.totalRides.toLocaleString()} color="indigo" />
          <SummaryCard icon={Wallet} label="Total Revenue" value={`रू ${data.summary.totalRevenue.toLocaleString()}`} color="primary" small />
        </div>
      )}

      {/* Tier Distribution */}
      {data && (
        <Card className="p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-foreground">Tier Distribution</h3>
            <span className="text-xs text-muted-foreground">{data.summary.totalRiders} riders · {data.period.workingDays} working days</span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {(["A+", "A", "B", "C", "D", "Inactive"] as Tier[]).map((t) => {
              const count = data.tierDistribution[t];
              const pct = data.summary.totalRiders > 0 ? (count / data.summary.totalRiders) * 100 : 0;
              const s = TIER_STYLES[t];
              return (
                <div key={t} className={cn("p-3 rounded-xl border", s.bg, s.ring, "ring-1")}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{s.emoji}</span>
                    <span className={cn("font-bold text-sm", s.text)}>{s.label}</span>
                  </div>
                  <div className={cn("text-2xl font-display font-bold", s.text)}>{count}</div>
                  <div className="text-xs text-muted-foreground">{pct.toFixed(0)}%</div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Riders Table */}
      <Card>
        {isLoading ? (
          <div className="p-12 flex items-center justify-center text-muted-foreground">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
            Loading performance data...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-destructive">{(error as Error).message}</div>
        ) : !filtered.length ? (
          <EmptyState
            title="No riders match your filters"
            description="Try widening the date range or clearing the tier/flag filter."
            icon={Trophy}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <SortHeader label="Rider"           keyName="riderName"        sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Tier"            keyName="tier"             sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Flags</th>
                  <SortHeader label="Present"         keyName="presentDays"      sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Absent</th>
                  <SortHeader label="Avg Rides/Day"   keyName="avgRidesPerDay"   sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                  <SortHeader label="Acceptance"      keyName="acceptanceRate"   sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                  <SortHeader label="Target Hit Rate" keyName="targetHitRate"    sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                  <SortHeader label="Fraud Days"      keyName="fraudDays"        sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                  <SortHeader label="Revenue"         keyName="totalRevenue"     sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                  <SortHeader label="Avg Rev/Day"     keyName="avgRevenuePerDay" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                  <th className="px-4 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => (
                  <tr
                    key={r.riderId}
                    onClick={() => setSelectedRiderId(r.riderId)}
                    className="hover:bg-muted/30 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{r.riderName}</div>
                      <div className="text-xs text-muted-foreground">{r.phoneNumber}</div>
                    </td>
                    <td className="px-4 py-3">
                      <TierBadge tier={r.tier} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {r.flags.map((f) => <FlagBadge key={f} flag={f} />)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.presentDays}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{r.absentDays}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">
                      {r.avgRidesPerDay.toFixed(1)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={cn(
                        "font-medium",
                        r.acceptanceRate >= 85 ? "text-emerald-600" :
                        r.acceptanceRate >= 70 ? "text-foreground" :
                        r.presentDays > 0 ? "text-red-600" : "text-muted-foreground",
                      )}>
                        {r.presentDays > 0 ? `${r.acceptanceRate.toFixed(0)}%` : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.presentDays > 0 ? (
                        <span className="text-xs">
                          <span className="font-semibold">{r.targetHitDays}</span>
                          <span className="text-muted-foreground">/{r.presentDays} </span>
                          <span className={cn(
                            "ml-1",
                            r.targetHitRate >= 80 ? "text-emerald-600" :
                            r.targetHitRate >= 60 ? "text-amber-600" : "text-red-600"
                          )}>({r.targetHitRate.toFixed(0)}%)</span>
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-xs">
                      {r.evaluableDays > 0 ? (
                        <span className={cn(
                          "inline-flex items-center gap-1",
                          r.fraudDays === 0 ? "text-muted-foreground" :
                          r.fraudDays / r.evaluableDays >= 0.2 ? "text-red-600 font-semibold" : "text-amber-600 font-medium",
                        )}>
                          {r.fraudDays > 0 && <ShieldAlert className="w-3 h-3" />}
                          {r.fraudDays}<span className="text-muted-foreground">/{r.evaluableDays}</span>
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Currency amount={r.totalRevenue} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Currency amount={r.avgRevenuePerDay} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground"><ChevronRight className="w-4 h-4" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Drawer */}
      {selectedRiderId !== null && (
        <RiderDetailDrawer
          riderId={selectedRiderId}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onClose={() => setSelectedRiderId(null)}
          summary={filtered.find((r) => r.riderId === selectedRiderId)}
        />
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SummaryCard({
  icon: Icon, label, value, color, small,
}: { icon: typeof Users; label: string; value: string; color: string; small?: boolean }) {
  const colors: Record<string, string> = {
    slate: "from-slate-500/10 to-slate-500/5 text-slate-700",
    emerald: "from-emerald-500/10 to-emerald-500/5 text-emerald-700",
    blue: "from-blue-500/10 to-blue-500/5 text-blue-700",
    amber: "from-amber-500/10 to-amber-500/5 text-amber-700",
    indigo: "from-indigo-500/10 to-indigo-500/5 text-indigo-700",
    primary: "from-primary/10 to-primary/5 text-primary",
  };
  return (
    <Card className={cn("p-4 bg-gradient-to-br border-0", colors[color])}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 opacity-70" />
        <span className="text-xs font-medium opacity-80">{label}</span>
      </div>
      <div className={cn("font-display font-bold tabular-nums", small ? "text-base" : "text-2xl")}>{value}</div>
    </Card>
  );
}

function TierBadge({ tier }: { tier: Tier }) {
  const s = TIER_STYLES[tier];
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ring-1",
      s.bg, s.text, s.ring,
    )}>
      <span>{s.emoji}</span>
      <span>{s.label}</span>
    </span>
  );
}

function FlagBadge({ flag }: { flag: string }) {
  const meta = FLAG_META[flag];
  if (!meta) return null;
  const tones = {
    danger: "bg-red-50 text-red-700 ring-red-200",
    warn: "bg-amber-50 text-amber-700 ring-amber-200",
    good: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  };
  const Icon = meta.icon;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium ring-1",
      tones[meta.tone],
    )} title={meta.label}>
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
}

function SortHeader({
  label, keyName, sortKey, sortDir, onSort, align = "left",
}: {
  label: string; keyName: SortKey; sortKey: SortKey; sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void; align?: "left" | "right";
}) {
  const active = sortKey === keyName;
  return (
    <th
      onClick={() => onSort(keyName)}
      className={cn(
        "px-4 py-3 font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (sortDir === "desc" ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />)}
      </span>
    </th>
  );
}

function RiderDetailDrawer({
  riderId, dateFrom, dateTo, onClose, summary,
}: {
  riderId: number; dateFrom: string; dateTo: string; onClose: () => void;
  summary: RiderPerformance | undefined;
}) {
  const { data, isLoading } = useQuery<RiderDetailResponse>({
    queryKey: ["performance-rider", riderId, dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/performance/rider/${riderId}?dateFrom=${dateFrom}&dateTo=${dateTo}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load rider details");
      return res.json();
    },
  });

  // Build chart data — chronological
  const chartData = useMemo(() => {
    if (!data) return [];
    return [...data.logs]
      .filter((l) => !l.isDraft)
      .reverse()
      .map((l) => ({
        date: l.englishDate.slice(5),
        rides: l.ridesCompleted ?? 0,
        target: l.dailyBonusSet ?? 0,
        revenue: parseFloat(l.totalIncome ?? "0"),
        acceptance: parseFloat(l.acceptanceRate ?? "0"),
      }));
  }, [data]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl bg-background h-full overflow-y-auto shadow-2xl animate-in slide-in-from-right duration-200">
        <div className="sticky top-0 bg-background z-10 px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-xl font-display font-bold">{summary?.riderName ?? "Rider"}</h2>
            <p className="text-xs text-muted-foreground">{summary?.phoneNumber}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Summary chips */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <DetailStat label="Tier" value={<TierBadge tier={summary.tier} />} />
              <DetailStat label="Avg Rides/Day" value={<span className="text-2xl font-display font-bold">{summary.avgRidesPerDay.toFixed(1)}</span>} />
              <DetailStat label="Acceptance"
                value={<span className={cn(
                  "text-2xl font-display font-bold",
                  summary.acceptanceRate >= 85 ? "text-emerald-600" :
                  summary.acceptanceRate >= 70 ? "" : summary.presentDays > 0 ? "text-red-600" : "text-muted-foreground",
                )}>{summary.presentDays > 0 ? `${summary.acceptanceRate.toFixed(0)}%` : "—"}</span>} />
              <DetailStat label="Hit Rate" value={
                <span className="text-2xl font-display font-bold">
                  {summary.presentDays > 0 ? `${summary.targetHitRate.toFixed(0)}%` : "—"}
                </span>
              } sub={summary.presentDays > 0 ? `${summary.targetHitDays}/${summary.presentDays} days` : undefined} />
              <DetailStat label="Present Days" value={<span className="text-2xl font-display font-bold">{summary.presentDays}</span>} sub={`of ${summary.workingDays} working days`} />
              <DetailStat label="Absent Days" value={<span className="text-2xl font-display font-bold text-orange-600">{summary.absentDays}</span>} />
              <DetailStat label="Total Revenue" value={<span className="text-lg font-display font-bold"><Currency amount={summary.totalRevenue} /></span>} sub={`Avg रू ${summary.avgRevenuePerDay.toFixed(0)}/day`} />
              <DetailStat label="Online Hours" value={<span className="text-2xl font-display font-bold">{summary.totalOnlineHours.toFixed(0)}h</span>} sub={`${summary.totalDistanceKm.toFixed(0)} km`} />
              <DetailStat
                label="Suspect Fraud Days"
                value={
                  summary.evaluableDays > 0 ? (
                    <span className={cn(
                      "inline-flex items-center gap-1 text-2xl font-display font-bold",
                      summary.fraudDays === 0 ? "text-emerald-600" :
                      summary.fraudDays / summary.evaluableDays >= 0.2 ? "text-red-600" : "text-amber-600",
                    )}>
                      {summary.fraudDays > 0 && <ShieldAlert className="w-5 h-5" />}
                      {summary.fraudDays}
                    </span>
                  ) : <span className="text-muted-foreground text-sm">No evaluable days</span>
                }
                sub={summary.evaluableDays > 0 ? `of ${summary.evaluableDays} evaluable days` : "Yango did not set a target"}
              />
            </div>
          )}

          {/* Flags */}
          {summary && summary.flags.length > 0 && (
            <Card className="p-4">
              <h3 className="font-display font-semibold text-sm mb-2">Coaching Flags</h3>
              <div className="flex flex-wrap gap-2">
                {summary.flags.map((f) => <FlagBadge key={f} flag={f} />)}
              </div>
            </Card>
          )}

          {/* Charts */}
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading…</div>
          ) : chartData.length === 0 ? (
            <Card className="p-8">
              <EmptyState title="No log data" description="No daily logs were saved for this rider in the selected period." icon={Trophy} />
            </Card>
          ) : (
            <>
              <Card className="p-4">
                <h3 className="font-display font-semibold text-sm mb-3">Rides — Daily Trend</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="rides" fill="#3b82f6" name="Rides Completed" />
                    <Bar dataKey="target" fill="#94a3b8" name="Target (Yango Bonus)" />
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card className="p-4">
                <h3 className="font-display font-semibold text-sm mb-3">Acceptance Rate Trend</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                    <Line type="monotone" dataKey="acceptance" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} name="Acceptance %" />
                  </LineChart>
                </ResponsiveContainer>
              </Card>

              <Card className="p-4">
                <h3 className="font-display font-semibold text-sm mb-3">Revenue Per Day</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => `रू ${v.toLocaleString()}`} />
                    <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} name="Revenue" />
                  </LineChart>
                </ResponsiveContainer>
              </Card>

              {/* Per-day table */}
              <Card>
                <div className="px-4 py-3 border-b">
                  <h3 className="font-display font-semibold text-sm">Daily Breakdown</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Date</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Rides</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Acc.</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Target</th>
                        <th className="px-3 py-2 text-center font-medium text-muted-foreground">Hit?</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data?.logs.filter((l) => !l.isDraft).map((l) => {
                        const target = l.dailyBonusSet ?? 0;
                        const rides = l.ridesCompleted ?? 0;
                        const goalBonusNum = parseFloat(l.goalBonus ?? "0") || 0;
                        const isFraud = target > 0 && rides >= target && goalBonusNum === 0;
                        return (
                          <tr key={l.id} className={cn(isFraud && "bg-red-50/40")}>
                            <td className="px-3 py-2 font-medium">{l.englishDate}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {rides}<span className="text-muted-foreground">/{l.totalRidesReceived ?? 0}</span>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{l.acceptanceRate ?? "—"}%</td>
                            <td className="px-3 py-2 text-right tabular-nums">{l.dailyBonusSet ?? "—"}</td>
                            <td className="px-3 py-2 text-center">
                              {isFraud ? (
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-red-100 text-red-700 ring-1 ring-red-200"
                                  title="Hit target but Yango paid no goal bonus — likely disqualified rides"
                                >
                                  <ShieldAlert className="w-3 h-3" />
                                  SUSPECT
                                </span>
                              ) : l.bonusTargetCompletion === true ? (
                                <span className="text-emerald-600">✓</span>
                              ) : l.bonusTargetCompletion === false ? (
                                <span className="text-red-600">✗</span>
                              ) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-3 py-2 text-right"><Currency amount={l.totalIncome} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailStat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </Card>
  );
}
