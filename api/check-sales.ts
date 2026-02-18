import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase } from './_lib/supabase';
import { getTokenForUser } from './_lib/tokens';
import { getRecentSales, delistItem } from './_lib/platform-apis';

/**
 * Auto-delist cron endpoint.
 * Called periodically (e.g., every 5 minutes via pg_cron or external cron).
 * For each user's platform connection, checks for new sales and auto-delists
 * the sold item from all other connected platforms.
 *
 * Protected by a shared secret in the Authorization header.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cron secret
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getServiceSupabase();
  const results: { processed: number; delisted: number; errors: string[] } = {
    processed: 0,
    delisted: 0,
    errors: [],
  };

  try {
    // Get all platform connections (service role bypasses RLS)
    const { data: connections, error: connError } = await supabase
      .from('platform_connections')
      .select('*');

    if (connError || !connections) {
      return res.status(500).json({ error: 'Failed to fetch connections', detail: connError?.message });
    }

    // Group connections by user_id
    const userConnections = new Map<string, typeof connections>();
    for (const conn of connections) {
      const existing = userConnections.get(conn.user_id) || [];
      existing.push(conn);
      userConnections.set(conn.user_id, existing);
    }

    // Process each user
    for (const [userId, conns] of userConnections) {
      // Skip users with only one platform (nothing to cross-delist)
      if (conns.length < 2) continue;

      for (const conn of conns) {
        try {
          // Get fresh token
          const token = await getTokenForUser(userId, conn.platform);
          if (!token) {
            results.errors.push(`No valid token for user ${userId} on ${conn.platform}`);
            continue;
          }

          // Determine "since" time — last check or 1 hour ago (fallback)
          const since = conn.last_sale_check || new Date(Date.now() - 60 * 60 * 1000).toISOString();

          // Fetch recent sales
          const sales = await getRecentSales(conn.platform, token, since, conn.platform_user_id);
          results.processed += sales.length;

          // For each sale, find matching cross-listed items and delist from other platforms
          for (const sale of sales) {
            await processSale(supabase, userId, conn.platform, sale, conns, results);
          }

          // Update last_sale_check
          await supabase
            .from('platform_connections')
            .update({ last_sale_check: new Date().toISOString() })
            .eq('id', conn.id);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.errors.push(`Error checking ${conn.platform} for user ${userId}: ${msg}`);
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: 'Cron failed', detail: msg });
  }

  return res.status(200).json(results);
}

interface SaleRecord {
  externalId: string;
  title: string;
  soldDate: string;
  price: number;
}

async function processSale(
  supabase: ReturnType<typeof getServiceSupabase>,
  userId: string,
  soldOnPlatform: string,
  sale: SaleRecord,
  userConnections: Array<{ platform: string; platform_user_id: string | null }>,
  results: { processed: number; delisted: number; errors: string[] }
) {
  // Find listing in our DB where platforms->{soldOnPlatform}->id matches the sale's externalId
  const { data: listings } = await supabase
    .from('listings')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'sold')
    .not('platforms', 'is', null);

  if (!listings) return;

  // Search through listings for one that has this externalId on the sold platform
  const matchedListing = listings.find((listing) => {
    const platforms = listing.platforms as Record<string, { id?: string }> | null;
    if (!platforms) return false;
    const platformData = platforms[soldOnPlatform];
    return platformData?.id === sale.externalId;
  });

  if (!matchedListing) return;

  // Check if already processed (idempotency)
  if (matchedListing.status === 'sold') return;

  const platforms = matchedListing.platforms as Record<string, { id?: string; status?: string }>;

  // Delist from all OTHER platforms
  for (const [platformId, platformData] of Object.entries(platforms)) {
    if (platformId === soldOnPlatform) continue;
    if (!platformData?.id) continue;
    if (platformData.status === 'ended' || platformData.status === 'delisted') continue;

    // Find the connection for this platform to get its token and platform_user_id
    const conn = userConnections.find((c) => c.platform === platformId);
    if (!conn) continue;

    try {
      const token = await getTokenForUser(userId, platformId);
      if (!token) {
        await logDelistAction(supabase, matchedListing.id, userId, soldOnPlatform, platformId, platformData.id, 'failed', 'No valid token');
        results.errors.push(`No token for ${platformId} to delist ${platformData.id}`);
        continue;
      }

      await delistItem(platformId, platformData.id, token, conn.platform_user_id || undefined);

      // Update the platform entry in the listing JSONB
      platforms[platformId] = { ...platformData, status: 'ended' };

      await logDelistAction(supabase, matchedListing.id, userId, soldOnPlatform, platformId, platformData.id, 'success');
      results.delisted++;

      console.log(`[check-sales] Delisted ${platformId}:${platformData.id} (sold on ${soldOnPlatform})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logDelistAction(supabase, matchedListing.id, userId, soldOnPlatform, platformId, platformData.id, 'failed', msg);
      results.errors.push(`Failed to delist ${platformId}:${platformData.id}: ${msg}`);
    }
  }

  // Mark listing as sold
  await supabase
    .from('listings')
    .update({
      status: 'sold',
      sold_on_platform: soldOnPlatform,
      sold_at: sale.soldDate,
      platforms,
    })
    .eq('id', matchedListing.id);
}

async function logDelistAction(
  supabase: ReturnType<typeof getServiceSupabase>,
  listingId: string,
  userId: string,
  soldOnPlatform: string,
  delistedFromPlatform: string,
  externalId: string,
  status: 'success' | 'failed' | 'skipped',
  errorMessage?: string
) {
  await supabase.from('auto_delist_log').insert({
    listing_id: listingId,
    user_id: userId,
    sold_on_platform: soldOnPlatform,
    delisted_from_platform: delistedFromPlatform,
    external_id: externalId,
    status,
    error_message: errorMessage || null,
  });
}
