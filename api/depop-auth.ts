import type { VercelRequest, VercelResponse } from '@vercel/node';

// Routes Depop auth through a Cloudflare Worker proxy.
// The Worker runs on CF's own network, which bypasses the Cloudflare Bot
// Management that blocks direct requests from Vercel (AWS) datacenters.
//
// Required Vercel env vars:
//   DEPOP_WORKER_URL    — e.g. https://depop-auth-proxy.YOUR_SUBDOMAIN.workers.dev
//   DEPOP_PROXY_SECRET  — shared secret, must match PROXY_SECRET set in the Worker

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const workerUrl = process.env.DEPOP_WORKER_URL;
  if (!workerUrl) {
    return res.status(503).json({
      error: 'Depop auth not configured. Set DEPOP_WORKER_URL in Vercel environment variables.',
    });
  }

  const { action, username, password, refresh_token } = req.body || {};
  if (!action) {
    return res.status(400).json({ error: 'action required' });
  }

  try {
    const workerRes = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.DEPOP_PROXY_SECRET
          ? { 'X-Proxy-Secret': process.env.DEPOP_PROXY_SECRET }
          : {}),
      },
      body: JSON.stringify({ action, username, password, refresh_token }),
    });

    const data = await workerRes.json();
    return res.status(workerRes.status).json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[depop-auth] worker proxy error:', msg);
    return res.status(500).json({ error: 'Failed to reach auth proxy', detail: msg });
  }
}
