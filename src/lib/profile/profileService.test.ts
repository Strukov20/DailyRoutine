import { supabase } from '@/lib/supabase/client';

import { ProfileServiceError, requestAccountDeletion } from './profileService';

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

describe('profileService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('requestAccountDeletion calls request_account_deletion and resolves on success', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });

    await expect(requestAccountDeletion()).resolves.toBeUndefined();
    expect(supabase.rpc).toHaveBeenCalledWith('request_account_deletion');
  });

  describe('error normalization', () => {
    it.each([
      ['42501', 'forbidden'],
      ['22023', 'still_owns_a_family'],
      ['some_unmapped_code', 'unknown'],
    ])('maps SQLSTATE %s to ProfileErrorCode %s', async (sqlState, expectedCode) => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: { code: sqlState, message: 'boom' } });

      let caught: unknown;
      try {
        await requestAccountDeletion();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ProfileServiceError);
      expect((caught as ProfileServiceError).code).toBe(expectedCode);
    });

    it('maps a non-Error rejection to a generic "unknown" ProfileServiceError without throwing while mapping', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: 'a plain string, not an Error' });

      let caught: unknown;
      try {
        await requestAccountDeletion();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ProfileServiceError);
      expect((caught as ProfileServiceError).code).toBe('unknown');
    });
  });
});
