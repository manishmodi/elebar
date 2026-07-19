import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import type { Expense, FleetStats, MaintenanceRecord, Paginated, PerformanceResponse, SalaryPayment } from "@/lib/types";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { Currency } from "@/components/Currency";
import { daysAgoISO, formatCurrency, todayISO } from "@/lib/format";

const COLORS = ["#2f3f96", "#0d9488", "#d97706", "#dc2626", "#64748b"];

export function Financials() {
  const [range, setRange] = useState<DateRange>({ date_from: daysAgoISO(29), date_to: todayISO() });

  const statsQuery = useQuery({
    queryKey: ["financials", "fleet-stats", range],
    queryFn: () => api.get<FleetStats>("/api/dashboard/fleet-stats/", range),
  });

  const salaryHistoryQuery = useQuery({
    queryKey: ["financials", "salary-history"],
    queryFn: () => api.get<SalaryPayment[]>("/api/salary/history/"),
  });

  const maintenanceQuery = useQuery({
    queryKey: ["financials", "maintenance"],
    queryFn: () => api.get<Paginated<MaintenanceRecord>>("/api/maintenance/", { page_size: 100 }),
  });

  const expensesQuery = useQuery({
    queryKey: ["financials", "expenses", range],
    queryFn: () => api.get<Paginated<Expense>>("/api/expenses/", { ...range, page_size: 100 }),
  });

  const performanceQuery = useQuery({
    queryKey: ["financials", "performance", range],
    queryFn: () => api.get<PerformanceResponse>("/api/performance/", range),
  });

  const inRange = (date: string) => date >= range.date_from && date <= range.date_to;

  const salaryCost = useMemo(
    () =>
      (salaryHistoryQuery.data ?? [])
        .filter((p) => p.period_from <= range.date_to && p.period_to >= range.date_from)
        .reduce((sum, p) => sum + parseFloat(p.salary_processed || "0"), 0),
    [salaryHistoryQuery.data, range],
  );

  const maintenanceCost = useMemo(
    () =>
      (maintenanceQuery.data?.results ?? [])
        .filter((m) => inRange(m.date))
        .reduce((sum, m) => sum + parseFloat(m.cost || "0"), 0),
    [maintenanceQuery.data, range],
  );

  const expenseCost = useMemo(
    () => (expensesQuery.data?.results ?? []).reduce((sum, e) => sum + parseFloat(e.amount || "0"), 0),
    [expensesQuery.data],
  );

  const revenue = statsQuery.data?.total_income ?? 0;
  const totalCost = salaryCost + maintenanceCost + expenseCost;
  const netProfit = revenue - totalCost;

  const costBreakdown = [
    { name: "Salaries", value: salaryCost },
    { name: "Maintenance", value: maintenanceCost },
    { name: "Expenses", value: expenseCost },
  ].filter((c) => c.value > 0);

  const topRiders = useMemo(
    () =>
      (performanceQuery.data?.riders ?? [])
        .slice()
        .sort((a, b) => b.total_revenue - a.total_revenue)
        .slice(0, 10),
    [performanceQuery.data],
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Financials</h1>
          <p className="page-subtitle">Profit &amp; loss overview across the selected period.</p>
        </div>
      </div>

      <div className="toolbar">
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Revenue</div>
          <div className="kpi-value"><Currency value={revenue} /></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Total costs</div>
          <div className="kpi-value"><Currency value={totalCost} /></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Net profit</div>
          <div className={`kpi-value ${netProfit >= 0 ? "text-success" : "text-danger"}`}><Currency value={netProfit} /></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Salary cost</div>
          <div className="kpi-value"><Currency value={salaryCost} /></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Maintenance cost</div>
          <div className="kpi-value"><Currency value={maintenanceCost} /></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Other expenses</div>
          <div className="kpi-value"><Currency value={expenseCost} /></div>
        </div>
      </div>

      <div className="grid-2">
        <div className="chart-card">
          <h3>Cost breakdown</h3>
          <div style={{ width: "100%", height: 280 }}>
            {costBreakdown.length === 0 ? (
              <p className="text-muted">No cost data for this range.</p>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={costBreakdown} dataKey="value" nameKey="name" outerRadius={100} label={(d: { name: string; value: number }) => `${d.name}: ${formatCurrency(d.value)}`}>
                    {costBreakdown.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <div className="chart-card">
          <h3>Top riders by income</h3>
          <div style={{ width: "100%", height: 280 }}>
            {topRiders.length === 0 ? (
              <p className="text-muted">No performance data for this range.</p>
            ) : (
              <ResponsiveContainer>
                <BarChart data={topRiders} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e3e7f0" />
                  <XAxis type="number" fontSize={11} />
                  <YAxis type="category" dataKey="rider_name" width={110} fontSize={11} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="total_revenue" fill="#0d9488" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
