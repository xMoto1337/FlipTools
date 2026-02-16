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
   * Sync sales from all connected platforms into Supabase.
   * Fetches orders from each platform API and upserts them.
   */
  async syncPlatformSales(startDate?: string): Promise<{ synced: number; total: number }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { isConnected, getToken } = usePlatformStore.getState();
    let totalSynced = 0;
    let totalFetched = 0;

    for (const platformId of getPlatformIds()) {
      const token = getToken(platformId);
      if (!token || !isConnected(platformId)) continue;

      try {
        const adapter = getPlatform(platformId);
        const platformSales = await adapter.getSales(
          { startDate, limit: 200 },
          token
        );

        totalFetched += platformSales.length;

        if (platformSales.length === 0) continue;

        // Upsert each sale — use external_id for dedup
        for (const item of platformSales) {
          if (!item.orderId) continue;

          const { error } = await supabase
            .from('sales')
            .upsert(
              {
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
              },
              {
                onConflict: 'user_id,platform,external_id',
                ignoreDuplicates: true,
              }
            );

          if (error) {
            console.error(`Failed to upsert sale ${item.orderId}:`, error);
          } else {
            totalSynced++;
          }
        }
      } catch (err) {
        console.error(`Failed to sync ${platformId} sales:`, err);
      }
    }

    return { synced: totalSynced, total: totalFetched };
  },
};
