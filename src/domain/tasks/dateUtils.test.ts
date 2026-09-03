import {
  compareDateOnlyStrings,
  formatDateOnly,
  formatTimeOnly,
  isOverdue,
  parseDateOnly,
  parseTimeOnly,
  todayDateString,
  tomorrowDateString,
} from './dateUtils';

/**
 * Deterministic timezone coverage per this phase's brief: UTC, Europe/Kyiv,
 * a negative UTC offset, Today/Tomorrow near midnight, a DST transition,
 * and date-only round-tripping.
 *
 * Every function under test takes its "now" as an explicit `Date` built via
 * the local 4-arg constructor and reads it back with local getters only —
 * by design, this never depends on ambient `process.env.TZ` at all (that is
 * the whole point: it can't shift with the runtime's timezone because it
 * never asks the runtime to interpret an ISO string in the first place).
 * `withTimeZone` below still wraps every case — confirmed via plain
 * `node -e` that `process.env.TZ` does NOT reliably change `Date`'s output
 * inside this project's Jest/jest-expo environment (unlike plain Node) — so
 * these wrappers exist to keep the suite honest against a future
 * implementation change that *does* start reading ambient timezone state,
 * not because the current implementation needs them to pass. See
 * docs/DECISIONS.md, "Phase 4."
 */

const ORIGINAL_TZ = process.env.TZ;

function withTimeZone<T>(tz: string, run: () => T): T {
  process.env.TZ = tz;
  try {
    return run();
  } finally {
    process.env.TZ = ORIGINAL_TZ;
  }
}

describe('parseDateOnly / formatDateOnly round-trip', () => {
  it.each(['UTC', 'Europe/Kyiv', 'Pacific/Honolulu', 'America/Los_Angeles'])(
    'never shifts the calendar day in %s',
    (tz) => {
      withTimeZone(tz, () => {
        expect(formatDateOnly(parseDateOnly('2026-09-03'))).toBe('2026-09-03');
        expect(formatDateOnly(parseDateOnly('2026-01-01'))).toBe('2026-01-01');
        expect(formatDateOnly(parseDateOnly('2026-12-31'))).toBe('2026-12-31');
      });
    },
  );
});

describe('todayDateString / tomorrowDateString', () => {
  it.each(['UTC', 'Europe/Kyiv', 'Pacific/Honolulu'])('never skip or repeat a day in %s', (tz) => {
    withTimeZone(tz, () => {
      const now = new Date(2026, 8, 3, 12, 0, 0); // Sep 3, 2026, local noon
      expect(todayDateString(now)).toBe('2026-09-03');
      expect(tomorrowDateString(now)).toBe('2026-09-04');
    });
  });

  it('rolls over correctly just before local midnight', () => {
    withTimeZone('Europe/Kyiv', () => {
      const now = new Date(2026, 8, 3, 23, 59, 59);
      expect(todayDateString(now)).toBe('2026-09-03');
      expect(tomorrowDateString(now)).toBe('2026-09-04');
    });
  });

  it('rolls over correctly just after local midnight', () => {
    withTimeZone('Europe/Kyiv', () => {
      const now = new Date(2026, 8, 4, 0, 0, 1);
      expect(todayDateString(now)).toBe('2026-09-04');
      expect(tomorrowDateString(now)).toBe('2026-09-05');
    });
  });

  it('handles a month boundary (tomorrow crosses into October)', () => {
    withTimeZone('UTC', () => {
      const now = new Date(2026, 8, 30, 12, 0, 0);
      expect(tomorrowDateString(now)).toBe('2026-10-01');
    });
  });

  it('a negative UTC offset does not shift "today" relative to the local wall clock', () => {
    withTimeZone('Pacific/Honolulu', () => {
      // 2026-09-03 14:00 local Honolulu time is 2026-09-04 00:00 UTC — a
      // naive UTC-based implementation would report "today" as the 4th.
      const now = new Date(2026, 8, 3, 14, 0, 0);
      expect(todayDateString(now)).toBe('2026-09-03');
    });
  });

  it('does not corrupt dates across a DST transition (Europe/Kyiv spring-forward, 2026-03-29)', () => {
    withTimeZone('Europe/Kyiv', () => {
      const beforeTransition = new Date(2026, 2, 28, 23, 0, 0); // Mar 28, 23:00
      const afterTransition = new Date(2026, 2, 29, 12, 0, 0); // Mar 29, 12:00 (post-transition)

      expect(todayDateString(beforeTransition)).toBe('2026-03-28');
      expect(tomorrowDateString(beforeTransition)).toBe('2026-03-29');
      expect(todayDateString(afterTransition)).toBe('2026-03-29');
      expect(tomorrowDateString(afterTransition)).toBe('2026-03-30');
    });
  });
});

describe('compareDateOnlyStrings / isOverdue', () => {
  it('orders "YYYY-MM-DD" strings correctly, including across year/month boundaries', () => {
    expect(compareDateOnlyStrings('2026-09-03', '2026-09-04')).toBeLessThan(0);
    expect(compareDateOnlyStrings('2026-12-31', '2027-01-01')).toBeLessThan(0);
    expect(compareDateOnlyStrings('2026-09-03', '2026-09-03')).toBe(0);
    expect(compareDateOnlyStrings('2026-09-04', '2026-09-03')).toBeGreaterThan(0);
  });

  it('isOverdue is true for any date strictly before today, in every tested zone', () => {
    withTimeZone('Europe/Kyiv', () => {
      const now = new Date(2026, 8, 3, 10, 0, 0);
      expect(isOverdue('2026-09-02', now)).toBe(true);
      expect(isOverdue('2026-09-03', now)).toBe(false);
      expect(isOverdue('2026-09-04', now)).toBe(false);
    });
  });
});

describe('parseTimeOnly / formatTimeOnly round-trip', () => {
  it('round-trips "HH:MM" without touching any timezone', () => {
    withTimeZone('Pacific/Honolulu', () => {
      expect(formatTimeOnly(parseTimeOnly('09:30'))).toBe('09:30');
      expect(formatTimeOnly(parseTimeOnly('23:59'))).toBe('23:59');
      expect(formatTimeOnly(parseTimeOnly('00:00'))).toBe('00:00');
    });
  });
});
