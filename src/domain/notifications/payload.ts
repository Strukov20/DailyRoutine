import { z } from 'zod';

/**
 * The push notification data payload's shape — versioned, and deliberately
 * minimal (see docs/SECURITY_AND_PRIVACY.md, Mechanism 4): navigation
 * identifiers only, never a title/description/name. Parsed defensively —
 * a malformed or future/unknown-version payload is never trusted, it is
 * ignored safely (see notificationResponseRouter.ts).
 *
 * Two shapes (Phase 7 added the second, never merged into one with both
 * fields optional — a task-assignment payload always carries taskId, an
 * event-responsibility payload always carries eventId, and a schema that
 * allowed either-or-neither would let a malformed payload silently parse
 * as "valid but pointing nowhere").
 */
const taskAssignmentPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  eventType: z.enum([
    'family_task.assignment_requested.v1',
    'family_task.assignment_accepted.v1',
    'family_task.assignment_declined.v1',
    'family_task.assignment_taken.v1',
  ]),
  familyId: z.string().uuid(),
  taskId: z.string().uuid(),
});

const eventResponsibilityPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  eventType: z.enum([
    'event_responsibility.assignment_requested.v1',
    'event_responsibility.assignment_accepted.v1',
    'event_responsibility.assignment_declined.v1',
    'event_responsibility.assignment_taken.v1',
  ]),
  familyId: z.string().uuid(),
  eventId: z.string().uuid(),
});

/**
 * Phase 8 — a *local*, device-scheduled reminder, never a server push (see
 * docs/DECISIONS.md, "Phase 8": personal reminders are a separate delivery
 * mechanism from the Phase 6 Expo Push outbox). `notificationType`, not
 * `eventType`, distinguishes this from the two server-push shapes above —
 * a local reminder has no outbox event to name. `occurrenceId` is null for
 * a one-off task's own reminder (the task id alone already identifies it).
 */
const taskReminderPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  notificationType: z.literal('task_reminder'),
  taskId: z.string().uuid(),
  occurrenceId: z.string().uuid().nullable(),
  reminderId: z.string().uuid(),
});

export const notificationPayloadSchemaV1 = z.union([
  taskAssignmentPayloadSchema,
  eventResponsibilityPayloadSchema,
  taskReminderPayloadSchema,
]);

export type NotificationPayloadV1 = z.infer<typeof notificationPayloadSchemaV1>;

/**
 * Parses an arbitrary, untrusted push data payload (the shape Expo hands
 * back from a notification response is `Record<string, unknown> | undefined`
 * with no compile-time guarantee it matches anything this app sent — an
 * older app version's still-cached notification, a malformed payload, or a
 * future schema version the running app predates). Returns null rather than
 * throwing on anything that doesn't match exactly, so the caller's only job
 * is "do I have a valid v1 payload or not."
 */
export function parseNotificationPayload(data: unknown): NotificationPayloadV1 | null {
  const result = notificationPayloadSchemaV1.safeParse(data);
  return result.success ? result.data : null;
}
