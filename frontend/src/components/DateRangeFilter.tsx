import { daysAgoISO, startOfMonthISO, todayISO } from "@/lib/format";

export interface DateRange {
  date_from: string;
  date_to: string;
  // Index signature lets a DateRange be spread straight into api query params.
  [key: string]: string;
}

interface DateRangeFilterProps {
  value: DateRange;
  onChange: (value: DateRange) => void;
}

export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const presets: { label: string; range: DateRange }[] = [
    { label: "Today", range: { date_from: todayISO(), date_to: todayISO() } },
    { label: "Last 7 days", range: { date_from: daysAgoISO(6), date_to: todayISO() } },
    { label: "Last 30 days", range: { date_from: daysAgoISO(29), date_to: todayISO() } },
    { label: "This month", range: { date_from: startOfMonthISO(), date_to: todayISO() } },
  ];

  return (
    <div className="date-range-filter">
      <div className="date-range-inputs">
        <label>
          From
          <input
            type="date"
            value={value.date_from}
            max={value.date_to}
            onChange={(e) => onChange({ ...value, date_from: e.target.value })}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={value.date_to}
            min={value.date_from}
            onChange={(e) => onChange({ ...value, date_to: e.target.value })}
          />
        </label>
      </div>
      <div className="date-range-presets">
        {presets.map((p) => (
          <button
            type="button"
            key={p.label}
            className="btn btn-ghost btn-sm"
            onClick={() => onChange(p.range)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
