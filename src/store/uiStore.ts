import { create } from 'zustand';

/**
 * Client-only UI state that does not belong in TanStack Query (it isn't
 * fetched from Supabase and has no server owner). Keep this store small —
 * anything that comes from or is persisted to the backend belongs in a
 * query/mutation instead. See docs/DECISIONS.md, "State-management
 * boundaries".
 */
export interface UIState {
  /** Manual light/dark override; 'system' follows the OS setting. */
  colorSchemeOverride: 'system' | 'light' | 'dark';
  setColorSchemeOverride: (value: UIState['colorSchemeOverride']) => void;

  /**
   * The family the UI currently focuses on. A user may belong to several
   * families (see docs/DATA_MODEL.md); this only tracks which one the
   * current session is looking at, not membership itself.
   */
  activeFamilyId: string | null;
  setActiveFamilyId: (familyId: string | null) => void;

  /**
   * An invitation token the user opened while signed out — set by
   * app/invite/[token].tsx, consumed by app/_layout.tsx's redirect effect
   * once auth completes, then cleared. Not persisted across app restarts
   * (there is no persist middleware on this store), which is the intended
   * lifetime for a mid-flow value like this one.
   */
  pendingInviteToken: string | null;
  setPendingInviteToken: (token: string | null) => void;

  /**
   * A route resolved from a push notification tapped while signed out —
   * set by notificationResponseRouter.ts, consumed by app/_layout.tsx's
   * redirect effect once auth completes, then cleared. Same lifetime and
   * rationale as pendingInviteToken above (a deliberate, small, transient
   * Zustand exception — not persisted across app restarts).
   */
  pendingNotificationRoute: string | null;
  setPendingNotificationRoute: (route: string | null) => void;

  /**
   * Phase 9 — the Realtime sync manager's own connection state
   * (`src/lib/realtime/useRealtimeSync.ts`), surfaced for the sync-status
   * indicator. Ephemeral, never fetched/persisted — the same rationale as
   * every other field in this store.
   */
  realtimeStatus: 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'error';
  setRealtimeStatus: (status: UIState['realtimeStatus']) => void;

  /**
   * Phase 10 — called by AuthProvider on a real sign-out (never a mere
   * family switch), alongside its own TanStack Query cache clearing.
   * Clears every field above that carries this *account's* own context —
   * activeFamilyId (a different family's schedule must never flash for
   * the next signed-in account on this device before they pick their
   * own), and any pending deep-link/notification route this account
   * hadn't consumed yet (must never resolve into the next account's
   * session instead). colorSchemeOverride and realtimeStatus are left
   * alone — a theme preference isn't account-sensitive, and
   * realtimeStatus reflects the connection itself, which the next
   * session's own Realtime manager will update on its own.
   */
  resetForSignOut: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  colorSchemeOverride: 'system',
  setColorSchemeOverride: (value) => set({ colorSchemeOverride: value }),

  activeFamilyId: null,
  setActiveFamilyId: (familyId) => set({ activeFamilyId: familyId }),

  pendingInviteToken: null,
  setPendingInviteToken: (token) => set({ pendingInviteToken: token }),

  pendingNotificationRoute: null,
  setPendingNotificationRoute: (route) => set({ pendingNotificationRoute: route }),

  realtimeStatus: 'offline',
  setRealtimeStatus: (status) => set({ realtimeStatus: status }),

  resetForSignOut: () =>
    set({ activeFamilyId: null, pendingInviteToken: null, pendingNotificationRoute: null }),
}));
