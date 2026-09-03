import { supabase } from '@/lib/supabase/client';

import { CategoryServiceError, createCustomCategory, listCategories } from './categoryService';

interface QueryResult {
  data: unknown;
  error: unknown;
}

function makeChain(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  chain.select = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.then = (
    onFulfilled: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

describe('categoryService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('listCategories maps rows to domain Category objects', async () => {
    (supabase.from as jest.Mock).mockReturnValue(
      makeChain({
        data: [{ id: 'c1', family_id: null, name: 'Work', color_token: 'work', is_system: true }],
        error: null,
      }),
    );

    await expect(listCategories()).resolves.toEqual([
      { id: 'c1', familyId: null, name: 'Work', colorToken: 'work', isSystem: true },
    ]);
  });

  it('createCustomCategory returns the new category id', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: 'c2', error: null });

    await expect(createCustomCategory('f1', 'Errands', 'work')).resolves.toBe('c2');
    expect(supabase.rpc).toHaveBeenCalledWith('create_custom_category', {
      p_family_id: 'f1',
      p_name: 'Errands',
      p_color_token: 'work',
    });
  });

  it('normalizes a forbidden RPC error', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'nope' },
    });

    let caught: unknown;
    try {
      await createCustomCategory('f1', 'Errands', 'work');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CategoryServiceError);
    expect((caught as CategoryServiceError).code).toBe('forbidden');
  });
});
