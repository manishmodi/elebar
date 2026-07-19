import { useState, useCallback } from "react";
import { Calendar, ArrowRightLeft } from "lucide-react";
import { adToBSFormatted, bsStringToAD } from "@/lib/nepali-date";

export type CalendarMode = "AD" | "BS";

interface DateRangeFilterProps {
  dateFrom: string;
  dateTo: string;
  onChange: (from: string, to: string) => void;
  calendarMode: CalendarMode;
  onCalendarModeChange: (mode: CalendarMode) => void;
}

export function DateRangeFilter({
  dateFrom,
  dateTo,
  onChange,
  calendarMode,
  onCalendarModeChange,
}: DateRangeFilterProps) {
  const [bsFrom, setBsFrom] = useState(() =>
    calendarMode === "BS" ? adToBSFormatted(dateFrom) : ""
  );
  const [bsTo, setBsTo] = useState(() =>
    calendarMode === "BS" ? adToBSFormatted(dateTo) : ""
  );

  const toggleMode = useCallback(() => {
    if (calendarMode === "AD") {
      setBsFrom(adToBSFormatted(dateFrom));
      setBsTo(adToBSFormatted(dateTo));
      onCalendarModeChange("BS");
    } else {
      onCalendarModeChange("AD");
    }
  }, [calendarMode, dateFrom, dateTo, onCalendarModeChange]);

  const handleADFromChange = (val: string) => {
    onChange(val, dateTo);
  };

  const handleADToChange = (val: string) => {
    onChange(dateFrom, val);
  };

  const handleBSFromChange = (val: string) => {
    setBsFrom(val);
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      const ad = bsStringToAD(val);
      if (ad) onChange(ad, dateTo);
    }
  };

  const handleBSToChange = (val: string) => {
    setBsTo(val);
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      const ad = bsStringToAD(val);
      if (ad) onChange(dateFrom, ad);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={toggleMode}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border-2 border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 transition-colors whitespace-nowrap"
        title="Switch between AD (Gregorian) and BS (Bikram Sambat)"
      >
        <ArrowRightLeft className="w-3.5 h-3.5" />
        {calendarMode}
      </button>

      <div className="flex items-center gap-1.5">
        <Calendar className="w-4 h-4 text-muted-foreground hidden sm:block" />
        {calendarMode === "AD" ? (
          <>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => handleADFromChange(e.target.value)}
              className="premium-input py-1.5 px-2 text-xs w-[130px]"
            />
            <span className="text-muted-foreground text-xs">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => handleADToChange(e.target.value)}
              className="premium-input py-1.5 px-2 text-xs w-[130px]"
            />
          </>
        ) : (
          <>
            <input
              type="text"
              value={bsFrom}
              onChange={(e) => handleBSFromChange(e.target.value)}
              placeholder="YYYY-MM-DD"
              className="premium-input py-1.5 px-2 text-xs w-[120px] font-mono"
            />
            <span className="text-muted-foreground text-xs">to</span>
            <input
              type="text"
              value={bsTo}
              onChange={(e) => handleBSToChange(e.target.value)}
              placeholder="YYYY-MM-DD"
              className="premium-input py-1.5 px-2 text-xs w-[120px] font-mono"
            />
          </>
        )}
      </div>
    </div>
  );
}

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getDefaultDateRange(): { from: string; to: string } {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
  return {
    from: toLocalDateStr(thirtyDaysAgo),
    to: toLocalDateStr(today),
  };
}
