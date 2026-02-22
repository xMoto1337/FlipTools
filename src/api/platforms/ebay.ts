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

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

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
    // Use Trading API ReviseItem — works with itemId (which is what synced listings store)
    // The Inventory API offer endpoint requires offerId which we don't have for synced items
    const itemFields: string[] = [];
    itemFields.push(`<ItemID>${externalId}</ItemID>`);

    if (listing.price !== undefined) {
      itemFields.push(`<StartPrice currencyID="USD">${listing.price.toFixed(2)}</StartPrice>`);
    }
    if (listing.title) {
      itemFields.push(`<Title>${escapeXml(listing.title)}</Title>`);
    }
    if (listing.description) {
      itemFields.push(`<Description>${escapeXml(listing.description)}</Description>`);
    }

    const xmlBody = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">',
      '  <Item>',
      ...itemFields.map(f => `    ${f}`),
      '  </Item>',
      '</ReviseItemRequest>',
    ].join('\n');

    const response = await fetch('/api/ebay-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tradingApiCall: 'ReviseItem',
        token,
        payload: xmlBody,
      }),
    });

    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error || 'Update failed');
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
          quantity: item.quantityAvailable || item.quantity || 1,
          images,
          condition: item.conditionDisplayName || '',
          createdAt: item.startTime || undefined,
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
    // Fetch orders from Fulfillment API — contains ALL info we need:
    // item details, pricing, payment summary with actual seller payouts
    const fulfillmentParams = new URLSearchParams({
      limit: String(params.limit || 200),
      orderBy: 'creationdate',
    });

    // Always pass a date filter — without one, eBay only returns ~90 days
    // eBay Fulfillment API hard limit: start date must be within the past 2 years
    // eBay requires dates WITHOUT milliseconds: 2024-01-01T00:00:00Z not 2024-01-01T00:00:00.000Z
    const toEbayDate = (iso: string) => iso.replace(/\.\d{3}Z$/, 'Z');
    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString();
    const startDate = params.startDate
      ? (new Date(params.startDate) < new Date(twoYearsAgo) ? twoYearsAgo : params.startDate)
      : twoYearsAgo;
    const endDate = toEbayDate(new Date().toISOString());
    fulfillmentParams.set('filter', `creationdate:[${toEbayDate(new Date(startDate).toISOString())}..${endDate}]`);

    const allOrders: SoldItem[] = [];
    let offset = 0;
    const limit = params.limit || 200;

    while (true) {
      fulfillmentParams.set('offset', String(offset));
      const response = await ebayGet(`/sell/fulfillment/v1/order?${fulfillmentParams}`, token);
      const data = await response.json();
      if (!response.ok) {
        const errMsg = data?.errors?.[0]?.message || data?.message || `HTTP ${response.status}`;
        console.error('[ebay] getSales fulfillment error:', response.status, data);
        if (response.status === 401) throw new Error('eBay token expired — please reconnect in Settings');
        if (response.status === 403) throw new Error(`eBay access denied — check your app scopes (${errMsg})`);
        // For other errors (500, 429, etc.) throw so the caller can surface the error
        throw new Error(`eBay sales fetch failed: ${errMsg}`);
      }

      const orders = data.orders || [];
      if (orders.length === 0) break;

      // Log first order for debugging — shows all available fields
      if (allOrders.length === 0 && orders.length > 0) {
        console.log('[ebay] Sample order (full):', JSON.stringify(orders[0], null, 2));
      }

      for (const order of orders) {
        const lineItems = (order.lineItems as Record<string, unknown>[]) || [];
        const pricing = (order.pricingSummary || {}) as Record<string, unknown>;
        const buyer = (order.buyer as Record<string, string>) || {};
        const paymentSummary = (order.paymentSummary || {}) as Record<string, unknown>;

        const firstItem = lineItems[0] || {};
        const title = (firstItem.title as string) || 'Unknown Item';
        const itemImage = ((firstItem.image as Record<string, string>)?.imageUrl) || '';
        const fullTitle = lineItems.length > 1 ? `${title} (+${lineItems.length - 1} more)` : title;

        // Log raw pricing and payment data for debugging
        console.log(`[ebay] Order ${order.orderId} raw pricing:`, JSON.stringify(pricing));
        console.log(`[ebay] Order ${order.orderId} raw paymentSummary:`, JSON.stringify(paymentSummary));

        // Use pricingSummary.total as the gross (accounts for delivery discounts)
        const subtotal = Number((pricing.priceSubtotal as Record<string, string>)?.value || 0);
        const pricingTotal = Number((pricing.total as Record<string, string>)?.value || 0);
        // Net delivery = total - subtotal (includes any delivery discounts)
        const netDelivery = Math.max(0, pricingTotal - subtotal);
        // Use pricingTotal as gross; fall back to subtotal if total is missing
        const grossSale = pricingTotal > 0 ? pricingTotal : subtotal;

        // Try to get actual payout from paymentSummary
        const payments = (paymentSummary.payments as Array<Record<string, unknown>>) || [];
        const totalDueSeller = paymentSummary.totalDueSeller as Record<string, string> | undefined;

        let actualPayout = 0;
        let hasPayoutData = false;

        if (totalDueSeller?.value) {
          actualPayout = Number(totalDueSeller.value);
          hasPayoutData = true;
        } else if (payments.length > 0) {
          for (const payment of payments) {
            const paymentAmount = (payment.amount as Record<string, string>)?.value;
            if (paymentAmount) {
              actualPayout += Number(paymentAmount);
              hasPayoutData = true;
            }
          }
        }

        let salePrice: number;
        let platformFees: number;
        let shippingCost: number;

        if (hasPayoutData && actualPayout > 0) {
          // payout = gross - eBay fees (but does NOT subtract shipping label cost)
          // So: eBay fees = gross - payout, shipping = delivery (buyer-paid, best proxy for label)
          // profit = gross - shipping - fees = payout - shipping ≈ what seller actually nets
          salePrice = grossSale;
          platformFees = Math.max(0, Math.round((grossSale - actualPayout) * 100) / 100);
          shippingCost = Math.round(netDelivery * 100) / 100;
          const profit = grossSale - platformFees - shippingCost;
          console.log(`[ebay] Order ${order.orderId}: gross=$${grossSale}, payout=$${actualPayout}, fees=$${platformFees}, shipping=$${shippingCost}, profit=$${profit.toFixed(2)}`);
        } else {
          // No payout data — estimate fees, use delivery as shipping
          const fees = ebayAdapter.calculateFees(subtotal);
          salePrice = grossSale;
          platformFees = fees.totalFees;
          shippingCost = Math.round(netDelivery * 100) / 100;
          const profit = grossSale - platformFees - shippingCost;
          console.log(`[ebay] Order ${order.orderId}: ESTIMATED — gross=$${grossSale}, fees=$${platformFees}, shipping=$${shippingCost}, profit=$${profit.toFixed(2)}`);
        }

        allOrders.push({
          title: fullTitle,
          price: salePrice,
          soldDate: (order.creationDate as string) || '',
          condition: '',
          imageUrl: itemImage,
          url: '',
          platform: 'ebay',
          shippingCost,
          platformFees,
          buyerUsername: buyer.username || undefined,
          orderId: order.orderId as string,
        });
      }

      if (orders.length < limit) break;
      offset += orders.length;
    }

    // Try to fetch shipping label costs from Finances API
    // These are deducted from seller payouts but not shown in Fulfillment API
    const shippingLabelCosts = new Map<string, number>();
    try {
      let labelOffset = 0;
      while (true) {
        const dateFilter = params.startDate
          ? `,transactionDate:[${new Date(params.startDate).toISOString()}..${new Date().toISOString()}]`
          : '';
        const labelParams = new URLSearchParams({
          limit: '200',
          offset: String(labelOffset),
          filter: `transactionType:{SHIPPING_LABEL}${dateFilter}`,
        });
        const labelResp = await ebayGet(`/sell/finances/v1/transaction?${labelParams}`, token);
        if (!labelResp.ok) {
          console.warn('[ebay] Could not fetch shipping labels from Finances API:', labelResp.status);
          break;
        }
        const labelData = await labelResp.json();
        const txs = labelData.transactions || [];
        if (txs.length === 0) break;

        for (const tx of txs) {
          const orderId = tx.orderId as string;
          if (!orderId) continue;
          const cost = Math.abs(Number((tx.amount as Record<string, string>)?.value || 0));
          shippingLabelCosts.set(orderId, (shippingLabelCosts.get(orderId) || 0) + cost);
        }
        if (txs.length < 200) break;
        labelOffset += txs.length;
      }
      if (shippingLabelCosts.size > 0) {
        console.log(`[ebay] Found ${shippingLabelCosts.size} shipping label costs from Finances API`);
      }
    } catch (err) {
      console.warn('[ebay] Shipping label fetch failed (non-critical):', err);
    }

    // Apply shipping label costs to matching orders
    if (shippingLabelCosts.size > 0) {
      for (const order of allOrders) {
        const labelCost = shippingLabelCosts.get(order.orderId || '');
        if (labelCost) {
          order.shippingCost = Math.round(labelCost * 100) / 100;
          console.log(`[ebay] Order ${order.orderId}: adding shipping label cost $${labelCost.toFixed(2)}`);
        }
      }
    }

    // Clear the finances fallback flag since we don't need it for the main flow
    try { localStorage.removeItem('fliptools_ebay_finances_fallback'); } catch {}

    console.log(`[ebay] getSales: ${allOrders.length} orders from Fulfillment API, ${shippingLabelCosts.size} shipping labels`);
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
