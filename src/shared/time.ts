/**
 * Time helpers. Instants are stored and passed as UTC epoch milliseconds;
 * an organisation's IANA time zone decides which calendar day a shift belongs to.
 */
export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = partFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    partFormatters.set(timeZone, fmt);
  }
  return fmt;
}

export function localParts(instant: number, timeZone: string): LocalParts {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(new Date(instant))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Calendar date ("YYYY-MM-DD") of an instant in the given zone. */
export function localDateKey(instant: number, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function offsetMs(instant: number, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(instant / MINUTE_MS) * MINUTE_MS;
}

/** Converts a wall-clock time in `timeZone` to a UTC instant. */
export function zonedToUtc(dateKey: string, hhmm: string, timeZone: string): number {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetMs(guess, timeZone);
  // Re-check once so a DST transition between `guess` and `first` is honoured.
  return guess - offsetMs(first, timeZone);
}

export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** ISO-8601 week key ("2026-W40") of a calendar date. Weeks run Monday to Sunday. */
export function isoWeekKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad(week)}`;
}

export interface Period {
  /** "YYYY-MM" */
  id: string;
  /** First calendar day, inclusive. */
  start: string;
  /** Day after the last calendar day. */
  endExclusive: string;
  days: number;
}

export function monthPeriod(periodId: string): Period {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId)) throw new RangeError(`Invalid period ${periodId}`);
  const [y, m] = periodId.split('-').map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = `${periodId}-01`;
  return { id: periodId, start, endExclusive: addDays(start, days), days };
}

export function periodOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function previousPeriod(periodId: string): string {
  const [y, m] = periodId.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

/** Whole days between two date keys (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}
