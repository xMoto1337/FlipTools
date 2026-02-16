export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface ListingData {
  title: string;
  description: string;
  price: number;
  category: string;
  condition: string;
  images: string[];
  tags: string[];
}

export interface PlatformListing {
  externalId: string;
  url: string;
  status: 'active' | 'sold' | 'ended' | 'error';
  platformData?: Record<string, unknown>;
}

export interface SoldItem {
  title: string;
  price: number;
  soldDate: string;
  condition: string;
  imageUrl: string;
  url: string;
  platform: string;
  // Extended fields for sales sync
  shippingCost?: number;
  platformFees?: number;
  buyerUsername?: string;
  orderId?: string;
}

export interface FeeBreakdown {
  finalValueFee: number;
  paymentProcessingFee: number;
  totalFees: number;
  netProceeds: number;
}

export interface ListingsQuery {
  status?: string;
  limit?: number;
  offset?: number;
}

export interface SalesQuery {
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export type PlatformId = 'ebay' | 'depop';

export interface PlatformAdapter {
  name: string;
  id: PlatformId;
  icon: string;
  color: string;

  // OAuth
  getAuthUrl(): string;
  handleCallback(code: string): Promise<TokenPair>;
  refreshToken(refreshToken: string): Promise<TokenPair>;

  // Listings
  createListing(listing: ListingData, token: string): Promise<PlatformListing>;
  updateListing(externalId: string, listing: Partial<ListingData>, token: string): Promise<PlatformListing>;
  deleteListing(externalId: string, token: string): Promise<void>;
  getListings(params: ListingsQuery, token: string): Promise<PlatformListing[]>;

  // Sales
  getSales(params: SalesQuery, token: string): Promise<SoldItem[]>;

  // Search
  searchSold(query: string, token: string): Promise<SoldItem[]>;
  searchByImage?(imageUrl: string, token: string): Promise<SoldItem[]>;

  // Helpers
  calculateFees(price: number): FeeBreakdown;
  mapCondition(condition: string): string;
  mapCategory(category: string): string;
}
