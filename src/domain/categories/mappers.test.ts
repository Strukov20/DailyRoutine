import { mapCategoryRow } from './mappers';

describe('mapCategoryRow', () => {
  it('maps a system category row', () => {
    expect(
      mapCategoryRow({
        id: 'c1',
        family_id: null,
        name: 'Work',
        color_token: 'work',
        is_system: true,
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
        created_by: null,
      }),
    ).toEqual({ id: 'c1', familyId: null, name: 'Work', colorToken: 'work', isSystem: true });
  });

  it('maps a custom family category row', () => {
    expect(
      mapCategoryRow({
        id: 'c2',
        family_id: 'f1',
        name: 'Errands',
        color_token: 'work',
        is_system: false,
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
        created_by: 'u1',
      }),
    ).toEqual({ id: 'c2', familyId: 'f1', name: 'Errands', colorToken: 'work', isSystem: false });
  });
});
