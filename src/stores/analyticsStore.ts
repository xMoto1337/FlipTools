import { create } from 'zustand';
import type { Sale, SalesStats } from '../api/analytics';

type DateRange = '7d' | '30d' | '90d' | '1y' | 'all';

interface AnalyticsState {
  sales: Sale[];
  stats: SalesStats | null;
  dateRange: DateRange;
  platformFilter: string;
  isLoading: boolean;

  setSales: (sales: Sale[]) => void;
  setStats: (stats: SalesStats) => void;
  setDateRange: (range: DateRange) => void;
  setPlatformFilter: (platform: string) => void;
  setLoading: (loading: boolean) => void;

  getDateRangeStart: () => string;
}

export const useAnalyticsStore = create<AnalyticsState>()((set, get) => ({
  sales: [],
  stats: null,
  dateRange: '30d',
  platformFilter: '',
  isLoading: false,

  setSales: (sales) => set({ sales }),
  setStats: (stats) => set({ stats }),
  setDateRange: (dateRange) => set({ dateRange }),
  setPlatformFilter: (platformFilter) => set({ platformFilter }),
  setLoading: (isLoading) => set({ isLoading }),

  getDateRangeStart: () => {
    const { dateRange } = get();
    const now = new Date();
    switch (dateRange) {
      case '7d': return new Date(now.getTime() - 7 * 86400000).toISOString();
      case '30d': return new Date(now.getTime() - 30 * 86400000).toISOString();
      case '90d': return new Date(now.getTime() - 90 * 86400000).toISOString();
      case '1y': return new Date(now.getTime() - 365 * 86400000).toISOString();
      case 'all': return new Date(0).toISOString();
    }
  },
}));
