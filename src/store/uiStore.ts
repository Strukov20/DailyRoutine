import { create } from 'zustand';

/**
 * Client-only UI state that does not belong in TanStack Query (it isn't
 * fetched from Supabase and has no server owner). Keep this store small —
 * anything that comes from or is persisted to the backend belongs in a
 * query/mutation instead. See docs/DECISIONS.md, "State-management
 * boundaries".
 */
interface UIState {
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
}

export const useUIStore = create<UIState>((set) => ({
  colorSchemeOverride: 'system',
  setColorSchemeOverride: (value) => set({ colorSchemeOverride: value }),

  activeFamilyId: null,
  setActiveFamilyId: (familyId) => set({ activeFamilyId: familyId }),

  pendingInviteToken: null,
  setPendingInviteToken: (token) => set({ pendingInviteToken: token }),
}));
