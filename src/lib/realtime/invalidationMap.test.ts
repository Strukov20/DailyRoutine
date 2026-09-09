import { parseInvalidationPayload, queryKeyPrefixesForEntity } from './invalidationMap';

describe('parseInvalidationPayload', () => {
  it('accepts a real, well-formed broadcast payload (with realtime.send\'s own extra id field)', () => {
    const parsed = parseInvalidationPayload({
      id: '11111111-1111-1111-1111-111111111111',
      version: 1,
      scope: 'family',
      entity: 'tasks',
      operation: 'changed',
    });
    expect(parsed).toEqual({ version: 1, scope: 'family', entity: 'tasks', operation: 'changed' });
  });

  it('rejects an unrecognized version, safely, without throwing', () => {
    expect(
      parseInvalidationPayload({ version: 2, scope: 'family', entity: 'tasks', operation: 'changed' }),
    ).toBeNull();
  });

  it('rejects an unrecognized entity, safely, without throwing', () => {
    expect(
      parseInvalidationPayload({ version: 1, scope: 'family', entity: 'something-new', operation: 'changed' }),
    ).toBeNull();
  });

  it('rejects a payload carrying unexpected row-shaped content instead of the generic shape', () => {
    expect(
      parseInvalidationPayload({ version: 1, scope: 'family', title: 'Buy milk', taskId: 'abc' }),
    ).toBeNull();
  });

  it('rejects null, undefined, a string, and an array — never throws on any of them', () => {
    expect(parseInvalidationPayload(null)).toBeNull();
    expect(parseInvalidationPayload(undefined)).toBeNull();
    expect(parseInvalidationPayload('not an object')).toBeNull();
    expect(parseInvalidationPayload([1, 2, 3])).toBeNull();
  });
});

describe('queryKeyPrefixesForEntity', () => {
  it('maps every documented entity to at least one query key prefix', () => {
    for (const entity of ['tasks', 'events', 'responsibilities', 'members', 'categories', 'reminders', 'recurrence'] as const) {
      expect(queryKeyPrefixesForEntity(entity).length).toBeGreaterThan(0);
    }
  });

  it('a tasks change fans out to Today/Tomorrow/Inbox/Calendar/FamilyTaskBoard and the Conflict Center', () => {
    const prefixes = queryKeyPrefixesForEntity('tasks');
    expect(prefixes).toContainEqual(['tasks']);
    expect(prefixes).toContainEqual(['calendar']);
    expect(prefixes).toContainEqual(['conflicts']);
  });

  it("a members change invalidates family membership, the calendar's member filters, and conflicts", () => {
    const prefixes = queryKeyPrefixesForEntity('members');
    expect(prefixes).toContainEqual(['families']);
    expect(prefixes).toContainEqual(['calendar']);
    expect(prefixes).toContainEqual(['conflicts']);
  });

  it('a reminders change never invalidates the conflicts list (a reminder definition alone never creates a schedule conflict)', () => {
    expect(queryKeyPrefixesForEntity('reminders')).not.toContainEqual(['conflicts']);
  });
});
