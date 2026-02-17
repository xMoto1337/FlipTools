import { config } from '../../config';
import type {
  PlatformAdapter,
  TokenPair,
  ListingData,
  PlatformListing,
  SoldItem,
  FeeBreakdown,
  ListingsQuery,
  SalesQuery,
} from './types';

// Use sandbox URLs for development, switch to production for release
// Detect sandbox from config flag OR from client ID containing "SBX"
const IS_SANDBOX = config.ebay.sandbox || config.ebay.clientId.includes('SBX');
const EBAY_AUTH_URL = IS_SANDBOX
  ? 'https://auth.sandbox.ebay.com/oauth2/authorize'
  : 'https://auth.ebay.com/oauth2/authorize';

const CONDITION_MAP: Record<string, string> = {
  'new': 'NEW',
  'like new': 'LIKE_NEW',
  'very good': 'VERY_GOOD',
  'good': 'GOOD',
  'acceptable': 'ACCEPTABLE',
  'for parts': 'FOR_PARTS_OR_NOT_WORKING',
};

const REVERSE_CONDITION_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(CONDITION_MAP).map(([k, v]) => [v, k])
);

// All eBay API calls must go through our proxy to avoid CORS issues
async function ebayGet(endpoint: string, token: string): Promise<Response> {
  const resp = await fetch('/api/ebay-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, token, method: 'GET' }),
  });
  return resp;
}

async function ebayPost(endpoint: string, token: string, payload: unknown): Promise<Response> {
  const resp = await fetch('/api/ebay-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, token, method: 'POST', payload }),
  });
  return resp;
}

export const ebayAdapter: PlatformAdapter = {
  name: 'eBay',
  id: 'ebay',
  icon: 'ebay',
  color: '#e53238',

  getAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: config.ebay.clientId,
      redirect_uri: config.ebay.redirectUri,
      response_type: 'code',
      scope: [
        'https://api.ebay.com/oauth/api_scope',
        'https://api.ebay.com/oauth/api_scope/sell.inventory',
        'https://api.ebay.com/oauth/api_scope/sell.marketing',
        'https://api.ebay.com/oauth/api_scope/sell.account',
        'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
      ].join(' '),
    });
    return `${EBAY_AUTH_URL}?${params.toString()}`;
  },

  async handleCallback(code: string): Promise<TokenPair> {
    const response = await fetch('/api/ebay-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, grant_type: 'authorization_code' }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'eBay auth failed');

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };
  },

  async refreshToken(refreshToken: string): Promise<TokenPair> {
    const response = await fetch('/api/ebay-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken, grant_type: 'refresh_token' }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Token refresh failed');

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };
  },

  async createListing(listing: ListingData, token: string): Promise<PlatformListing> {
    const sku = `FT-${Date.now()}`;

    // Create inventory item
    await ebayPost(`/sell/inventory/v1/inventory_item/${sku}`, token, {
      product: {
        title: listing.title,
        description: listing.description,
        imageUrls: listing.images,
      },
      condition: CONDITION_MAP[listing.condition.toLowerCase()] || 'USED_EXCELLENT',
      availability: {
        shipToLocationAvailability: { quantity: 1 },
      },
    });

    // Create offer
    const offerResponse = await ebayPost('/sell/inventory/v1/offer', token, {
      sku,
      marketplaceId: 'EBAY_US',
      format: 'FIXED_PRICE',
      listingDescription: listing.description,
      pricingSummary: {
        price: { value: listing.price.toFixed(2), currency: 'USD' },
      },
      categoryId: listing.category || '175672',
      listingPolicies: {},
    });

    const offerData = await offerResponse.json();
    if (!offerResponse.ok) throw new Error(offerData.message || 'Failed to create eBay offer');

    // Publish offer
    const publishResponse = await ebayPost(
      `/sell/inventory/v1/offer/${offerData.offerId}/publish`,
      token,
      {}
    );

    const publishData = await publishResponse.json();

    return {
      externalId: publishData.listingId || offerData.offerId,
      url: `https://www.ebay.com/itm/${publishData.listingId}`,
      status: 'active',
      platformData: { sku, offerId: offerData.offerId },
    };
  },

  async updateListing(externalId: string, listing: Partial<ListingData>, token: string): Promise<PlatformListing> {
    const response = await ebayPost(`/sell/inventory/v1/offer/${externalId}`, token, {
      ...(listing.price && {
        pricingSummary: { price: { value: listing.price.toFixed(2), currency: 'USD' } },
      }),
      ...(listing.description && { listingDescription: listing.description }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || 'Update failed');
    }

    return {
      externalId,
      url: `https://www.ebay.com/itm/${externalId}`,
      status: 'active',
    };
  },

  async deleteListing(externalId: string, token: string): Promise<void> {
    // DELETE method through proxy
    const response = await fetch('/api/ebay-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: `/sell/inventory/v1/offer/${externalId}`,
        token,
        method: 'DELETE',
      }),
    });
    if (!response.ok) throw new Error('Failed to delete eBay listing');
  },

  async getListings(_params: ListingsQuery, token: string): Promise<PlatformListing[]> {
    // Fetch inventory items (titles, images, condition)
    const itemsMap = new Map<string, Record<string, unknown>>();
    let itemsOffset = 0;
    while (true) {
      const resp = await ebayGet(
        `/sell/inventory/v1/inventory_item?limit=200&offset=${itemsOffset}`,
        token
      );
      const data = await resp.json();
      if (!resp.ok) {
        console.error('[ebay] getInventoryItems error:', resp.status, data);
        break;
      }
      const items = (data.inventoryItems || []) as Record<string, unknown>[];
      if (items.length === 0) break;
      for (const item of items) {
        itemsMap.set(item.sku as string, item);
      }
      if (items.length < 200) break;
      itemsOffset += items.length;
    }

    // Fetch offers (prices, listing IDs, status)
    const allListings: PlatformListing[] = [];
    let offersOffset = 0;
    while (true) {
      const resp = await ebayGet(
        `/sell/inventory/v1/offer?limit=200&offset=${offersOffset}`,
        token
      );
      const data = await resp.json();
      if (!resp.ok) {
        console.error('[ebay] getOffers error:', resp.status, data);
        if (resp.status === 401) throw new Error('eBay token expired');
        break;
      }
      const offers = (data.offers || []) as Record<string, unknown>[];
      if (offers.length === 0) break;

      for (const offer of offers) {
        const sku = offer.sku as string;
        const invItem = itemsMap.get(sku);
        const product = (invItem?.product || {}) as Record<string, unknown>;
        const pricing = (offer.pricingSummary as Record<string, Record<string, string>>) || {};
        const listing = (offer.listing as Record<string, string>) || {};
        const listingId = listing.listingId || '';
        const status = offer.status === 'PUBLISHED' ? 'active' as const : 'ended' as const;

        // Map eBay condition codes back to readable names
        const conditionRaw = (invItem?.condition as string) || '';
        const conditionLabel = REVERSE_CONDITION_MAP[conditionRaw] || conditionRaw.toLowerCase().replace(/_/g, ' ');

        allListings.push({
          externalId: listingId || String(offer.offerId || ''),
          url: listingId ? `https://www.ebay.com/itm/${listingId}` : '',
          status,
          title: (product.title as string) || '',
          description: (product.description as string) || '',
          price: Number(pricing.price?.value || 0),
          images: (product.imageUrls as string[]) || [],
          condition: conditionLabel,
          category: (offer.categoryId as string) || '',
          platformData: { sku, offerId: offer.offerId },
        });
      }

      if (offers.length < 200) break;
      offersOffset += offers.length;
    }

    console.log(`[ebay] getListings: found ${allListings.length} listings`);
    return allListings;
  },

  async getSales(params: SalesQuery, token: string): Promise<SoldItem[]> {
    // Build query with date filters and pagination
    const queryParams = new URLSearchParams({
      limit: String(params.limit || 200),
      orderBy: 'creationdate',
    });

    // eBay Fulfillment API uses filter for date ranges
    const filters: string[] = [];
    if (params.startDate) {
      filters.push(`creationdate:[${new Date(params.startDate).toISOString()}..${new Date().toISOString()}]`);
    }
    if (filters.length > 0) {
      queryParams.set('filter', filters.join(','));
    }

    const allOrders: SoldItem[] = [];
    let offset = 0;
    const limit = params.limit || 200;

    // Paginate through orders
    while (true) {
      queryParams.set('offset', String(offset));
      const response = await ebayGet(
        `/sell/fulfillment/v1/order?${queryParams}`,
        token
      );
      const data = await response.json();
      if (!response.ok) {
        console.error('[ebay] getSales error:', response.status, data);
        if (response.status === 401) {
          throw new Error('eBay token expired');
        }
        break;
      }

      const orders = data.orders || [];
      if (orders.length === 0) break;

      for (const order of orders) {
        const lineItems = (order.lineItems as Record<string, unknown>[]) || [];
        const pricing = (order.pricingSummary as Record<string, Record<string, string>>) || {};
        const buyer = (order.buyer as Record<string, string>) || {};

        // Total = item price + shipping (what the seller receives before fees)
        // Shipping is revenue to the seller, not a cost — buyer pays it
        const salePrice = Number(pricing.total?.value || 0);

        // Estimate fees on total (eBay charges FVF on item + shipping)
        const fees = ebayAdapter.calculateFees(salePrice);

        // Get the first line item for title/image
        const firstItem = lineItems[0] || {};
        const title = (firstItem.title as string) || 'Unknown Item';
        const legacyItemId = firstItem.legacyItemId as string;
        const itemUrl = legacyItemId ? `https://www.ebay.com/itm/${legacyItemId}` : '';
        const itemImage = ((firstItem.image as Record<string, string>)?.imageUrl) || '';

        // Multi-item orders: combine titles
        const fullTitle = lineItems.length > 1
          ? `${title} (+${lineItems.length - 1} more)`
          : title;

        allOrders.push({
          title: fullTitle,
          price: salePrice,
          soldDate: (order.creationDate as string) || '',
          condition: '',
          imageUrl: itemImage,
          url: itemUrl,
          platform: 'ebay',
          shippingCost: 0, // Buyer's shipping payment is included in salePrice as revenue
          platformFees: fees.totalFees,
          buyerUsername: buyer.username || undefined,
          orderId: order.orderId as string,
        });
      }

      // Check if there are more pages
      if (orders.length < limit) break;
      offset += orders.length;
    }

    return allOrders;
  },

  async searchSold(query: string, token: string): Promise<SoldItem[]> {
    // Try Marketplace Insights API for actual sold/completed items
    const insightsParams = new URLSearchParams({
      q: query,
      filter: 'buyingOptions:{FIXED_PRICE|AUCTION},priceCurrency:USD',
      sort: 'newlyListed',
      limit: '50',
    });

    const insightsResponse = await ebayGet(
      `/buy/marketplace_insights/v1_beta/item_sales/search?${insightsParams}`,
      token
    );

    if (insightsResponse.ok) {
      const data = await insightsResponse.json();
      return (data.itemSales || []).map((item: Record<string, unknown>) => ({
        title: item.title as string,
        price: Number(((item.lastSoldPrice || item.price) as Record<string, unknown>)?.value || 0),
        soldDate: (item.lastSoldDate as string) || '',
        condition: (item.condition as string) || '',
        imageUrl: ((item.thumbnailImages as Record<string, string>[]) || [])[0]?.imageUrl || ((item.image as Record<string, string>)?.imageUrl) || '',
        url: item.itemWebUrl as string || '',
        platform: 'ebay',
      }));
    }

    // Fallback to Browse API if Marketplace Insights is unavailable
    const params = new URLSearchParams({
      q: query,
      filter: 'buyingOptions:{FIXED_PRICE|AUCTION}',
      sort: 'newlyListed',
      limit: '50',
    });

    const response = await ebayGet(
      `/buy/browse/v1/item_summary/search?${params}`,
      token
    );

    const data = await response.json();
    if (!response.ok) return [];

    return (data.itemSummaries || []).map((item: Record<string, unknown>) => ({
      title: item.title as string,
      price: Number((item.price as Record<string, unknown>)?.value || 0),
      soldDate: item.itemEndDate as string || '',
      condition: (item.condition as string) || '',
      imageUrl: ((item.thumbnailImages as Record<string, string>[]) || [])[0]?.imageUrl || '',
      url: item.itemWebUrl as string || '',
      platform: 'ebay',
    }));
  },

  async searchByImage(imageUrl: string, token: string): Promise<SoldItem[]> {
    const response = await ebayPost(
      '/buy/browse/v1/item_summary/search_by_image',
      token,
      { image: imageUrl }
    );

    const data = await response.json();
    if (!response.ok) return [];

    return (data.itemSummaries || []).map((item: Record<string, unknown>) => ({
      title: item.title as string,
      price: Number((item.price as Record<string, unknown>)?.value || 0),
      soldDate: '',
      condition: (item.condition as string) || '',
      imageUrl: ((item.thumbnailImages as Record<string, string>[]) || [])[0]?.imageUrl || '',
      url: item.itemWebUrl as string || '',
      platform: 'ebay',
    }));
  },

  calculateFees(price: number): FeeBreakdown {
    // eBay merged payment processing into FVF — no separate 2.95%
    const finalValueFee = price * 0.1325; // 13.25% standard FVF (includes payment processing)
    const perOrderFee = 0.30; // per-order regulatory surcharge
    const totalFees = finalValueFee + perOrderFee;

    return {
      finalValueFee: Math.round(finalValueFee * 100) / 100,
      paymentProcessingFee: Math.round(perOrderFee * 100) / 100,
      totalFees: Math.round(totalFees * 100) / 100,
      netProceeds: Math.round((price - totalFees) * 100) / 100,
    };
  },

  mapCondition(condition: string): string {
    return CONDITION_MAP[condition.toLowerCase()] || 'USED_EXCELLENT';
  },

  mapCategory(category: string): string {
    const categoryMap: Record<string, string> = {
      'clothing': '11450',
      'shoes': '93427',
      'electronics': '293',
      'collectibles': '1',
      'home': '11700',
      'toys': '220',
    };
    return categoryMap[category.toLowerCase()] || '175672';
  },
};
