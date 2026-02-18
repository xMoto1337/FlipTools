import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const clientId = process.env.VITE_ETSY_CLIENT_ID;
  const redirectUri = process.env.VITE_ETSY_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).json({ error: 'Etsy credentials not configured' });
  }

  const { grant_type, code, code_verifier, refresh_token } = req.body;

  const params = new URLSearchParams();
  params.append('grant_type', grant_type);
  params.append('client_id', clientId);

  if (grant_type === 'authorization_code') {
    if (!code) return res.status(400).json({ error: 'Missing authorization code' });
    if (!code_verifier) return res.status(400).json({ error: 'Missing code_verifier (PKCE)' });
    params.append('code', code);
    params.append('redirect_uri', redirectUri);
    params.append('code_verifier', code_verifier);
  } else if (grant_type === 'refresh_token') {
    if (!refresh_token) return res.status(400).json({ error: 'Missing refresh token' });
    params.append('refresh_token', refresh_token);
  } else {
    return res.status(400).json({ error: 'Invalid grant_type' });
  }

  try {
    const response = await fetch('https://api.etsy.com/v3/public/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Etsy token exchange failed:', data);
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
    console.error('Etsy auth error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
