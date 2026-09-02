import {
  comparePriorityDescending,
  getPriorityWeight,
  isHigherPriority,
  TASK_PRIORITIES,
  type TaskPriority,
} from './priority';

describe('task priority domain logic', () => {
  it('orders critical above important above normal', () => {
    expect(getPriorityWeight('critical')).toBeGreaterThan(getPriorityWeight('important'));
    expect(getPriorityWeight('important')).toBeGreaterThan(getPriorityWeight('normal'));
  });

  it('sorts a mixed list with critical first', () => {
    const priorities: TaskPriority[] = ['normal', 'critical', 'important', 'normal'];
    const sorted = [...priorities].sort(comparePriorityDescending);
    expect(sorted).toEqual(['critical', 'important', 'normal', 'normal']);
  });

  it('reports higher priority correctly', () => {
    expect(isHigherPriority('critical', 'normal')).toBe(true);
    expect(isHigherPriority('normal', 'critical')).toBe(false);
    expect(isHigherPriority('important', 'important')).toBe(false);
  });

  it('exposes exactly the three domain priorities', () => {
    expect(TASK_PRIORITIES).toEqual(['normal', 'important', 'critical']);
  });
});
