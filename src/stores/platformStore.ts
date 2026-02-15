import { create } from 'zustand';
import type { PlatformId } from '../api/platforms';

interface PlatformConnection {
  platform: PlatformId;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string;
  platformUsername: string;
  connectedAt: string;
}

interface PlatformState {
  connections: Record<string, PlatformConnection>;
  syncStatus: Record<string, 'idle' | 'syncing' | 'error'>;

  setConnection: (platform: PlatformId, connection: PlatformConnection) => void;
  removeConnection: (platform: PlatformId) => void;
  setSyncStatus: (platform: PlatformId, status: 'idle' | 'syncing' | 'error') => void;
  isConnected: (platform: PlatformId) => boolean;
  getToken: (platform: PlatformId) => string | null;
}

export const usePlatformStore = create<PlatformState>()((set, get) => ({
  connections: {},
  syncStatus: {},

  setConnection: (platform, connection) =>
    set((s) => ({
      connections: { ...s.connections, [platform]: connection },
    })),

  removeConnection: (platform) =>
    set((s) => {
      const connections = { ...s.connections };
      delete connections[platform];
      return { connections };
    }),

  setSyncStatus: (platform, status) =>
    set((s) => ({
      syncStatus: { ...s.syncStatus, [platform]: status },
    })),

  isConnected: (platform) => !!get().connections[platform],
  getToken: (platform) => get().connections[platform]?.accessToken || null,
}));
