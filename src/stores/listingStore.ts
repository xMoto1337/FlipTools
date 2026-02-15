import { create } from 'zustand';
import type { Listing } from '../api/listings';

type ViewMode = 'grid' | 'list';

interface ListingState {
  listings: Listing[];
  selectedIds: Set<string>;
  viewMode: ViewMode;
  searchQuery: string;
  statusFilter: string;
  platformFilter: string;
  isLoading: boolean;

  setListings: (listings: Listing[]) => void;
  addListing: (listing: Listing) => void;
  updateListing: (id: string, updates: Partial<Listing>) => void;
  removeListing: (id: string) => void;
  removeListings: (ids: string[]) => void;

  toggleSelect: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;

  setViewMode: (mode: ViewMode) => void;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (status: string) => void;
  setPlatformFilter: (platform: string) => void;
  setLoading: (loading: boolean) => void;

  filteredListings: () => Listing[];
}

export const useListingStore = create<ListingState>()((set, get) => ({
  listings: [],
  selectedIds: new Set<string>(),
  viewMode: 'grid',
  searchQuery: '',
  statusFilter: '',
  platformFilter: '',
  isLoading: false,

  setListings: (listings) => set({ listings }),
  addListing: (listing) => set((s) => ({ listings: [listing, ...s.listings] })),
  updateListing: (id, updates) =>
    set((s) => ({
      listings: s.listings.map((l) => (l.id === id ? { ...l, ...updates } : l)),
    })),
  removeListing: (id) =>
    set((s) => ({
      listings: s.listings.filter((l) => l.id !== id),
      selectedIds: new Set([...s.selectedIds].filter((sid) => sid !== id)),
    })),
  removeListings: (ids) =>
    set((s) => ({
      listings: s.listings.filter((l) => !ids.includes(l.id)),
      selectedIds: new Set([...s.selectedIds].filter((sid) => !ids.includes(sid))),
    })),

  toggleSelect: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    }),
  selectAll: () =>
    set(() => ({ selectedIds: new Set(get().filteredListings().map((l) => l.id)) })),
  clearSelection: () => set({ selectedIds: new Set() }),

  setViewMode: (viewMode) => set({ viewMode }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setPlatformFilter: (platformFilter) => set({ platformFilter }),
  setLoading: (isLoading) => set({ isLoading }),

  filteredListings: () => {
    const { listings, searchQuery, statusFilter, platformFilter } = get();
    return listings.filter((l) => {
      if (searchQuery && !l.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (statusFilter && l.status !== statusFilter) return false;
      if (platformFilter && !l.platforms[platformFilter]) return false;
      return true;
    });
  },
}));
