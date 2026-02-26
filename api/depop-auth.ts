import type { VercelRequest, VercelResponse } from '@vercel/node';

// Depop unofficial internal API — same endpoints their mobile app uses.
// This is not a public API and may change without notice.
const DEPOP_API = 'https://webapi.depop.com/api/v1';

// Depop's mobile app User-Agent (required or they block the request)
const DEPOP_UA = 'Depop/3.7.0 iOS/17.0';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, username, password, refresh_token } = req.body || {};

  // ── Login with username + password ────────────────────────────────────────
  if (action === 'login') {
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    try {
      const response = await fetch(`${DEPOP_API}/auth/login/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': DEPOP_UA,
          'Accept': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        const msg = data?.message || data?.error || `Login failed (${response.status})`;
        return res.status(response.status).json({ error: msg });
      }

      // Return tokens — never echo the password back
      return res.status(200).json({
        access_token: data.access_token || data.accessToken,
        refresh_token: data.refresh_token || data.refreshToken,
        expires_in: data.expires_in || 3600,
        username: data.username || username,
        user_id: data.userId || data.user_id,
      });
    } catch (err) {
      console.error('[depop-auth] login error:', err);
      return res.status(500).json({ error: 'Failed to reach Depop' });
    }
  }

  // ── Refresh token ─────────────────────────────────────────────────────────
  if (action === 'refresh') {
    if (!refresh_token) {
      return res.status(400).json({ error: 'refresh_token required' });
    }

    try {
      const response = await fetch(`${DEPOP_API}/auth/token/refresh/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': DEPOP_UA,
          'Accept': 'application/json',
        },
        body: JSON.stringify({ refresh: refresh_token }),
      });

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: 'Token refresh failed' });
      }

      return res.status(200).json({
        access_token: data.access || data.access_token,
        refresh_token: data.refresh || refresh_token,
        expires_in: data.expires_in || 3600,
      });
    } catch (err) {
      console.error('[depop-auth] refresh error:', err);
      return res.status(500).json({ error: 'Failed to reach Depop' });
    }
  }

  return res.status(400).json({ error: 'Invalid action. Use "login" or "refresh".' });
}
