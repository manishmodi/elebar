import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ActivityLog } from "@/lib/types";
import { DataTable, type Column } from "@/components/DataTable";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime, daysAgoISO, todayISO } from "@/lib/format";

const ACTION_TONE: Record<string, string> = {
  create: "badge-success",
  update: "badge-info",
  delete: "badge-danger",
  login: "badge-neutral",
  logout: "badge-neutral",
  approve: "badge-success",
  reject: "badge-danger",
};

export function SystemLogs() {
  const [section, setSection] = useState("");
  const [action, setAction] = useState("");
  const [range, setRange] = useState<DateRange>({ date_from: daysAgoISO(6), date_to: todayISO() });

  const logsQuery = useQuery({
    queryKey: ["activity-logs", { section, action, range }],
    queryFn: () =>
      api.get<ActivityLog[]>("/api/activity-logs/", {
        section: section || undefined,
        action: action || undefined,
        date_from: range.date_from,
        date_to: range.date_to,
      }),
  });

  const columns: Column<ActivityLog>[] = [
    { key: "created_at", header: "Time", render: (l) => formatDateTime(l.created_at) },
    { key: "user_name", header: "User", render: (l) => l.user_name },
    { key: "section", header: "Section", render: (l) => l.section },
    { key: "action", header: "Action", render: (l) => <StatusBadge status={l.action} map={ACTION_TONE} /> },
    { key: "description", header: "Description", render: (l) => l.description },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">System Logs</h1>
          <p className="page-subtitle">Full audit trail of user actions across the platform.</p>
        </div>
      </div>

      <div className="toolbar">
        <input placeholder="Section" value={section} onChange={(e) => setSection(e.target.value)} style={{ maxWidth: 160 }} />
        <input placeholder="Action" value={action} onChange={(e) => setAction(e.target.value)} style={{ maxWidth: 160 }} />
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      <DataTable columns={columns} rows={logsQuery.data ?? []} loading={logsQuery.isLoading} rowKey={(l) => l.id} />
    </div>
  );
}
