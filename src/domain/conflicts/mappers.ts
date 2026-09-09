import type { ConflictEntityType, ConflictSeverity, ConflictType, FamilyConflict } from './types';

// `list_family_conflicts`'s generated RPC return type marks every column
// non-nullable (src/lib/supabase/types.ts) even though member_id/
// primary_entity_id/secondary_entity_type/secondary_entity_id are all
// genuinely nullable at runtime (a redacted entity reference, or a
// conflict with no single responsible member) — same generated-type
// imprecision src/domain/calendar/mappers.ts already works around with its
// own hand-written `Raw*Row` interfaces, not the generated type directly.
export interface RawFamilyConflictRow {
  conflict_id: string;
  family_id: string;
  conflict_date: string;
  type: string;
  severity: string;
  member_id: string | null;
  primary_entity_type: string;
  primary_entity_id: string | null;
  secondary_entity_type: string | null;
  secondary_entity_id: string | null;
  safe_message_code: string;
  safe_message_params: unknown;
}

const CONFLICT_SEVERITIES: readonly ConflictSeverity[] = ['warning', 'critical'];
const CONFLICT_TYPES: readonly ConflictType[] = [
  'event_event',
  'task_event',
  'task_task',
  'responsibility_busy',
  'responsibility_responsibility',
  'unassigned_dropoff_pickup',
  'no_available_adult',
];
const CONFLICT_ENTITY_TYPES: readonly ConflictEntityType[] = ['event', 'task', 'occurrence', 'responsibility'];

// CHECK-constrained/free-text columns come back as plain `string` from the
// generated types — narrowed here with a safe fallback, same convention as
// src/domain/tasks/mappers.ts and src/domain/calendar/mappers.ts. An
// unrecognized value should never crash the Conflict Center; it should
// just render as generically as possible.
function asSeverity(value: string): ConflictSeverity {
  return (CONFLICT_SEVERITIES as readonly string[]).includes(value) ? (value as ConflictSeverity) : 'warning';
}

function asType(value: string): ConflictType {
  return (CONFLICT_TYPES as readonly string[]).includes(value) ? (value as ConflictType) : 'task_task';
}

function asEntityType(value: string | null): ConflictEntityType | null {
  if (value === null) return null;
  return (CONFLICT_ENTITY_TYPES as readonly string[]).includes(value) ? (value as ConflictEntityType) : null;
}

function asMessageParams(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  const params: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') params[key] = entry;
  }
  return params;
}

export function mapFamilyConflictRow(row: RawFamilyConflictRow): FamilyConflict {
  return {
    conflictId: row.conflict_id,
    familyId: row.family_id,
    conflictDate: row.conflict_date,
    type: asType(row.type),
    severity: asSeverity(row.severity),
    memberId: row.member_id,
    primaryEntityType: asEntityType(row.primary_entity_type) ?? 'task',
    primaryEntityId: row.primary_entity_id,
    secondaryEntityType: asEntityType(row.secondary_entity_type),
    secondaryEntityId: row.secondary_entity_id,
    safeMessageCode: row.safe_message_code,
    safeMessageParams: asMessageParams(row.safe_message_params),
  };
}
