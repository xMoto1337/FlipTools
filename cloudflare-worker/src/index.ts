export interface Env {
  PROXY_SECRET: string;
}

const DEPOP_API = 'https://webapi.depop.com/api/v1';

// Allowed origins for browser-direct calls
const ALLOWED_ORIGINS = ['https://fliptools.net', 'http://localhost:1422', 'http://localhost:5173'];

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Secret',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: cors });
    }

    // Accept either the shared server-to-server secret OR any request from
    // our allowed browser origins (real browsers have residential IPs that
    // bypass Cloudflare Bot Management naturally).
    const secret = request.headers.get('X-Proxy-Secret');
    const fromBrowser = origin && ALLOWED_ORIGINS.includes(origin);
    if (env.PROXY_SECRET && secret !== env.PROXY_SECRET && !fromBrowser) {
      return new Response('Unauthorized', { status: 401, headers: cors });
    }

    let body: Record<string, string>;
    try {
      body = await request.json() as Record<string, string>;
    } catch {
      return json({ error: 'Invalid JSON' }, 400, cors);
    }

    const { action, username, password, refresh_token } = body;

    // ── Login ────────────────────────────────────────────────────────────────
    if (action === 'login') {
      if (!username || !password) {
        return json({ error: 'Username and password required' }, 400, cors);
      }

      const resp = await fetch(`${DEPOP_API}/auth/login/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Depop/3.7.0 (iPhone; iOS 17.0; Scale/3.00)',
          'X-Depop-Platform': 'iOS',
        },
        body: JSON.stringify({ username, password }),
      });

      return proxyResponse(resp, cors);
    }

    // ── Refresh token ────────────────────────────────────────────────────────
    if (action === 'refresh') {
      if (!refresh_token) {
        return json({ error: 'refresh_token required' }, 400, cors);
      }

      const resp = await fetch(`${DEPOP_API}/auth/token/refresh/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Depop/3.7.0 (iPhone; iOS 17.0; Scale/3.00)',
        },
        body: JSON.stringify({ refresh: refresh_token }),
      });

      return proxyResponse(resp, cors);
    }

    return json({ error: 'Invalid action. Use "login" or "refresh".' }, 400, cors);
  },
};

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...extraHeaders, 'Content-Type': 'application/json' },
  });
}
