import { supabase } from './supabase';
import type { SoldItem } from './platforms/types';

export interface SavedSearch {
  id: string;
  user_id: string;
  name: string;
  query: string;
  search_type: 'keyword' | 'image';
  last_avg_price: number | null;
  last_result_count: number | null;
  result_snapshot: SoldItem[];
  price_history: { date: string; avgPrice: number; resultCount: number }[];
  notes: string | null;
  is_watching: boolean;
  last_searched_at: string;
  created_at: string;
  updated_at: string;
}

export interface SavedSearchInput {
  name: string;
  query: string;
  search_type: 'keyword' | 'image';
  last_avg_price?: number;
  last_result_count?: number;
  result_snapshot?: SoldItem[];
  notes?: string;
  is_watching?: boolean;
}

export const researchApi = {
  async getSavedSearches(): Promise<SavedSearch[]> {
    const { data, error } = await supabase
      .from('saved_searches')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async saveSearch(input: SavedSearchInput): Promise<SavedSearch> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('saved_searches')
      .insert({
        user_id: user.id,
        ...input,
        result_snapshot: input.result_snapshot?.slice(0, 20) || [],
        price_history: input.last_avg_price
          ? [{ date: new Date().toISOString(), avgPrice: input.last_avg_price, resultCount: input.last_result_count || 0 }]
          : [],
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async updateSavedSearch(id: string, updates: Partial<SavedSearchInput>): Promise<SavedSearch> {
    const { data, error } = await supabase
      .from('saved_searches')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async deleteSavedSearch(id: string): Promise<void> {
    const { error } = await supabase
      .from('saved_searches')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },

  async recordPriceSnapshot(id: string, avgPrice: number, resultCount: number, resultSnapshot: SoldItem[]): Promise<void> {
    // Read existing price_history, append new entry
    const { data: existing, error: readError } = await supabase
      .from('saved_searches')
      .select('price_history')
      .eq('id', id)
      .single();

    if (readError) throw readError;

    const history = (existing?.price_history as { date: string; avgPrice: number; resultCount: number }[]) || [];
    history.push({ date: new Date().toISOString(), avgPrice, resultCount });

    const { error } = await supabase
      .from('saved_searches')
      .update({
        price_history: history,
        last_avg_price: avgPrice,
        last_result_count: resultCount,
        result_snapshot: resultSnapshot.slice(0, 20),
        last_searched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) throw error;
  },
};
