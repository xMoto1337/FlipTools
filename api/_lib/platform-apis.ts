/**
 * Server-side platform API helpers for the auto-delist cron.
 * These call platform APIs directly (no browser proxy needed).
 */

// --- eBay ---

const EBAY_API_URL = 'https://api.ebay.com';

function ebayHeaders(token: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
  };
}

export interface SaleRecord {
  externalId: string;
  title: string;
  soldDate: string;
  price: number;
}

/**
 * Fetch recent eBay orders since a given date.
 */
export async function getEbayRecentSales(token: string, since: string): Promise<SaleRecord[]> {
  const sales: SaleRecord[] = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const filter = `creationdate:[${new Date(since).toISOString()}..${new Date().toISOString()}]`;
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      orderBy: 'creationdate',
      filter,
    });

    const response = await fetch(`${EBAY_API_URL}/sell/fulfillment/v1/order?${params}`, {
      headers: ebayHeaders(token),
    });

    if (!response.ok) {
      console.error(`[platform-apis] eBay getSales error: ${response.status}`);
      break;
    }

    const data = await response.json();
    const orders = data.orders || [];
    if (orders.length === 0) break;

    for (const order of orders) {
      // Only count completed/paid orders
      if (order.orderFulfillmentStatus === 'FULFILLED' || order.orderPaymentStatus === 'PAID') {
        const lineItems = order.lineItems || [];
        for (const item of lineItems) {
          sales.push({
            externalId: item.legacyItemId || item.lineItemId || order.orderId,
            title: item.title || 'Unknown',
            soldDate: order.creationDate || new Date().toISOString(),
            price: Number(item.total?.value || 0),
          });
        }
      }
    }

    if (orders.length < limit) break;
    offset += orders.length;
  }

  return sales;
}

/**
 * Delete/end an eBay listing by offer ID.
 */
export async function delistEbayItem(externalId: string, token: string): Promise<void> {
  // Try withdraw offer first, then delete
  const response = await fetch(`${EBAY_API_URL}/sell/inventory/v1/offer/${externalId}`, {
    method: 'DELETE',
    headers: ebayHeaders(token),
  });

  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`eBay delist failed (${response.status}): ${text}`);
  }
}

// --- Etsy ---

const ETSY_API_URL = 'https://openapi.etsy.com';

function etsyHeaders(token: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'x-api-key': process.env.VITE_ETSY_CLIENT_ID || '',
    'Content-Type': 'application/json',
  };
}

/**
 * Fetch recent Etsy receipts (sales) since a given date.
 * Requires shop_id (stored in platform_user_id on the connection).
 */
export async function getEtsyRecentSales(token: string, shopId: string, since: string): Promise<SaleRecord[]> {
  const sales: SaleRecord[] = [];
  let offset = 0;
  const limit = 50;
  const minCreated = Math.floor(new Date(since).getTime() / 1000);

  while (true) {
    const url = `${ETSY_API_URL}/v3/application/shops/${shopId}/receipts?limit=${limit}&offset=${offset}&was_paid=true&min_created=${minCreated}`;

    const response = await fetch(url, { headers: etsyHeaders(token) });

    if (!response.ok) {
      console.error(`[platform-apis] Etsy getSales error: ${response.status}`);
      break;
    }

    const data = await response.json();
    const receipts = data.results || [];
    if (receipts.length === 0) break;

    for (const receipt of receipts) {
      const transactions = receipt.transactions || [];
      for (const tx of transactions) {
        sales.push({
          externalId: String(tx.listing_id),
          title: tx.title || 'Unknown',
          soldDate: receipt.create_timestamp
            ? new Date(receipt.create_timestamp * 1000).toISOString()
            : new Date().toISOString(),
          price: Number(tx.price?.amount || 0) / Number(tx.price?.divisor || 100),
        });
      }
    }

    if (receipts.length < limit) break;
    offset += receipts.length;
  }

  return sales;
}

/**
 * Delete/deactivate an Etsy listing.
 */
export async function delistEtsyItem(externalId: string, shopId: string, token: string): Promise<void> {
  const response = await fetch(
    `${ETSY_API_URL}/v3/application/shops/${shopId}/listings/${externalId}`,
    {
      method: 'DELETE',
      headers: etsyHeaders(token),
    }
  );

  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`Etsy delist failed (${response.status}): ${text}`);
  }
}

// --- Generic dispatch ---

export async function getRecentSales(
  platform: string,
  token: string,
  since: string,
  platformUserId?: string
): Promise<SaleRecord[]> {
  switch (platform) {
    case 'ebay':
      return getEbayRecentSales(token, since);
    case 'etsy':
      if (!platformUserId) throw new Error('Etsy requires shop_id (platformUserId)');
      return getEtsyRecentSales(token, platformUserId, since);
    default:
      console.warn(`[platform-apis] Unknown platform: ${platform}`);
      return [];
  }
}

export async function delistItem(
  platform: string,
  externalId: string,
  token: string,
  platformUserId?: string
): Promise<void> {
  switch (platform) {
    case 'ebay':
      return delistEbayItem(externalId, token);
    case 'etsy':
      if (!platformUserId) throw new Error('Etsy requires shop_id (platformUserId)');
      return delistEtsyItem(externalId, platformUserId, token);
    default:
      throw new Error(`Cannot delist on unknown platform: ${platform}`);
  }
}
