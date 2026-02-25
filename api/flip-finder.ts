import type { VercelRequest, VercelResponse } from '@vercel/node';

export interface FlipSource {
  id: string;
  title: string;
  buyPrice: number;
  image: string;
  url: string;
  source: 'aliexpress' | 'dhgate' | 'wish' | 'temu' | 'shein';
  minOrder: number;
  shippingDesc: string;
  rating?: number;
  totalOrders?: number;
}

type SourceResult =
  | { status: 'ok';    items: FlipSource[]; detail?: string }
  | { status: 'empty'; items: FlipSource[]; detail: string }
  | { status: 'error'; items: FlipSource[]; detail: string };

// ── Proxy wrapper ──────────────────────────────────────────────────────────
// When SCRAPER_API_KEY is set in Vercel env vars, all outbound requests are
// routed through ScraperAPI (scraperapi.com — free 1000 credits/month).
// Without it the requests still try directly; many will be blocked by bot
// protection on AWS IPs, but the errors will be reported per-source.
const SCRAPER_KEY = process.env.SCRAPER_API_KEY ?? '';

async function proxiedFetch(
  url: string,
  headers: Record<string, string> = {},
  options: { method?: string; body?: string; timeoutMs?: number } = {}
): Promise<Response> {
  const { method = 'GET', body, timeoutMs = 18000 } = options;
  const signal = AbortSignal.timeout(timeoutMs);

  if (SCRAPER_KEY) {
    const proxyUrl =
      `https://api.scraperapi.com?api_key=${SCRAPER_KEY}` +
      `&url=${encodeURIComponent(url)}&render=false`;
    return fetch(proxyUrl, { method, headers, body, signal });
  }

  return fetch(url, { method, headers, body, signal });
}

// ── Shared browser-like headers ────────────────────────────────────────────
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BASE_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
};

function safeFloat(val: unknown, fallback = 0): number {
  const n = parseFloat(String(val ?? '').replace(/[^0-9.]/g, ''));
  return isFinite(n) ? n : fallback;
}
function safeInt(val: unknown, fallback = 0): number {
  const n = parseInt(String(val ?? '').replace(/[^0-9]/g, ''), 10);
  return isFinite(n) ? n : fallback;
}

// ── AliExpress ─────────────────────────────────────────────────────────────
async function searchAliExpress(query: string): Promise<SourceResult> {
  try {
    const params = new URLSearchParams({
      keywords: query,
      page: '1',
      pageSize: '40',
      origin: 'PCItemList',
      g: 'y',
      sortType: 'default',
    });

    const res = await proxiedFetch(
      `https://www.aliexpress.com/glosearch/api/product?${params}`,
      {
        ...BASE_HEADERS,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Referer: 'https://www.aliexpress.com/',
        'X-Requested-With': 'XMLHttpRequest',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
      },
      { timeoutMs: 18000 }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { status: 'error', items: [], detail: `HTTP ${res.status} — ${body.slice(0, 120)}` };
    }

    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('json')) {
      const preview = (await res.text()).slice(0, 200);
      return { status: 'error', items: [], detail: `non-JSON (${ct.slice(0, 40)}): ${preview}` };
    }

    const json = (await res.json()) as Record<string, unknown>;
    const rawList: unknown[] =
      ((json?.mods as Record<string, unknown>)?.itemList as Record<string, unknown>)
        ?.content as unknown[] ??
      (json?.mods as Record<string, unknown>)?.itemList as unknown[] ??
      (json?.result as Record<string, unknown>)?.mods as unknown[] ??
      [];

    const items = (Array.isArray(rawList) ? rawList : [])
      .slice(0, 25)
      .flatMap<FlipSource>((raw) => {
        const it = ((raw as Record<string, unknown>)?.item ?? raw) as Record<string, unknown>;
        const prices = it?.prices as Record<string, unknown> | undefined;
        const salePrice = prices?.salePrice as Record<string, unknown> | undefined;
        const priceStr =
          (salePrice?.minPrice as string | undefined) ??
          ((it?.sku as Record<string, unknown>)?.def as Record<string, unknown> | undefined)?.promotionPrice as string | undefined ??
          (it?.price as Record<string, unknown> | undefined)?.min as string | undefined ??
          '0';
        const price = safeFloat(priceStr);
        if (price === 0) return [];
        const imgRaw = (it?.image as Record<string, unknown>)?.imgUrl as string | undefined;
        return [{
          id: `ali-${it?.productId ?? Math.random()}`,
          title: String((it?.title as Record<string, unknown>)?.displayTitle ?? it?.productTitle ?? 'Unknown').slice(0, 120),
          buyPrice: price,
          image: imgRaw ? `https:${imgRaw}` : '',
          url: `https://www.aliexpress.com/item/${it?.productId}.html`,
          source: 'aliexpress',
          minOrder: safeInt(it?.moq, 1) || 1,
          shippingDesc: String((prices?.shippingInfo as Record<string, unknown>)?.shippingDesc ?? 'Free Shipping'),
          rating: safeFloat((it?.evaluation as Record<string, unknown>)?.starRating) || undefined,
          totalOrders: safeInt(String(it?.tradeDesc ?? '').replace(/[^0-9]/g, '')) || undefined,
        }];
      });

    return items.length > 0
      ? { status: 'ok', items }
      : { status: 'empty', items: [], detail: `API responded but returned 0 priced items. Response keys: ${Object.keys(json).join(', ')}` };
  } catch (err) {
    return { status: 'error', items: [], detail: (err as Error).message };
  }
}

// ── DHgate ─────────────────────────────────────────────────────────────────
async function searchDHgate(query: string): Promise<SourceResult> {
  try {
    const params = new URLSearchParams({ searchkey: query, pageNo: '1', pageSize: '30' });
    const res = await proxiedFetch(
      `https://www.dhgate.com/wholesale/search.do?${params}`,
      { ...BASE_HEADERS, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', Referer: 'https://www.dhgate.com/' },
      { timeoutMs: 18000 }
    );

    if (!res.ok) return { status: 'error', items: [], detail: `HTTP ${res.status}` };

    const html = await res.text();

    const patterns: [RegExp, string][] = [
      [/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]+?\});\s*<\/script>/, '__INITIAL_STATE__'],
      [/"productList"\s*:\s*(\[[\s\S]{20,500000}\])\s*,\s*"pagination"/, 'productList array'],
      [/window\.__NEXT_DATA__\s*=\s*({[\s\S]+?})\s*<\/script>/, '__NEXT_DATA__'],
    ];

    for (const [pattern, label] of patterns) {
      const match = html.match(pattern);
      if (!match) continue;
      try {
        const raw = JSON.parse(match[1]);
        const list: Record<string, unknown>[] = Array.isArray(raw)
          ? raw
          : (raw?.searchResult as Record<string, unknown>)?.data as Record<string, unknown>[] ??
            (raw?.props as Record<string, unknown>)?.pageProps as Record<string, unknown>[] ??
            [];
        if (list.length === 0) continue;
        const items = list.slice(0, 20).flatMap<FlipSource>((item) => {
          const price = safeFloat(item?.minPrice ?? item?.price);
          if (price === 0) return [];
          return [{
            id: `dhg-${item?.productId ?? item?.id ?? Math.random()}`,
            title: String(item?.productName ?? item?.name ?? 'Unknown').slice(0, 120),
            buyPrice: price,
            image: String(item?.pictureUrl ?? item?.imageUrl ?? ''),
            url: `https://www.dhgate.com/product/${item?.productId ?? item?.id}.html`,
            source: 'dhgate',
            minOrder: safeInt(item?.minPurchase ?? item?.minOrder, 1) || 1,
            shippingDesc: String(item?.shipDesc ?? 'Free Shipping'),
            rating: safeFloat(item?.feedbackScore ?? item?.rating) || undefined,
            totalOrders: safeInt(item?.saleCount ?? item?.sold) || undefined,
          }];
        });
        if (items.length > 0) return { status: 'ok', items };
        return { status: 'empty', items: [], detail: `${label} found but ${list.length} entries had no valid prices` };
      } catch (e) {
        console.warn('[dhgate] parse error for', label, e);
        continue;
      }
    }

    const isBot = /challenge|captcha|access denied|403/i.test(html.slice(0, 500));
    return {
      status: 'error',
      items: [],
      detail: isBot
        ? 'Bot challenge / access denied page returned. Needs ScraperAPI.'
        : `No product JSON found in HTML (${html.length} bytes). First 200: ${html.slice(0, 200)}`,
    };
  } catch (err) {
    return { status: 'error', items: [], detail: (err as Error).message };
  }
}

// ── Wish ───────────────────────────────────────────────────────────────────
async function searchWish(query: string): Promise<SourceResult> {
  try {
    const params = new URLSearchParams({ query, count: '20', skip: '0', version: '2' });
    const res = await proxiedFetch(
      `https://www.wish.com/api/search/search?${params}`,
      { ...BASE_HEADERS, Accept: 'application/json', Referer: 'https://www.wish.com/search/' },
      { timeoutMs: 15000 }
    );

    if (!res.ok) return { status: 'error', items: [], detail: `HTTP ${res.status}` };

    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('json')) {
      const preview = (await res.text()).slice(0, 200);
      return { status: 'error', items: [], detail: `non-JSON (${ct.slice(0, 40)}): ${preview}` };
    }

    const json = (await res.json()) as Record<string, unknown>;
    const results: Record<string, unknown>[] =
      ((json?.result as Record<string, unknown>)?.results as Record<string, unknown>[]) ??
      (json?.results as Record<string, unknown>[]) ??
      [];

    const items = results.slice(0, 20).flatMap<FlipSource>((r) => {
      const item = (r?.wish_item ?? r?.item ?? r) as Record<string, unknown>;
      let price = 0;
      const rawPrice = item?.price ?? item?.retail_price;
      if (typeof rawPrice === 'number') price = rawPrice > 200 ? rawPrice / 100 : rawPrice;
      else price = safeFloat(rawPrice);
      if (price === 0) return [];
      const pid = String(item?.id ?? '');
      return [{
        id: `wish-${pid || Math.random()}`,
        title: String(item?.name ?? item?.title ?? 'Unknown').slice(0, 120),
        buyPrice: price,
        image: String(item?.image_url ?? item?.image ?? ''),
        url: pid ? `https://www.wish.com/product/${pid}` : 'https://www.wish.com',
        source: 'wish',
        minOrder: 1,
        shippingDesc: String(item?.shipping_price ?? 'Varies'),
        rating: safeFloat(item?.rating) || undefined,
        totalOrders: safeInt(item?.number_sold) || undefined,
      }];
    });

    return items.length > 0
      ? { status: 'ok', items }
      : { status: 'empty', items: [], detail: `${results.length} results, 0 with valid prices. Keys: ${Object.keys(json).join(', ')}` };
  } catch (err) {
    return { status: 'error', items: [], detail: (err as Error).message };
  }
}

// ── Temu ───────────────────────────────────────────────────────────────────
async function searchTemu(query: string): Promise<SourceResult> {
  try {
    const res = await proxiedFetch(
      'https://www.temu.com/api/poppy/v1/search',
      {
        ...BASE_HEADERS,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Referer: 'https://www.temu.com/',
        Origin: 'https://www.temu.com',
      },
      {
        method: 'POST',
        body: JSON.stringify({ keyword: query, page_no: 1, page_size: 20, sort_type: 0, list_id: '', filter_attrs: [] }),
        timeoutMs: 15000,
      }
    );

    if (!res.ok) return { status: 'error', items: [], detail: `HTTP ${res.status}` };

    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('json')) {
      const preview = (await res.text()).slice(0, 200);
      return { status: 'error', items: [], detail: `non-JSON (${ct.slice(0, 40)}): ${preview}` };
    }

    const json = (await res.json()) as Record<string, unknown>;
    const goods: Record<string, unknown>[] =
      (json?.result as Record<string, unknown>)?.goods_list as Record<string, unknown>[] ??
      (json?.data as Record<string, unknown>)?.goods_list as Record<string, unknown>[] ??
      (json?.goods_list as Record<string, unknown>[]) ??
      [];

    const items = goods.slice(0, 20).flatMap<FlipSource>((g) => {
      const priceCents =
        safeInt(g?.price_info) || safeInt((g?.price as Record<string, unknown>)?.price);
      const price = priceCents / 100;
      if (price === 0) return [];
      const gid = String(g?.goods_id ?? g?.id ?? Math.random());
      return [{
        id: `temu-${gid}`,
        title: String(g?.goods_name ?? g?.name ?? 'Unknown').slice(0, 120),
        buyPrice: price,
        image: String(g?.image_url ?? (g?.images as Record<string, unknown>[])?.[0]?.url ?? ''),
        url: `https://www.temu.com/goods.html?_bg_fs=1&goods_id=${gid}`,
        source: 'temu',
        minOrder: 1,
        shippingDesc: 'Free Shipping',
        rating: safeFloat(g?.goods_rate ?? g?.rating) || undefined,
        totalOrders: safeInt(g?.sold_count ?? g?.total_sold) || undefined,
      }];
    });

    return items.length > 0
      ? { status: 'ok', items }
      : { status: 'empty', items: [], detail: `goods_list had ${goods.length} entries, 0 with valid prices. Keys: ${Object.keys(json).join(', ')}` };
  } catch (err) {
    return { status: 'error', items: [], detail: (err as Error).message };
  }
}

// ── Shein ──────────────────────────────────────────────────────────────────
async function searchShein(query: string): Promise<SourceResult> {
  try {
    const params = new URLSearchParams({
      SearchWord: query, page: '1', limit: '40',
      currency: 'USD', country: 'US', lang: 'en', sort: '0',
    });
    const res = await proxiedFetch(
      `https://us.shein.com/api/productList/info/v1?${params}`,
      {
        ...BASE_HEADERS,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Referer: 'https://us.shein.com/',
        'X-Requested-With': 'XMLHttpRequest',
      },
      { timeoutMs: 15000 }
    );

    if (!res.ok) return { status: 'error', items: [], detail: `HTTP ${res.status}` };

    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('json')) {
      const preview = (await res.text()).slice(0, 200);
      return { status: 'error', items: [], detail: `non-JSON (${ct.slice(0, 40)}): ${preview}` };
    }

    const json = (await res.json()) as Record<string, unknown>;
    const goods: Record<string, unknown>[] =
      (json?.info as Record<string, unknown>)?.products as Record<string, unknown>[] ??
      (json?.products as Record<string, unknown>[]) ??
      (json?.goods as Record<string, unknown>[]) ??
      (json?.data as Record<string, unknown>)?.products as Record<string, unknown>[] ??
      [];

    if (goods.length === 0) {
      return { status: 'empty', items: [], detail: `0 goods. Response keys: ${Object.keys(json).join(', ')}` };
    }

    const items = goods.slice(0, 25).flatMap<FlipSource>((g) => {
      const priceObj = g?.salePrice as Record<string, unknown> | undefined;
      const price = safeFloat(priceObj?.amount ?? priceObj?.usdAmount ?? g?.price ?? g?.salePrice);
      if (price === 0) return [];
      const img = String(g?.goods_img ?? g?.image ?? g?.thumbnail ?? '');
      const gid = String(g?.goods_id ?? g?.id ?? Math.random());
      const urlName = String(g?.goods_url_name ?? g?.goods_sn ?? gid).toLowerCase().replace(/\s+/g, '-');
      return [{
        id: `shein-${gid}`,
        title: String(g?.goods_name ?? g?.name ?? 'Unknown').slice(0, 120),
        buyPrice: price,
        image: img.startsWith('http') ? img : img ? `https:${img}` : '',
        url: `https://us.shein.com/${urlName}-p-${gid}.html`,
        source: 'shein',
        minOrder: 1,
        shippingDesc: 'Free over $29',
        rating: safeFloat(g?.comment_rank_average ?? g?.rating) || undefined,
        totalOrders: safeInt(g?.sales_count ?? g?.sold_count) || undefined,
      }];
    });

    return items.length > 0
      ? { status: 'ok', items }
      : { status: 'empty', items: [], detail: `${goods.length} goods, 0 with valid prices` };
  } catch (err) {
    return { status: 'error', items: [], detail: (err as Error).message };
  }
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const query = (req.query.q as string | undefined)?.trim();
  if (!query) return res.status(400).json({ error: 'Missing q parameter' });

  const requestedSources = ((req.query.source as string | undefined) ?? 'all')
    .split(',').map((s) => s.trim());
  const all = requestedSources.includes('all');

  const tasks: [string, Promise<SourceResult>][] = [];
  if (all || requestedSources.includes('aliexpress')) tasks.push(['aliexpress', searchAliExpress(query)]);
  if (all || requestedSources.includes('dhgate'))     tasks.push(['dhgate',     searchDHgate(query)]);
  if (all || requestedSources.includes('wish'))       tasks.push(['wish',       searchWish(query)]);
  if (all || requestedSources.includes('temu'))       tasks.push(['temu',       searchTemu(query)]);
  if (all || requestedSources.includes('shein'))      tasks.push(['shein',      searchShein(query)]);

  const settled = await Promise.allSettled(tasks.map(([, p]) => p));

  const results: FlipSource[] = [];
  const sourceStatus: Record<string, string> = {};
  const sourceErrors: Record<string, string> = {};

  for (let i = 0; i < settled.length; i++) {
    const name = tasks[i][0];
    const r = settled[i];
    if (r.status === 'fulfilled') {
      results.push(...r.value.items);
      sourceStatus[name] = r.value.status;
      if (r.value.status !== 'ok') sourceErrors[name] = r.value.detail ?? '';
    } else {
      sourceStatus[name] = 'error';
      sourceErrors[name] = String(r.reason?.message ?? r.reason ?? 'unknown');
    }
  }

  results.sort((a, b) => a.buyPrice - b.buyPrice);

  const hasScraperKey = !!SCRAPER_KEY;

  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');
  return res.json({ results, query, count: results.length, sourceStatus, sourceErrors, hasScraperKey });
}
