import { create } from 'zustand';
import type { Listing } from '../api/listings';

type ViewMode = 'grid' | 'list';
type SortField = 'created_at' | 'price' | 'title' | 'status';
type SortDir = 'asc' | 'desc';

interface ListingState {
  listings: Listing[];
  selectedIds: Set<string>;
  viewMode: ViewMode;
  searchQuery: string;
  statusFilter: string;
  platformFilter: string;
  categoryFilter: string;
  conditionFilter: string;
  sortField: SortField;
  sortDir: SortDir;
  currentPage: number;
  pageSize: number;
  isLoading: boolean;

  setListings: (listings: Listing[]) => void;
  addListing: (listing: Listing) => void;
  updateListing: (id: string, updates: Partial<Listing>) => void;
  updateListings: (ids: string[], updates: Partial<Listing>) => void;
  removeListing: (id: string) => void;
  removeListings: (ids: string[]) => void;

  toggleSelect: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;

  setViewMode: (mode: ViewMode) => void;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (status: string) => void;
  setPlatformFilter: (platform: string) => void;
  setCategoryFilter: (category: string) => void;
  setConditionFilter: (condition: string) => void;
  setSortField: (field: SortField) => void;
  setSortDir: (dir: SortDir) => void;
  setCurrentPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setLoading: (loading: boolean) => void;

  filteredListings: () => Listing[];
  paginatedListings: () => Listing[];
  totalPages: () => number;
  totalFiltered: () => number;
}

export const useListingStore = create<ListingState>()((set, get) => ({
  listings: [],
  selectedIds: new Set<string>(),
  viewMode: 'list',
  searchQuery: '',
  statusFilter: '',
  platformFilter: '',
  categoryFilter: '',
  conditionFilter: '',
  sortField: 'created_at',
  sortDir: 'desc',
  currentPage: 1,
  pageSize: 24,
  isLoading: false,

  setListings: (listings) => set({ listings }),
  addListing: (listing) => set((s) => ({ listings: [listing, ...s.listings] })),
  updateListing: (id, updates) =>
    set((s) => ({
      listings: s.listings.map((l) => (l.id === id ? { ...l, ...updates } : l)),
    })),
  updateListings: (ids, updates) =>
    set((s) => ({
      listings: s.listings.map((l) => (ids.includes(l.id) ? { ...l, ...updates } : l)),
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
    set(() => ({ selectedIds: new Set(get().paginatedListings().map((l) => l.id)) })),
  clearSelection: () => set({ selectedIds: new Set() }),

  setViewMode: (viewMode) => set({ viewMode }),
  setSearchQuery: (searchQuery) => set({ searchQuery, currentPage: 1 }),
  setStatusFilter: (statusFilter) => set({ statusFilter, currentPage: 1 }),
  setPlatformFilter: (platformFilter) => set({ platformFilter, currentPage: 1 }),
  setCategoryFilter: (categoryFilter) => set({ categoryFilter, currentPage: 1 }),
  setConditionFilter: (conditionFilter) => set({ conditionFilter, currentPage: 1 }),
  setSortField: (sortField) => set({ sortField }),
  setSortDir: (sortDir) => set({ sortDir }),
  setCurrentPage: (currentPage) => set({ currentPage }),
  setPageSize: (pageSize) => set({ pageSize, currentPage: 1 }),
  setLoading: (isLoading) => set({ isLoading }),

  filteredListings: () => {
    const { listings, searchQuery, statusFilter, platformFilter, categoryFilter, conditionFilter, sortField, sortDir } = get();
    let filtered = listings.filter((l) => {
      if (searchQuery && !l.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (statusFilter && l.status !== statusFilter) return false;
      if (platformFilter && !l.platforms[platformFilter]) return false;
      if (categoryFilter && l.category !== categoryFilter) return false;
      if (conditionFilter && l.condition !== conditionFilter) return false;
      return true;
    });

    // Sort
    filtered = [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'price':
          cmp = (a.price || 0) - (b.price || 0);
          break;
        case 'title':
          cmp = a.title.localeCompare(b.title);
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
        case 'created_at':
        default:
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return filtered;
  },

  paginatedListings: () => {
    const { currentPage, pageSize } = get();
    const filtered = get().filteredListings();
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  },

  totalPages: () => {
    const { pageSize } = get();
    return Math.max(1, Math.ceil(get().filteredListings().length / pageSize));
  },

  totalFiltered: () => get().filteredListings().length,
}));
