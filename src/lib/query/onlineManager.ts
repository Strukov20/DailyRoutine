import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';

/**
 * TanStack Query's `onlineManager` defaults to the browser's `navigator.onLine`
 * (always `true`, and never changes, under React Native) — without this,
 * queries would keep retrying against a dead network instead of pausing,
 * and would never automatically refetch on reconnect. This is the official
 * React Native integration recipe. Call once, at app startup (see
 * QueryProvider.tsx) — not per-component.
 */
export function setUpQueryOnlineManager(): void {
  onlineManager.setEventListener((setOnline) => {
    return NetInfo.addEventListener((state) => {
      setOnline(Boolean(state.isConnected));
    });
  });
}
