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
  | { status: 'ok'; items: FlipSource[] }
  | { status: 'empty'; items: FlipSource[] }
  | { status: 'error'; items: FlipSource[]; detail: string };

// ── Shared headers ─────────────────────────────────────────────────────────
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BASE_HEADERS = {
  'User-Agent': UA,
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
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
// Two-step: get a session cookie from homepage, then use it for the search API.
// Their glosearch endpoint requires a valid session to return JSON instead of a
// bot-detection redirect.
async function searchAliExpress(query: string): Promise<SourceResult> {
  try {
    // Step 1: warm up a session
    const sessionRes = await fetch('https://www.aliexpress.com/', {
      headers: {
        ...BASE_HEADERS,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(6000),
      redirect: 'follow',
    });

    const cookies = sessionRes.headers.get('set-cookie') ?? '';

    // Step 2: actual search
    const params = new URLSearchParams({
      keywords: query,
      page: '1',
      pageSize: '40',
      origin: 'PCItemList',
      g: 'y',
      sortType: 'default',
    });

    const searchRes = await fetch(
      `https://www.aliexpress.com/glosearch/api/product?${params}`,
      {
        headers: {
          ...BASE_HEADERS,
          Accept: 'application/json, text/javascript, */*; q=0.01',
          Referer: 'https://www.aliexpress.com/',
          'X-Requested-With': 'XMLHttpRequest',
          ...(cookies ? { Cookie: cookies } : {}),
        },
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!searchRes.ok) {
      return { status: 'error', items: [], detail: `HTTP ${searchRes.status}` };
    }

    const ct = searchRes.headers.get('content-type') ?? '';
    if (!ct.includes('json')) {
      const preview = (await searchRes.text()).slice(0, 120);
      return { status: 'error', items: [], detail: `non-JSON response: ${preview}` };
    }

    const json = (await searchRes.json()) as Record<string, unknown>;

    // Normalise multiple possible response shapes
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
          ((it?.sku as Record<string, unknown> | undefined)?.def as Record<string, unknown> | undefined)?.promotionPrice as string | undefined ??
          (it?.price as Record<string, unknown> | undefined)?.min as string | undefined ??
          '0';
        const price = safeFloat(priceStr);
        if (price === 0) return [];
        const imgRaw = (it?.image as Record<string, unknown> | undefined)?.imgUrl as string | undefined;
        return [{
          id: `ali-${it?.productId ?? Math.random()}`,
          title: String(
            (it?.title as Record<string, unknown> | undefined)?.displayTitle ?? it?.productTitle ?? 'Unknown'
          ).slice(0, 120),
          buyPrice: price,
          image: imgRaw ? `https:${imgRaw}` : '',
          url: `https://www.aliexpress.com/item/${it?.productId}.html`,
          source: 'aliexpress',
          minOrder: safeInt(it?.moq, 1) || 1,
          shippingDesc: String(
            (prices?.shippingInfo as Record<string, unknown> | undefined)?.shippingDesc ?? 'Free Shipping'
          ),
          rating: safeFloat((it?.evaluation as Record<string, unknown> | undefined)?.starRating) || undefined,
          totalOrders: safeInt(String(it?.tradeDesc ?? '').replace(/[^0-9]/g, '')) || undefined,
        }];
      });

    return items.length > 0
      ? { status: 'ok', items }
      : { status: 'empty', items: [], detail: 'search returned 0 products' };
  } catch (err) {
    return { status: 'error', items: [], detail: (err as Error).message };
  }
}

// ── DHgate ────────────────────────────────────────────────────────────────
async function searchDHgate(query: string): Promise<SourceResult> {
  try {
    const params = new URLSearchParams({
      searchkey: query,
      pageNo: '1',
      pageSize: '30',
    });

    const res = await fetch(`https://www.dhgate.com/wholesale/search.do?${params}`, {
      headers: {
        ...BASE_HEADERS,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: 'https://www.dhgate.com/',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return { status: 'error', items: [], detail: `HTTP ${res.status}` };

    const html = await res.text();

    const patterns = [
      /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]+?\});\s*<\/script>/,
      /"productList"\s*:\s*(\[[\s\S]{20,200000}\])\s*,\s*"pagination"/,
      /window\.__NEXT_DATA__\s*=\s*(\{[\s\S]+?)\}\s*<\/script>/,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (!match) continue;
      try {
        const raw = JSON.parse(match[1]);
        const list: Record<string, unknown>[] = Array.isArray(raw)
          ? raw
          : (raw?.searchResult as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ??
            (raw?.props as Record<string, unknown> | undefined)?.pageProps as Record<string, unknown>[] ??
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
      } catch { continue; }
    }

    const preview = html.slice(0, 120);
    return { status: 'empty', items: [], detail: `no structured data found. HTML: ${preview}` };
  } catch (err) {
    return { status: 'error', items: [], detail: (err as Error).message };
  }
}

// ── Wish ──────────────────────────────────────────────────────────────────
async function searchWish(query: string): Promise<SourceResult> {
  try {
    const params = new URLSearchParams({ query, count: '20', skip: '0', version: '2' });
    const res = await fetch(`https://www.wish.com/api/search/search?${params}`, {
      headers: {
        ...BASE_HEADERS,
        Accept: 'application/json',
        Referer: 'https://www.wish.com/search/',
      },
      signal: AbortSignal.timeout(7000),
    });

    if (!res.ok) return { status: 'error', items: [], detail: `HTTP ${res.status}` };

    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('json')) {
      return { status: 'error', items: [], detail: `non-JSON (${ct})` };
    }

    const json = (await res.json()) as Record<string, unknown>;
    const results =
      ((json?.result as Record<string, unknown> | undefined)?.results as Record<string, unknown>[]) ??
      (json?.results as Record<string, unknown>[]) ??
      [];

    const items = results.slice(0, 20).flatMap<FlipSource>((r) => {
      const item =
        (r?.wish_item as Record<string, unknown> | undefined) ??
        (r?.item as Record<string, unknown> | undefined) ??
        r;
      let price = 0;
      const rawPrice = item?.price ?? item?.retail_price;
      if (typeof rawPrice === 'number') {
        price = rawPrice > 200 ? rawPrice / 100 : rawPrice;
      } else {
        price = safeFloat(rawPrice);
      }
      if (price === 0) return [];
      const img = (item?.image_url as string | undefined) ?? (item?.image as string | undefined) ?? '';
      const pid = (item?.id as string | undefined) ?? '';
      return [{
        id: `wish-${pid || Math.random()}`,
        title: String(item?.name ?? item?.title ?? 'Unknown').slice(0, 120),
        buyPrice: price,
        image: img,
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
      : { status: 'empty', items: [], detail: `results array had ${results.length} entries, 0 with valid prices` };
  } catch (err) {
    return { status: 'error', items: [], detail: (err as Error).message };
  }
}

// ── Temu ──────────────────────────────────────────────────────────────────
async function searchTemu(query: string): Promise<SourceResult> {
  try {
    const res = await fetch('https://www.temu.com/api/poppy/v1/search', {
      method: 'POST',
      headers: {
        ...BASE_HEADERS,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Referer: 'https://www.temu.com/',
        Origin: 'https://www.temu.com',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
      },
      body: JSON.stringify({ keyword: query, page_no: 1, page_size: 20, sort_type: 0, list_id: '', filter_attrs: [] }),
      signal: AbortSignal.timeout(7000),
    });

    if (!res.ok) return { status: 'error', items: [], detail: `HTTP ${res.status}` };

    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('json')) return { status: 'error', items: [], detail: `non-JSON (${ct})` };

    const json = (await res.json()) as Record<string, unknown>;
    const goods: Record<string, unknown>[] =
      (json?.result as Record<string, unknown> | undefined)?.goods_list as Record<string, unknown>[] ??
      (json?.data as Record<string, unknown> | undefined)?.goods_list as Record<string, unknown>[] ??
      (json?.goods_list as Record<string, unknown>[]) ??
      [];

    const items = goods.slice(0, 20).flatMap<FlipSource>((g) => {
      const priceCents =
        safeInt(g?.price_info as unknown) ||
        safeInt((g?.price as Record<string, unknown> | undefined)?.price);
      const price = priceCents / 100;
      if (price === 0) return [];
      const img =
        (g?.image_url as string | undefined) ??
        ((g?.images as Record<string, unknown>[] | undefined)?.[0]?.url as string | undefined) ??
        '';
      const gid = String(g?.goods_id ?? g?.id ?? Math.random());
      return [{
        id: `temu-${gid}`,
        title: String(g?.goods_name ?? g?.name ?? 'Unknown').slice(0, 120),
        buyPrice: price,
        image: img,
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
      : { status: 'empty', items: [], detail: `goods_list had ${goods.length} entries, 0 with valid prices` };
  } catch (err) {
    return { status: 'error', items: [], detail: (err as Error).message };
  }
}

// ── Shein ─────────────────────────────────────────────────────────────────
async function searchShein(query: string): Promise<SourceResult> {
  try {
    const params = new URLSearchParams({
      SearchWord: query,
      page: '1',
      limit: '40',
      currency: 'USD',
      country: 'US',
      lang: 'en',
      sort: '0',
    });

    const res = await fetch(`https://us.shein.com/api/productList/info/v1?${params}`, {
      headers: {
        ...BASE_HEADERS,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Referer: 'https://us.shein.com/',
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: AbortSignal.timeout(7000),
    });

    if (!res.ok) return { status: 'error', items: [], detail: `HTTP ${res.status}` };

    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('json')) return { status: 'error', items: [], detail: `non-JSON (${ct})` };

    const json = (await res.json()) as Record<string, unknown>;
    const goods: Record<string, unknown>[] =
      (json?.info as Record<string, unknown> | undefined)?.products as Record<string, unknown>[] ??
      (json?.products as Record<string, unknown>[]) ??
      (json?.goods as Record<string, unknown>[]) ??
      (json?.data as Record<string, unknown> | undefined)?.products as Record<string, unknown>[] ??
      [];

    if (goods.length === 0) {
      return { status: 'empty', items: [], detail: `no goods in response keys: ${Object.keys(json).join(', ')}` };
    }

    const items = goods.slice(0, 25).flatMap<FlipSource>((g) => {
      const priceObj = g?.salePrice as Record<string, unknown> | undefined;
      const price = safeFloat(priceObj?.amount ?? priceObj?.usdAmount ?? g?.price ?? g?.salePrice);
      if (price === 0) return [];
      const img =
        (g?.goods_img as string | undefined) ??
        (g?.image as string | undefined) ??
        (g?.thumbnail as string | undefined) ??
        '';
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
    .split(',')
    .map((s) => s.trim());
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
      if (r.value.status !== 'ok') {
        sourceErrors[name] = (r.value as { detail?: string }).detail ?? '';
      }
    } else {
      sourceStatus[name] = 'error';
      sourceErrors[name] = r.reason?.message ?? 'unknown';
    }
  }

  results.sort((a, b) => a.buyPrice - b.buyPrice);

  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');
  return res.json({ results, query, count: results.length, sourceStatus, sourceErrors });
}
