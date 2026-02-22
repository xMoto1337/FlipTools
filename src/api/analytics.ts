import { supabase } from './supabase';
import { usePlatformStore } from '../stores/platformStore';
import { getPlatform, getPlatformIds } from './platforms';

export interface Sale {
  id: string;
  user_id: string;
  listing_id: string | null;
  platform: string;
  sale_price: number;
  shipping_cost: number;
  platform_fees: number;
  cost: number;
  profit: number;
  buyer_username: string | null;
  sold_at: string;
  external_id?: string | null;
  item_title?: string | null;
  item_image_url?: string | null;
  listing?: {
    title: string;
    images: string[];
  };
}

export interface SalesStats {
  totalRevenue: number;
  totalProfit: number;
  totalSales: number;
  avgProfit: number;
  avgSalePrice: number;
}

export const analyticsApi = {
  async getSales(params?: {
    startDate?: string;
    endDate?: string;
    platform?: string;
    limit?: number;
    offset?: number;
  }): Promise<Sale[]> {
    let query = supabase
      .from('sales')
      .select('*, listing:listings(title, images)')
      .order('sold_at', { ascending: false });

    if (params?.startDate) {
      query = query.gte('sold_at', params.startDate);
    }
    if (params?.endDate) {
      query = query.lte('sold_at', params.endDate);
    }
    if (params?.platform) {
      query = query.eq('platform', params.platform);
    }
    if (params?.limit) {
      query = query.limit(params.limit);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async getStats(startDate?: string, endDate?: string): Promise<SalesStats> {
    let query = supabase
      .from('sales')
      .select('sale_price, profit, platform_fees, shipping_cost, cost');

    if (startDate) query = query.gte('sold_at', startDate);
    if (endDate) query = query.lte('sold_at', endDate);

    const { data, error } = await query;
    if (error) throw error;

    const sales = data || [];
    const totalRevenue = sales.reduce((sum, s) => sum + Number(s.sale_price), 0);
    const totalProfit = sales.reduce((sum, s) => sum + Number(s.profit), 0);

    return {
      totalRevenue,
      totalProfit,
      totalSales: sales.length,
      avgProfit: sales.length > 0 ? totalProfit / sales.length : 0,
      avgSalePrice: sales.length > 0 ? totalRevenue / sales.length : 0,
    };
  },

  async recordSale(sale: {
    listing_id?: string;
    platform: string;
    sale_price: number;
    shipping_cost?: number;
    platform_fees?: number;
    cost?: number;
    buyer_username?: string;
    sold_at?: string;
  }): Promise<Sale> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('sales')
      .insert({
        user_id: user.id,
        ...sale,
        shipping_cost: sale.shipping_cost || 0,
        platform_fees: sale.platform_fees || 0,
        cost: sale.cost || 0,
        sold_at: sale.sold_at || new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Ensure the platform token is fresh; refresh if expired.
   * Returns the valid access token or null if refresh fails.
   */
  async _ensureFreshToken(platformId: Parameters<typeof getPlatform>[0]): Promise<string | null> {
    const store = usePlatformStore.getState();
    const connection = store.connections[platformId];
    if (!connection) return null;

    // Check if token expires within the next 5 minutes
    const expiresAt = new Date(connection.tokenExpiresAt).getTime();
    const buffer = 5 * 60 * 1000;
    if (Date.now() < expiresAt - buffer) {
      return connection.accessToken;
    }

    // Token expired or expiring soon — refresh it
    console.log(`[sync] Refreshing expired ${platformId} token...`);
    try {
      const adapter = getPlatform(platformId);
      const newTokens = await adapter.refreshToken(connection.refreshToken);
      store.setConnection(platformId, {
        ...connection,
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
        tokenExpiresAt: newTokens.expiresAt,
      });
      console.log(`[sync] ${platformId} token refreshed successfully`);
      return newTokens.accessToken;
    } catch (err) {
      console.error(`[sync] Failed to refresh ${platformId} token:`, err);
      return null;
    }
  },

  /**
   * Delete all sales for a platform so they can be re-synced fresh.
   * Called when reconnecting a platform to clear stale cached data.
   */
  async purgePlatformSales(platform: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('sales')
      .delete()
      .eq('user_id', user.id)
      .eq('platform', platform);

    if (error) {
      console.error(`[sync] Failed to purge ${platform} sales:`, error);
    } else {
      console.log(`[sync] Purged all ${platform} sales for fresh re-sync`);
    }
  },

  /**
   * Sync sales from all connected platforms into Supabase.
   * Fetches orders from each platform API and upserts them.
   */
  async syncPlatformSales(startDate?: string, force = false): Promise<{ synced: number; total: number; errors: string[] }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // Skip sync if we synced recently (10-minute cache) unless forced
    const CACHE_KEY = `fliptools_sales_last_sync_${user.id}`;
    const CACHE_TTL = 10 * 60 * 1000;
    if (!force) {
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached && Date.now() - Number(cached) < CACHE_TTL) {
          console.log('[sync] Sales sync skipped — cached within 10 minutes');
          return { synced: 0, total: 0, errors: [] };
        }
      } catch {}
    }

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
        const platformSales = await adapter.getSales({ startDate, limit: 200 }, token);

        console.log(`[sync] ${platformId}: fetched ${platformSales.length} sales`);
        totalFetched += platformSales.length;

        if (platformSales.length === 0) continue;

        // Single batch upsert — handles new and existing in one round-trip.
        // ignoreDuplicates: false means existing rows get updated with fresh eBay data.
        const rows = platformSales
          .filter((item) => item.orderId)
          .map((item) => ({
            user_id: user.id,
            platform: item.platform,
            sale_price: item.price,
            shipping_cost: item.shippingCost || 0,
            platform_fees: item.platformFees || 0,
            cost: 0,
            buyer_username: item.buyerUsername || null,
            sold_at: item.soldDate || new Date().toISOString(),
            external_id: item.orderId,
            item_title: item.title,
            item_image_url: item.imageUrl || null,
          }));

        const { error } = await supabase.from('sales').upsert(rows, {
          onConflict: 'user_id,platform,external_id',
          ignoreDuplicates: false,
        });

        if (error) {
          console.error(`[sync] Upsert failed for ${platformId}:`, error);
          errors.push(`${platformId}: ${error.message}`);
        } else {
          totalSynced += rows.length;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[sync] Failed to sync ${platformId} sales:`, msg);
        errors.push(`${platformId}: ${msg}`);
      }
    }

    // Cache successful sync time
    if (errors.length === 0) {
      try { localStorage.setItem(CACHE_KEY, String(Date.now())); } catch {}
    }

    console.log(`[sync] Done — synced ${totalSynced}/${totalFetched}, errors: ${errors.length}`);
    return { synced: totalSynced, total: totalFetched, errors };
  },
};
