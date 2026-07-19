import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetDashboardSummary } from "@workspace/api-client-react";
import { useDailyLogs } from "@/hooks/use-daily-logs";
import { PageHeader, Card, Currency } from "@/components/ui-components";
import { DateRangeFilter, getDefaultDateRange, type CalendarMode } from "@/components/date-range-filter";
import { Car, Users, Zap, Coins, BarChart3, Wallet, Activity, Receipt, Route } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Dot,
} from "recharts";

const API_BASE = `${import.meta.env.BASE_URL}api`;

type FleetStats = {
  totalRides: number;
  totalIncome: string;
  numberOfDays: number;
  activeVehicles: number;
  hasLogs: boolean;
  fleetAvgDailyRides: string | null;
  fleetAvgDailyIncome: string | null;
  fleetAvgDailyDistance: string | null;
  prev: { totalRides: number; totalIncome: string; dateFrom: string; dateTo: string };
  growth: {
    totalRides: number | null;
    totalIncome: number | null;
    avgDailyRides: number | null;
    avgDailyIncome: number | null;
    avgDailyDistance: number | null;
  };
};

function useFleetStats(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: ["fleet-stats", dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/dashboard/fleet-stats?dateFrom=${dateFrom}&dateTo=${dateTo}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch fleet stats");
      return res.json() as Promise<FleetStats>;
    },
    enabled: !!dateFrom && !!dateTo,
  });
}

function GrowthBadge({ pct, prevLabel }: { pct: number | null | undefined; prevLabel?: string }) {
  if (pct === null || pct === undefined) return null;
  const isPos = pct >= 0;
  const isFlat = pct === 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full mt-1 ${
        isFlat
          ? "bg-gray-100 text-gray-500"
          : isPos
          ? "bg-emerald-100 text-emerald-700"
          : "bg-red-100 text-red-600"
      }`}
      title={prevLabel ? `vs. prev period (${prevLabel})` : "vs. previous period"}
    >
      {isFlat ? "=" : isPos ? "↑" : "↓"} {isPos && !isFlat ? "+" : ""}{pct}%
    </span>
  );
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function eachDayInRange(from: string, to: string): string[] {
  const days: string[] = [];
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  const cur = new Date(start);
  while (cur <= end) {
    days.push(toLocalDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export default function Dashboard() {
  const { data: summary, isLoading, error } = useGetDashboardSummary();
  const { data: dailyLogs } = useDailyLogs();

  const [dateRange, setDateRange] = useState(getDefaultDateRange);
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("AD");
  const { data: fleetStats, isLoading: fleetLoading } = useFleetStats(dateRange.from, dateRange.to);

  const chartData = useMemo(() => {
    if (!dateRange.from || !dateRange.to) return [];
    const allDays = eachDayInRange(dateRange.from, dateRange.to);

    const MAX_POINTS = 60;
    const step = allDays.length > MAX_POINTS ? Math.ceil(allDays.length / MAX_POINTS) : 1;
    const sampledDays = allDays.filter((_, i) => i % step === 0 || i === allDays.length - 1);

    return sampledDays.map((dateStr) => {
      const dayLogs = dailyLogs?.filter(
        (l) => l.englishDate.split("T")[0] === dateStr
      );
      const totalIncome = dayLogs?.reduce(
        (sum, l) => sum + parseFloat(l.totalIncome || "0"),
        0
      ) ?? 0;
      return { name: formatShortDate(dateStr), income: totalIncome, date: dateStr };
    });
  }, [dailyLogs, dateRange.from, dateRange.to]);

  const periodLabel = useMemo(() => {
    if (!dateRange.from || !dateRange.to) return "Period";
    const days = eachDayInRange(dateRange.from, dateRange.to).length;
    return `${days}-Day`;
  }, [dateRange.from, dateRange.to]);

  if (isLoading) return <div className="p-8 text-center animate-pulse">Loading dashboard data...</div>;
  if (error || !summary) return <div className="p-8 text-center text-destructive">Failed to load dashboard.</div>;

  const prevLabel = fleetStats?.prev
    ? `${fleetStats.prev.dateFrom} → ${fleetStats.prev.dateTo}`
    : undefined;

  const kpis = [
    {
      label: "Active Vehicles",
      value: `${summary.activeVehicles} / ${summary.totalVehicles}`,
      icon: Car,
      color: "text-blue-600",
      bg: "bg-blue-100",
      growth: null,
    },
    {
      label: "Active Riders",
      value: `${summary.activeRiders} / ${summary.totalRiders}`,
      icon: Users,
      color: "text-indigo-600",
      bg: "bg-indigo-100",
      growth: null,
    },
    {
      label: `Rides (${periodLabel})`,
      value: fleetLoading ? "—" : (fleetStats?.totalRides ?? 0),
      icon: Zap,
      color: "text-amber-600",
      bg: "bg-amber-100",
      growth: fleetStats?.growth?.totalRides ?? null,
    },
    {
      label: `Income (${periodLabel})`,
      value: fleetLoading ? "—" : <Currency amount={fleetStats?.totalIncome ?? "0"} />,
      icon: Coins,
      color: "text-emerald-600",
      bg: "bg-emerald-100",
      growth: fleetStats?.growth?.totalIncome ?? null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Fleet Overview"
        description="Real-time insights and performance metrics for Elebhar FMS."
        actions={
          <DateRangeFilter
            dateFrom={dateRange.from}
            dateTo={dateRange.to}
            onChange={(from, to) => setDateRange({ from, to })}
            calendarMode={calendarMode}
            onCalendarModeChange={setCalendarMode}
          />
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 mb-8">
        {kpis.map((kpi, i) => (
          <Card key={i} className="p-6 hover-elevate transition-all duration-300">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${kpi.bg} ${kpi.color}`}>
                <kpi.icon className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">{kpi.label}</p>
                <p className="text-2xl font-bold text-foreground mt-0.5">{kpi.value}</p>
                <GrowthBadge pct={kpi.growth} prevLabel={prevLabel} />
              </div>
            </div>
          </Card>
        ))}

        <Card className="p-6 hover-elevate transition-all duration-300 border-dashed border-2 border-primary/20 bg-primary/5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-violet-100 text-violet-600">
              <BarChart3 className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Avg Rides / Scooter / Day</p>
              <p className="text-2xl font-bold text-foreground mt-0.5">
                {fleetLoading ? "—" : fleetStats?.fleetAvgDailyRides ?? "—"}
              </p>
              <GrowthBadge pct={fleetStats?.growth?.avgDailyRides} prevLabel={prevLabel} />
            </div>
          </div>
        </Card>

        <Card className="p-6 hover-elevate transition-all duration-300 border-dashed border-2 border-primary/20 bg-primary/5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-teal-100 text-teal-600">
              <Wallet className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Avg Income / Scooter / Day (रू)</p>
              <p className="text-2xl font-bold text-foreground mt-0.5">
                {fleetLoading ? "—" : fleetStats?.fleetAvgDailyIncome
                  ? <Currency amount={fleetStats.fleetAvgDailyIncome} />
                  : "—"}
              </p>
              <GrowthBadge pct={fleetStats?.growth?.avgDailyIncome} prevLabel={prevLabel} />
            </div>
          </div>
        </Card>

        <Card className="p-6 hover-elevate transition-all duration-300 border-dashed border-2 border-primary/20 bg-primary/5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-cyan-100 text-cyan-600">
              <Route className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Avg Distance / Scooter / Day</p>
              <p className="text-2xl font-bold text-foreground mt-0.5">
                {fleetLoading ? "—" : fleetStats?.fleetAvgDailyDistance
                  ? `${fleetStats.fleetAvgDailyDistance} km`
                  : "—"}
              </p>
              <GrowthBadge pct={fleetStats?.growth?.avgDailyDistance} prevLabel={prevLabel} />
            </div>
          </div>
        </Card>

        <Card className="p-6 hover-elevate transition-all duration-300 border-dashed border-2 border-primary/20 bg-primary/5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-orange-100 text-orange-600">
              <Receipt className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Avg Revenue / Rider / Ride (रू)</p>
              <p className="text-2xl font-bold text-foreground mt-0.5">
                {fleetLoading
                  ? "—"
                  : (() => {
                      const rides = fleetStats?.totalRides ?? 0;
                      const income = parseFloat(fleetStats?.totalIncome ?? "0");
                      if (rides === 0 || income === 0) return "—";
                      return <Currency amount={(income / rides).toFixed(2)} />;
                    })()}
              </p>
              {(() => {
                if (fleetLoading || !fleetStats) return null;
                const curRides = fleetStats.totalRides;
                const curIncome = parseFloat(fleetStats.totalIncome ?? "0");
                const prevRides = fleetStats.prev?.totalRides ?? 0;
                const prevIncome = parseFloat(fleetStats.prev?.totalIncome ?? "0");
                if (curRides === 0 || prevRides === 0) return null;
                const cur = curIncome / curRides;
                const prev = prevIncome / prevRides;
                if (prev === 0) return null;
                const pct = Math.round(((cur - prev) / prev) * 100);
                return <GrowthBadge pct={pct} prevLabel={prevLabel} />;
              })()}
            </div>
          </div>
        </Card>
      </div>

      {/* Income Trend Chart — full width */}
      <div className="mb-8">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              <h3 className="font-display font-semibold text-lg">Income Trend (रू)</h3>
            </div>
            <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
              {periodLabel} view
            </span>
          </div>
          <div className="h-96 w-full">
            {chartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                No data in selected range.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#6b7280", fontSize: 12 }}
                    dy={10}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#6b7280", fontSize: 12 }}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: "12px",
                      border: "none",
                      boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                    }}
                    formatter={(value: number) => [
                      `रू ${value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
                      "Income",
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="income"
                    stroke="var(--color-primary)"
                    strokeWidth={2.5}
                    dot={chartData.length <= 14 ? <Dot r={4} fill="var(--color-primary)" stroke="white" strokeWidth={2} /> : false}
                    activeDot={{ r: 6, fill: "var(--color-primary)", stroke: "white", strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
