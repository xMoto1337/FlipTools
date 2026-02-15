import { usePlatformStore } from '../stores/platformStore';
import { getPlatform } from '../api/platforms';
import type { PlatformId } from '../api/platforms';

export const usePlatform = (platformId: PlatformId) => {
  const store = usePlatformStore();
  const adapter = getPlatform(platformId);

  const connect = () => {
    const authUrl = adapter.getAuthUrl();
    const popup = window.open(authUrl, 'ebay-auth', 'width=600,height=700');

    // Listen for the popup to complete and close
    const checkInterval = setInterval(() => {
      if (popup?.closed) {
        clearInterval(checkInterval);
        // Re-read from localStorage since persist middleware saved there
        window.location.reload();
      }
    }, 500);
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
