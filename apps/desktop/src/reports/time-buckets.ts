import type { CellValue } from "./types";

export type TimeGrain = "exact" | "day" | "week" | "month" | "quarter" | "year";

export const TIME_GRAIN_LABELS: Record<TimeGrain, string> = {
  exact: "Data esatta",
  day: "Giorno",
  week: "Settimana",
  month: "Mese",
  quarter: "Trimestre",
  year: "Anno",
};

export interface TimeBucket {
  key: string;
  label: string;
  sortKey: number;
}

interface ParsedIsoDate {
  instant: Date;
  year: number;
  month: number;
  day: number;
}

const ISO_DATE_VALUE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const MILLIS_PER_DAY = 86_400_000;
const ITALIAN_MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"] as const;

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

function daysInMonth(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCDate();
}

function utcTimestamp(year: number, month: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function parseIsoDate(value: CellValue | undefined): ParsedIsoDate | null {
  if (typeof value !== "string") return null;
  const match = ISO_DATE_VALUE.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText, zoneText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;

  if (!hourText) {
    const timestamp = utcTimestamp(year, month, day);
    return Number.isFinite(timestamp) ? { instant: new Date(timestamp), year, month, day } : null;
  }

  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = secondText ? Number(secondText) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (zoneText && zoneText !== "Z") {
    const offsetHours = Number(zoneText.slice(1, 3));
    const offsetMinutes = Number(zoneText.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) return null;
  }

  // A timezone-less ISO datetime is interpreted as UTC so the result never
  // changes with the machine running the report.
  const normalizedFraction = fractionText ? fractionText.padEnd(3, "0").slice(0, 3) : "000";
  const normalizedZone = zoneText ?? "Z";
  const normalized = `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${pad(second)}.${normalizedFraction}${normalizedZone}`;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) return null;
  return { instant: new Date(timestamp), year, month, day };
}

function dateParts(date: Date): { year: number; month: number; day: number } {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function dayBucket(date: Date): TimeBucket {
  const { year, month, day } = dateParts(date);
  const key = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
  return { key, label: `${pad(day)}/${pad(month)}/${pad(year, 4)}`, sortKey: utcTimestamp(year, month, day) };
}

function weekBucket(date: Date): TimeBucket {
  const current = new Date(date.getTime());
  current.setUTCHours(0, 0, 0, 0);
  const weekday = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() - weekday + 1);

  const thursday = new Date(current.getTime());
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(0);
  firstThursday.setUTCFullYear(isoYear, 0, 4);
  firstThursday.setUTCHours(0, 0, 0, 0);
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (MILLIS_PER_DAY * 7));
  const key = `${pad(isoYear, 4)}-W${pad(week)}`;
  return { key, label: `Settimana ${week} · ${pad(isoYear, 4)}`, sortKey: current.getTime() };
}

function monthBucket(date: Date): TimeBucket {
  const { year, month } = dateParts(date);
  const key = `${pad(year, 4)}-${pad(month)}`;
  return { key, label: `${ITALIAN_MONTHS[month - 1]} ${pad(year, 4)}`, sortKey: utcTimestamp(year, month, 1) };
}

function quarterBucket(date: Date): TimeBucket {
  const { year, month } = dateParts(date);
  const quarter = Math.floor((month - 1) / 3) + 1;
  return { key: `${pad(year, 4)}-Q${quarter}`, label: `T${quarter} ${pad(year, 4)}`, sortKey: utcTimestamp(year, (quarter - 1) * 3 + 1, 1) };
}

function yearBucket(date: Date): TimeBucket {
  const year = date.getUTCFullYear();
  return { key: pad(year, 4), label: pad(year, 4), sortKey: utcTimestamp(year, 1, 1) };
}

export function bucketTimeValue(value: CellValue | undefined, grain: TimeGrain): TimeBucket | null {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  if (grain === "exact") return { key: String(value), label: String(value), sortKey: parsed.instant.getTime() };
  if (grain === "day") return dayBucket(parsed.instant);
  if (grain === "week") return weekBucket(parsed.instant);
  if (grain === "month") return monthBucket(parsed.instant);
  if (grain === "quarter") return quarterBucket(parsed.instant);
  return yearBucket(parsed.instant);
}
