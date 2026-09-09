import { z } from 'zod';

/**
 * The generic invalidation payload every broadcast trigger emits (see
 * `public.emit_invalidation` in the Phase 9 migration). A Realtime
 * message is never trusted as application data — this schema is
 * deliberately minimal (no row content to even validate) and anything
 * that fails it, or carries a `version`/`entity` this build doesn't
 * recognize, is safely ignored rather than acted on (Section 3: "Ignore
 * unknown versions/entities safely"). `id` is realtime.send's own
 * auto-generated message id (see docs/DECISIONS.md, "Phase 9") — present
 * on every real message, unused here beyond being a harmless extra key.
 */
export const invalidationPayloadSchema = z.object({
  version: z.literal(1),
  scope: z.enum(['profile', 'family']),
  entity: z.enum(['tasks', 'events', 'responsibilities', 'members', 'categories', 'reminders', 'recurrence']),
  operation: z.literal('changed'),
});

export type InvalidationPayload = z.infer<typeof invalidationPayloadSchema>;

export type InvalidationEntity = InvalidationPayload['entity'];

/**
 * One centralized entity -> query-key-prefix mapping (Section 7) — no
 * component/screen invalidates its own queries in response to a broadcast
 * directly. TanStack Query's `invalidateQueries({queryKey: prefix})`
 * matches every query whose key *starts with* `prefix`, so a bare
 * `['tasks']` here already covers `taskKeys.inbox(profileId)`,
 * `taskKeys.forDate(profileId, date)`, `taskKeys.family(familyId)`, etc.
 * without needing to reconstruct every parameterized key variant.
 *
 * Every entity also invalidates `['conflicts']` — a broadcast never
 * carries enough information to know whether a specific change actually
 * created or resolved a conflict (conflicts are computed live from
 * multiple sources, never stored — see docs/DECISIONS.md, "Phase 9"), so
 * the safe, simple rule is: anything that could plausibly affect a
 * family's schedule refreshes the Conflict Center too.
 */
const ENTITY_QUERY_KEY_PREFIXES: Record<InvalidationEntity, readonly (readonly unknown[])[]> = {
  tasks: [['tasks'], ['calendar'], ['conflicts']],
  events: [['calendar'], ['conflicts']],
  responsibilities: [['calendar'], ['conflicts']],
  members: [['families'], ['calendar'], ['conflicts']],
  categories: [['categories'], ['tasks'], ['calendar']],
  reminders: [['recurrence']],
  recurrence: [['tasks'], ['calendar'], ['recurrence'], ['conflicts']],
};

export function queryKeyPrefixesForEntity(entity: InvalidationEntity): readonly (readonly unknown[])[] {
  return ENTITY_QUERY_KEY_PREFIXES[entity];
}

/**
 * Validates and parses a raw Realtime broadcast payload. Returns `null`
 * (never throws) for anything malformed or unrecognized — a message this
 * build doesn't understand is data to ignore, not an error to surface.
 */
export function parseInvalidationPayload(raw: unknown): InvalidationPayload | null {
  const result = invalidationPayloadSchema.safeParse(raw);
  return result.success ? result.data : null;
}
