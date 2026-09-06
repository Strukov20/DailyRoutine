import { z } from 'zod';

/**
 * The push notification data payload's shape — versioned, and deliberately
 * minimal (see docs/SECURITY_AND_PRIVACY.md, Mechanism 4): navigation
 * identifiers only, never a title/description/name. Parsed defensively —
 * a malformed or future/unknown-version payload is never trusted, it is
 * ignored safely (see notificationResponseRouter.ts).
 */
export const notificationPayloadSchemaV1 = z.object({
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
