/**
 * Timezone/interval utilities for the family calendar (Phase 7). No
 * dependency — same "dependency-free, local-constructor-only" discipline
 * as src/domain/tasks/dateUtils.ts, extended to a genuinely different
 * problem: events store an unambiguous instant (`starts_at`/`ends_at` are
 * Postgres `timestamptz`, i.e. UTC internally) plus an IANA `timezone` for
 * correct rendering — never a bare local date string like `tasks.date`, so
 * the "never parse a date-only string through the UTC ISO path" warning
 * that module exists for does not apply here in the same direction.
 *
 * What *does* apply: computing which UTC instant range corresponds to "the
 * device's selected local calendar day," for a day-range query
 * (`starts_at >= dayStart AND starts_at < dayNext`). That conversion must
 * go through the local `Date` constructor (which resolves in the device's
 * actual configured timezone, DST included) — never a manual UTC-offset
 * calculation, which would silently break across a DST transition.
 */

/** The device's current IANA timezone (e.g. "Europe/Kyiv"), for stamping new events. */
export function getDeviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export interface UtcDayBounds {
  /** ISO instant of local midnight on the given day, in UTC. */
  startUtc: string;
  /** ISO instant of local midnight on the *next* day, in UTC — half-open upper bound. */
  endUtc: string;
}

/**
 * Given a local calendar day (year/month/day, 1-indexed month), returns the
 * [startUtc, endUtc) instant range for that day *in the device's own
 * configured timezone* — correct across DST because it goes through the
 * local `Date` constructor rather than a fixed-offset calculation.
 */
export function localDayBoundsUtc(year: number, month: number, day: number): UtcDayBounds {
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0);
  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

/** `localDayBoundsUtc` for a specific `Date`'s own local calendar day. */
export function dayBoundsUtcFor(date: Date): UtcDayBounds {
  return localDayBoundsUtc(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/**
 * Half-open interval overlap: `[aStart, aEnd)` vs `[bStart, bEnd)`. An
 * interval ending exactly when another begins does *not* overlap — see
 * docs/DECISIONS.md, "Phase 7," for why this convention was chosen (a
 * pickup ending at 18:00 and a shift starting at 18:00 are not a
 * conflict).
 */
export function intervalsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(aEnd).getTime() > new Date(bStart).getTime();
}

/** Formats an ISO instant as a locale-aware local time label ("HH:MM" / "h:mm a"). */
export function formatEventTimeLabel(isoInstant: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(isoInstant));
}

/** Formats an ISO instant as a locale-aware local date label, for headers/day navigation. */
export function formatEventDateLabel(isoInstant: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(
    new Date(isoInstant),
  );
}

/** True if `isoInstant`'s local calendar day matches `reference`'s local calendar day. */
export function isSameLocalDay(isoInstant: string, reference: Date): boolean {
  const d = new Date(isoInstant);
  return (
    d.getFullYear() === reference.getFullYear() &&
    d.getMonth() === reference.getMonth() &&
    d.getDate() === reference.getDate()
  );
}

/** The local calendar day one day after `date` — for Previous/Next day navigation. */
export function addLocalDays(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta);
}
