import type { VercelRequest, VercelResponse } from '@vercel/node';

// Proxy for eBay API calls to avoid CORS issues
// The browser can't call api.ebay.com directly

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST to proxy requests' });
  }

  const { endpoint, token, method, payload } = req.body;

  if (!endpoint || !token) {
    return res.status(400).json({ error: 'Missing endpoint or token' });
  }

  const ebayUrl = `https://api.ebay.com${endpoint}`;
  const ebayMethod = method || 'GET';

  try {
    const fetchOptions: RequestInit = {
      method: ebayMethod,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    };

    // Attach body for POST/PUT requests
    if ((ebayMethod === 'POST' || ebayMethod === 'PUT') && payload) {
      fetchOptions.body = JSON.stringify(payload);
    }

    const response = await fetch(ebayUrl, fetchOptions);

    // Some eBay responses may not be JSON (204 No Content, etc.)
    const contentType = response.headers.get('content-type') || '';
    if (response.status === 204 || !contentType.includes('application/json')) {
      return res.status(response.status).json({ ok: response.ok });
    }

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    console.error('eBay proxy error:', err);
    return res.status(500).json({ error: 'Proxy request failed' });
  }
}
