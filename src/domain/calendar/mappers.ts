import type {
  CalendarEvent,
  EventVisibility,
  FamilyResponsibilityItem,
  FamilyScheduleItem,
  Responsibility,
  ResponsibilityStatus,
  ResponsibilityType,
} from './types';

// Raw row shapes matched exactly to supabase/migrations/20260907120000_family_calendar.sql
// (events/responsibilities/family_schedule/family_responsibilities) — kept
// as local interfaces here, decoupled from the generated Supabase row
// shape, same convention as src/domain/tasks/mappers.ts (and CHECK-
// constrained columns come back widened to plain `string` from the real
// generator too, which the narrowing helpers below account for either way).
export interface RawEventRow {
  id: string;
  owner_profile_id: string;
  family_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  visibility: string;
  created_at: string;
  updated_at: string;
}

export interface RawResponsibilityRow {
  id: string;
  event_id: string;
  family_id: string;
  type: string;
  label: string | null;
  assignee_member_id: string | null;
  status: string;
}

export interface RawFamilyScheduleRow {
  id: string;
  family_id: string;
  owner_profile_id: string;
  starts_at: string;
  ends_at: string;
  visibility: string;
  title: string | null;
  description: string | null;
  location: string | null;
  participant_member_id: string | null;
}

export interface RawFamilyResponsibilityRow {
  id: string;
  event_id: string;
  family_id: string;
  type: string;
  label: string | null;
  assignee_member_id: string | null;
  status: string;
  event_starts_at: string;
  event_ends_at: string;
  event_title: string;
  due_at: string;
}

const EVENT_VISIBILITIES: readonly EventVisibility[] = ['private', 'family'];
const RESPONSIBILITY_STATUSES: readonly ResponsibilityStatus[] = [
  'unassigned',
  'pending_acceptance',
  'accepted',
  'declined',
  'done',
];
const RESPONSIBILITY_TYPES: readonly ResponsibilityType[] = ['drop_off', 'pick_up', 'supervise', 'custom'];

function asVisibility(value: string): EventVisibility {
  return (EVENT_VISIBILITIES as readonly string[]).includes(value) ? (value as EventVisibility) : 'private';
}

function asResponsibilityStatus(value: string): ResponsibilityStatus {
  return (RESPONSIBILITY_STATUSES as readonly string[]).includes(value)
    ? (value as ResponsibilityStatus)
    : 'unassigned';
}

function asResponsibilityType(value: string): ResponsibilityType {
  return (RESPONSIBILITY_TYPES as readonly string[]).includes(value) ? (value as ResponsibilityType) : 'custom';
}

export function mapEventRow(row: RawEventRow): CalendarEvent {
  return {
    id: row.id,
    ownerProfileId: row.owner_profile_id,
    familyId: row.family_id,
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    visibility: asVisibility(row.visibility),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapResponsibilityRow(row: RawResponsibilityRow): Responsibility {
  return {
    id: row.id,
    eventId: row.event_id,
    familyId: row.family_id,
    type: asResponsibilityType(row.type),
    label: row.label,
    assigneeMemberId: row.assignee_member_id,
    status: asResponsibilityStatus(row.status),
  };
}

export function mapFamilyScheduleRow(row: RawFamilyScheduleRow): FamilyScheduleItem {
  return {
    id: row.id,
    familyId: row.family_id,
    ownerProfileId: row.owner_profile_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    visibility: asVisibility(row.visibility),
    title: row.title,
    description: row.description,
    location: row.location,
    participantMemberId: row.participant_member_id,
  };
}

export function mapFamilyResponsibilityRow(row: RawFamilyResponsibilityRow): FamilyResponsibilityItem {
  return {
    id: row.id,
    eventId: row.event_id,
    familyId: row.family_id,
    type: asResponsibilityType(row.type),
    label: row.label,
    assigneeMemberId: row.assignee_member_id,
    status: asResponsibilityStatus(row.status),
    eventStartsAt: row.event_starts_at,
    eventEndsAt: row.event_ends_at,
    eventTitle: row.event_title,
    dueAt: row.due_at,
  };
}
