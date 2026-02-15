import { supabase } from './supabase';

export interface Listing {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  price: number | null;
  cost: number | null;
  category: string | null;
  condition: string | null;
  images: string[];
  status: 'draft' | 'active' | 'sold' | 'ended' | 'error';
  platforms: Record<string, { id: string; url: string; status: string }>;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface ListingInput {
  title: string;
  description?: string;
  price?: number;
  cost?: number;
  category?: string;
  condition?: string;
  images?: string[];
  tags?: string[];
  status?: Listing['status'];
}

export const listingsApi = {
  async getAll(filters?: {
    status?: string;
    platform?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<Listing[]> {
    let query = supabase
      .from('listings')
      .select('*')
      .order('created_at', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.search) {
      query = query.ilike('title', `%${filters.search}%`);
    }
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }
    if (filters?.offset) {
      query = query.range(filters.offset, filters.offset + (filters?.limit || 50) - 1);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async getById(id: string): Promise<Listing | null> {
    const { data, error } = await supabase
      .from('listings')
      .select('*')
      .eq('id', id)
      .single();

    if (error) return null;
    return data;
  },

  async create(listing: ListingInput): Promise<Listing> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('listings')
      .insert({
        user_id: user.id,
        ...listing,
        images: listing.images || [],
        tags: listing.tags || [],
        platforms: {},
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async update(id: string, updates: Partial<ListingInput>): Promise<Listing> {
    const { data, error } = await supabase
      .from('listings')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from('listings')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },

  async bulkUpdateStatus(ids: string[], status: Listing['status']): Promise<void> {
    const { error } = await supabase
      .from('listings')
      .update({ status, updated_at: new Date().toISOString() })
      .in('id', ids);

    if (error) throw error;
  },

  async bulkDelete(ids: string[]): Promise<void> {
    const { error } = await supabase
      .from('listings')
      .delete()
      .in('id', ids);

    if (error) throw error;
  },

  async uploadImage(file: File): Promise<string> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const fileExt = file.name.split('.').pop();
    const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;

    const { error } = await supabase.storage
      .from('listing-images')
      .upload(fileName, file);

    if (error) throw error;

    const { data } = supabase.storage
      .from('listing-images')
      .getPublicUrl(fileName);

    return data.publicUrl;
  },
};
