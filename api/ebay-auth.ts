import type { VercelRequest, VercelResponse } from '@vercel/node';

const clientIdVal = process.env.VITE_EBAY_CLIENT_ID || '';
const IS_SANDBOX = process.env.VITE_EBAY_SANDBOX === 'true' || clientIdVal.includes('SBX');
const EBAY_API_URL = IS_SANDBOX
  ? 'https://api.sandbox.ebay.com'
  : 'https://api.ebay.com';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers for frontend calls
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientId = process.env.VITE_EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const redirectUri = process.env.VITE_EBAY_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(500).json({ error: 'eBay credentials not configured' });
  }

  const { grant_type, code, refresh_token } = req.body;

  const params = new URLSearchParams();
  params.append('grant_type', grant_type);

  if (grant_type === 'authorization_code') {
    if (!code) return res.status(400).json({ error: 'Missing authorization code' });
    params.append('code', code);
    params.append('redirect_uri', redirectUri);
  } else if (grant_type === 'refresh_token') {
    if (!refresh_token) return res.status(400).json({ error: 'Missing refresh token' });
    params.append('refresh_token', refresh_token);
  } else {
    return res.status(400).json({ error: 'Invalid grant_type' });
  }

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch(`${EBAY_API_URL}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`,
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('eBay token exchange failed:', data);
      return res.status(response.status).json({
        error: data.error_description || data.error || 'Token exchange failed',
      });
    }

    return res.status(200).json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      token_type: data.token_type,
    });
  } catch (err) {
    console.error('eBay auth error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
