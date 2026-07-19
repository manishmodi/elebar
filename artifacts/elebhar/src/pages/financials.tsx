import { useDailyLogs } from "@/hooks/use-daily-logs";
import { useMaintenance } from "@/hooks/use-maintenance";
import { PageHeader, Card, Currency } from "@/components/ui-components";
import {
  DollarSign, TrendingUp, TrendingDown, Wallet,
  ArrowUpRight, ArrowDownRight, Users, CalendarDays,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

const API_BASE = `${import.meta.env.BASE_URL}api`;

// ─── Hooks ─────────────────────────────────────────────────────────────────

function useSalaryPayments() {
  return useQuery({
    queryKey: ["salary-history"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/salary/history`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch salary history");
      return res.json() as Promise<SalaryPaymentRecord[]>;
    },
  });
}

interface ExpenseRecord { id: number; date: string; amount: string; categoryName?: string | null; }

function useExpenses() {
  return useQuery<ExpenseRecord[]>({
    queryKey: ["expenses"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/expenses`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch expenses");
      return res.json();
    },
  });
}

interface SalaryPaymentRecord {
  id: number;
  riderId: number;
  riderName: string;
  periodFrom: string;
  periodTo: string;
  baseSalary: string;
  totalAllowances: string;
  totalAdvances: string;
  totalCashVariance: string;
  finalSalary: string;
  salaryProcessed?: string | null;
  processedAt: string;
}

// ─── Date helpers ──────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getDefaultRange() {
  const now = new Date();
  return {
    from: toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toDateStr(now),
  };
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function Financials() {
  const { data: logs } = useDailyLogs();
  const { data: maintenance } = useMaintenance();
  const { data: salaryPayments } = useSalaryPayments();
  const { data: expenses } = useExpenses();

  const [dateFrom, setDateFrom] = useState(getDefaultRange().from);
  const [dateTo, setDateTo]     = useState(getDefaultRange().to);

  const setQuick = (mode: "week" | "month" | "all") => {
    const now = new Date();
    if (mode === "week") {
      const from = new Date(now);
      from.setDate(from.getDate() - 6);
      setDateFrom(toDateStr(from));
      setDateTo(toDateStr(now));
    } else if (mode === "month") {
      setDateFrom(toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)));
      setDateTo(toDateStr(now));
    } else {
      setDateFrom("2000-01-01");
      setDateTo(toDateStr(now));
    }
  };

  const financials = useMemo(() => {
    if (!logs || !maintenance) return null;

    // ── Filter each dataset by the selected date range ──────────────────
    const filteredLogs = logs.filter(l => l.englishDate >= dateFrom && l.englishDate <= dateTo);

    const filteredMaintenance = maintenance.filter((m: { date: string }) =>
      (m.date ?? "") >= dateFrom && (m.date ?? "") <= dateTo
    );

    // Salary payments: include any payment whose pay period overlaps the selected date range.
    // This ensures salary for e.g. Mar 2–Apr 1 appears in March/April financials, not just on the day it was processed.
    const filteredPayments = (salaryPayments ?? []).filter(p =>
      p.periodFrom <= dateTo && p.periodTo >= dateFrom
    );

    // ── Revenue (from daily logs) ────────────────────────────────────────
    const totalRevenue          = filteredLogs.reduce((s, l) => s + parseFloat(l.totalIncome        || "0"), 0);
    const totalCashApp          = filteredLogs.reduce((s, l) => s + parseFloat(l.cashAsPerApp       || "0"), 0);
    const totalDriverCash       = filteredLogs.reduce((s, l) => s + parseFloat(l.cashGivenByDriver  || "0"), 0);
    const totalOnlineXfer       = filteredLogs.reduce((s, l) => s + parseFloat(l.cashTransferredOnline || "0"), 0);
    const totalGoalBonus        = filteredLogs.reduce((s, l) => s + parseFloat(l.goalBonus          || "0"), 0);
    const totalPromoBonus       = filteredLogs.reduce((s, l) => s + parseFloat(l.promotionBonusOther || "0"), 0);
    // ── Salary (from processed salary payments) ──────────────────────────
    // Using salaryProcessed (what was actually paid) instead of finalSalary
    const totalSalaryPaid       = filteredPayments.reduce((s, p) => s + parseFloat(p.salaryProcessed ?? p.finalSalary ?? "0"), 0);
    const totalCashVariance     = filteredPayments.reduce((s, p) => s + parseFloat(p.totalCashVariance || "0"), 0);
    const totalAdvancesDeducted = filteredPayments.reduce((s, p) => s + parseFloat(p.totalAdvances    || "0"), 0);
    const totalAllowancesPaid   = filteredPayments.reduce((s, p) => s + parseFloat(p.totalAllowances  || "0"), 0);
    const paymentCount          = filteredPayments.length;

    // ── Costs ────────────────────────────────────────────────────────────
    const totalMaintenanceCost  = filteredMaintenance.reduce((s: number, m: { cost?: string }) =>
      s + parseFloat(m.cost || "0"), 0);

    const filteredExpenses = (expenses ?? []).filter(e => e.date >= dateFrom && e.date <= dateTo);
    const totalOperationalExpenses = filteredExpenses.reduce((s, e) => s + parseFloat(e.amount || "0"), 0);

    // ── Gross Profit ─────────────────────────────────────────────────────
    // Revenue − Salaries Paid − Maintenance − Operational Expenses
    // (Cash variance is already baked into salaryProcessed so not double-counted)
    const grossProfit = totalRevenue - totalSalaryPaid - totalMaintenanceCost - totalOperationalExpenses;

    // ── Charts ───────────────────────────────────────────────────────────
    const riderEarnings: Record<string, number> = {};
    filteredLogs.forEach(l => {
      const name = l.riderName || `Rider #${l.riderId}`;
      riderEarnings[name] = (riderEarnings[name] || 0) + parseFloat(l.totalIncome || "0");
    });
    const topRiders = Object.entries(riderEarnings)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, earnings]) => ({ name: name.split(" ")[0], earnings }));

    const cashBreakdown = [
      { name: "Driver Cash",      value: totalDriverCash, color: "#3b82f6" },
      { name: "Online Transfer",  value: totalOnlineXfer, color: "#10b981" },
    ].filter(c => c.value > 0);

    return {
      totalRevenue, totalCashApp, totalDriverCash, totalOnlineXfer,
      totalGoalBonus, totalPromoBonus,
      totalSalaryPaid, totalCashVariance, totalAdvancesDeducted, totalAllowancesPaid,
      paymentCount, totalMaintenanceCost, totalOperationalExpenses, grossProfit,
      topRiders, cashBreakdown,
      logCount: filteredLogs.length,
    };
  }, [logs, maintenance, salaryPayments, expenses, dateFrom, dateTo]);

  const isProfit = (financials?.grossProfit ?? 0) >= 0;

  return (
    <div>
      <PageHeader
        title="Financial Management"
        description="Revenue, salary costs, maintenance, and gross profit."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Quick filters */}
            <div className="flex items-center gap-1 bg-muted rounded-xl p-1">
              {(["week", "month", "all"] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setQuick(p)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all text-muted-foreground hover:text-foreground hover:bg-white/60"
                >
                  {p === "week" ? "This Week" : p === "month" ? "This Month" : "All Time"}
                </button>
              ))}
            </div>

            {/* Custom date range */}
            <div className="flex items-center gap-1.5 bg-background border rounded-xl px-3 py-1.5">
              <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="text-xs bg-transparent outline-none w-28 tabular-nums text-foreground"
              />
              <span className="text-muted-foreground text-xs">→</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="text-xs bg-transparent outline-none w-28 tabular-nums text-foreground"
              />
            </div>
          </div>
        }
      />

      {!financials ? (
        <p className="text-muted-foreground">Loading financial data...</p>
      ) : (
        <>
          {/* ── KPI cards ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <MetricCard
              label="Total Revenue"
              value={financials.totalRevenue}
              icon={<DollarSign className="w-5 h-5" />}
              color="emerald"
              subtitle={`${financials.logCount} log entries`}
            />
            <MetricCard
              label="Salaries Paid"
              value={financials.totalSalaryPaid}
              icon={<Users className="w-5 h-5" />}
              color="blue"
              subtitle={`${financials.paymentCount} payment run(s)`}
            />
            <MetricCard
              label="Maintenance Cost"
              value={financials.totalMaintenanceCost}
              icon={<ArrowDownRight className="w-5 h-5" />}
              color="red"
            />
            <MetricCard
              label="Gross Profit"
              value={Math.abs(financials.grossProfit)}
              icon={isProfit ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              color={isProfit ? "emerald" : "red"}
              prefix={isProfit ? undefined : "−"}
              subtitle={isProfit ? "Revenue − Costs" : "Net Loss"}
              bold
            />
          </div>

          {/* ── Charts ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <Card className="p-6 lg:col-span-2">
              <h3 className="text-base font-semibold mb-4">Top Earning Riders</h3>
              {financials.topRiders.length === 0 ? (
                <p className="text-muted-foreground text-sm">No data for selected period.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={financials.topRiders}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="name" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip formatter={(v: number) => [`रू ${v.toFixed(2)}`, "Revenue"]} />
                    <Bar dataKey="earnings" fill="#3b82f6" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card className="p-6">
              <h3 className="text-base font-semibold mb-4">Cash Collection</h3>
              {financials.cashBreakdown.length === 0 ? (
                <p className="text-muted-foreground text-sm">No data for selected period.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={financials.cashBreakdown}
                      cx="50%" cy="50%"
                      innerRadius={50} outerRadius={80}
                      dataKey="value" nameKey="name" label={false}
                    >
                      {financials.cashBreakdown.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Legend fontSize={11} />
                    <Tooltip formatter={(v: number) => `रू ${v.toFixed(2)}`} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>

          {/* ── Detailed summary ─────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Revenue breakdown */}
            <Card className="p-6">
              <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
                <ArrowUpRight className="w-4 h-4 text-emerald-600" />
                Revenue Breakdown
              </h3>
              <div className="space-y-0.5">
                <LineItem label="Total App Income"         amount={financials.totalRevenue} />
                <LineItem label="App Cash (System)"        amount={financials.totalCashApp} indent />
                <LineItem label="Cash Given by Drivers"    amount={financials.totalDriverCash} indent />
                <LineItem label="Online Transfers"         amount={financials.totalOnlineXfer} indent />
                <LineItem label="Goal Bonuses"             amount={financials.totalGoalBonus} indent />
                <LineItem label="Promo & Other Bonuses"    amount={financials.totalPromoBonus} indent />
              </div>
            </Card>

            {/* Cost breakdown */}
            <Card className="p-6">
              <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
                <ArrowDownRight className="w-4 h-4 text-red-600" />
                Cost Breakdown
              </h3>
              <div className="space-y-0.5">
                <LineItem label="Salaries Paid (Processed)"   amount={financials.totalSalaryPaid} />
                <LineItem label="  Allowances Included"       amount={financials.totalAllowancesPaid} indent />
                <LineItem label="  Advances Deducted"         amount={financials.totalAdvancesDeducted} indent deduct />
                <LineItem
                  label="  Cash Variance Settled"
                  amount={financials.totalCashVariance}
                  indent
                  highlight={Math.abs(financials.totalCashVariance) > 0.01}
                  deduct={financials.totalCashVariance > 0}
                />
                <LineItem label="Maintenance Costs"           amount={financials.totalMaintenanceCost} />
                <LineItem label="Operational Expenses"        amount={financials.totalOperationalExpenses} />
                <div className="mt-3 pt-3 border-t">
                  <LineItem
                    label={financials.grossProfit >= 0 ? "Gross Profit" : "Net Loss"}
                    amount={Math.abs(financials.grossProfit)}
                    bold
                    color={financials.grossProfit >= 0 ? "emerald" : "red"}
                    prefix={financials.grossProfit < 0 ? "−" : undefined}
                  />
                </div>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function MetricCard({
  label, value, icon, color, subtitle, bold, prefix,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: "emerald" | "blue" | "violet" | "red";
  subtitle?: string;
  bold?: boolean;
  prefix?: string;
}) {
  const colorMap = {
    emerald: "bg-emerald-50 text-emerald-600 border-emerald-100",
    blue:    "bg-blue-50 text-blue-600 border-blue-100",
    violet:  "bg-violet-50 text-violet-600 border-violet-100",
    red:     "bg-red-50 text-red-600 border-red-100",
  };
  const textColor = {
    emerald: "text-emerald-700",
    blue:    "text-foreground",
    violet:  "text-foreground",
    red:     "text-red-700",
  };
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
          <p className={`text-2xl font-bold mt-1 font-mono tabular-nums ${bold ? textColor[color] : ""}`}>
            {prefix && <span className="text-lg">{prefix}</span>}
            रू {value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        <div className={`p-2.5 rounded-xl border ${colorMap[color]}`}>{icon}</div>
      </div>
    </Card>
  );
}

function LineItem({
  label, amount, indent, highlight, bold, deduct, color, prefix,
}: {
  label: string;
  amount: number;
  indent?: boolean;
  highlight?: boolean;
  bold?: boolean;
  deduct?: boolean;
  color?: "emerald" | "red";
  prefix?: string;
}) {
  const textColor = color === "emerald"
    ? "text-emerald-700 font-semibold"
    : color === "red"
    ? "text-red-600 font-semibold"
    : deduct
    ? "text-red-600"
    : "";

  return (
    <div className={`flex items-center justify-between py-1.5 border-b border-dashed last:border-0 ${indent ? "pl-4" : ""} ${highlight ? "bg-amber-50 px-3 rounded-lg border-amber-200" : ""}`}>
      <span className={`text-sm ${indent ? "text-muted-foreground/80" : "text-muted-foreground"}`}>{label}</span>
      <span className={`font-mono text-sm tabular-nums ${bold ? "font-bold text-base" : "font-medium"} ${textColor} ${highlight ? "text-amber-700" : ""}`}>
        {prefix && <span>{prefix}</span>}
        रू {amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </div>
  );
}
