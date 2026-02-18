import { getServiceSupabase } from './supabase';

interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Get a fresh access token for a user's platform connection.
 * Automatically refreshes if expired (with 5-min buffer).
 */
export async function getTokenForUser(userId: string, platform: string): Promise<string | null> {
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('platform_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('platform', platform)
    .single();

  if (!data) return null;

  // Check if token expires within 5 minutes
  const expiresAt = new Date(data.token_expires_at).getTime();
  const buffer = 5 * 60 * 1000;

  if (expiresAt < Date.now() + buffer) {
    try {
      const newTokens = await refreshTokenForPlatform(platform, data.refresh_token);
      await saveTokens(userId, platform, newTokens);
      return newTokens.access_token;
    } catch (err) {
      console.error(`[tokens] Failed to refresh ${platform} token for user ${userId}:`, err);
      return null;
    }
  }

  return data.access_token;
}

/**
 * Refresh a platform token server-side.
 */
async function refreshTokenForPlatform(platform: string, refreshToken: string): Promise<TokenData> {
  if (platform === 'ebay') {
    return refreshEbayToken(refreshToken);
  } else if (platform === 'etsy') {
    return refreshEtsyToken(refreshToken);
  }
  throw new Error(`Unknown platform: ${platform}`);
}

async function refreshEbayToken(refreshToken: string): Promise<TokenData> {
  const clientId = process.env.VITE_EBAY_CLIENT_ID!;
  const clientSecret = process.env.EBAY_CLIENT_SECRET!;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const IS_SANDBOX = clientId.includes('SBX');
  const baseUrl = IS_SANDBOX ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetch(`${baseUrl}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basicAuth}`,
    },
    body: params.toString(),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || 'eBay token refresh failed');

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_in: data.expires_in,
  };
}

async function refreshEtsyToken(refreshToken: string): Promise<TokenData> {
  const clientId = process.env.VITE_ETSY_CLIENT_ID!;

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const response = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || 'Etsy token refresh failed');

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
  };
}

/**
 * Save/update tokens in the platform_connections table.
 */
export async function saveTokens(
  userId: string,
  platform: string,
  tokens: TokenData,
  extra?: { platform_user_id?: string; platform_username?: string }
): Promise<void> {
  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from('platform_connections')
    .upsert({
      user_id: userId,
      platform,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      ...(extra?.platform_user_id && { platform_user_id: extra.platform_user_id }),
      ...(extra?.platform_username && { platform_username: extra.platform_username }),
      connected_at: new Date().toISOString(),
    }, { onConflict: 'user_id,platform' });

  if (error) {
    console.error(`[tokens] Failed to save ${platform} tokens for user ${userId}:`, error);
  }
}
