import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import type { PerformanceDayRow, PerformanceResponse, PerformanceRow, Tier } from "@/lib/types";
import { DataTable, type Column } from "@/components/DataTable";
import { Modal } from "@/components/Modal";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { Currency } from "@/components/Currency";
import { formatDate, daysAgoISO, todayISO } from "@/lib/format";

const TIER_TONE: Record<string, string> = {
  "A+": "badge-success",
  A: "badge-success",
  B: "badge-info",
  C: "badge-warning",
  D: "badge-danger",
  Inactive: "badge-neutral",
};

type SortKey = "total_revenue" | "total_rides";

export function Performance() {
  const [range, setRange] = useState<DateRange>({ date_from: daysAgoISO(29), date_to: todayISO() });
  const [sortKey, setSortKey] = useState<SortKey>("total_revenue");
  const [selectedRider, setSelectedRider] = useState<PerformanceRow | null>(null);

  const perfQuery = useQuery({
    queryKey: ["performance", range],
    queryFn: () => api.get<PerformanceResponse>("/api/performance/", range),
  });

  const detailQuery = useQuery({
    queryKey: ["performance", "rider", selectedRider?.rider, range],
    queryFn: () => api.get<PerformanceDayRow[]>(`/api/performance/rider/${selectedRider?.rider}/`, range),
    enabled: Boolean(selectedRider),
  });

  const sortedRiders = useMemo(() => {
    const rows = perfQuery.data?.riders ?? [];
    return rows.slice().sort((a, b) => b[sortKey] - a[sortKey]);
  }, [perfQuery.data, sortKey]);

  const columns: Column<PerformanceRow>[] = [
    { key: "rider_name", header: "Rider", render: (r) => r.rider_name },
    { key: "tier", header: "Tier", render: (r) => <span className={`badge ${TIER_TONE[r.tier] ?? "badge-neutral"}`}>{r.tier}</span> },
    { key: "days", header: "Days", render: (r) => r.days },
    { key: "total_rides", header: "Total rides", render: (r) => r.total_rides },
    { key: "total_revenue", header: "Total revenue", render: (r) => <Currency value={r.total_revenue} /> },
    { key: "avg_rides_per_day", header: "Avg rides/day", render: (r) => r.avg_rides_per_day.toFixed(1) },
    { key: "avg_revenue_per_day", header: "Avg revenue/day", render: (r) => <Currency value={r.avg_revenue_per_day} /> },
    // both are null when the rider has no acceptance data / target days
    { key: "avg_acceptance", header: "Acceptance", render: (r) => (r.avg_acceptance != null ? `${r.avg_acceptance.toFixed(1)}%` : "—") },
    { key: "target_hit_rate", header: "Target hit rate", render: (r) => (r.target_hit_rate != null ? `${r.target_hit_rate.toFixed(1)}%` : "—") },
    {
      key: "flags",
      header: "Flags",
      render: (r) => (r.flags.length ? r.flags.map((f) => <span className="chip" key={f}>{f}</span>) : <span className="text-muted">-</span>),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Performance</h1>
          <p className="page-subtitle">Rider leaderboard, tiering, and behavioral flags.</p>
        </div>
      </div>

      <div className="toolbar">
        <DateRangeFilter value={range} onChange={setRange} />
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          <option value="total_revenue">Sort by revenue</option>
          <option value="total_rides">Sort by rides</option>
        </select>
      </div>

      {perfQuery.data && (
        <div className="kpi-grid">
          {Object.entries(perfQuery.data.tier_distribution).map(([tier, count]) => (
            <div className="kpi-card" key={tier}>
              <div className="kpi-label">Tier {tier}</div>
              <div className="kpi-value">{count}</div>
            </div>
          ))}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={sortedRiders}
        loading={perfQuery.isLoading}
        rowKey={(r) => r.rider}
        onRowClick={(r) => setSelectedRider(r)}
      />

      <Modal
        open={Boolean(selectedRider)}
        title={`Performance detail — ${selectedRider?.rider_name ?? ""}`}
        onClose={() => setSelectedRider(null)}
        wide
      >
        {detailQuery.isLoading ? (
          <p className="text-muted">Loading…</p>
        ) : (
          <>
            <div className="grid-2">
              <div>
                <h3 style={{ marginBottom: 10, fontSize: 13 }}>Rides completed vs target</h3>
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer>
                    <BarChart data={detailQuery.data ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e3e7f0" />
                      <XAxis dataKey="date" tickFormatter={(v: string) => formatDate(v)} fontSize={10} />
                      <YAxis fontSize={11} />
                      <Tooltip labelFormatter={(v) => formatDate(String(v))} />
                      <Bar dataKey="rides_completed" fill="#2f3f96" name="Completed" />
                      <Bar dataKey="target" fill="#0d9488" name="Target" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <h3 style={{ marginBottom: 10, fontSize: 13 }}>Income per day</h3>
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer>
                    <LineChart data={detailQuery.data ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e3e7f0" />
                      <XAxis dataKey="date" tickFormatter={(v: string) => formatDate(v)} fontSize={10} />
                      <YAxis fontSize={11} />
                      <Tooltip labelFormatter={(v) => formatDate(String(v))} formatter={(v: number) => [`Rs ${v}`, "Income"]} />
                      <Line type="monotone" dataKey="income" stroke="#2f3f96" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
