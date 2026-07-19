import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import type { DashboardSummary, FleetStats } from "@/lib/types";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { formatCurrency, formatDate, daysAgoISO, todayISO } from "@/lib/format";

export function Dashboard() {
  const [range, setRange] = useState<DateRange>({ date_from: daysAgoISO(29), date_to: todayISO() });

  const summaryQuery = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: () => api.get<DashboardSummary>("/api/dashboard/summary/"),
  });

  const statsQuery = useQuery({
    queryKey: ["dashboard-fleet-stats", range],
    queryFn: () => api.get<FleetStats>("/api/dashboard/fleet-stats/", range),
  });

  const summary = summaryQuery.data;
  const stats = statsQuery.data;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Fleet-wide operational overview.</p>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Vehicles</div>
          <div className="kpi-value">{summary?.vehicles.total ?? "-"}</div>
          <div className="kpi-sub">
            {summary?.vehicles.active ?? 0} active &middot; {summary?.vehicles.maintenance ?? 0} in service
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Riders</div>
          <div className="kpi-value">{summary?.riders.total ?? "-"}</div>
          <div className="kpi-sub">{summary?.riders.active ?? 0} active</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Today&apos;s Rides</div>
          <div className="kpi-value">{summary?.today.rides ?? "-"}</div>
          <div className="kpi-sub">{formatCurrency(summary?.today.income)} income</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">This Month</div>
          <div className="kpi-value">{summary?.month.rides ?? "-"}</div>
          <div className="kpi-sub">{formatCurrency(summary?.month.income)} income</div>
        </div>
      </div>

      <div className="chart-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <h3>Daily income trend</h3>
          <DateRangeFilter value={range} onChange={setRange} />
        </div>
        {/* each metric is null when the previous period has no baseline */}
        {stats?.growth && (stats.growth.income != null || stats.growth.rides != null) && (
          <p className="kpi-sub" style={{ marginBottom: 10 }}>
            {stats.growth.income != null && (
              <>
                Income growth:{" "}
                <strong className={stats.growth.income >= 0 ? "text-success" : "text-danger"}>
                  {stats.growth.income >= 0 ? "+" : ""}
                  {stats.growth.income.toFixed(1)}%
                </strong>
              </>
            )}
            {stats.growth.income != null && stats.growth.rides != null && <> &middot; </>}
            {stats.growth.rides != null && (
              <>
                Rides growth:{" "}
                <strong className={stats.growth.rides >= 0 ? "text-success" : "text-danger"}>
                  {stats.growth.rides >= 0 ? "+" : ""}
                  {stats.growth.rides.toFixed(1)}%
                </strong>
              </>
            )}
          </p>
        )}
        <div style={{ width: "100%", height: 320 }}>
          {statsQuery.isLoading ? (
            <p className="text-muted">Loading chart…</p>
          ) : (
            <ResponsiveContainer>
              <LineChart data={stats?.daily ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e3e7f0" />
                <XAxis dataKey="english_date" tickFormatter={(v: string) => formatDate(v)} fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip
                  labelFormatter={(v) => formatDate(String(v))}
                  formatter={(value: number, name: string) =>
                    name === "income" ? [formatCurrency(value), "Income"] : [value, "Rides"]
                  }
                />
                <Line type="monotone" dataKey="income" stroke="#2f3f96" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="rides" stroke="#0d9488" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        <p className="kpi-sub">
          Total: {stats?.total_rides ?? 0} rides &middot; {formatCurrency(stats?.total_income)} over {stats?.days ?? 0} days
        </p>
      </div>
    </div>
  );
}
