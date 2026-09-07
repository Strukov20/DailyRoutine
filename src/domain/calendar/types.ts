/**
 * Domain shapes for the family calendar (Phase 7) — decoupled from the
 * generated Supabase row shape, same convention as src/domain/tasks/types.ts.
 * `startsAt`/`endsAt` stay as raw ISO timestamptz strings (never parsed into
 * a `Date` here) — see src/domain/calendar/dateUtils.ts for the day-boundary
 * and overlap helpers built around that.
 */

export type EventVisibility = 'private' | 'family';

export interface CalendarEvent {
  id: string;
  ownerProfileId: string;
  familyId: string | null;
  title: string;
  description: string | null;
  location: string | null;
  /** ISO timestamptz — an unambiguous instant, never a naive local string. */
  startsAt: string;
  endsAt: string;
  /** IANA zone captured at creation/edit time, for correct local rendering. */
  timezone: string;
  visibility: EventVisibility;
  createdAt: string;
  updatedAt: string;
}

/**
 * The same state-machine vocabulary as tasks.assignment_status (Phase 5) —
 * see docs/DECISIONS.md, "Phase 7" for why responsibilities.status was kept
 * as-is rather than renamed.
 */
export type ResponsibilityStatus = 'unassigned' | 'pending_acceptance' | 'accepted' | 'declined' | 'done';
export type ResponsibilityType = 'drop_off' | 'pick_up' | 'supervise' | 'custom';

export interface Responsibility {
  id: string;
  eventId: string;
  familyId: string;
  type: ResponsibilityType;
  label: string | null;
  assigneeMemberId: string | null;
  status: ResponsibilityStatus;
}

/** A row from the sanitized `family_schedule` view — see docs/DATA_MODEL.md. */
export interface FamilyScheduleItem {
  id: string;
  familyId: string;
  ownerProfileId: string;
  startsAt: string;
  endsAt: string;
  visibility: EventVisibility;
  /** null for a private item — the Busy-block case. */
  title: string | null;
  description: string | null;
  location: string | null;
  /** The event's primary participant (e.g. which child), null for a private item or one with none. */
  participantMemberId: string | null;
}

/**
 * A row from the sanitized `family_responsibilities` view. Never itself
 * sanitized — see that view's own comment for why (a responsibility can
 * only exist on a family-visible event).
 */
export interface FamilyResponsibilityItem {
  id: string;
  eventId: string;
  familyId: string;
  type: ResponsibilityType;
  label: string | null;
  assigneeMemberId: string | null;
  status: ResponsibilityStatus;
  eventStartsAt: string;
  eventEndsAt: string;
  eventTitle: string;
  /** Derived: the event's starts_at for drop_off, ends_at for pick_up/others. */
  dueAt: string;
}

export interface CreateChildEventParams {
  familyId: string;
  childMemberId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  description?: string;
  location?: string;
  dropOffAssigneeMemberId?: string;
  pickUpAssigneeMemberId?: string;
}
