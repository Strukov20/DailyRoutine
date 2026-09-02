import { z } from 'zod';

/**
 * Only `title` is required to create a task (see docs/DATA_MODEL.md,
 * "tasks"). Every other field — date, time, reminders, assignee, etc. —
 * belongs to the full task-creation flow, which is out of scope for this
 * foundation phase.
 */
export const newTaskSchema = z.object({
  title: z.string().trim().min(1, 'title_required'),
});
export type NewTaskInput = z.infer<typeof newTaskSchema>;
