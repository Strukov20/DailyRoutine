/**
 * Date-only ("YYYY-MM-DD") utilities for personal tasks. No dependency —
 * deliberately dependency-free (see docs/DECISIONS.md, "Phase 4").
 *
 * The one rule every function here exists to enforce: a date-only value
 * must never round-trip through `Date`'s UTC-based ISO parsing/formatting
 * (`new Date('2026-09-03')`, `date.toISOString().slice(0, 10)`). Both of
 * those interpret/emit the string as UTC midnight, which is a *different*
 * calendar day from local midnight in every timezone with a non-zero UTC
 * offset — the exact bug class docs/DATA_MODEL.md's `tasks.date` design
 * (plain `date`, no timezone) and this phase's brief both call out by name.
 * Every function below reads/writes local calendar fields only
 * (`getFullYear`/`getMonth`/`getDate` and the 4-arg local `Date`
 * constructor), never the ISO/UTC path.
 */

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateOnlyString(value: string): boolean {
  return DATE_ONLY_PATTERN.test(value);
}

/** Parses "YYYY-MM-DD" into a local-midnight Date — never via the UTC ISO path. */
export function parseDateOnly(dateString: string): Date {
  const parts = dateString.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  return new Date(year, month - 1, day);
}

/** Formats a Date's *local* calendar date as "YYYY-MM-DD". */
export function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The device's current local calendar date, as "YYYY-MM-DD". */
export function todayDateString(now: Date = new Date()): string {
  return formatDateOnly(now);
}

/** The device's local calendar date one day after `now`, as "YYYY-MM-DD". */
export function tomorrowDateString(now: Date = new Date()): string {
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return formatDateOnly(local);
}

/**
 * "YYYY-MM-DD" strings compare correctly with plain string comparison
 * (zero-padded ISO 8601 date order == lexicographic order) — no Date
 * object, no timezone, involved at all. Prefer this over parsing both
 * sides just to compare them.
 */
export function compareDateOnlyStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isBeforeDateOnly(a: string, b: string): boolean {
  return compareDateOnlyStrings(a, b) < 0;
}

/** True if `dateString` is strictly before the device's current local date. */
export function isOverdue(dateString: string, now: Date = new Date()): boolean {
  return isBeforeDateOnly(dateString, todayDateString(now));
}

/** Parses "HH:MM" into a Date carrying that local time on an arbitrary reference day. */
export function parseTimeOnly(timeString: string): Date {
  const parts = timeString.split(':');
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  return new Date(2000, 0, 1, hours, minutes);
}

/** Formats a Date's *local* hours/minutes as "HH:MM" (24-hour, zero-padded). */
export function formatTimeOnly(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Formats "HH:MM:SS" (Postgres `time`) as a locale-aware "HH:MM" label.
 * Never touches a `Date`/timezone at all — a wall-clock time string has no
 * timezone of its own to convert.
 */
export function formatTimeLabel(startTime: string, locale: string): string {
  const [hoursStr, minutesStr] = startTime.split(':');
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);
  const reference = new Date(2000, 0, 1, hours, minutes);
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(reference);
}
