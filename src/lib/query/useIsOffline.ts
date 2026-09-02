import { useNetInfo } from '@react-native-community/netinfo';

/** True once NetInfo has reported a definite disconnected state (not the initial `null`). */
export function useIsOffline(): boolean {
  const netInfo = useNetInfo();
  return netInfo.isConnected === false;
}
