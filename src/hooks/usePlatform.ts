import { usePlatformStore } from '../stores/platformStore';
import { getPlatform } from '../api/platforms';
import type { PlatformId } from '../api/platforms';

export const usePlatform = (platformId: PlatformId) => {
  const store = usePlatformStore();
  const adapter = getPlatform(platformId);

  const connect = async () => {
    let authUrl: string;

    // Etsy requires async PKCE auth URL generation
    if (platformId === 'etsy') {
      const { getEtsyAuthUrl } = await import('../api/platforms/etsy');
      authUrl = await getEtsyAuthUrl();
    } else {
      authUrl = adapter.getAuthUrl();
    }

    if (!authUrl) {
      console.error(`[usePlatform] No auth URL for ${platformId}`);
      return;
    }

    const popup = window.open(authUrl, `${platformId}-auth`, 'width=600,height=700');

    // Listen for the popup to complete and close
    const checkInterval = setInterval(() => {
      if (popup?.closed) {
        clearInterval(checkInterval);
        window.location.reload();
      }
    }, 500);
  };

  const disconnect = () => {
    store.removeConnection(platformId);
    // Clean up platform-specific data
    if (platformId === 'etsy') {
      try { localStorage.removeItem('fliptools_etsy_shop_id'); } catch {}
    }
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
