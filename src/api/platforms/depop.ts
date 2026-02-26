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

const DEPOP_API_URL = 'https://webapi.depop.com/api/v2';

const CONDITION_MAP: Record<string, string> = {
  'new': 'NEW_WITH_TAGS',
  'like new': 'NEW_WITHOUT_TAGS',
  'very good': 'VERY_GOOD',
  'good': 'GOOD',
  'acceptable': 'USED',
};

export const depopAdapter: PlatformAdapter = {
  name: 'Depop',
  id: 'depop',
  icon: 'depop',
  color: '#ff2300',

  getAuthUrl(): string {
    // Depop uses username/password login (no public OAuth).
    // Return a sentinel value — SettingsPage handles this with a login modal.
    return '__depop_login__';
  },

  async handleCallback(code: string): Promise<TokenPair> {
    const response = await fetch(`${DEPOP_API_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Depop auth failed');

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
    };
  },

  async refreshToken(refreshToken: string): Promise<TokenPair> {
    const response = await fetch('/api/depop-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'refresh', refresh_token: refreshToken }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Depop token refresh failed');

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
    };
  },

  async createListing(listing: ListingData, token: string): Promise<PlatformListing> {
    const response = await fetch(`${DEPOP_API_URL}/products`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: `${listing.title}\n\n${listing.description}`,
        price: listing.price,
        currency: 'USD',
        condition: CONDITION_MAP[listing.condition.toLowerCase()] || 'GOOD',
        photos: listing.images,
        categories: [listing.category],
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Failed to create Depop listing');

    return {
      externalId: data.id || data.slug,
      url: `https://www.depop.com/products/${data.slug || data.id}`,
      status: 'active',
    };
  },

  async updateListing(externalId: string, listing: Partial<ListingData>, token: string): Promise<PlatformListing> {
    const response = await fetch(`${DEPOP_API_URL}/products/${externalId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...(listing.price && { price: listing.price }),
        ...(listing.description && { description: listing.description }),
      }),
    });

    if (!response.ok) throw new Error('Failed to update Depop listing');

    return {
      externalId,
      url: `https://www.depop.com/products/${externalId}`,
      status: 'active',
    };
  },

  async deleteListing(externalId: string, token: string): Promise<void> {
    const response = await fetch(`${DEPOP_API_URL}/products/${externalId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Failed to delete Depop listing');
  },

  async getListings(_params: ListingsQuery, token: string): Promise<PlatformListing[]> {
    const response = await fetch(`${DEPOP_API_URL}/products/me?limit=100`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    const data = await response.json();
    if (!response.ok) return [];

    return (data.products || []).map((product: Record<string, string>) => ({
      externalId: product.id,
      url: `https://www.depop.com/products/${product.slug || product.id}`,
      status: product.status === 'SOLD' ? 'sold' : 'active',
    }));
  },

  async getSales(_params: SalesQuery, token: string): Promise<SoldItem[]> {
    const response = await fetch(`${DEPOP_API_URL}/sales?limit=50`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    const data = await response.json();
    if (!response.ok) return [];

    return (data.sales || []).map((sale: Record<string, unknown>) => ({
      title: (sale.product as Record<string, string>)?.description || 'Unknown',
      price: Number(sale.price || 0),
      soldDate: sale.date as string || '',
      condition: '',
      imageUrl: '',
      url: '',
      platform: 'depop',
    }));
  },

  async searchSold(query: string, token: string): Promise<SoldItem[]> {
    const response = await fetch(
      `${DEPOP_API_URL}/search/products?q=${encodeURIComponent(query)}&sold=true&limit=50`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    const data = await response.json();
    if (!response.ok) return [];

    return (data.products || []).map((item: Record<string, unknown>) => ({
      title: item.description as string || '',
      price: Number(item.price || 0),
      soldDate: '',
      condition: '',
      imageUrl: ((item.photos as string[]) || [])[0] || '',
      url: `https://www.depop.com/products/${item.slug || item.id}`,
      platform: 'depop',
    }));
  },

  calculateFees(price: number): FeeBreakdown {
    const finalValueFee = price * 0.10; // 10% Depop fee
    const paymentProcessingFee = price * 0.029 + 0.30; // Payment processing
    const totalFees = finalValueFee + paymentProcessingFee;

    return {
      finalValueFee: Math.round(finalValueFee * 100) / 100,
      paymentProcessingFee: Math.round(paymentProcessingFee * 100) / 100,
      totalFees: Math.round(totalFees * 100) / 100,
      netProceeds: Math.round((price - totalFees) * 100) / 100,
    };
  },

  mapCondition(condition: string): string {
    return CONDITION_MAP[condition.toLowerCase()] || 'GOOD';
  },

  mapCategory(category: string): string {
    const categoryMap: Record<string, string> = {
      'clothing': 'tops',
      'shoes': 'shoes',
      'accessories': 'accessories',
      'bags': 'bags',
    };
    return categoryMap[category.toLowerCase()] || 'other';
  },
};
