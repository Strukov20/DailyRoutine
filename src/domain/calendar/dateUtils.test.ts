import { addLocalDays, dayBoundsUtcFor, intervalsOverlap, isSameLocalDay, localDayBoundsUtc } from './dateUtils';

/**
 * Unlike src/domain/tasks/dateUtils.ts (deliberately timezone-independent
 * date-only strings), these functions intentionally resolve against the
 * actual runtime's configured local timezone — that's the whole point of
 * localDayBoundsUtc (see its own doc comment). Per docs/DECISIONS.md,
 * "Phase 4," `process.env.TZ` reassignment is not reliably honored inside
 * this project's jest-expo environment, so these tests are self-consistent
 * (asserting the function's own round-trip behavior against whatever
 * timezone this test runner is actually in) rather than a multi-timezone
 * matrix — that class of coverage belongs to intervalsOverlap below
 * instead, which is pure arithmetic with no timezone dependency at all.
 */

describe('localDayBoundsUtc / dayBoundsUtcFor', () => {
  it('returns a range exactly 24 hours apart', () => {
    const { startUtc, endUtc } = localDayBoundsUtc(2026, 9, 15);
    const diffMs = new Date(endUtc).getTime() - new Date(startUtc).getTime();
    expect(diffMs).toBe(24 * 60 * 60 * 1000);
  });

  it('startUtc round-trips to local midnight and endUtc to the next local midnight', () => {
    const { startUtc, endUtc } = localDayBoundsUtc(2026, 9, 15);
    const start = new Date(startUtc);
    const end = new Date(endUtc);
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()]).toEqual([
      2026, 8, 15, 0, 0,
    ]);
    expect([end.getFullYear(), end.getMonth(), end.getDate(), end.getHours(), end.getMinutes()]).toEqual([
      2026, 8, 16, 0, 0,
    ]);
  });

  it('handles a month boundary correctly', () => {
    const { endUtc } = localDayBoundsUtc(2026, 9, 30);
    const end = new Date(endUtc);
    expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([2026, 9, 1]);
  });

  it('dayBoundsUtcFor matches localDayBoundsUtc for the same calendar day', () => {
    const reference = new Date(2026, 8, 15, 14, 30, 0);
    expect(dayBoundsUtcFor(reference)).toEqual(localDayBoundsUtc(2026, 9, 15));
  });
});

describe('intervalsOverlap — half-open [start, end) semantics, no timezone dependency', () => {
  it('detects a genuine overlap', () => {
    expect(
      intervalsOverlap('2026-09-15T17:00:00Z', '2026-09-15T18:00:00Z', '2026-09-15T17:30:00Z', '2026-09-15T18:30:00Z'),
    ).toBe(true);
  });

  it('one interval fully containing another is an overlap', () => {
    expect(
      intervalsOverlap('2026-09-15T17:00:00Z', '2026-09-15T19:00:00Z', '2026-09-15T17:30:00Z', '2026-09-15T18:00:00Z'),
    ).toBe(true);
  });

  it('a boundary touch (one ends exactly when the other begins) is NOT an overlap', () => {
    expect(
      intervalsOverlap('2026-09-15T17:00:00Z', '2026-09-15T18:00:00Z', '2026-09-15T18:00:00Z', '2026-09-15T19:00:00Z'),
    ).toBe(false);
    expect(
      intervalsOverlap('2026-09-15T18:00:00Z', '2026-09-15T19:00:00Z', '2026-09-15T17:00:00Z', '2026-09-15T18:00:00Z'),
    ).toBe(false);
  });

  it('completely disjoint intervals do not overlap', () => {
    expect(
      intervalsOverlap('2026-09-15T17:00:00Z', '2026-09-15T18:00:00Z', '2026-09-15T20:00:00Z', '2026-09-15T21:00:00Z'),
    ).toBe(false);
  });

  it('is symmetric', () => {
    const a = ['2026-09-15T17:00:00Z', '2026-09-15T18:00:00Z'] as const;
    const b = ['2026-09-15T17:30:00Z', '2026-09-15T18:30:00Z'] as const;
    expect(intervalsOverlap(a[0], a[1], b[0], b[1])).toBe(intervalsOverlap(b[0], b[1], a[0], a[1]));
  });
});

describe('isSameLocalDay', () => {
  it('is true for the same local calendar day', () => {
    const reference = new Date(2026, 8, 15, 10, 0, 0);
    expect(isSameLocalDay(new Date(2026, 8, 15, 23, 59, 0).toISOString(), reference)).toBe(true);
  });

  it('is false across a local calendar-day boundary', () => {
    const reference = new Date(2026, 8, 15, 10, 0, 0);
    expect(isSameLocalDay(new Date(2026, 8, 16, 0, 0, 1).toISOString(), reference)).toBe(false);
  });
});

describe('addLocalDays', () => {
  it('adds and subtracts local days, including across a month boundary', () => {
    const reference = new Date(2026, 8, 30);
    const next = addLocalDays(reference, 1);
    expect([next.getFullYear(), next.getMonth(), next.getDate()]).toEqual([2026, 9, 1]);

    const previous = addLocalDays(reference, -1);
    expect([previous.getFullYear(), previous.getMonth(), previous.getDate()]).toEqual([2026, 8, 29]);
  });
});
