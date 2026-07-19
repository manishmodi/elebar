import { useMemo } from "react";
import { useListAssignments } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/ui-components";
import { adToBSString } from "@/lib/nepali-date";
import { History, Car, User } from "lucide-react";

interface AssignmentHistoryProps {
  riderId?: number;
  vehicleId?: number;
}

interface AssignmentRow {
  id: number;
  riderId: number;
  vehicleId: number;
  riderName?: string | null;
  vehiclePlate?: string | null;
  startDate: string;
  endDate?: string | null;
  shiftType?: string | null;
  status: string;
}

function formatDate(value?: string | null): string | null {
  if (!value) return null;
  const ad = value.split("T")[0];
  const bs = adToBSString(value);
  return bs ? `${ad} (${bs} BS)` : ad;
}

export function AssignmentHistory({ riderId, vehicleId }: AssignmentHistoryProps) {
  const params = riderId != null ? { riderId } : vehicleId != null ? { vehicleId } : undefined;
  const { data, isLoading } = useListAssignments(params);
  const showVehicle = riderId != null;

  const sorted = useMemo(() => {
    const list: AssignmentRow[] = Array.isArray(data) ? ([...data] as AssignmentRow[]) : [];
    return list.sort((a, b) => {
      const aActive = a.status === "active" ? 1 : 0;
      const bActive = b.status === "active" ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return (b.startDate || "").localeCompare(a.startDate || "");
    });
  }, [data]);

  return (
    <div className="border-t pt-5">
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm uppercase tracking-wider text-primary">Assignment History</h3>
      </div>

      {isLoading ? (
        <div className="text-center py-6 text-muted-foreground text-sm">Loading history...</div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm bg-muted/30 rounded-xl border">
          {showVehicle ? "This rider has not been assigned to any vehicle yet." : "This vehicle has not been assigned to any rider yet."}
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((a) => {
            const label = showVehicle ? (a.vehiclePlate || `Vehicle #${a.vehicleId}`) : (a.riderName || `Rider #${a.riderId}`);
            const start = formatDate(a.startDate);
            const end = a.endDate ? formatDate(a.endDate) : "Present";
            return (
              <div key={a.id} className="flex items-start justify-between gap-3 p-3 rounded-xl border bg-muted/20">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    {showVehicle ? <Car className="w-4 h-4 text-primary" /> : <User className="w-4 h-4 text-primary" />}
                  </div>
                  <div className="min-w-0">
                    <div className={`font-medium text-sm text-foreground truncate ${showVehicle ? "font-mono" : ""}`}>{label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{start} → {end}</div>
                    <div className="text-xs text-muted-foreground capitalize mt-0.5">{a.shiftType || "day"} shift</div>
                  </div>
                </div>
                <StatusBadge status={a.status} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
