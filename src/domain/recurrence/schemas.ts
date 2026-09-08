import { z } from 'zod';

/**
 * Validation only — no translated messages here, same convention as
 * src/domain/tasks/schemas.ts. Mirrors the RPCs' own invariants
 * client-side (see supabase/migrations/20260908120000_recurring_tasks_reminders.sql,
 * the source of truth either way).
 */

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const recurrenceEditorSchema = z
  .object({
    frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    interval: z.number().int().positive('interval_invalid').max(365, 'interval_invalid'),
    byWeekday: z.array(z.number().int().min(0).max(6)).optional(),
    endCondition: z.enum(['never', 'on_date', 'after_count']),
    until: z.string().regex(DATE_ONLY_PATTERN, 'date_invalid').optional(),
    count: z.number().int().positive('count_invalid').max(1000, 'count_invalid').optional(),
  })
  .refine((data) => data.frequency !== 'weekly' || (data.byWeekday && data.byWeekday.length > 0), {
    message: 'weekday_required',
    path: ['byWeekday'],
  })
  .refine((data) => data.endCondition !== 'on_date' || Boolean(data.until), {
    message: 'until_required',
    path: ['until'],
  })
  .refine((data) => data.endCondition !== 'after_count' || data.count !== undefined, {
    message: 'count_required',
    path: ['count'],
  });
export type RecurrenceEditorInput = z.infer<typeof recurrenceEditorSchema>;

const REMINDER_OFFSET_MAX_MINUTES = 43200; // 30 days — generous upper bound for a "custom" offset

export const reminderEditorSchema = z
  .object({
    kind: z.enum(['relative', 'absolute']),
    offsetMinutesBefore: z.number().int().min(0).max(REMINDER_OFFSET_MAX_MINUTES).optional(),
    remindAt: z.string().datetime({ offset: true }).optional(),
    label: z.string().trim().max(80).optional(),
  })
  .refine((data) => data.kind !== 'relative' || data.offsetMinutesBefore !== undefined, {
    message: 'offset_required',
    path: ['offsetMinutesBefore'],
  })
  .refine((data) => data.kind !== 'absolute' || Boolean(data.remindAt), {
    message: 'remind_at_required',
    path: ['remindAt'],
  });
export type ReminderEditorInput = z.infer<typeof reminderEditorSchema>;
