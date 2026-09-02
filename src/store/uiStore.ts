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
}

export const useUIStore = create<UIState>((set) => ({
  colorSchemeOverride: 'system',
  setColorSchemeOverride: (value) => set({ colorSchemeOverride: value }),

  activeFamilyId: null,
  setActiveFamilyId: (familyId) => set({ activeFamilyId: familyId }),
}));
