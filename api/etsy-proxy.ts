import type { VercelRequest, VercelResponse } from '@vercel/node';

const ETSY_API_URL = 'https://openapi.etsy.com';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { endpoint, token, method, payload } = req.body;
  const clientId = process.env.VITE_ETSY_CLIENT_ID;

  if (!endpoint || !token) {
    return res.status(400).json({ error: 'Missing endpoint or token' });
  }

  try {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'x-api-key': clientId || '',
    };

    const fetchOptions: RequestInit = {
      method: method || 'GET',
      headers,
    };

    if (payload && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(payload);
    }

    const url = `${ETSY_API_URL}${endpoint}`;
    const response = await fetch(url, fetchOptions);

    // For DELETE with no content
    if (response.status === 204) {
      return res.status(204).end();
    }

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    console.error('Etsy proxy error:', err);
    return res.status(500).json({ error: 'Proxy request failed' });
  }
}
