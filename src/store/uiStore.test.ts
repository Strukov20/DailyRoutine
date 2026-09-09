import { useUIStore } from './uiStore';

describe('useUIStore.resetForSignOut', () => {
  beforeEach(() => {
    useUIStore.setState({
      colorSchemeOverride: 'dark',
      activeFamilyId: 'family-1',
      pendingInviteToken: 'token-1',
      pendingNotificationRoute: '/task/1',
      realtimeStatus: 'connected',
    });
  });

  it('clears account-scoped fields — activeFamilyId, pendingInviteToken, pendingNotificationRoute', () => {
    useUIStore.getState().resetForSignOut();

    const state = useUIStore.getState();
    expect(state.activeFamilyId).toBeNull();
    expect(state.pendingInviteToken).toBeNull();
    expect(state.pendingNotificationRoute).toBeNull();
  });

  it('never touches colorSchemeOverride or realtimeStatus — neither is account-sensitive', () => {
    useUIStore.getState().resetForSignOut();

    const state = useUIStore.getState();
    expect(state.colorSchemeOverride).toBe('dark');
    expect(state.realtimeStatus).toBe('connected');
  });
});
