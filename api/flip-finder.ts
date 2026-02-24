import type { VercelRequest, VercelResponse } from '@vercel/node';

export interface FlipSource {
  id: string;
  title: string;
  buyPrice: number;
  image: string;
  url: string;
  source: 'aliexpress' | 'dhgate';
  minOrder: number;
  shippingDesc: string;
  rating?: number;
  totalOrders?: number;
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

async function searchAliExpress(query: string): Promise<FlipSource[]> {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://www.aliexpress.com/w/wholesale-${encoded}.html?SearchText=${encoded}`;

    const res = await fetch(url, {
      headers: { ...BROWSER_HEADERS, Referer: 'https://www.aliexpress.com/' },
      signal: AbortSignal.timeout(14000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();
    let items: Record<string, unknown>[] = [];

    // Pattern 1: window.runParams = { data: { ... } }
    const runParamsMatch = html.match(/window\.runParams\s*=\s*(\{[\s\S]+?\});\s*(?:try\b|var \w|window\.)/);
    if (runParamsMatch) {
      try {
        const data = JSON.parse(runParamsMatch[1]) as Record<string, unknown>;
        const mods = (data?.mods ?? (data as Record<string, unknown>)?.data) as Record<string, unknown> | undefined;
        items =
          (mods?.itemList as Record<string, unknown>[] | undefined) ??
          ((mods?.itemList as Record<string, unknown> | undefined)?.content as Record<string, unknown>[] | undefined) ??
          [];
      } catch { /* ignore */ }
    }

    // Pattern 2: __NEXT_DATA__
    if (items.length === 0) {
      const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
      if (nextMatch) {
        try {
          const nd = JSON.parse(nextMatch[1]) as Record<string, unknown>;
          const props = (nd?.props as Record<string, unknown>)?.pageProps as Record<string, unknown> | undefined;
          items =
            (props?.searchResult as Record<string, unknown>[] | undefined) ??
            ((props?.searchResult as Record<string, unknown> | undefined)?.resultList as Record<string, unknown>[] | undefined) ??
            [];
        } catch { /* ignore */ }
      }
    }

    // Pattern 3: raw JSON blob in script
    if (items.length === 0) {
      const dataMatch = html.match(/"resultList"\s*:\s*(\[[\s\S]{20,100000}?\])\s*,\s*"/);
      if (dataMatch) {
        try { items = JSON.parse(dataMatch[1]); } catch { /* ignore */ }
      }
    }

    return items.slice(0, 20).flatMap((raw) => {
      const item = ((raw as Record<string, unknown>)?.item ?? raw) as Record<string, unknown>;
      const prices = item?.prices as Record<string, unknown> | undefined;
      const salePrice = prices?.salePrice as Record<string, unknown> | undefined;
      const priceStr =
        (salePrice?.minPrice as string | undefined) ??
        ((item?.sku as Record<string, unknown>)?.def as Record<string, unknown>)?.promotionPrice as string | undefined ??
        (item?.price as Record<string, unknown>)?.min as string | undefined ??
        '0';
      const price = parseFloat(String(priceStr).replace(/[^0-9.]/g, '')) || 0;
      if (price === 0) return [];

      const imageObj = item?.image as Record<string, unknown> | undefined;
      const imgUrl = imageObj?.imgUrl as string | undefined;

      return [{
        id: `ali-${item?.productId ?? Math.random()}`,
        title: String(
          (item?.title as Record<string, unknown> | undefined)?.displayTitle ??
          item?.productTitle ??
          'Unknown'
        ),
        buyPrice: price,
        image: imgUrl ? `https:${imgUrl}` : String(item?.imageUrl ?? ''),
        url: `https://www.aliexpress.com/item/${item?.productId}.html`,
        source: 'aliexpress' as const,
        minOrder: parseInt(String(item?.moq ?? '1')) || 1,
        shippingDesc: String(
          (prices?.shippingInfo as Record<string, unknown> | undefined)?.shippingDesc ?? 'Free Shipping'
        ),
        rating: parseFloat(String((item?.evaluation as Record<string, unknown> | undefined)?.starRating ?? '0')) || undefined,
        totalOrders: parseInt(String(item?.tradeDesc ?? '').replace(/[^0-9]/g, '') || '0') || undefined,
      }];
    });
  } catch (err) {
    console.warn('[flip-finder] AliExpress error:', err instanceof Error ? err.message : err);
    return [];
  }
}

async function searchDHgate(query: string): Promise<FlipSource[]> {
  try {
    const url = `https://www.dhgate.com/wholesale/search.do?searchkey=${encodeURIComponent(query)}&pageNo=1`;

    const res = await fetch(url, {
      headers: { ...BROWSER_HEADERS, Referer: 'https://www.dhgate.com/' },
      signal: AbortSignal.timeout(14000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();

    // Try embedded __INITIAL_STATE__
    const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]+?\});\s*(?:window\.|<\/script>)/);
    if (stateMatch) {
      try {
        const state = JSON.parse(stateMatch[1]) as Record<string, unknown>;
        const list: Record<string, unknown>[] =
          ((state?.searchResult as Record<string, unknown>)?.data as Record<string, unknown>)?.productList as Record<string, unknown>[] ??
          (state?.productList as Record<string, unknown>)?.data as Record<string, unknown>[] ??
          [];

        return list.slice(0, 20).flatMap((item) => {
          const price = parseFloat(String(item?.minPrice ?? item?.price ?? '0'));
          if (price === 0) return [];
          return [{
            id: `dhg-${item?.productId ?? item?.id ?? Math.random()}`,
            title: String(item?.productName ?? item?.name ?? 'Unknown'),
            buyPrice: price,
            image: String(item?.pictureUrl ?? item?.imageUrl ?? ''),
            url: `https://www.dhgate.com/product/${item?.productId ?? item?.id}.html`,
            source: 'dhgate' as const,
            minOrder: parseInt(String(item?.minPurchase ?? item?.minOrder ?? '1')) || 1,
            shippingDesc: String(item?.shipDesc ?? 'Free Shipping'),
            rating: parseFloat(String(item?.feedbackScore ?? item?.rating ?? '0')) || undefined,
            totalOrders: parseInt(String(item?.saleCount ?? item?.sold ?? '0')) || undefined,
          }];
        });
      } catch { /* ignore */ }
    }

    return [];
  } catch (err) {
    console.warn('[flip-finder] DHgate error:', err instanceof Error ? err.message : err);
    return [];
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const query = (req.query.q as string | undefined)?.trim();
  if (!query) return res.status(400).json({ error: 'Missing q parameter' });

  const source = (req.query.source as string | undefined) ?? 'all';

  const tasks: Promise<FlipSource[]>[] = [];
  if (source === 'all' || source === 'aliexpress') tasks.push(searchAliExpress(query));
  if (source === 'all' || source === 'dhgate') tasks.push(searchDHgate(query));

  const settled = await Promise.allSettled(tasks);
  const results: FlipSource[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') results.push(...r.value);
  }

  results.sort((a, b) => a.buyPrice - b.buyPrice);

  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');
  return res.json({ results, query });
}
