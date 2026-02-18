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

const ETSY_AUTH_URL = 'https://www.etsy.com/oauth/connect';

async function computeS256Challenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// All Etsy API calls go through our proxy to avoid CORS
async function etsyGet(endpoint: string, token: string): Promise<Response> {
  return fetch('/api/etsy-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, token, method: 'GET' }),
  });
}

async function etsyPost(endpoint: string, token: string, payload: unknown): Promise<Response> {
  return fetch('/api/etsy-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, token, method: 'POST', payload }),
  });
}

async function etsyPut(endpoint: string, token: string, payload: unknown): Promise<Response> {
  return fetch('/api/etsy-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, token, method: 'PUT', payload }),
  });
}

async function etsyDelete(endpoint: string, token: string): Promise<Response> {
  return fetch('/api/etsy-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, token, method: 'DELETE' }),
  });
}

/** Get the user's shop_id from localStorage (saved during OAuth callback). */
function getShopId(): string | null {
  try {
    return localStorage.getItem('fliptools_etsy_shop_id');
  } catch {
    return null;
  }
}

const CONDITION_MAP: Record<string, string> = {
  'new': 'is_not_vintage',
  'like new': 'is_not_vintage',
  'very good': 'is_not_vintage',
  'good': 'is_not_vintage',
  'acceptable': 'is_not_vintage',
  'vintage': 'is_vintage',
};

const CATEGORY_MAP: Record<string, number> = {
  'clothing': 69150367,
  'shoes': 69168382,
  'electronics': 69150391,
  'collectibles': 69150457,
  'home': 69150433,
  'toys': 69150441,
  'jewelry': 69150449,
  'art': 69150401,
};

export const etsyAdapter: PlatformAdapter = {
  name: 'Etsy',
  id: 'etsy',
  icon: 'etsy',
  color: '#f1641e',

  getAuthUrl(): string {
    // Etsy requires async PKCE — this sync method returns '' as a placeholder.
    // The actual URL is built by getEtsyAuthUrl() which is called from usePlatform hook.
    return '';
  },

  async handleCallback(code: string): Promise<TokenPair> {
    const verifier = sessionStorage.getItem('etsy_code_verifier');
    if (!verifier) throw new Error('Missing PKCE code verifier');

    const response = await fetch('/api/etsy-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Etsy auth failed');

    // Clean up verifier
    sessionStorage.removeItem('etsy_code_verifier');

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };
  },

  async refreshToken(refreshToken: string): Promise<TokenPair> {
    const response = await fetch('/api/etsy-auth', {
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
    const shopId = getShopId();
    if (!shopId) throw new Error('Etsy shop ID not found. Please reconnect Etsy.');

    const taxonomyId = CATEGORY_MAP[listing.category.toLowerCase()] || 69150367;

    const response = await etsyPost(`/v3/application/shops/${shopId}/listings`, token, {
      title: listing.title.substring(0, 140), // Etsy max title length
      description: listing.description || listing.title,
      price: listing.price,
      quantity: 1,
      taxonomy_id: taxonomyId,
      who_made: 'someone_else',
      when_made: '2020_2025',
      is_supply: false,
      shipping_profile_id: null, // Will use default
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || data.error_msg || 'Failed to create Etsy listing');
    }

    return {
      externalId: String(data.listing_id),
      url: data.url || `https://www.etsy.com/listing/${data.listing_id}`,
      status: 'active',
      platformData: { shopId },
    };
  },

  async updateListing(externalId: string, listing: Partial<ListingData>, token: string): Promise<PlatformListing> {
    const shopId = getShopId();
    if (!shopId) throw new Error('Etsy shop ID not found.');

    const body: Record<string, unknown> = {};
    if (listing.title) body.title = listing.title.substring(0, 140);
    if (listing.description) body.description = listing.description;
    if (listing.price) body.price = listing.price;

    const response = await etsyPut(`/v3/application/shops/${shopId}/listings/${externalId}`, token, body);

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Update failed');
    }

    return {
      externalId,
      url: `https://www.etsy.com/listing/${externalId}`,
      status: 'active',
    };
  },

  async deleteListing(externalId: string, token: string): Promise<void> {
    const shopId = getShopId();
    if (!shopId) throw new Error('Etsy shop ID not found.');

    const response = await etsyDelete(`/v3/application/shops/${shopId}/listings/${externalId}`, token);
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to delete Etsy listing');
    }
  },

  async getListings(_params: ListingsQuery, token: string): Promise<PlatformListing[]> {
    const shopId = getShopId();
    if (!shopId) {
      console.warn('[etsy] No shop ID found, skipping listing sync');
      return [];
    }

    const allListings: PlatformListing[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const response = await etsyGet(
        `/v3/application/shops/${shopId}/listings?state=active&limit=${limit}&offset=${offset}`,
        token
      );

      if (!response.ok) {
        if (response.status === 401) throw new Error('Etsy token expired');
        console.error('[etsy] getListings error:', response.status);
        break;
      }

      const data = await response.json();
      const listings = data.results || [];
      if (listings.length === 0) break;

      for (const item of listings) {
        allListings.push({
          externalId: String(item.listing_id),
          url: item.url || `https://www.etsy.com/listing/${item.listing_id}`,
          status: 'active',
          title: item.title || '',
          price: Number(item.price?.amount || 0) / Number(item.price?.divisor || 100),
          images: (item.images || []).map((img: Record<string, string>) => img.url_570xN || img.url_fullxfull || '').filter(Boolean),
          condition: '',
          createdAt: item.creation_tsz ? new Date(item.creation_tsz * 1000).toISOString() : undefined,
        });
      }

      if (listings.length < limit) break;
      offset += listings.length;
    }

    console.log(`[etsy] getListings: found ${allListings.length} active listings`);
    return allListings;
  },

  async getSales(params: SalesQuery, token: string): Promise<SoldItem[]> {
    const shopId = getShopId();
    if (!shopId) return [];

    const allSales: SoldItem[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      let endpoint = `/v3/application/shops/${shopId}/receipts?limit=${limit}&offset=${offset}&was_paid=true`;
      if (params.startDate) {
        const minCreated = Math.floor(new Date(params.startDate).getTime() / 1000);
        endpoint += `&min_created=${minCreated}`;
      }

      const response = await etsyGet(endpoint, token);
      if (!response.ok) {
        if (response.status === 401) throw new Error('Etsy token expired');
        console.error('[etsy] getSales error:', response.status);
        break;
      }

      const data = await response.json();
      const receipts = data.results || [];
      if (receipts.length === 0) break;

      for (const receipt of receipts) {
        const transactions = receipt.transactions || [];
        const firstItem = transactions[0] || {};
        const title = (firstItem.title as string) || 'Unknown Item';
        const fullTitle = transactions.length > 1 ? `${title} (+${transactions.length - 1} more)` : title;

        const grandTotal = Number(receipt.grandtotal?.amount || 0) / Number(receipt.grandtotal?.divisor || 100);
        const subtotal = Number(receipt.subtotal?.amount || 0) / Number(receipt.subtotal?.divisor || 100);
        const shipping = Number(receipt.total_shipping_cost?.amount || 0) / Number(receipt.total_shipping_cost?.divisor || 100);

        // Etsy fees: 6.5% transaction + $0.20 listing + 3% + $0.25 payment processing
        const fees = etsyAdapter.calculateFees(subtotal);

        allSales.push({
          title: fullTitle,
          price: grandTotal,
          soldDate: receipt.create_timestamp ? new Date(receipt.create_timestamp * 1000).toISOString() : '',
          condition: '',
          imageUrl: '',
          url: '',
          platform: 'etsy',
          shippingCost: shipping,
          platformFees: fees.totalFees,
          buyerUsername: receipt.buyer_email || undefined,
          orderId: String(receipt.receipt_id),
        });
      }

      if (receipts.length < limit) break;
      offset += receipts.length;
    }

    console.log(`[etsy] getSales: ${allSales.length} receipts`);
    return allSales;
  },

  async searchSold(query: string, token: string): Promise<SoldItem[]> {
    // Etsy doesn't have a "sold comps" search like eBay
    // Use active listings search as a proxy
    const response = await etsyGet(
      `/v3/application/listings/active?keywords=${encodeURIComponent(query)}&limit=25&sort_on=score`,
      token
    );

    if (!response.ok) return [];
    const data = await response.json();

    return (data.results || []).map((item: Record<string, unknown>) => ({
      title: item.title as string,
      price: Number((item.price as Record<string, number>)?.amount || 0) / Number((item.price as Record<string, number>)?.divisor || 100),
      soldDate: '',
      condition: '',
      imageUrl: '',
      url: item.url as string || `https://www.etsy.com/listing/${item.listing_id}`,
      platform: 'etsy',
    }));
  },

  calculateFees(price: number): FeeBreakdown {
    const listingFee = 0.20; // $0.20 per listing
    const transactionFee = price * 0.065; // 6.5%
    const paymentProcessing = price * 0.03 + 0.25; // 3% + $0.25
    const totalFees = listingFee + transactionFee + paymentProcessing;

    return {
      finalValueFee: Math.round(transactionFee * 100) / 100,
      paymentProcessingFee: Math.round((paymentProcessing + listingFee) * 100) / 100,
      totalFees: Math.round(totalFees * 100) / 100,
      netProceeds: Math.round((price - totalFees) * 100) / 100,
    };
  },

  mapCondition(condition: string): string {
    return CONDITION_MAP[condition.toLowerCase()] || 'is_not_vintage';
  },

  mapCategory(category: string): string {
    return String(CATEGORY_MAP[category.toLowerCase()] || 69150367);
  },
};

/**
 * Build the Etsy OAuth URL asynchronously (needed for PKCE S256 challenge).
 * Call this instead of etsyAdapter.getAuthUrl() since PKCE requires async.
 */
export async function getEtsyAuthUrl(): Promise<string> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const verifier = btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  sessionStorage.setItem('etsy_code_verifier', verifier);

  const challenge = await computeS256Challenge(verifier);
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.etsy.clientId,
    redirect_uri: config.etsy.redirectUri,
    scope: 'listings_r listings_w transactions_r',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  return `${ETSY_AUTH_URL}?${params.toString()}`;
}
