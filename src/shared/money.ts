/**
 * Money is always an integer count of paise (₹1 = 100 paise).
 * No floating-point value ever represents money in FairShift.
 */
export type Paise = number;

/** Basis points: 10000 = 1.0x. Multipliers are stored this way so they stay integers. */
export const BP_ONE = 10_000;

export function assertInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer, got ${value}`);
  }
}

/**
 * Integer division rounded half away from zero: round(numerator / denominator).
 * Both arguments must be safe integers and the denominator positive.
 */
export function divRound(numerator: number, denominator: number): number {
  assertInteger(numerator, 'numerator');
  assertInteger(denominator, 'denominator');
  if (denominator <= 0) throw new RangeError('denominator must be positive');
  const sign = numerator < 0 ? -1 : 1;
  const abs = Math.abs(numerator);
  const result = Math.floor((2 * abs + denominator) / (2 * denominator));
  return sign * result || 0;
}

/** Pay for `minutes` at `ratePaisePerHour` scaled by `multiplierBp`, rounded once to the paisa. */
export function payForMinutes(minutes: number, ratePaisePerHour: number, multiplierBp = BP_ONE): Paise {
  return divRound(minutes * ratePaisePerHour * multiplierBp, 60 * BP_ONE);
}

const formatters = new Map<string, Intl.NumberFormat>();

/** Formats paise as Indian rupees for the given locale, e.g. "₹1,200.00". */
export function formatINR(paise: Paise, locale = 'en-IN'): string {
  let fmt = formatters.get(locale);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
    formatters.set(locale, fmt);
  }
  return fmt.format(paise / 100);
}
