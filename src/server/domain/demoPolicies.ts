/**
 * Demonstration pay policies for the two fictional organisations.
 * These values illustrate configurability. They are NOT a statement of what any law requires.
 */
import type { PolicyRules } from '../../shared/types.ts';

/** Construction labour: hourly pay, overtime after 8 payable hours a day at 2x. */
export const CONSTRUCTION_LABOUR: PolicyRules = {
  overtime: { eligible: true, mode: 'daily', thresholdMinutes: 8 * 60, multiplierBp: 20_000 },
  unpaidBreak: { afterMinutes: 5 * 60, minutes: 30 },
  nightAllowancePaise: 0,
  standardMonthlyMinutes: 208 * 60,
  fatigue: { maxShiftMinutes: 12 * 60, minRestMinutes: 10 * 60, maxWeeklyMinutes: 48 * 60, maxConsecutiveDays: 6 },
  missedCheckoutAfterMinutes: 16 * 60,
};

/** College facilities staff: monthly salary, overtime after 48 hours a week at 1.5x, night allowance. */
export const COLLEGE_FACILITIES: PolicyRules = {
  overtime: { eligible: true, mode: 'weekly', thresholdMinutes: 48 * 60, multiplierBp: 15_000 },
  unpaidBreak: { afterMinutes: 6 * 60, minutes: 30 },
  nightAllowancePaise: 100_00,
  standardMonthlyMinutes: 208 * 60,
  fatigue: { maxShiftMinutes: 12 * 60, minRestMinutes: 11 * 60, maxWeeklyMinutes: 48 * 60, maxConsecutiveDays: 6 },
  missedCheckoutAfterMinutes: 16 * 60,
};
