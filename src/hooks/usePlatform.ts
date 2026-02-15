import { usePlatformStore } from '../stores/platformStore';
import { getPlatform } from '../api/platforms';
import type { PlatformId } from '../api/platforms';

export const usePlatform = (platformId: PlatformId) => {
  const store = usePlatformStore();
  const adapter = getPlatform(platformId);

  const connect = () => {
    const authUrl = adapter.getAuthUrl();
    window.location.href = authUrl;
  };

  const disconnect = () => {
    store.removeConnection(platformId);
  };

  return {
    adapter,
    isConnected: store.isConnected(platformId),
    syncStatus: store.syncStatus[platformId] || 'idle',
    token: store.getToken(platformId),
    connect,
    disconnect,
  };
};
