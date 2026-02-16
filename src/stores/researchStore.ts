import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SoldItem } from '../api/platforms/types';
import { computeMarketAnalysis, type MarketAnalysis } from '../utils/researchAnalytics';

export interface SearchHistoryEntry {
  id: string;
  query: string;
  searchType: 'keyword' | 'image';
  resultCount: number;
  avgPrice: number;
  timestamp: string;
}

interface ResearchState {
  results: SoldItem[];
  analysis: MarketAnalysis | null;
  isSearching: boolean;
  searchQuery: string;
  searchType: 'keyword' | 'image';
  imagePreview: string | null;
  costInput: number;
  shippingCostInput: number;
  searchHistory: SearchHistoryEntry[];
  monthlySearchCount: number;
  monthlySearchResetDate: string;

  setResults: (results: SoldItem[]) => void;
  setIsSearching: (loading: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSearchType: (type: 'keyword' | 'image') => void;
  setImagePreview: (preview: string | null) => void;
  setCostInput: (cost: number) => void;
  setShippingCostInput: (cost: number) => void;
  addToHistory: (entry: Omit<SearchHistoryEntry, 'id' | 'timestamp'>) => void;
  clearHistory: () => void;
  computeAnalysis: () => void;
  incrementSearchCount: () => void;
  getSearchesRemaining: (limit: number) => number;
}

function getMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth()}`;
}

export const useResearchStore = create<ResearchState>()(
  persist(
    (set, get) => ({
      results: [],
      analysis: null,
      isSearching: false,
      searchQuery: '',
      searchType: 'keyword',
      imagePreview: null,
      costInput: 0,
      shippingCostInput: 0,
      searchHistory: [],
      monthlySearchCount: 0,
      monthlySearchResetDate: getMonthKey(),

      setResults: (results) => set({ results }),
      setIsSearching: (isSearching) => set({ isSearching }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setSearchType: (searchType) => set({ searchType }),
      setImagePreview: (imagePreview) => set({ imagePreview }),
      setCostInput: (costInput) => set({ costInput }),
      setShippingCostInput: (shippingCostInput) => set({ shippingCostInput }),

      addToHistory: (entry) => set((s) => ({
        searchHistory: [
          { ...entry, id: crypto.randomUUID(), timestamp: new Date().toISOString() },
          ...s.searchHistory,
        ].slice(0, 50),
      })),

      clearHistory: () => set({ searchHistory: [] }),

      computeAnalysis: () => {
        const { results } = get();
        if (results.length === 0) {
          set({ analysis: null });
          return;
        }
        set({ analysis: computeMarketAnalysis(results) });
      },

      incrementSearchCount: () => {
        const currentMonth = getMonthKey();
        const { monthlySearchResetDate, monthlySearchCount } = get();
        if (currentMonth !== monthlySearchResetDate) {
          set({ monthlySearchCount: 1, monthlySearchResetDate: currentMonth });
        } else {
          set({ monthlySearchCount: monthlySearchCount + 1 });
        }
      },

      getSearchesRemaining: (limit: number) => {
        const currentMonth = getMonthKey();
        const { monthlySearchResetDate, monthlySearchCount } = get();
        if (currentMonth !== monthlySearchResetDate) return limit;
        return Math.max(0, limit - monthlySearchCount);
      },
    }),
    {
      name: 'fliptools-research',
      partialize: (state) => ({
        searchHistory: state.searchHistory,
        costInput: state.costInput,
        shippingCostInput: state.shippingCostInput,
        monthlySearchCount: state.monthlySearchCount,
        monthlySearchResetDate: state.monthlySearchResetDate,
      }),
    }
  )
);
