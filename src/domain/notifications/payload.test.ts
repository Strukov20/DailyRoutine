import { parseNotificationPayload } from './payload';

describe('parseNotificationPayload', () => {
  const validPayload = {
    schemaVersion: 1,
    eventType: 'family_task.assignment_requested.v1',
    familyId: '11111111-1111-4111-8111-111111111111',
    taskId: '22222222-2222-4222-8222-222222222222',
  };

  it('parses a valid v1 payload', () => {
    expect(parseNotificationPayload(validPayload)).toEqual(validPayload);
  });

  it('accepts every documented event type', () => {
    const eventTypes = [
      'family_task.assignment_requested.v1',
      'family_task.assignment_accepted.v1',
      'family_task.assignment_declined.v1',
      'family_task.assignment_taken.v1',
    ];
    for (const eventType of eventTypes) {
      expect(parseNotificationPayload({ ...validPayload, eventType })).not.toBeNull();
    }
  });

  it('rejects an unknown/future schema version rather than throwing', () => {
    expect(parseNotificationPayload({ ...validPayload, schemaVersion: 2 })).toBeNull();
  });

  it('rejects an unrecognized event type', () => {
    expect(parseNotificationPayload({ ...validPayload, eventType: 'something.else.v1' })).toBeNull();
  });

  it('rejects a non-uuid familyId/taskId', () => {
    expect(parseNotificationPayload({ ...validPayload, familyId: 'not-a-uuid' })).toBeNull();
    expect(parseNotificationPayload({ ...validPayload, taskId: 'not-a-uuid' })).toBeNull();
  });

  it('rejects a payload missing required fields', () => {
    const { taskId, ...withoutTaskId } = validPayload;
    void taskId;
    expect(parseNotificationPayload(withoutTaskId)).toBeNull();
  });

  it('rejects null, undefined, arrays, and primitives without throwing', () => {
    expect(parseNotificationPayload(null)).toBeNull();
    expect(parseNotificationPayload(undefined)).toBeNull();
    expect(parseNotificationPayload([])).toBeNull();
    expect(parseNotificationPayload('a string')).toBeNull();
    expect(parseNotificationPayload(42)).toBeNull();
  });

  it('rejects an empty object', () => {
    expect(parseNotificationPayload({})).toBeNull();
  });
});
