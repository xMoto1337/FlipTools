import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '../api/supabase';
import type { PlatformId } from '../api/platforms';

interface PlatformConnection {
  platform: PlatformId;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string;
  platformUsername: string;
  connectedAt: string;
  platformUserId?: string;
}

interface PlatformState {
  connections: Record<string, PlatformConnection>;
  syncStatus: Record<string, 'idle' | 'syncing' | 'error'>;

  setConnection: (platform: PlatformId, connection: PlatformConnection) => void;
  removeConnection: (platform: PlatformId) => void;
  setSyncStatus: (platform: PlatformId, status: 'idle' | 'syncing' | 'error') => void;
  isConnected: (platform: PlatformId) => boolean;
  getToken: (platform: PlatformId) => string | null;
  loadFromSupabase: () => Promise<void>;
}

/** Sync a connection to the Supabase platform_connections table (fire-and-forget). */
async function syncToSupabase(connection: PlatformConnection) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('platform_connections').upsert({
      user_id: user.id,
      platform: connection.platform,
      access_token: connection.accessToken,
      refresh_token: connection.refreshToken,
      token_expires_at: connection.tokenExpiresAt,
      platform_user_id: connection.platformUserId || null,
      platform_username: connection.platformUsername,
      connected_at: connection.connectedAt,
    }, { onConflict: 'user_id,platform' });
  } catch (err) {
    console.warn('[platformStore] Failed to sync connection to Supabase:', err);
  }
}

/** Remove a connection from the Supabase platform_connections table. */
async function removeFromSupabase(platform: PlatformId) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('platform_connections')
      .delete()
      .eq('user_id', user.id)
      .eq('platform', platform);
  } catch (err) {
    console.warn('[platformStore] Failed to remove connection from Supabase:', err);
  }
}

export const usePlatformStore = create<PlatformState>()(
  persist(
    (set, get) => ({
      connections: {},
      syncStatus: {},

      setConnection: (platform, connection) => {
        // Clear sync caches so data re-syncs with new token/scopes
        try {
          localStorage.removeItem('fliptools_listings_last_sync');
          localStorage.removeItem('fliptools_ebay_finances_fallback');
        } catch {}
        set((s) => ({
          connections: { ...s.connections, [platform]: connection },
        }));
        // Also persist to Supabase for server-side access (non-blocking)
        syncToSupabase(connection);
      },

      removeConnection: (platform) => {
        try {
          localStorage.removeItem('fliptools_listings_last_sync');
          localStorage.removeItem('fliptools_ebay_finances_fallback');
        } catch {}
        set((s) => {
          const connections = { ...s.connections };
          delete connections[platform];
          return { connections };
        });
        // Also remove from Supabase (non-blocking)
        removeFromSupabase(platform);
      },

      setSyncStatus: (platform, status) =>
        set((s) => ({
          syncStatus: { ...s.syncStatus, [platform]: status },
        })),

      isConnected: (platform) => !!get().connections[platform],
      getToken: (platform) => get().connections[platform]?.accessToken || null,

      /** Load connections from Supabase (fallback if localStorage is empty). */
      loadFromSupabase: async () => {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;

          const { data: rows } = await supabase
            .from('platform_connections')
            .select('*')
            .eq('user_id', user.id);

          if (!rows || rows.length === 0) return;

          const current = get().connections;
          const merged = { ...current };

          for (const row of rows) {
            const pid = row.platform as PlatformId;
            // Only load from DB if not already in localStorage
            if (!merged[pid]) {
              merged[pid] = {
                platform: pid,
                accessToken: row.access_token,
                refreshToken: row.refresh_token,
                tokenExpiresAt: row.token_expires_at,
                platformUsername: row.platform_username || `${row.platform} Account`,
                connectedAt: row.connected_at,
                platformUserId: row.platform_user_id || undefined,
              };
            }
          }

          set({ connections: merged });
        } catch (err) {
          console.warn('[platformStore] Failed to load from Supabase:', err);
        }
      },
    }),
    {
      name: 'fliptools-platforms',
      partialize: (state) => ({ connections: state.connections }),
    }
  )
);
