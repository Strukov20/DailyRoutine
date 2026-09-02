import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { listMyFamilies } from '@/lib/family/familyService';
import { useUIStore } from '@/store/uiStore';

import { useActiveFamily } from './hooks';

// A manual factory, not `jest.mock('@/lib/family/familyService')` alone —
// automock still loads the real module to infer its shape, which pulls in
// the real supabase client and its AsyncStorage native module (unavailable
// under Jest). Only listMyFamilies is exercised by this test file.
jest.mock('@/lib/family/familyService', () => ({
  listMyFamilies: jest.fn(),
  createFamily: jest.fn(),
  createFamilyInvitation: jest.fn(),
  getInvitationPreview: jest.fn(),
  acceptFamilyInvitation: jest.fn(),
  declineFamilyInvitation: jest.fn(),
  revokeFamilyInvitation: jest.fn(),
  listFamilyMembers: jest.fn(),
  listFamilyInvitations: jest.fn(),
  createChildProfile: jest.fn(),
  updateChildProfile: jest.fn(),
  removeFamilyMember: jest.fn(),
}));

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // eslint-disable-next-line react/display-name -- test-only wrapper, no consumer ever sees this name
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const FAMILY_A = { id: 'f-a', name: 'A', ownerId: 'u1', createdAt: '2026-01-01' };
const FAMILY_B = { id: 'f-b', name: 'B', ownerId: 'u1', createdAt: '2026-01-02' };

describe('useActiveFamily', () => {
  beforeEach(() => {
    useUIStore.setState({ activeFamilyId: null });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('resolves to null with an empty family list', async () => {
    (listMyFamilies as jest.Mock).mockResolvedValue([]);

    const { result } = await renderHook(() => useActiveFamily(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.activeFamily).toBeNull();
    expect(result.current.families).toEqual([]);
  });

  it('defaults to the first family when no preference is stored', async () => {
    (listMyFamilies as jest.Mock).mockResolvedValue([FAMILY_A, FAMILY_B]);

    const { result } = await renderHook(() => useActiveFamily(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.activeFamily?.id).toBe('f-a'));
    // The fallback is persisted back into the store, not just returned —
    // useFamilyMembers/useFamilyInvitations elsewhere read activeFamilyId
    // directly from uiStore, so it must actually be written.
    expect(useUIStore.getState().activeFamilyId).toBe('f-a');
  });

  it('keeps a stored preference that still refers to a family the user belongs to', async () => {
    useUIStore.setState({ activeFamilyId: 'f-b' });
    (listMyFamilies as jest.Mock).mockResolvedValue([FAMILY_A, FAMILY_B]);

    const { result } = await renderHook(() => useActiveFamily(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.activeFamily?.id).toBe('f-b');
  });

  it('falls back to the first family when the stored preference no longer exists', async () => {
    useUIStore.setState({ activeFamilyId: 'f-removed' });
    (listMyFamilies as jest.Mock).mockResolvedValue([FAMILY_A, FAMILY_B]);

    const { result } = await renderHook(() => useActiveFamily(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.activeFamily?.id).toBe('f-a'));
    expect(useUIStore.getState().activeFamilyId).toBe('f-a');
  });
});
