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
   * Sync sales from all connected platforms into Supabase.
   * Fetches orders from each platform API and upserts them.
   */
  async syncPlatformSales(startDate?: string): Promise<{ synced: number; total: number; errors: string[] }> {
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
        const platformSales = await adapter.getSales(
          { startDate, limit: 200 },
          token
        );

        console.log(`[sync] ${platformId}: fetched ${platformSales.length} sales`);
        totalFetched += platformSales.length;

        if (platformSales.length === 0) continue;

        // Get existing external_ids to avoid duplicates
        // (PostgREST can't use partial unique indexes for onConflict)
        const orderIds = platformSales
          .map((s) => s.orderId)
          .filter((id): id is string => !!id);

        const { data: existing } = await supabase
          .from('sales')
          .select('external_id')
          .eq('user_id', user.id)
          .eq('platform', platformId)
          .in('external_id', orderIds);

        const existingIds = new Set((existing || []).map((r) => r.external_id));

        // Insert only new sales
        const newSales = platformSales.filter(
          (item) => item.orderId && !existingIds.has(item.orderId)
        );

        if (newSales.length === 0) {
          console.log(`[sync] ${platformId}: all ${platformSales.length} sales already synced`);
          totalSynced += platformSales.length;
          continue;
        }

        console.log(`[sync] ${platformId}: inserting ${newSales.length} new sales`);

        const rows = newSales.map((item) => ({
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

        const { error } = await supabase.from('sales').insert(rows);

        if (error) {
          console.error(`[sync] Batch insert failed for ${platformId}:`, error);
          errors.push(`${platformId}: ${error.message}`);
        } else {
          totalSynced += newSales.length;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[sync] Failed to sync ${platformId} sales:`, msg);
        errors.push(`${platformId}: ${msg}`);
      }
    }

    console.log(`[sync] Done — synced ${totalSynced}/${totalFetched}, errors: ${errors.length}`);
    return { synced: totalSynced, total: totalFetched, errors };
  },
};
