/**
 * Domain shapes for the Conflict Center (Phase 9, Section 14) — decoupled
 * from `list_family_conflicts`'s generated RPC row shape, same convention
 * as src/domain/calendar/types.ts. Every row here is already
 * privacy-redacted server-side (see the RPC's own comment in
 * supabase/migrations/20260909120000_realtime_offline_conflicts.sql) —
 * `primaryEntityId`/`secondaryEntityId` are `null` whenever navigating to
 * that entity isn't safe for the caller, and neither this type nor
 * anything built on it ever carries a private title/description/notes.
 */

export type ConflictSeverity = 'warning' | 'critical';

/**
 * The 7 distinct `type` values `list_family_conflicts` emits — the
 * recurring-occurrence category (Section 13, item 8) is folded into
 * `task_event`/`task_task` via `primaryEntityType`/`secondaryEntityType`
 * being `'occurrence'` rather than getting its own `type`.
 */
export type ConflictType =
  | 'event_event'
  | 'task_event'
  | 'task_task'
  | 'responsibility_busy'
  | 'responsibility_responsibility'
  | 'unassigned_dropoff_pickup'
  | 'no_available_adult';

export type ConflictEntityType = 'event' | 'task' | 'occurrence' | 'responsibility';

export interface FamilyConflict {
  /** Stable for UI dedup/list-key purposes — never a reversible hash of a private title (see the RPC's own comment). */
  conflictId: string;
  familyId: string;
  conflictDate: string;
  type: ConflictType;
  severity: ConflictSeverity;
  /** Null for a conflict with no single responsible member (unassigned_dropoff_pickup, no_available_adult). */
  memberId: string | null;
  primaryEntityType: ConflictEntityType;
  /** Null when navigating to it isn't safe for the caller — never omit the whole conflict just because this is redacted. */
  primaryEntityId: string | null;
  secondaryEntityType: ConflictEntityType | null;
  secondaryEntityId: string | null;
  /** e.g. "conflicts.event_event" — an i18n key, resolved client-side, never a pre-rendered English string from the server. */
  safeMessageCode: string;
  /** Currently always `{ time: "HH:MM" }` — kept as a loose record since the RPC may add params for a future conflict type without a client type change. */
  safeMessageParams: Record<string, string>;
}
