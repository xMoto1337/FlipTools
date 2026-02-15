import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  sidebarCollapsed: boolean;
  sidebarMobileOpen: boolean;
  accentColor: string;
  showChangelog: boolean;
  lastSeenVersion: string;

  toggleSidebar: () => void;
  setSidebarMobileOpen: (open: boolean) => void;
  setAccentColor: (color: string) => void;
  setShowChangelog: (show: boolean) => void;
  setLastSeenVersion: (version: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      sidebarMobileOpen: false,
      accentColor: 'cyan',
      showChangelog: false,
      lastSeenVersion: '0.0.0',

      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarMobileOpen: (open) => set({ sidebarMobileOpen: open }),
      setAccentColor: (accentColor) => set({ accentColor }),
      setShowChangelog: (showChangelog) => set({ showChangelog }),
      setLastSeenVersion: (lastSeenVersion) => set({ lastSeenVersion }),
    }),
    {
      name: 'fliptools-settings',
    }
  )
);
