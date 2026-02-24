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

// ── Shared headers ─────────────────────────────────────────────────────────
const CHROME_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
};

function safeFloat(val: unknown, fallback = 0): number {
  const n = parseFloat(String(val ?? '').replace(/[^0-9.]/g, ''));
  return isFinite(n) ? n : fallback;
}

function safeInt(val: unknown, fallback = 0): number {
  const n = parseInt(String(val ?? '').replace(/[^0-9]/g, ''), 10);
  return isFinite(n) ? n : fallback;
}

// ── AliExpress — internal glosearch JSON API ───────────────────────────────
// AliExpress exposes their search results as a JSON endpoint used by their
// own React frontend, making it far more stable than HTML scraping.
async function searchAliExpress(query: string): Promise<FlipSource[]> {
  try {
    const params = new URLSearchParams({
      keywords: query,
      page: '1',
      pageSize: '40',
      origin: 'PCItemList',
      g: 'y',
      sortType: 'default',
    });

    const res = await fetch(
      `https://www.aliexpress.com/glosearch/api/product?${params}`,
      {
        headers: {
          ...CHROME_HEADERS,
          Accept: 'application/json, text/javascript, */*; q=0.01',
          Referer: 'https://www.aliexpress.com/',
          'X-Requested-With': 'XMLHttpRequest',
        },
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!res.ok) throw new Error(`AliExpress ${res.status}`);

    const json = (await res.json()) as Record<string, unknown>;

    // Multiple possible response shapes depending on AB test / region
    const content: unknown[] =
      (json?.mods as Record<string, unknown> | undefined)
        ?.itemList as unknown[] ??
      ((json?.mods as Record<string, unknown> | undefined)
        ?.itemList as Record<string, unknown> | undefined)
        ?.content as unknown[] ??
      (json?.result as Record<string, unknown> | undefined)
        ?.mods as unknown[] ??
      [];

    // Try nested paths
    const items: unknown[] = Array.isArray(content)
      ? content
      : (
          (json?.mods as Record<string, unknown> | undefined)
            ?.itemList as Record<string, unknown> | undefined
        )?.content as unknown[] ?? [];

    return items
      .slice(0, 25)
      .flatMap<FlipSource>((raw) => {
        const it = (
          (raw as Record<string, unknown>)?.item ?? raw
        ) as Record<string, unknown>;

        const prices = it?.prices as Record<string, unknown> | undefined;
        const salePrice = prices?.salePrice as Record<string, unknown> | undefined;

        const priceStr =
          (salePrice?.minPrice as string | undefined) ??
          ((it?.sku as Record<string, unknown> | undefined)?.def as Record<string, unknown> | undefined)
            ?.promotionPrice as string | undefined ??
          (it?.price as Record<string, unknown> | undefined)?.min as string | undefined ??
          '0';

        const price = safeFloat(priceStr);
        if (price === 0) return [];

        const imgRaw = (it?.image as Record<string, unknown> | undefined)?.imgUrl as string | undefined;

        return [
          {
            id: `ali-${it?.productId ?? Math.random()}`,
            title: String(
              (it?.title as Record<string, unknown> | undefined)?.displayTitle ??
                it?.productTitle ??
                'Unknown'
            ).slice(0, 120),
            buyPrice: price,
            image: imgRaw ? `https:${imgRaw}` : '',
            url: `https://www.aliexpress.com/item/${it?.productId}.html`,
            source: 'aliexpress',
            minOrder: safeInt(it?.moq, 1) || 1,
            shippingDesc: String(
              (prices?.shippingInfo as Record<string, unknown> | undefined)?.shippingDesc ??
                'Free Shipping'
            ),
            rating:
              safeFloat(
                (it?.evaluation as Record<string, unknown> | undefined)?.starRating
              ) || undefined,
            totalOrders:
              safeInt(String(it?.tradeDesc ?? '').replace(/[^0-9]/g, '')) || undefined,
          },
        ];
      });
  } catch (err) {
    console.warn('[flip-finder] AliExpress:', (err as Error).message);
    return [];
  }
}

// ── DHgate — internal search API ──────────────────────────────────────────
// DHgate has an internal search endpoint used by their SPA frontend.
async function searchDHgate(query: string): Promise<FlipSource[]> {
  try {
    // DHgate uses a Next.js / React frontend; their product search data
    // is served as a JSON API endpoint their page's getServerSideProps calls.
    const params = new URLSearchParams({
      searchkey: query,
      pageNo: '1',
      pageSize: '30',
    });

    const res = await fetch(
      `https://www.dhgate.com/wholesale/search.do?${params}`,
      {
        headers: {
          ...CHROME_HEADERS,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          Referer: 'https://www.dhgate.com/',
        },
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!res.ok) throw new Error(`DHgate ${res.status}`);

    const html = await res.text();

    // DHgate embeds structured data in <script> tags
    const patterns = [
      /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]+?\});\s*<\/script>/,
      /"productList"\s*:\s*(\[[\s\S]{20,200000}\])\s*,\s*"pagination"/,
      /window\.__NEXT_DATA__\s*=\s*(\{[\s\S]+?)\}\s*<\/script>/,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (!match) continue;

      try {
        const raw = JSON.parse(
          pattern.source.startsWith('"productList"') ? match[1] : match[1]
        );

        const list: Record<string, unknown>[] = Array.isArray(raw)
          ? raw
          : (raw?.searchResult as Record<string, unknown> | undefined)
              ?.data as Record<string, unknown>[] ??
            (raw?.props as Record<string, unknown> | undefined)
              ?.pageProps as Record<string, unknown>[] ??
            [];

        if (list.length === 0) continue;

        return list.slice(0, 20).flatMap<FlipSource>((item) => {
          const price = safeFloat(item?.minPrice ?? item?.price);
          if (price === 0) return [];
          return [
            {
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
            },
          ];
        });
      } catch {
        continue;
      }
    }

    return [];
  } catch (err) {
    console.warn('[flip-finder] DHgate:', (err as Error).message);
    return [];
  }
}

// ── Wish — JSON search API ─────────────────────────────────────────────────
// Wish.com has a public-facing JSON search endpoint.
async function searchWish(query: string): Promise<FlipSource[]> {
  try {
    const params = new URLSearchParams({
      query,
      count: '20',
      skip: '0',
      version: '2',
    });

    const res = await fetch(
      `https://www.wish.com/api/search/search?${params}`,
      {
        headers: {
          ...CHROME_HEADERS,
          Accept: 'application/json',
          Referer: 'https://www.wish.com/search/',
        },
        signal: AbortSignal.timeout(12000),
      }
    );

    if (!res.ok) throw new Error(`Wish ${res.status}`);

    const json = (await res.json()) as Record<string, unknown>;
    const results =
      ((json?.result as Record<string, unknown> | undefined)
        ?.results as Record<string, unknown>[]) ??
      (json?.results as Record<string, unknown>[]) ??
      [];

    return results.slice(0, 20).flatMap<FlipSource>((r) => {
      const item =
        (r?.wish_item as Record<string, unknown> | undefined) ??
        (r?.item as Record<string, unknown> | undefined) ??
        r;

      // Wish prices can come as cents (integer) or dollars (string)
      let price = 0;
      const rawPrice = item?.price ?? item?.retail_price;
      if (typeof rawPrice === 'number') {
        // Could be cents (> 100 for a < $1 item)
        price = rawPrice > 200 ? rawPrice / 100 : rawPrice;
      } else {
        price = safeFloat(rawPrice);
      }

      if (price === 0) return [];

      const img =
        (item?.image_url as string | undefined) ??
        (item?.image as string | undefined) ??
        '';

      const pid = (item?.id as string | undefined) ?? '';

      return [
        {
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
        },
      ];
    });
  } catch (err) {
    console.warn('[flip-finder] Wish:', (err as Error).message);
    return [];
  }
}

// ── Temu — internal search API ────────────────────────────────────────────
// Temu exposes a public-facing search endpoint their mobile app uses.
async function searchTemu(query: string): Promise<FlipSource[]> {
  try {
    const res = await fetch('https://www.temu.com/api/poppy/v1/search', {
      method: 'POST',
      headers: {
        ...CHROME_HEADERS,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Referer: 'https://www.temu.com/',
        Origin: 'https://www.temu.com',
      },
      body: JSON.stringify({
        keyword: query,
        page_no: 1,
        page_size: 20,
        sort_type: 0,
        list_id: '',
        filter_attrs: [],
      }),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) throw new Error(`Temu ${res.status}`);

    const json = (await res.json()) as Record<string, unknown>;

    // Temu wraps results in various structures
    const goods: Record<string, unknown>[] =
      (json?.result as Record<string, unknown> | undefined)
        ?.goods_list as Record<string, unknown>[] ??
      (json?.data as Record<string, unknown> | undefined)
        ?.goods_list as Record<string, unknown>[] ??
      (json?.goods_list as Record<string, unknown>[]) ??
      [];

    return goods.slice(0, 20).flatMap<FlipSource>((g) => {
      // Temu stores price in cents
      const priceCents =
        safeInt(g?.price_info as unknown) ||
        safeInt(
          (g?.price as Record<string, unknown> | undefined)?.price
        );
      const price = priceCents / 100;
      if (price === 0) return [];

      const img =
        (g?.image_url as string | undefined) ??
        ((g?.images as Record<string, unknown>[] | undefined)?.[0]
          ?.url as string | undefined) ??
        '';

      const gid = String(g?.goods_id ?? g?.id ?? Math.random());

      return [
        {
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
        },
      ];
    });
  } catch (err) {
    console.warn('[flip-finder] Temu:', (err as Error).message);
    return [];
  }
}

// ── Shein — internal product search API ───────────────────────────────────
// Shein's React frontend calls an internal API endpoint to load search results.
// They use a versioned goods-search endpoint that returns JSON directly.
async function searchShein(query: string): Promise<FlipSource[]> {
  try {
    // Shein uses a query-string search endpoint consumed by their SPA
    const params = new URLSearchParams({
      SearchWord: query,
      page: '1',
      limit: '40',
      currency: 'USD',
      country: 'US',
      lang: 'en',
      sort: '0',
    });

    // Try their primary search endpoint first
    const endpoints = [
      `https://us.shein.com/api/productList/info/v1?${params}`,
      `https://us.shein.com/pdsearch/${encodeURIComponent(query)}/?ici=s1&src_identifier=fc%3DSearchword%60sc%3D${encodeURIComponent(query)}`,
    ];

    for (const url of endpoints) {
      const res = await fetch(url, {
        headers: {
          ...CHROME_HEADERS,
          Accept: 'application/json, text/javascript, */*; q=0.01',
          Referer: 'https://us.shein.com/',
          'X-Requested-With': 'XMLHttpRequest',
        },
        signal: AbortSignal.timeout(13000),
      });

      if (!res.ok) continue;

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('json')) continue;

      const json = (await res.json()) as Record<string, unknown>;

      // Multiple possible response shapes
      const goods: Record<string, unknown>[] =
        (json?.info as Record<string, unknown> | undefined)
          ?.products as Record<string, unknown>[] ??
        (json?.products as Record<string, unknown>[]) ??
        (json?.goods as Record<string, unknown>[]) ??
        ((json?.data as Record<string, unknown> | undefined)
          ?.products as Record<string, unknown>[]) ??
        [];

      if (goods.length === 0) continue;

      return goods.slice(0, 25).flatMap<FlipSource>((g) => {
        // Shein prices can come as salePrice object or direct number
        const priceObj = g?.salePrice as Record<string, unknown> | undefined;
        const price =
          safeFloat(priceObj?.amount ?? priceObj?.usdAmount ?? g?.price ?? g?.salePrice);

        if (price === 0) return [];

        const img =
          (g?.goods_img as string | undefined) ??
          (g?.image as string | undefined) ??
          (g?.thumbnail as string | undefined) ??
          '';

        const gid = String(g?.goods_id ?? g?.id ?? Math.random());
        const urlName = String(g?.goods_url_name ?? g?.goods_sn ?? gid)
          .toLowerCase()
          .replace(/\s+/g, '-');

        return [
          {
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
          },
        ];
      });
    }

    return [];
  } catch (err) {
    console.warn('[flip-finder] Shein:', (err as Error).message);
    return [];
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

  // source can be 'all' or comma-separated: 'aliexpress,dhgate,wish,temu'
  const requestedSources = ((req.query.source as string | undefined) ?? 'all')
    .split(',')
    .map((s) => s.trim());

  const all = requestedSources.includes('all');

  const tasks: Promise<FlipSource[]>[] = [];
  if (all || requestedSources.includes('aliexpress')) tasks.push(searchAliExpress(query));
  if (all || requestedSources.includes('dhgate')) tasks.push(searchDHgate(query));
  if (all || requestedSources.includes('wish')) tasks.push(searchWish(query));
  if (all || requestedSources.includes('temu')) tasks.push(searchTemu(query));
  if (all || requestedSources.includes('shein')) tasks.push(searchShein(query));

  const settled = await Promise.allSettled(tasks);
  const results: FlipSource[] = [];
  const sourceStatus: Record<string, 'ok' | 'empty' | 'error'> = {};

  for (const r of settled) {
    if (r.status === 'fulfilled') {
      results.push(...r.value);
      // tag which sources returned data
      for (const item of r.value) {
        sourceStatus[item.source] = r.value.length > 0 ? 'ok' : 'empty';
      }
    }
  }

  results.sort((a, b) => a.buyPrice - b.buyPrice);

  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');
  return res.json({ results, query, count: results.length, sourceStatus });
}
