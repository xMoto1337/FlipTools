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
const IS_SANDBOX = import.meta.env.DEV || config.ebay.sandbox || config.ebay.clientId.includes('SBX');
const EBAY_AUTH_URL = IS_SANDBOX
  ? 'https://auth.sandbox.ebay.com/oauth2/authorize'
  : 'https://auth.ebay.com/oauth2/authorize';
const EBAY_API_URL = IS_SANDBOX
  ? 'https://api.sandbox.ebay.com'
  : 'https://api.ebay.com';

const CONDITION_MAP: Record<string, string> = {
  'new': 'NEW',
  'like new': 'LIKE_NEW',
  'very good': 'VERY_GOOD',
  'good': 'GOOD',
  'acceptable': 'ACCEPTABLE',
  'for parts': 'FOR_PARTS_OR_NOT_WORKING',
};

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
    // Token exchange must go through our backend (CORS blocks direct eBay calls)
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
    // Using eBay Inventory API
    const sku = `FT-${Date.now()}`;

    // Create inventory item
    await fetch(`${EBAY_API_URL}/sell/inventory/v1/inventory_item/${sku}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Language': 'en-US',
      },
      body: JSON.stringify({
        product: {
          title: listing.title,
          description: listing.description,
          imageUrls: listing.images,
        },
        condition: CONDITION_MAP[listing.condition.toLowerCase()] || 'USED_EXCELLENT',
        availability: {
          shipToLocationAvailability: {
            quantity: 1,
          },
        },
      }),
    });

    // Create offer
    const offerResponse = await fetch(`${EBAY_API_URL}/sell/inventory/v1/offer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Language': 'en-US',
      },
      body: JSON.stringify({
        sku,
        marketplaceId: 'EBAY_US',
        format: 'FIXED_PRICE',
        listingDescription: listing.description,
        pricingSummary: {
          price: { value: listing.price.toFixed(2), currency: 'USD' },
        },
        categoryId: listing.category || '175672',
        listingPolicies: {},
      }),
    });

    const offerData = await offerResponse.json();
    if (!offerResponse.ok) throw new Error(offerData.message || 'Failed to create eBay offer');

    // Publish offer
    const publishResponse = await fetch(
      `${EBAY_API_URL}/sell/inventory/v1/offer/${offerData.offerId}/publish`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      }
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
    // Simplified update — would need sku lookup in production
    const response = await fetch(`${EBAY_API_URL}/sell/inventory/v1/offer/${externalId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...(listing.price && {
          pricingSummary: { price: { value: listing.price.toFixed(2), currency: 'USD' } },
        }),
        ...(listing.description && { listingDescription: listing.description }),
      }),
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
    const response = await fetch(
      `${EBAY_API_URL}/sell/inventory/v1/offer/${externalId}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      }
    );
    if (!response.ok) throw new Error('Failed to delete eBay listing');
  },

  async getListings(_params: ListingsQuery, token: string): Promise<PlatformListing[]> {
    const response = await fetch(`${EBAY_API_URL}/sell/inventory/v1/offer?limit=100`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Failed to fetch listings');

    return (data.offers || []).map((offer: Record<string, unknown>) => ({
      externalId: String(offer.offerId || ''),
      url: (offer.listing as Record<string, string>)?.listingId
        ? `https://www.ebay.com/itm/${(offer.listing as Record<string, string>).listingId}`
        : '',
      status: offer.status === 'PUBLISHED' ? 'active' as const : 'ended' as const,
    }));
  },

  async getSales(_params: SalesQuery, token: string): Promise<SoldItem[]> {
    const response = await fetch(
      `${EBAY_API_URL}/sell/fulfillment/v1/order?limit=50&orderBy=creationdate`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    const data = await response.json();
    if (!response.ok) return [];

    return (data.orders || []).map((order: Record<string, unknown>) => {
      const lineItem = (order.lineItems as Record<string, unknown>[])?.[0] || {};
      return {
        title: (lineItem.title as string) || 'Unknown',
        price: Number((order.pricingSummary as Record<string, unknown>)?.total || 0),
        soldDate: order.creationDate as string,
        condition: '',
        imageUrl: '',
        url: '',
        platform: 'ebay',
      };
    });
  },

  async searchSold(query: string, token: string): Promise<SoldItem[]> {
    // Try Marketplace Insights API for actual sold/completed items
    const insightsParams = new URLSearchParams({
      q: query,
      filter: 'buyingOptions:{FIXED_PRICE|AUCTION},priceCurrency:USD',
      sort: 'newlyListed',
      limit: '50',
    });

    const insightsResponse = await fetch(
      `${EBAY_API_URL}/buy/marketplace_insights/v1_beta/item_sales/search?${insightsParams}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
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

    const response = await fetch(
      `${EBAY_API_URL}/buy/browse/v1/item_summary/search?${params}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
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
    // eBay Browse API image search
    const response = await fetch(
      `${EBAY_API_URL}/buy/browse/v1/item_summary/search_by_image`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: imageUrl }),
      }
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
    const finalValueFee = price * 0.1325; // 13.25% standard
    const paymentProcessingFee = price * 0.0295 + 0.30; // 2.95% + $0.30
    const totalFees = finalValueFee + paymentProcessingFee;

    return {
      finalValueFee: Math.round(finalValueFee * 100) / 100,
      paymentProcessingFee: Math.round(paymentProcessingFee * 100) / 100,
      totalFees: Math.round(totalFees * 100) / 100,
      netProceeds: Math.round((price - totalFees) * 100) / 100,
    };
  },

  mapCondition(condition: string): string {
    return CONDITION_MAP[condition.toLowerCase()] || 'USED_EXCELLENT';
  },

  mapCategory(category: string): string {
    // Basic category mapping — would be expanded with eBay category tree
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
