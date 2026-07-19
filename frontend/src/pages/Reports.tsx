import { useState } from "react";
import { api } from "@/lib/api";
import { useToast, apiErrorMessage } from "@/contexts/toast";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { daysAgoISO, todayISO, toCsv, downloadCsvString } from "@/lib/format";
import type { CashCollection, DailyLog, FleetStats, Paginated, Vehicle } from "@/lib/types";

type ReportType = "daily-fleet" | "daily-rider" | "vehicle-performance" | "cash-reconciliation";

const REPORT_LABELS: Record<ReportType, string> = {
  "daily-fleet": "Daily Fleet",
  "daily-rider": "Daily Rider",
  "vehicle-performance": "Vehicle Performance",
  "cash-reconciliation": "Cash Reconciliation",
};

export function Reports() {
  const toast = useToast();
  const [reportType, setReportType] = useState<ReportType>("daily-fleet");
  const [range, setRange] = useState<DateRange>({ date_from: daysAgoISO(29), date_to: todayISO() });
  const [generating, setGenerating] = useState(false);

  const generate = async () => {
    setGenerating(true);
    try {
      switch (reportType) {
        case "daily-fleet": {
          const stats = await api.get<FleetStats>("/api/dashboard/fleet-stats/", range);
          const csv = toCsv(stats.daily as unknown as Record<string, unknown>[], ["english_date", "rides", "income", "vehicles"]);
          downloadCsvString(`daily-fleet-${range.date_from}_${range.date_to}.csv`, csv);
          break;
        }
        case "daily-rider": {
          const logs = await api.get<Paginated<DailyLog>>("/api/daily-logs/", { ...range, page_size: 100 });
          const csv = toCsv(logs.results as unknown as Record<string, unknown>[]);
          downloadCsvString(`daily-rider-${range.date_from}_${range.date_to}.csv`, csv);
          break;
        }
        case "vehicle-performance": {
          const [vehicles, logs] = await Promise.all([
            api.get<Paginated<Vehicle>>("/api/vehicles/", { page_size: 100 }),
            api.get<Paginated<DailyLog>>("/api/daily-logs/", { ...range, page_size: 100 }),
          ]);
          const byVehicle = new Map<string, { rides: number; income: number }>();
          for (const log of logs.results) {
            const entry = byVehicle.get(log.vehicle) ?? { rides: 0, income: 0 };
            entry.rides += log.rides_completed ?? 0;
            entry.income += parseFloat(log.total_income ?? "0");
            byVehicle.set(log.vehicle, entry);
          }
          const rows = vehicles.results.map((v) => ({
            vehicle_number: v.vehicle_number,
            plate_number: v.plate_number,
            status: v.status,
            odometer_reading: v.odometer_reading,
            rides: byVehicle.get(v.id)?.rides ?? 0,
            income: (byVehicle.get(v.id)?.income ?? 0).toFixed(2),
          }));
          const csv = toCsv(rows);
          downloadCsvString(`vehicle-performance-${range.date_from}_${range.date_to}.csv`, csv);
          break;
        }
        case "cash-reconciliation": {
          const rows = await api.get<Paginated<CashCollection>>("/api/cash-collection/", { ...range, page_size: 100 });
          const csv = toCsv(rows.results as unknown as Record<string, unknown>[]);
          downloadCsvString(`cash-reconciliation-${range.date_from}_${range.date_to}.csv`, csv);
          break;
        }
      }
      toast.success("Report downloaded.");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not generate report."));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">Generate CSV exports for operational and financial reporting.</p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 520 }}>
        <div className="form-grid" style={{ marginBottom: 16 }}>
          <label className="form-field">
            <span className="form-label">Report type</span>
            <select value={reportType} onChange={(e) => setReportType(e.target.value as ReportType)}>
              {Object.entries(REPORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>
        <DateRangeFilter value={range} onChange={setRange} />
        <div className="form-actions" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-primary" onClick={generate} disabled={generating}>
            {generating ? "Generating…" : "Download CSV"}
          </button>
        </div>
      </div>
    </div>
  );
}
