import { z } from 'zod';

import { TASK_PRIORITIES } from './priority';

/**
 * Validation only — no translated messages here, same convention as
 * src/domain/auth/schemas.ts and src/domain/family/schemas.ts. Components
 * map `error.type`/a schema's custom message token to translated text.
 */

/** Inbox/Today/Tomorrow's inline quick-add input — title is the only field. */
export const quickAddTaskSchema = z.object({
  title: z.string().trim().min(1, 'title_required'),
});
export type QuickAddTaskInput = z.infer<typeof quickAddTaskSchema>;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

/**
 * The full create/edit task form (app/task/new.tsx, app/task/[id]/edit.tsx).
 * Mirrors the database's own invariants client-side so a validation error
 * appears next to the field before ever reaching the server (see
 * docs/DATA_MODEL.md's tasks CHECK constraints, which remain the source of
 * truth and the last line of defense either way):
 *   - only title is required;
 *   - a start time without a date is invalid ("time cannot silently exist
 *     without a date");
 *   - a duration without a start time is invalid;
 *   - duration is positive and bounded to one day (1440 minutes).
 */
export const taskEditorSchema = z
  .object({
    title: z.string().trim().min(1, 'title_required'),
    description: z.string().trim().optional(),
    date: z.string().regex(DATE_ONLY_PATTERN, 'date_invalid').optional(),
    startTime: z.string().regex(TIME_PATTERN, 'time_invalid').optional(),
    durationMinutes: z
      .number()
      .int('duration_invalid')
      .positive('duration_invalid')
      .max(1440, 'duration_too_long')
      .optional(),
    priority: z.enum(TASK_PRIORITIES),
    categoryId: z.string().optional(),
    visibility: z.enum(['private', 'family']),
  })
  .refine((data) => !data.startTime || Boolean(data.date), {
    message: 'time_requires_date',
    path: ['startTime'],
  })
  .refine((data) => !data.durationMinutes || Boolean(data.startTime), {
    message: 'duration_requires_time',
    path: ['durationMinutes'],
  });
export type TaskEditorInput = z.infer<typeof taskEditorSchema>;
