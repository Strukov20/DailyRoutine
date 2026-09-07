import { z } from 'zod';

/**
 * Validation only — no translated messages here, same convention as
 * src/domain/tasks/schemas.ts. Components map a schema's custom message
 * token to translated text.
 */

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

export type EventKind = 'personal' | 'family' | 'child';

/**
 * The single reusable event editor form (Section 12). Mirrors the RPCs'
 * own invariants client-side (see docs/DATA_MODEL.md's events CHECK
 * constraints, which remain the source of truth either way):
 *   - title and a full date+start+end are required (the MVP Day Calendar
 *     has no all-day/date-only event concept — see docs/DECISIONS.md,
 *     "Phase 7," for why that's explicitly deferred rather than modeled
 *     ambiguously);
 *   - endTime must be after startTime on the same date;
 *   - a child event requires a childMemberId; a family/personal event never
 *     carries one;
 *   - visibility only applies to a personal event — family/child events are
 *     always visibility=family, enforced server-side regardless.
 */
export const eventEditorSchema = z
  .object({
    kind: z.enum(['personal', 'family', 'child']),
    title: z.string().trim().min(1, 'title_required'),
    description: z.string().trim().optional(),
    location: z.string().trim().optional(),
    date: z.string().regex(DATE_ONLY_PATTERN, 'date_invalid'),
    startTime: z.string().regex(TIME_PATTERN, 'time_invalid'),
    endTime: z.string().regex(TIME_PATTERN, 'time_invalid'),
    visibility: z.enum(['private', 'family']).optional(),
    familyId: z.string().optional(),
    childMemberId: z.string().optional(),
    dropOffAssigneeMemberId: z.string().optional(),
    pickUpAssigneeMemberId: z.string().optional(),
  })
  .refine((data) => data.endTime > data.startTime, {
    message: 'end_before_start',
    path: ['endTime'],
  })
  .refine((data) => data.kind === 'personal' || Boolean(data.familyId), {
    message: 'family_required',
    path: ['familyId'],
  })
  .refine((data) => data.kind !== 'child' || Boolean(data.childMemberId), {
    message: 'child_required',
    path: ['childMemberId'],
  });
export type EventEditorInput = z.infer<typeof eventEditorSchema>;
