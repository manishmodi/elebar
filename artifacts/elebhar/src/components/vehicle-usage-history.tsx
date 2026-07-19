import { useMemo } from "react";
import { useListAttendance, type Attendance } from "@workspace/api-client-react";
import { adToBSString } from "@/lib/nepali-date";
import { ClipboardList, User } from "lucide-react";

interface VehicleUsageHistoryProps {
  vehicleId: number;
  dateFrom?: string;
  dateTo?: string;
}

function bsLabel(ad?: string | null, bs?: string | null): string {
  if (!ad) return "";
  const adDay = ad.split("T")[0];
  const bsDay = bs || adToBSString(ad);
  return bsDay ? `${adDay} (${bsDay} BS)` : adDay;
}

function distance(out?: string | null, inn?: string | null): string | null {
  const o = out != null && out !== "" ? parseFloat(out) : null;
  const i = inn != null && inn !== "" ? parseFloat(inn) : null;
  if (o != null && i != null && i >= o) return `${(i - o).toFixed(1)} km`;
  return null;
}

export function VehicleUsageHistory({ vehicleId, dateFrom, dateTo }: VehicleUsageHistoryProps) {
  const { data, isLoading } = useListAttendance({ vehicleId });

  const rows = useMemo(() => {
    const list: Attendance[] = Array.isArray(data) ? [...data] : [];
    return list
      .filter((r) => {
        if (r.vehicleId !== vehicleId) return false;
        const d = (r.date || "").split("T")[0];
        if (!d) return false;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
      })
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [data, vehicleId, dateFrom, dateTo]);

  return (
    <div className="border-t pt-5">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm uppercase tracking-wider text-primary">Vehicle Usage (by attendance)</h3>
      </div>

      {isLoading ? (
        <div className="text-center py-6 text-muted-foreground text-sm">Loading usage...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm bg-muted/30 rounded-xl border">
          {dateFrom || dateTo
            ? "No one took this scooter out in the selected date range."
            : "No one has taken this scooter out yet (no attendance records)."}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            // riderTimeIn/distanceIn are the MORNING values (arrival/odometer-out) — see attendance form labels
            const times = [r.riderTimeIn, r.riderTimeOut].filter(Boolean).join(" → ");
            const dist = distance(r.distanceIn, r.distanceOut);
            return (
              <div key={r.id} className="flex items-start justify-between gap-3 p-3 rounded-xl border bg-muted/20">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-sm text-foreground truncate">{r.riderName || `Rider #${r.riderId}`}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{bsLabel(r.date, r.nepaliDate)}</div>
                    {(times || dist) && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {times && <span>{times}</span>}
                        {times && dist && <span> · </span>}
                        {dist && <span>{dist}</span>}
                      </div>
                    )}
                    {r.vehicleOverrideReason && (
                      <div className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">Override: {r.vehicleOverrideReason}</div>
                    )}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground capitalize flex-shrink-0 mt-1">{r.type.replace("_", " ")}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
