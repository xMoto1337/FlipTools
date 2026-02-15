import { create } from 'zustand';

export interface InventoryItem {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  cost: number | null;
  quantity: number;
  category: string | null;
  images: string[];
  location: string | null;
  sku: string | null;
  listing_id: string | null;
  created_at: string;
  updated_at: string;
}

interface InventoryState {
  items: InventoryItem[];
  searchQuery: string;
  categoryFilter: string;
  isLoading: boolean;

  setItems: (items: InventoryItem[]) => void;
  addItem: (item: InventoryItem) => void;
  updateItem: (id: string, updates: Partial<InventoryItem>) => void;
  removeItem: (id: string) => void;
  setSearchQuery: (query: string) => void;
  setCategoryFilter: (category: string) => void;
  setLoading: (loading: boolean) => void;

  filteredItems: () => InventoryItem[];
  totalValue: () => number;
  totalItems: () => number;
}

export const useInventoryStore = create<InventoryState>()((set, get) => ({
  items: [],
  searchQuery: '',
  categoryFilter: '',
  isLoading: false,

  setItems: (items) => set({ items }),
  addItem: (item) => set((s) => ({ items: [item, ...s.items] })),
  updateItem: (id, updates) =>
    set((s) => ({
      items: s.items.map((i) => (i.id === id ? { ...i, ...updates } : i)),
    })),
  removeItem: (id) =>
    set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
  setLoading: (isLoading) => set({ isLoading }),

  filteredItems: () => {
    const { items, searchQuery, categoryFilter } = get();
    return items.filter((i) => {
      if (searchQuery && !i.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (categoryFilter && i.category !== categoryFilter) return false;
      return true;
    });
  },

  totalValue: () => {
    return get().items.reduce((sum, i) => sum + (i.cost || 0) * i.quantity, 0);
  },

  totalItems: () => {
    return get().items.reduce((sum, i) => sum + i.quantity, 0);
  },
}));
