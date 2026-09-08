import { supabase } from '@/lib/supabase/client';
import { createLogger } from '@/lib/logger/logger';
import {
  mapEventRow,
  mapFamilyResponsibilityRow,
  mapFamilyScheduleRow,
  mapResponsibilityRow,
  type RawEventRow,
  type RawFamilyResponsibilityRow,
  type RawFamilyScheduleRow,
  type RawResponsibilityRow,
} from '@/domain/calendar/mappers';
import type {
  CalendarEvent,
  CreateChildEventParams,
  EventVisibility,
  FamilyResponsibilityItem,
  FamilyScheduleItem,
  Responsibility,
} from '@/domain/calendar/types';

const logger = createLogger('calendar-service');

/**
 * Transport-layer wrapper around the event/responsibility RPCs and their
 * supporting reads — the only place in the app that calls
 * `supabase.rpc(...)` or `supabase.from('events' | 'responsibilities')`
 * directly. Screens go through src/domain/calendar/hooks.ts, which goes
 * through this module. Mirrors src/lib/tasks/taskService.ts's established
 * pattern. Every mutation here is a narrowly scoped SECURITY DEFINER RPC —
 * see supabase/migrations/20260907120000_family_calendar.sql — never a raw
 * table INSERT/UPDATE/DELETE, because `events`/`responsibilities`
 * intentionally have no such grant for `authenticated`.
 */

export type CalendarErrorCode = 'forbidden' | 'invalid_input' | 'conflict' | 'unknown';

const CODE_BY_SQLSTATE: Record<string, CalendarErrorCode> = {
  '42501': 'forbidden',
  '22023': 'invalid_input',
  '23514': 'invalid_input',
  // The responsibility assignment state machine raises 40001 for a stale/
  // already-resolved state — same convention as task_assignments (Phase 5).
  '40001': 'conflict',
};

export class CalendarServiceError extends Error {
  readonly code: CalendarErrorCode;

  constructor(code: CalendarErrorCode, message: string) {
    super(message);
    this.name = 'CalendarServiceError';
    this.code = code;
  }
}

function toCalendarServiceError(error: unknown): CalendarServiceError {
  const sqlState = (error as { code?: string } | null | undefined)?.code;
  const message = error instanceof Error ? error.message : 'Unknown calendar error';
  logger.warn('calendar request failed', { sqlState, message });
  const normalized = (sqlState && CODE_BY_SQLSTATE[sqlState]) || 'unknown';
  return new CalendarServiceError(normalized, message);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The caller's own events (personal or family-linked) overlapping [startUtc, endUtc). */
export async function listOwnEventsForRange(
  ownerProfileId: string,
  startUtc: string,
  endUtc: string,
): Promise<CalendarEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('owner_profile_id', ownerProfileId)
    .lt('starts_at', endUtc)
    .gt('ends_at', startUtc)
    .order('starts_at', { ascending: true });
  if (error) throw toCalendarServiceError(error);
  return (data as RawEventRow[]).map(mapEventRow);
}

/** The sanitized family day agenda (events) — Busy blocks included, private content nulled. */
export async function listFamilyScheduleForRange(
  familyId: string,
  startUtc: string,
  endUtc: string,
): Promise<FamilyScheduleItem[]> {
  const { data, error } = await supabase
    .from('family_schedule')
    .select('*')
    .eq('family_id', familyId)
    .lt('starts_at', endUtc)
    .gt('ends_at', startUtc)
    .order('starts_at', { ascending: true });
  if (error) throw toCalendarServiceError(error);
  return (data as RawFamilyScheduleRow[]).map(mapFamilyScheduleRow);
}

/** The sanitized family day agenda (drop-off/pick-up/etc. responsibilities), by due time. */
export async function listFamilyResponsibilitiesForRange(
  familyId: string,
  startUtc: string,
  endUtc: string,
): Promise<FamilyResponsibilityItem[]> {
  const { data, error } = await supabase
    .from('family_responsibilities')
    .select('*')
    .eq('family_id', familyId)
    .lt('due_at', endUtc)
    .gt('due_at', startUtc)
    .order('due_at', { ascending: true });
  if (error) throw toCalendarServiceError(error);
  return (data as RawFamilyResponsibilityRow[]).map(mapFamilyResponsibilityRow);
}

export async function getEvent(eventId: string): Promise<CalendarEvent | null> {
  const { data, error } = await supabase.from('events').select('*').eq('id', eventId).maybeSingle();
  if (error) throw toCalendarServiceError(error);
  return data ? mapEventRow(data as RawEventRow) : null;
}

export async function listResponsibilitiesForEvent(eventId: string): Promise<Responsibility[]> {
  const { data, error } = await supabase.from('responsibilities').select('*').eq('event_id', eventId);
  if (error) throw toCalendarServiceError(error);
  return (data as RawResponsibilityRow[]).map(mapResponsibilityRow);
}

/** Read-only, deterministic, privacy-safe — see has_member_schedule_conflict's own comment. */
export async function hasMemberScheduleConflict(
  memberId: string,
  startUtc: string,
  endUtc: string,
  excludeResponsibilityId?: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_member_schedule_conflict', {
    p_member_id: memberId,
    p_starts_at: startUtc,
    p_ends_at: endUtc,
    p_exclude_responsibility_id: excludeResponsibilityId,
  });
  if (error) throw toCalendarServiceError(error);
  return data;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface CreatePersonalEventParams {
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  description?: string;
  location?: string;
  visibility?: EventVisibility;
  familyId?: string;
}

export async function createPersonalEvent(params: CreatePersonalEventParams): Promise<string> {
  const { data, error } = await supabase.rpc('create_personal_event', {
    p_title: params.title,
    p_starts_at: params.startsAt,
    p_ends_at: params.endsAt,
    p_timezone: params.timezone,
    p_description: params.description,
    p_location: params.location,
    p_visibility: params.visibility,
    p_family_id: params.familyId,
  });
  if (error) throw toCalendarServiceError(error);
  return data;
}

export interface CreateFamilyEventParams {
  familyId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  description?: string;
  location?: string;
}

export async function createFamilyEvent(params: CreateFamilyEventParams): Promise<string> {
  const { data, error } = await supabase.rpc('create_family_event', {
    p_family_id: params.familyId,
    p_title: params.title,
    p_starts_at: params.startsAt,
    p_ends_at: params.endsAt,
    p_timezone: params.timezone,
    p_description: params.description,
    p_location: params.location,
  });
  if (error) throw toCalendarServiceError(error);
  return data;
}

export async function createChildEvent(params: CreateChildEventParams): Promise<string> {
  const { data, error } = await supabase.rpc('create_child_event', {
    p_family_id: params.familyId,
    p_child_member_id: params.childMemberId,
    p_title: params.title,
    p_starts_at: params.startsAt,
    p_ends_at: params.endsAt,
    p_timezone: params.timezone,
    p_description: params.description,
    p_location: params.location,
    p_drop_off_assignee_member_id: params.dropOffAssigneeMemberId,
    p_pick_up_assignee_member_id: params.pickUpAssigneeMemberId,
  });
  if (error) throw toCalendarServiceError(error);
  return data;
}

export interface UpdateEventParams {
  eventId: string;
  title?: string;
  description?: string;
  clearDescription?: boolean;
  location?: string;
  clearLocation?: boolean;
  startsAt?: string;
  endsAt?: string;
  timezone?: string;
  visibility?: EventVisibility;
}

export async function updateEvent(params: UpdateEventParams): Promise<void> {
  const { error } = await supabase.rpc('update_event', {
    p_event_id: params.eventId,
    p_title: params.title,
    p_description: params.description,
    p_clear_description: params.clearDescription,
    p_location: params.location,
    p_clear_location: params.clearLocation,
    p_starts_at: params.startsAt,
    p_ends_at: params.endsAt,
    p_timezone: params.timezone,
    p_visibility: params.visibility,
  });
  if (error) throw toCalendarServiceError(error);
}

export async function cancelEvent(eventId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_event', { p_event_id: eventId });
  if (error) throw toCalendarServiceError(error);
}

export async function assignEventResponsibility(responsibilityId: string, assigneeMemberId: string): Promise<void> {
  const { error } = await supabase.rpc('assign_event_responsibility', {
    p_responsibility_id: responsibilityId,
    p_assignee_member_id: assigneeMemberId,
  });
  if (error) throw toCalendarServiceError(error);
}

export async function reassignEventResponsibility(responsibilityId: string, assigneeMemberId: string): Promise<void> {
  const { error } = await supabase.rpc('reassign_event_responsibility', {
    p_responsibility_id: responsibilityId,
    p_assignee_member_id: assigneeMemberId,
  });
  if (error) throw toCalendarServiceError(error);
}

export async function takeEventResponsibility(responsibilityId: string): Promise<void> {
  const { error } = await supabase.rpc('take_event_responsibility', { p_responsibility_id: responsibilityId });
  if (error) throw toCalendarServiceError(error);
}

export async function acceptEventResponsibility(responsibilityId: string): Promise<void> {
  const { error } = await supabase.rpc('accept_event_responsibility', { p_responsibility_id: responsibilityId });
  if (error) throw toCalendarServiceError(error);
}

export async function declineEventResponsibility(responsibilityId: string): Promise<void> {
  const { error } = await supabase.rpc('decline_event_responsibility', { p_responsibility_id: responsibilityId });
  if (error) throw toCalendarServiceError(error);
}

export async function removeEventResponsibility(responsibilityId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_event_responsibility', { p_responsibility_id: responsibilityId });
  if (error) throw toCalendarServiceError(error);
}
