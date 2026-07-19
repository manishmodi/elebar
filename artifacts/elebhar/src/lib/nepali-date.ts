const BS_MONTHS = [
  "Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin",
  "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"
];

const BS_CALENDAR: Record<number, number[]> = {
  2070: [31,32,31,32,31,30,30,30,29,30,29,31],
  2071: [31,31,32,31,31,31,30,29,30,29,30,30],
  2072: [31,32,31,32,31,30,30,30,29,29,30,31],
  2073: [31,31,32,32,31,30,30,29,30,29,30,30],
  2074: [31,32,31,32,31,30,30,30,29,30,29,31],
  2075: [31,31,31,32,31,31,30,29,30,29,30,30],
  2076: [31,31,32,32,31,30,30,29,30,29,30,30],
  2077: [31,32,31,32,31,30,30,30,29,29,30,31],
  2078: [31,31,31,32,31,31,29,30,30,29,29,31],
  2079: [31,31,32,31,31,31,30,29,30,29,30,30],
  2080: [31,32,31,32,31,30,30,30,29,29,30,31],
  2081: [31,31,32,32,31,30,30,29,30,29,30,30],
  2082: [31,32,31,32,31,30,30,30,29,30,29,31],
  2083: [31,31,31,32,31,31,29,30,30,29,30,30],
  2084: [31,31,32,31,31,31,30,29,30,29,30,30],
  2085: [31,32,31,32,31,30,30,30,29,29,30,31],
  2086: [31,31,32,32,31,30,30,29,30,29,30,30],
  2087: [31,32,31,32,31,30,30,30,29,30,29,31],
  2088: [31,31,31,32,31,31,29,30,30,29,30,30],
  2089: [31,31,32,31,31,31,30,29,30,29,30,30],
  2090: [31,32,31,32,31,30,30,30,29,29,30,31],
  2091: [31,31,32,32,31,30,30,29,30,29,30,30],
  2092: [31,32,31,32,31,30,30,30,29,30,29,31],
  2093: [31,31,31,32,31,31,30,29,30,29,30,30],
  2094: [31,31,32,31,31,31,30,29,30,29,30,30],
  2095: [31,32,31,32,31,30,30,30,29,29,30,31],
  2096: [31,31,32,32,31,30,30,29,30,29,30,30],
  2097: [31,32,31,32,31,30,30,30,29,30,29,31],
  2098: [31,31,31,32,31,31,30,29,30,29,30,30],
  2099: [31,31,32,31,31,31,30,29,30,29,30,30],
  2100: [31,32,31,32,31,30,30,30,29,29,30,31],
};

const BS_EPOCH_AD = new Date(2013, 3, 14);
const BS_EPOCH_BS = { year: 2070, month: 0, day: 1 };

export interface BSDate {
  year: number;
  month: number;
  day: number;
}

export function adToBS(adDate: string | Date): BSDate | null {
  const d = typeof adDate === "string" ? new Date(adDate + "T00:00:00") : adDate;
  if (isNaN(d.getTime())) return null;

  let diffDays = Math.floor((d.getTime() - BS_EPOCH_AD.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return null;

  let bsYear = BS_EPOCH_BS.year;
  let bsMonth = BS_EPOCH_BS.month;
  let bsDay = BS_EPOCH_BS.day;

  while (diffDays > 0) {
    const cal = BS_CALENDAR[bsYear];
    if (!cal) return null;
    const daysInMonth = cal[bsMonth];
    const remaining = daysInMonth - bsDay;
    if (diffDays <= remaining) {
      bsDay += diffDays;
      diffDays = 0;
    } else {
      diffDays -= (remaining + 1);
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

export function formatBS(bs: BSDate | null): string {
  if (!bs) return "";
  return `${BS_MONTHS[bs.month]} ${bs.day}, ${bs.year}`;
}

export function formatBSShort(bs: BSDate | null): string {
  if (!bs) return "";
  return `${BS_MONTHS[bs.month]} ${bs.day}`;
}

export function adToBSString(adDate: string): string {
  return formatBSShort(adToBS(adDate));
}

export function getBSMonthName(month: number): string {
  return BS_MONTHS[month] || "";
}

export function bsToAD(bs: BSDate): string | null {
  const cal = BS_CALENDAR[bs.year];
  if (!cal) return null;
  if (bs.month < 0 || bs.month > 11) return null;
  if (bs.day < 1 || bs.day > cal[bs.month]) return null;

  let totalDays = 0;
  for (let y = BS_EPOCH_BS.year; y < bs.year; y++) {
    const yCal = BS_CALENDAR[y];
    if (!yCal) return null;
    totalDays += yCal.reduce((a, b) => a + b, 0);
  }
  for (let m = 0; m < bs.month; m++) {
    totalDays += cal[m];
  }
  totalDays += bs.day - BS_EPOCH_BS.day;

  const result = new Date(BS_EPOCH_AD.getTime());
  result.setDate(result.getDate() + totalDays);
  const yyyy = result.getFullYear();
  const mm = String(result.getMonth() + 1).padStart(2, "0");
  const dd = String(result.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function bsStringToAD(bsStr: string): string | null {
  const parts = bsStr.split("-");
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  return bsToAD({ year, month, day });
}

export function adToBSFormatted(adDate: string): string {
  const bs = adToBS(adDate);
  if (!bs) return "";
  const mm = String(bs.month + 1).padStart(2, "0");
  const dd = String(bs.day).padStart(2, "0");
  return `${bs.year}-${mm}-${dd}`;
}

export function getTodayBS(): BSDate | null {
  return adToBS(new Date());
}
