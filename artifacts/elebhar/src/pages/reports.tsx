import { useState } from "react";
import { PageHeader, Card, Button } from "@/components/ui-components";
import { Download, FileText, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { listDailyLogs } from "@workspace/api-client-react";

const REPORT_TYPES = [
  { id: "daily-fleet", name: "Daily Fleet Report", desc: "Overall summary of vehicles and drivers for a specific day." },
  { id: "daily-rider", name: "Daily Rider Report", desc: "Individual performance, acceptances, and rides." },
  { id: "vehicle-perf", name: "Vehicle Performance", desc: "Distance covered and income generated per vehicle." },
  { id: "cash-recon", name: "Cash Reconciliation", desc: "Summary of App Cash, Transfers, and Cash check variances." },
];

const DAILY_FLEET_COLUMNS = [
  { key: "englishDate", label: "Date" },
  { key: "nepaliDate", label: "Nepali Date" },
  { key: "riderName", label: "Rider" },
  { key: "vehiclePlate", label: "Vehicle" },
  { key: "checkInTime", label: "Check In" },
  { key: "checkOutTime", label: "Check Out" },
  { key: "dailyBonusSet", label: "Daily Bonus Set" },
  { key: "totalRidesReceived", label: "Rides Received" },
  { key: "ridesCompleted", label: "Rides Completed" },
  { key: "acceptanceRate", label: "Acceptance Rate" },
  { key: "bonusTargetCompletion", label: "Bonus Target Met" },
  { key: "totalRideDistanceKm", label: "Distance (km)" },
  { key: "totalRideHours", label: "Ride Hours" },
  { key: "totalAppOnline", label: "App Online Hours" },
  { key: "cashAsPerApp", label: "Cash As Per App" },
  { key: "goalBonus", label: "Goal Bonus" },
  { key: "promotionBonusOther", label: "Promotion/Bonus" },
  { key: "totalIncome", label: "Total Income" },
  { key: "cashGivenByDriver", label: "Cash Given by Driver" },
  { key: "cashTransferredOnline", label: "Cash Transferred Online" },
  { key: "cashCheck", label: "Cash Check" },
  { key: "dailyAllowance", label: "Daily Allowance" },
  { key: "remarks", label: "Remarks" },
];

const CASH_RECON_COLUMNS = [
  { key: "englishDate", label: "Date" },
  { key: "nepaliDate", label: "Nepali Date" },
  { key: "riderName", label: "Rider" },
  { key: "vehiclePlate", label: "Vehicle" },
  { key: "cashAsPerApp", label: "Cash As Per App" },
  { key: "cashGivenByDriver", label: "Cash Given by Driver" },
  { key: "cashTransferredOnline", label: "Cash Transferred Online" },
  { key: "cashCheck", label: "Cash Check" },
  { key: "totalIncome", label: "Total Income" },
];

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadCsv(filename: string, csvContent: string) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const { toast } = useToast();
  const [reportType, setReportType] = useState("daily-fleet");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    if (!startDate || !endDate) {
      toast({ title: "Missing dates", description: "Please select both start and end dates.", variant: "destructive" });
      return;
    }
    if (startDate > endDate) {
      toast({ title: "Invalid range", description: "Start date must be before end date.", variant: "destructive" });
      return;
    }

    setIsDownloading(true);
    try {
      const logs = await listDailyLogs({ startDate, endDate });

      if (!logs || logs.length === 0) {
        toast({ title: "No data", description: "No daily logs found for the selected date range." });
        setIsDownloading(false);
        return;
      }

      const columns = (reportType === "cash-recon") ? CASH_RECON_COLUMNS : DAILY_FLEET_COLUMNS;
      const header = columns.map((c) => escapeCsvField(c.label)).join(",");
      const rows = logs.map((log) =>
        columns.map((c) => escapeCsvField((log as Record<string, unknown>)[c.key])).join(",")
      );
      const csv = [header, ...rows].join("\n");

      const reportName = REPORT_TYPES.find((r) => r.id === reportType)?.name?.replace(/\s+/g, "_") || reportType;
      const filename = `${reportName}_${startDate}_to_${endDate}.csv`;
      downloadCsv(filename, csv);

      toast({ title: "Report downloaded", description: `${logs.length} records exported to ${filename}` });
    } catch {
      toast({ title: "Export failed", description: "Could not fetch data for the report.", variant: "destructive" });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader 
        title="Reports & Analytics" 
        description="Export data and generate financial/operational reports."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6 space-y-6">
          <h3 className="font-display font-semibold text-lg border-b pb-3">Generate Export</h3>
          
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Report Type</label>
              <select className="premium-input bg-white" value={reportType} onChange={(e) => setReportType(e.target.value)}>
                {REPORT_TYPES.map(rt => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
              </select>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Start Date</label>
                <input type="date" className="premium-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">End Date</label>
                <input type="date" className="premium-input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>

            <Button className="w-full mt-4" onClick={handleDownload} disabled={isDownloading}>
              {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {isDownloading ? "Generating..." : "Download CSV"}
            </Button>
          </div>
        </Card>

        <div className="space-y-4">
          <h3 className="font-display font-semibold text-lg text-foreground px-1">Available Reports</h3>
          {REPORT_TYPES.map(rt => (
            <Card key={rt.id} className={`p-4 flex items-start gap-4 hover-elevate cursor-pointer transition-colors ${reportType === rt.id ? 'border-primary bg-primary/5' : ''}`} onClick={() => setReportType(rt.id)}>
              <div className="p-2.5 bg-primary/10 text-primary rounded-xl shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-semibold text-sm">{rt.name}</h4>
                <p className="text-xs text-muted-foreground mt-1">{rt.desc}</p>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
