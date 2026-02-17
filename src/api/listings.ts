import { supabase } from './supabase';
import { usePlatformStore } from '../stores/platformStore';
import { getPlatform, getPlatformIds } from './platforms';
import { analyticsApi } from './analytics';

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

  /**
   * Sync listings from all connected platforms into Supabase.
   * Caches sync time — only re-fetches from platform APIs every 10 minutes.
   * Pass force=true to bypass the cache.
   */
  async syncPlatformListings(force = false): Promise<{ synced: number; total: number; errors: string[] }> {
    const SYNC_INTERVAL = 10 * 60 * 1000; // 10 minutes
    const lastSync = Number(localStorage.getItem('fliptools_listings_last_sync') || '0');

    if (!force && Date.now() - lastSync < SYNC_INTERVAL) {
      console.log('[sync] Listings: skipping — last sync was', Math.round((Date.now() - lastSync) / 1000), 's ago');
      return { synced: 0, total: 0, errors: [] };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { isConnected } = usePlatformStore.getState();
    let totalSynced = 0;
    let totalFetched = 0;
    const errors: string[] = [];

    for (const platformId of getPlatformIds()) {
      if (!isConnected(platformId)) continue;

      // Refresh token if expired
      const token = await analyticsApi._ensureFreshToken(platformId);
      if (!token) {
        errors.push(`${platformId}: token expired — reconnect in Settings`);
        continue;
      }

      try {
        const adapter = getPlatform(platformId);
        const platformListings = await adapter.getListings({}, token);

        console.log(`[sync] ${platformId}: fetched ${platformListings.length} listings`);
        totalFetched += platformListings.length;

        if (platformListings.length === 0) continue;

        // Get existing listings that have this platform's external ID
        // The platforms JSONB column stores: { "ebay": { "id": "123", ... } }
        const { data: existing } = await supabase
          .from('listings')
          .select('id, platforms')
          .eq('user_id', user.id);

        // Build a set of existing external IDs for this platform
        const existingByExternalId = new Map<string, string>();
        for (const row of existing || []) {
          const platData = (row.platforms as Record<string, { id: string }>)?.[platformId];
          if (platData?.id) {
            existingByExternalId.set(platData.id, row.id);
          }
        }

        // Separate into new and existing listings
        const newListings = [];
        const updatedListings = [];

        for (const item of platformListings) {
          if (!item.externalId) continue;
          const existingId = existingByExternalId.get(item.externalId);

          const platformInfo = {
            [platformId]: {
              id: item.externalId,
              url: item.url,
              status: item.status,
            },
          };

          if (existingId) {
            // Update existing listing
            updatedListings.push({
              dbId: existingId,
              status: item.status === 'active' ? 'active' as const : item.status === 'sold' ? 'sold' as const : 'ended' as const,
              price: item.price || undefined,
              images: item.images?.length ? item.images : undefined,
              platforms: platformInfo,
            });
          } else {
            // Insert new listing
            newListings.push({
              user_id: user.id,
              title: item.title || 'Untitled',
              description: item.description || null,
              price: item.price || null,
              category: item.category || null,
              condition: item.condition || null,
              images: item.images || [],
              status: item.status === 'active' ? 'active' : item.status === 'sold' ? 'sold' : 'ended',
              platforms: platformInfo,
              tags: [],
            });
          }
        }

        // Insert new listings
        if (newListings.length > 0) {
          console.log(`[sync] ${platformId}: inserting ${newListings.length} new listings`);
          const { error: insertErr } = await supabase.from('listings').insert(newListings);
          if (insertErr) {
            console.error(`[sync] Listing insert failed for ${platformId}:`, insertErr);
            errors.push(`${platformId}: ${insertErr.message}`);
          } else {
            totalSynced += newListings.length;
          }
        }

        // Update existing listings (status + price)
        for (const item of updatedListings) {
          const updates: Record<string, unknown> = {
            status: item.status,
            platforms: item.platforms,
            updated_at: new Date().toISOString(),
          };
          if (item.price !== undefined) updates.price = item.price;
          if (item.images !== undefined) updates.images = item.images;

          const { error: updateErr } = await supabase
            .from('listings')
            .update(updates)
            .eq('id', item.dbId);

          if (updateErr) {
            console.error(`[sync] Listing update failed:`, updateErr);
          } else {
            totalSynced++;
          }
        }

        if (newListings.length === 0 && updatedListings.length === 0) {
          console.log(`[sync] ${platformId}: no listings to sync`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[sync] Failed to sync ${platformId} listings:`, msg);
        errors.push(`${platformId}: ${msg}`);
      }
    }

    // Save sync timestamp so we don't re-fetch on every navigation
    localStorage.setItem('fliptools_listings_last_sync', String(Date.now()));

    console.log(`[sync] Listings done — synced ${totalSynced}/${totalFetched}, errors: ${errors.length}`);
    return { synced: totalSynced, total: totalFetched, errors };
  },
};
