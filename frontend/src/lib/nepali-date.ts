// Bikram Sambat (BS) <-> Gregorian (AD) conversion.
//
// Ported faithfully from the legacy Elebhar TS stack's `nepali-date.ts`
// (removed from the tree 2026-07-19, see git history at commit 2667766).
// The BS_CALENDAR month-length table and the epoch anchor are official
// Nepali calendar data — do not "fix", round, or extrapolate values here;
// extend the table only by appending real published BS year data.

export const BS_MONTHS = [
  "Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin",
  "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra",
] as const;

// BS year -> day counts for months Baisakh(0)..Chaitra(11).
export const BS_CALENDAR: Record<number, number[]> = {
  2070: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2071: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2072: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2073: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2074: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2075: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2076: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2077: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2078: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31],
  2079: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2080: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2081: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2082: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2083: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30],
  2084: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2085: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2086: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2087: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2088: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30],
  2089: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2090: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2091: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2092: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2093: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2094: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2095: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2096: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2097: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2098: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2099: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2100: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
};

export const BS_MIN_YEAR = 2070;
export const BS_MAX_YEAR = 2100;

const BS_EPOCH_AD = new Date(2013, 3, 14);
const BS_EPOCH_BS: BsDate = { year: 2070, month: 0, day: 1 };

export interface BsDate {
  year: number;
  month: number; // 0 = Baisakh .. 11 = Chaitra
  day: number;
}

function getMonthLength(year: number, month: number): number | null {
  if (month < 0 || month > 11) return null;
  const cal = BS_CALENDAR[year];
  if (!cal) return null;
  return cal[month] ?? null;
}

/** AD (string "YYYY-MM-DD" or Date) -> BS. Returns null before the epoch or past the known table. */
export function adToBs(adDate: string | Date): BsDate | null {
  const d = typeof adDate === "string" ? new Date(adDate + "T00:00:00") : adDate;
  if (Number.isNaN(d.getTime())) return null;

  let diffDays = Math.floor((d.getTime() - BS_EPOCH_AD.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return null;

  let bsYear = BS_EPOCH_BS.year;
  let bsMonth = BS_EPOCH_BS.month;
  let bsDay = BS_EPOCH_BS.day;

  while (diffDays > 0) {
    const daysInMonth = getMonthLength(bsYear, bsMonth);
    if (daysInMonth === null) return null;
    const remaining = daysInMonth - bsDay;
    if (diffDays <= remaining) {
      bsDay += diffDays;
      diffDays = 0;
    } else {
      diffDays -= remaining + 1;
      bsMonth++;
      bsDay = 1;
      if (bsMonth >= 12) {
        bsMonth = 0;
        bsYear++;
      }
    }
  }

  return { year: bsYear, month: bsMonth, day: bsDay };
}

/** BS -> AD, formatted "YYYY-MM-DD". Returns null for out-of-table years or invalid day-of-month. */
export function bsToAd(bs: BsDate): string | null {
  const cal = BS_CALENDAR[bs.year];
  if (!cal) return null;
  if (bs.month < 0 || bs.month > 11) return null;
  const monthLength = cal[bs.month];
  if (monthLength === undefined || bs.day < 1 || bs.day > monthLength) return null;

  let totalDays = 0;
  for (let y = BS_EPOCH_BS.year; y < bs.year; y++) {
    const yCal = BS_CALENDAR[y];
    if (!yCal) return null;
    totalDays += yCal.reduce((a, b) => a + b, 0);
  }
  for (let m = 0; m < bs.month; m++) {
    totalDays += cal[m] ?? 0;
  }
  totalDays += bs.day - BS_EPOCH_BS.day;

  const result = new Date(BS_EPOCH_AD.getTime());
  result.setDate(result.getDate() + totalDays);
  const yyyy = result.getFullYear();
  const mm = String(result.getMonth() + 1).padStart(2, "0");
  const dd = String(result.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function formatBs(bs: BsDate | null): string {
  if (!bs) return "";
  return `${BS_MONTHS[bs.month] ?? ""} ${bs.day}, ${bs.year}`;
}

export function formatBsShort(bs: BsDate | null): string {
  if (!bs) return "";
  return `${BS_MONTHS[bs.month] ?? ""} ${bs.day}`;
}

export function adToBsString(adDate: string): string {
  return formatBsShort(adToBs(adDate));
}

export function getBsMonthName(month: number): string {
  return BS_MONTHS[month] ?? "";
}

export function bsStringToAd(bsStr: string): string | null {
  const parts = bsStr.split("-");
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0] ?? "", 10);
  const month = parseInt(parts[1] ?? "", 10) - 1;
  const day = parseInt(parts[2] ?? "", 10);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
  return bsToAd({ year, month, day });
}

export function adToBsFormatted(adDate: string): string {
  const bs = adToBs(adDate);
  if (!bs) return "";
  const mm = String(bs.month + 1).padStart(2, "0");
  const dd = String(bs.day).padStart(2, "0");
  return `${bs.year}-${mm}-${dd}`;
}

export function getTodayBs(): BsDate | null {
  return adToBs(new Date());
}

/** Number of days in a given BS year/month, or null if outside the known table. */
export function getBsMonthLength(year: number, month: number): number | null {
  return getMonthLength(year, month);
}

/** Add `delta` months to a BS year/month, rolling the year over as needed. */
export function shiftBsMonth(year: number, month: number, delta: number): { year: number; month: number } {
  let m = month + delta;
  let y = year;
  while (m < 0) {
    m += 12;
    y -= 1;
  }
  while (m > 11) {
    m -= 12;
    y += 1;
  }
  return { year: y, month: m };
}
