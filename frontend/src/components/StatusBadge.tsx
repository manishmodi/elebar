interface StatusBadgeProps {
  status: string;
  map?: Record<string, string>;
}

const DEFAULT_TONE: Record<string, string> = {
  active: "badge-success",
  present: "badge-success",
  approved: "badge-success",
  verified: "badge-success",
  ok: "badge-success",
  completed: "badge-success",
  processed: "badge-success",

  pending: "badge-warning",
  maintenance: "badge-warning",
  half_day: "badge-warning",
  due_soon: "badge-warning",
  leave: "badge-warning",

  inactive: "badge-neutral",
  ended: "badge-neutral",
  holiday: "badge-neutral",
  unknown: "badge-neutral",

  disapproved: "badge-danger",
  rejected: "badge-danger",
  absent: "badge-danger",
  overdue: "badge-danger",
  checkout: "badge-info",
  exchange: "badge-info",
  checkin: "badge-info",
};

export function StatusBadge({ status, map }: StatusBadgeProps) {
  const key = status?.toLowerCase() ?? "";
  const tone = map?.[key] ?? DEFAULT_TONE[key] ?? "badge-neutral";
  const label = status
    ? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "-";
  return <span className={`badge ${tone}`}>{label}</span>;
}
