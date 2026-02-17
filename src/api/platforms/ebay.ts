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

/**
 * Fallback: get sales using only the Fulfillment API with estimated fees.
 * Used when the Finances API scope hasn't been authorized yet.
 */
async function getSalesFromFulfillmentOnly(params: SalesQuery, token: string): Promise<SoldItem[]> {
  const queryParams = new URLSearchParams({
    limit: String(params.limit || 200),
    orderBy: 'creationdate',
  });

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

  while (true) {
    queryParams.set('offset', String(offset));
    const response = await ebayGet(`/sell/fulfillment/v1/order?${queryParams}`, token);
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) throw new Error('eBay token expired');
      break;
    }

    const orders = data.orders || [];
    if (orders.length === 0) break;

    for (const order of orders) {
      const lineItems = (order.lineItems as Record<string, unknown>[]) || [];
      const pricing = (order.pricingSummary as Record<string, Record<string, string>>) || {};
      const buyer = (order.buyer as Record<string, string>) || {};

      const subtotal = Number(pricing.priceSubtotal?.value || 0);
      const delivery = Number(pricing.deliveryCost?.value || 0);
      const salePrice = subtotal + delivery;

      // Use estimated fees as fallback
      const fees = ebayAdapter.calculateFees(salePrice);

      const firstItem = lineItems[0] || {};
      const title = (firstItem.title as string) || 'Unknown Item';
      const itemImage = ((firstItem.image as Record<string, string>)?.imageUrl) || '';
      const fullTitle = lineItems.length > 1 ? `${title} (+${lineItems.length - 1} more)` : title;

      allOrders.push({
        title: fullTitle,
        price: salePrice,
        soldDate: (order.creationDate as string) || '',
        condition: '',
        imageUrl: itemImage,
        url: '',
        platform: 'ebay',
        shippingCost: 0,
        platformFees: fees.totalFees,
        buyerUsername: buyer.username || undefined,
        orderId: order.orderId as string,
      });
    }

    if (orders.length < limit) break;
    offset += orders.length;
  }

  return allOrders;
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
        'https://api.ebay.com/oauth/api_scope/sell.finances',
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
    // Use the Trading API (GetMyeBaySelling) to fetch ALL active listings
    // This works for listings created through the eBay website, app, or any API
    const allListings: PlatformListing[] = [];
    let pageNumber = 1;
    let totalPages = 1;

    while (pageNumber <= totalPages) {
      const xmlBody = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">',
        '  <ActiveList>',
        '    <Include>true</Include>',
        '    <Pagination>',
        `      <EntriesPerPage>200</EntriesPerPage>`,
        `      <PageNumber>${pageNumber}</PageNumber>`,
        '    </Pagination>',
        '  </ActiveList>',
        '  <DetailLevel>ReturnAll</DetailLevel>',
        '</GetMyeBaySellingRequest>',
      ].join('\n');

      const resp = await fetch('/api/ebay-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradingApiCall: 'GetMyeBaySelling',
          token,
          payload: xmlBody,
        }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        console.error('[ebay] GetMyeBaySelling error:', resp.status, data);
        if (data.error) throw new Error(data.error);
        throw new Error('eBay token expired');
      }

      // Update pagination from response
      if (data.totalPages) totalPages = data.totalPages;

      const items = data.items || [];
      console.log(`[ebay] GetMyeBaySelling page ${pageNumber}/${totalPages}: ${items.length} items (total: ${data.totalEntries})`);

      if (items.length === 0) break;

      for (const item of items) {
        // Use full PictureURLs first, fall back to gallery thumbnail
        const images = (item.imageUrls && item.imageUrls.length > 0)
          ? item.imageUrls
          : (item.galleryUrl ? [item.galleryUrl] : []);

        allListings.push({
          externalId: item.itemId,
          url: item.viewItemUrl || `https://www.ebay.com/itm/${item.itemId}`,
          status: 'active',
          title: item.title || '',
          price: item.currentPrice || 0,
          images,
          condition: item.conditionDisplayName || '',
          platformData: {
            listingType: item.listingType,
            quantity: item.quantity,
            quantityAvailable: item.quantityAvailable,
          },
        });
      }

      pageNumber++;
    }

    console.log(`[ebay] getListings: found ${allListings.length} active listings`);
    return allListings;
  },

  async getSales(params: SalesQuery, token: string): Promise<SoldItem[]> {
    // Step 1: Fetch orders from Fulfillment API for item details (title, image, buyer)
    const fulfillmentParams = new URLSearchParams({
      limit: String(params.limit || 200),
      orderBy: 'creationdate',
    });

    const filters: string[] = [];
    if (params.startDate) {
      filters.push(`creationdate:[${new Date(params.startDate).toISOString()}..${new Date().toISOString()}]`);
    }
    if (filters.length > 0) {
      fulfillmentParams.set('filter', filters.join(','));
    }

    // Fetch all orders from Fulfillment API
    const orderMap = new Map<string, { title: string; imageUrl: string; buyerUsername: string; creationDate: string }>();
    let offset = 0;
    const limit = params.limit || 200;

    while (true) {
      fulfillmentParams.set('offset', String(offset));
      const response = await ebayGet(`/sell/fulfillment/v1/order?${fulfillmentParams}`, token);
      const data = await response.json();
      if (!response.ok) {
        console.error('[ebay] getSales fulfillment error:', response.status, data);
        if (response.status === 401) throw new Error('eBay token expired');
        break;
      }

      const orders = data.orders || [];
      if (orders.length === 0) break;

      for (const order of orders) {
        const lineItems = (order.lineItems as Record<string, unknown>[]) || [];
        const buyer = (order.buyer as Record<string, string>) || {};
        const firstItem = lineItems[0] || {};
        const title = (firstItem.title as string) || 'Unknown Item';
        const itemImage = ((firstItem.image as Record<string, string>)?.imageUrl) || '';
        const fullTitle = lineItems.length > 1 ? `${title} (+${lineItems.length - 1} more)` : title;

        orderMap.set(order.orderId as string, {
          title: fullTitle,
          imageUrl: itemImage,
          buyerUsername: buyer.username || '',
          creationDate: (order.creationDate as string) || '',
        });
      }

      if (orders.length < limit) break;
      offset += orders.length;
    }

    // Step 2: Fetch transactions from Finances API for accurate fees
    // The Finances API has actual fee amounts, not estimates
    const allOrders: SoldItem[] = [];
    let txOffset = 0;

    while (true) {
      const txParams = new URLSearchParams({
        limit: '200',
        offset: String(txOffset),
        filter: 'transactionType:{SALE}',
      });

      // Add date filter for Finances API
      if (params.startDate) {
        txParams.set('filter', `transactionType:{SALE},transactionDate:[${new Date(params.startDate).toISOString()}..${new Date().toISOString()}]`);
      }

      const txResponse = await ebayGet(`/sell/finances/v1/transaction?${txParams}`, token);
      const txData = await txResponse.json();

      if (!txResponse.ok) {
        console.warn('[ebay] Finances API error:', txResponse.status, txData);
        // If Finances API fails (e.g. scope not authorized yet), fall back to Fulfillment-only
        if (orderMap.size > 0) {
          console.log('[ebay] Falling back to Fulfillment API with estimated fees');
          return getSalesFromFulfillmentOnly(params, token);
        }
        break;
      }

      const transactions = txData.transactions || [];
      if (transactions.length === 0) break;

      // Log first transaction for debugging
      if (allOrders.length === 0 && transactions.length > 0) {
        const sample = transactions[0];
        const sampleNet = Number((sample.amount as Record<string, string>)?.value || 0);
        const sampleFees = Math.abs(Number((sample.totalFeeAmount as Record<string, string>)?.value || 0));
        const sampleGross = Number((sample.totalFeeBasisAmount as Record<string, string>)?.value || 0);
        console.log('[ebay] Sample Finances transaction:', {
          orderId: sample.orderId,
          gross: sampleGross,
          fees: sampleFees,
          netPayout: sampleNet,
          check: `gross(${sampleGross}) - fees(${sampleFees}) = ${(sampleGross - sampleFees).toFixed(2)} vs net(${sampleNet})`,
        });
      }

      for (const tx of transactions) {
        const orderId = tx.orderId as string;
        if (!orderId) continue;

        // amount = the NET payout to seller (after eBay deducts all fees, shipping labels, etc.)
        // This is the actual money that hits the seller's bank account.
        // totalFeeBasisAmount = gross basis for fee calculation (NOT reliable as "sale price")
        // totalFeeAmount = fees eBay charged (negative)
        const netPayout = Number((tx.amount as Record<string, string>)?.value || 0);

        // Get order details from fulfillment data
        const orderInfo = orderMap.get(orderId);

        // Use net payout as sale_price with fees=0 so profit = net_payout - cost
        // This gives the most accurate "what you actually earned" number
        // The gross and fees are stored for display purposes
        allOrders.push({
          title: orderInfo?.title || 'eBay Sale',
          price: netPayout,
          soldDate: (tx.transactionDate as string) || orderInfo?.creationDate || '',
          condition: '',
          imageUrl: orderInfo?.imageUrl || '',
          url: '',
          platform: 'ebay',
          shippingCost: 0,
          platformFees: 0,
          buyerUsername: orderInfo?.buyerUsername || undefined,
          orderId,
        });
      }

      if (transactions.length < 200) break;
      txOffset += transactions.length;
    }

    console.log(`[ebay] getSales: ${allOrders.length} sales from Finances API (${orderMap.size} orders from Fulfillment)`);
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
