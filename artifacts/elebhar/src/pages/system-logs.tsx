import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Card, EmptyState } from "@/components/ui-components";
import { ScrollText, Search, Filter } from "lucide-react";

interface ActivityLog {
  id: number;
  userId: number | null;
  userName: string;
  action: string;
  section: string;
  description: string;
  createdAt: string;
}

const SECTION_LABELS: Record<string, string> = {
  "riders": "Riders",
  "vehicles": "Vehicles",
  "daily-logs": "Daily Logs",
  "assignments": "Assignments",
  "attendance": "Attendance",
  "maintenance": "Maintenance",
  "users": "User Management",
  "financials": "Financials",
  "reports": "Reports",
};

const SECTION_COLORS: Record<string, string> = {
  "riders": "bg-blue-100 text-blue-700",
  "vehicles": "bg-indigo-100 text-indigo-700",
  "daily-logs": "bg-emerald-100 text-emerald-700",
  "assignments": "bg-orange-100 text-orange-700",
  "attendance": "bg-pink-100 text-pink-700",
  "maintenance": "bg-yellow-100 text-yellow-800",
  "users": "bg-purple-100 text-purple-700",
  "financials": "bg-teal-100 text-teal-700",
  "reports": "bg-gray-100 text-gray-700",
};

const ACTION_STYLES: Record<string, string> = {
  "created": "bg-green-100 text-green-700 border border-green-200",
  "updated": "bg-amber-100 text-amber-700 border border-amber-200",
  "deleted": "bg-red-100 text-red-700 border border-red-200",
};

const API_BASE = `${import.meta.env.BASE_URL}api`;

function useActivityLogs() {
  return useQuery<ActivityLog[]>({
    queryKey: ["activity-logs"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/activity-logs`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch activity logs");
      return res.json();
    },
    refetchInterval: 30000,
  });
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatFullTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

export default function SystemLogs() {
  const { data: logs, isLoading } = useActivityLogs();
  const [search, setSearch] = useState("");
  const [filterSection, setFilterSection] = useState("all");
  const [filterAction, setFilterAction] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const sections = useMemo(() => {
    if (!logs) return [];
    return Array.from(new Set(logs.map(l => l.section))).sort();
  }, [logs]);

  const filtered = useMemo(() => {
    if (!logs) return [];
    return logs.filter(l => {
      const matchSearch = !search ||
        l.userName.toLowerCase().includes(search.toLowerCase()) ||
        l.description.toLowerCase().includes(search.toLowerCase());
      const matchSection = filterSection === "all" || l.section === filterSection;
      const matchAction = filterAction === "all" || l.action === filterAction;
      const logDate = l.createdAt.split("T")[0];
      const matchFrom = !dateFrom || logDate >= dateFrom;
      const matchTo = !dateTo || logDate <= dateTo;
      return matchSearch && matchSection && matchAction && matchFrom && matchTo;
    });
  }, [logs, search, filterSection, filterAction, dateFrom, dateTo]);

  return (
    <div>
      <PageHeader
        title="System Logs"
        description="Complete audit trail of all user activity across the system."
      />

      <Card className="mb-6 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by user or activity..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="premium-input pl-9"
            />
          </div>

          <select
            value={filterSection}
            onChange={e => setFilterSection(e.target.value)}
            className="premium-input bg-white min-w-[150px]"
          >
            <option value="all">All Sections</option>
            {sections.map(s => (
              <option key={s} value={s}>{SECTION_LABELS[s] ?? s}</option>
            ))}
          </select>

          <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
            {(["all", "created", "updated", "deleted"] as const).map(a => (
              <button
                key={a}
                onClick={() => setFilterAction(a)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                  filterAction === a
                    ? "bg-white shadow text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {a === "all" ? "All Actions" : a}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="premium-input text-sm"
              title="From date"
            />
            <span className="text-muted-foreground text-sm">–</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="premium-input text-sm"
              title="To date"
            />
          </div>

          <span className="text-sm text-muted-foreground self-center whitespace-nowrap">
            {filtered.length} record{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <div className="text-center">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              Loading activity logs...
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No activity found"
            description="No logs match the current filters. Activity will appear here as users perform actions."
            icon={ScrollText}
          />
        ) : (
          <div className="divide-y divide-border">
            {filtered.map(log => (
              <div key={log.id} className="flex items-start gap-4 px-6 py-4 hover:bg-muted/30 transition-colors">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs mt-0.5">
                  {log.userName.charAt(0).toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-semibold text-sm text-foreground">{log.userName}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_STYLES[log.action] ?? "bg-gray-100 text-gray-700"}`}>
                      {log.action}
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${SECTION_COLORS[log.section] ?? "bg-gray-100 text-gray-700"}`}>
                      {SECTION_LABELS[log.section] ?? log.section}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{log.description}</p>
                </div>

                <div className="flex-shrink-0 text-right">
                  <span
                    className="text-xs text-muted-foreground cursor-default"
                    title={formatFullTime(log.createdAt)}
                  >
                    {formatRelativeTime(log.createdAt)}
                  </span>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                    {formatFullTime(log.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
