// Browser-side Flip Finder source parsers.
// Used by the Tauri desktop path — requests are made via native_fetch (user's
// own IP) then the raw response body is parsed here in TypeScript.

export interface FlipSource {
  id: string;
  title: string;
  buyPrice: number;
  image: string;
  url: string;
  source: 'alibaba' | 'aliexpress' | 'dhgate' | 'wish' | 'temu' | 'shein';
  minOrder: number;
  shippingDesc: string;
  rating?: number;
  totalOrders?: number;
}

export interface SourceResult {
  status: 'ok' | 'empty' | 'error';
  items: FlipSource[];
  detail?: string;
}

// Provided by the caller — wraps Tauri's native_fetch invoke
export type NativeFetcher = (
  url: string,
  opts?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ status: number; content_type: string; body: string }>;

function sf(val: unknown, fb = 0): number {
  const n = parseFloat(String(val ?? '').replace(/[^0-9.]/g, ''));
  return isFinite(n) ? n : fb;
}
function si(val: unknown, fb = 0): number {
  const n = parseInt(String(val ?? '').replace(/[^0-9]/g, ''), 10);
  return isFinite(n) ? n : fb;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BASE: Record<string, string> = {
  'User-Agent': UA,
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

// ── Alibaba (B2B) ────────────────────────────────────────────────────────
export async function searchAlibaba(query: string, fetcher: NativeFetcher): Promise<SourceResult> {
  try {
    const params = new URLSearchParams({
      SearchText: query, IndexArea: 'product_en', fsb: 'y', page: '1',
    });
    const r = await fetcher(`https://www.alibaba.com/trade/search?${params}`, {
      headers: { ...BASE, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', Referer: 'https://www.alibaba.com/' },
    });

    if (r.status !== 200) return { status: 'error', items: [], detail: `HTTP ${r.status}` };
    const html = r.body;

    const patterns: [RegExp, string][] = [
      [/<script[^>]*>\s*window\.__page_params__\s*=\s*([\s\S]+?);\s*window\./, '__page_params__'],
      [/window\.__page_params__\s*=\s*({[\s\S]+?});\s*<\/script>/, '__page_params__ (end)'],
      [/"resultList"\s*:\s*(\[[\s\S]{10,300000}\])\s*,\s*"(?:totalCount|pagination)"/, 'resultList'],
    ];

    for (const [pattern, label] of patterns) {
      const match = html.match(pattern);
      if (!match) continue;
      try {
        const raw = JSON.parse(match[1]);
        const list: Record<string, unknown>[] = Array.isArray(raw)
          ? raw
          : raw?.tradeSearchModule?.resultList ??
            raw?.resultList ??
            (raw?.data as Record<string, unknown>)?.resultList ??
            [];
        if (!Array.isArray(list) || list.length === 0) continue;

        const items = list.slice(0, 20).flatMap<FlipSource>((item) => {
          const priceVO = item?.priceVO as Record<string, unknown> | undefined;
          const priceStr = String(priceVO?.minPrice ?? priceVO?.price ?? item?.price ?? '0');
          const price = sf(priceStr.replace(/[^0-9.]/g, ''));
          if (price === 0) return [];
          const imgRaw = String(item?.imageUrl ?? item?.imgUrl ?? '');
          const detailRaw = String(item?.detail_url ?? item?.productHref ?? '');
          return [{
            id: `alib-${item?.product_id ?? item?.id ?? Math.random()}`,
            title: String(item?.subject ?? item?.title ?? 'Unknown').slice(0, 120),
            buyPrice: price,
            image: imgRaw.startsWith('//') ? `https:${imgRaw}` : imgRaw.startsWith('http') ? imgRaw : '',
            url: detailRaw.startsWith('//') ? `https:${detailRaw}` : detailRaw.startsWith('http') ? detailRaw : `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(query)}`,
            source: 'alibaba',
            minOrder: si(item?.moq ?? item?.minOrderQuantity, 1) || 1,
            shippingDesc: String((item?.logistics as Record<string, unknown>)?.freightFee ?? 'Varies'),
            rating: sf(item?.starRating ?? item?.score) || undefined,
            totalOrders: si(item?.tradeCount ?? item?.totalOrders) || undefined,
          }];
        });
        if (items.length > 0) return { status: 'ok', items };
        return { status: 'empty', items: [], detail: `${label}: ${list.length} products, 0 with valid prices` };
      } catch { continue; }
    }

    const isBot = /challenge|captcha|access.denied/i.test(html.slice(0, 1000));
    return {
      status: 'error', items: [],
      detail: isBot ? 'Bot challenge page' : `No product JSON found (${html.length}b). First 200: ${html.slice(0, 200)}`,
    };
  } catch (e) {
    return { status: 'error', items: [], detail: String((e as Error).message) };
  }
}

// ── AliExpress ───────────────────────────────────────────────────────────
export async function searchAliExpress(query: string, fetcher: NativeFetcher): Promise<SourceResult> {
  try {
    const params = new URLSearchParams({
      keywords: query, page: '1', pageSize: '40',
      origin: 'PCItemList', g: 'y', sortType: 'default',
    });
    const r = await fetcher(`https://www.aliexpress.com/glosearch/api/product?${params}`, {
      headers: {
        ...BASE,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Referer: 'https://www.aliexpress.com/',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    if (r.status !== 200) return { status: 'error', items: [], detail: `HTTP ${r.status}` };
    if (!r.content_type.includes('json')) {
      return { status: 'error', items: [], detail: `non-JSON (${r.content_type.slice(0, 40)}): ${r.body.slice(0, 150)}` };
    }

    const json = JSON.parse(r.body) as Record<string, unknown>;
    const rawList: unknown[] =
      ((json?.mods as Record<string, unknown>)?.itemList as Record<string, unknown>)?.content as unknown[] ??
      (json?.mods as Record<string, unknown>)?.itemList as unknown[] ??
      (json?.result as Record<string, unknown>)?.mods as unknown[] ??
      [];

    const items = (Array.isArray(rawList) ? rawList : []).slice(0, 25).flatMap<FlipSource>((raw) => {
      const it = ((raw as Record<string, unknown>)?.item ?? raw) as Record<string, unknown>;
      const prices = it?.prices as Record<string, unknown> | undefined;
      const sp = prices?.salePrice as Record<string, unknown> | undefined;
      const priceStr =
        (sp?.minPrice as string | undefined) ??
        ((it?.sku as Record<string, unknown>)?.def as Record<string, unknown> | undefined)?.promotionPrice as string | undefined ??
        (it?.price as Record<string, unknown> | undefined)?.min as string | undefined ?? '0';
      const price = sf(priceStr);
      if (price === 0) return [];
      const imgRaw = (it?.image as Record<string, unknown>)?.imgUrl as string | undefined;
      return [{
        id: `ali-${it?.productId ?? Math.random()}`,
        title: String((it?.title as Record<string, unknown>)?.displayTitle ?? it?.productTitle ?? 'Unknown').slice(0, 120),
        buyPrice: price,
        image: imgRaw ? `https:${imgRaw}` : '',
        url: `https://www.aliexpress.com/item/${it?.productId}.html`,
        source: 'aliexpress',
        minOrder: si(it?.moq, 1) || 1,
        shippingDesc: String((prices?.shippingInfo as Record<string, unknown>)?.shippingDesc ?? 'Free Shipping'),
        rating: sf((it?.evaluation as Record<string, unknown>)?.starRating) || undefined,
        totalOrders: si(String(it?.tradeDesc ?? '').replace(/[^0-9]/g, '')) || undefined,
      }];
    });

    return items.length > 0
      ? { status: 'ok', items }
      : { status: 'empty', items: [], detail: `0 priced items. Keys: ${Object.keys(json).join(', ')}` };
  } catch (e) {
    return { status: 'error', items: [], detail: String((e as Error).message) };
  }
}

// ── DHgate ───────────────────────────────────────────────────────────────
export async function searchDHgate(query: string, fetcher: NativeFetcher): Promise<SourceResult> {
  try {
    const params = new URLSearchParams({ searchkey: query, pageNo: '1', pageSize: '30' });
    const r = await fetcher(`https://www.dhgate.com/wholesale/search.do?${params}`, {
      headers: { ...BASE, Accept: 'text/html,*/*;q=0.8', Referer: 'https://www.dhgate.com/' },
    });

    if (r.status !== 200) return { status: 'error', items: [], detail: `HTTP ${r.status}` };

    const html = r.body;
    const patterns: [RegExp, string][] = [
      [/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/, '__NEXT_DATA__'],
      [/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]+?\});\s*<\/script>/, '__INITIAL_STATE__'],
      [/"productList"\s*:\s*(\[[\s\S]{20,500000}\])\s*,\s*"pagination"/, 'productList'],
    ];

    for (const [pattern, label] of patterns) {
      const match = html.match(pattern);
      if (!match) continue;
      try {
        const raw = JSON.parse(match[1]);
        const pp = (raw?.props as Record<string, unknown>)?.pageProps as Record<string, unknown> | undefined;
        const list: Record<string, unknown>[] = Array.isArray(raw)
          ? raw
          : (pp?.searchResult as Record<string, unknown>)?.data as Record<string, unknown>[] ??
            (pp?.productList as Record<string, unknown>[]) ??
            (raw?.searchResult as Record<string, unknown>)?.data as Record<string, unknown>[] ??
            [];
        if (list.length === 0) continue;
        const items = list.slice(0, 20).flatMap<FlipSource>((item) => {
          const price = sf(item?.minPrice ?? item?.price);
          if (price === 0) return [];
          return [{
            id: `dhg-${item?.productId ?? item?.id ?? Math.random()}`,
            title: String(item?.productName ?? item?.name ?? 'Unknown').slice(0, 120),
            buyPrice: price,
            image: String(item?.pictureUrl ?? item?.imageUrl ?? ''),
            url: `https://www.dhgate.com/product/${item?.productId ?? item?.id}.html`,
            source: 'dhgate',
            minOrder: si(item?.minPurchase ?? item?.minOrder, 1) || 1,
            shippingDesc: String(item?.shipDesc ?? 'Free Shipping'),
            rating: sf(item?.feedbackScore ?? item?.rating) || undefined,
            totalOrders: si(item?.saleCount ?? item?.sold) || undefined,
          }];
        });
        if (items.length > 0) return { status: 'ok', items };
        return { status: 'empty', items: [], detail: `${label}: ${list.length} entries, 0 priced` };
      } catch { continue; }
    }

    const isBot = /challenge|captcha|403|access denied/i.test(html.slice(0, 500));
    return {
      status: 'error', items: [],
      detail: isBot ? 'Bot challenge page' : `No product JSON (${html.length}b). First 200: ${html.slice(0, 200)}`,
    };
  } catch (e) {
    return { status: 'error', items: [], detail: String((e as Error).message) };
  }
}

// ── Wish ─────────────────────────────────────────────────────────────────
export async function searchWish(query: string, fetcher: NativeFetcher): Promise<SourceResult> {
  try {
    const params = new URLSearchParams({ query, count: '20', skip: '0', version: '2' });
    const r = await fetcher(`https://www.wish.com/api/search/search?${params}`, {
      headers: { ...BASE, Accept: 'application/json', Referer: 'https://www.wish.com/search/' },
    });

    if (r.status !== 200) return { status: 'error', items: [], detail: `HTTP ${r.status}` };
    if (!r.content_type.includes('json')) {
      return { status: 'error', items: [], detail: `non-JSON: ${r.body.slice(0, 150)}` };
    }

    const json = JSON.parse(r.body) as Record<string, unknown>;
    const results: Record<string, unknown>[] =
      ((json?.result as Record<string, unknown>)?.results as Record<string, unknown>[]) ??
      (json?.results as Record<string, unknown>[]) ?? [];

    const items = results.slice(0, 20).flatMap<FlipSource>((rr) => {
      const item = (rr?.wish_item ?? rr?.item ?? rr) as Record<string, unknown>;
      const rawPrice = item?.price ?? item?.retail_price;
      let price = typeof rawPrice === 'number' ? (rawPrice > 200 ? rawPrice / 100 : rawPrice) : sf(rawPrice);
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
        rating: sf(item?.rating) || undefined,
        totalOrders: si(item?.number_sold) || undefined,
      }];
    });

    return items.length > 0
      ? { status: 'ok', items }
      : { status: 'empty', items: [], detail: `${results.length} results, 0 priced. Keys: ${Object.keys(json).join(', ')}` };
  } catch (e) {
    return { status: 'error', items: [], detail: String((e as Error).message) };
  }
}

// ── Temu ─────────────────────────────────────────────────────────────────
export async function searchTemu(query: string, fetcher: NativeFetcher): Promise<SourceResult> {
  try {
    const r = await fetcher('https://www.temu.com/api/poppy/v1/search', {
      method: 'POST',
      headers: {
        ...BASE,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Referer: 'https://www.temu.com/',
        Origin: 'https://www.temu.com',
      },
      body: JSON.stringify({ keyword: query, page_no: 1, page_size: 20, sort_type: 0, list_id: '', filter_attrs: [] }),
    });

    if (r.status !== 200) return { status: 'error', items: [], detail: `HTTP ${r.status}` };
    if (!r.content_type.includes('json')) {
      return { status: 'error', items: [], detail: `non-JSON: ${r.body.slice(0, 150)}` };
    }

    const json = JSON.parse(r.body) as Record<string, unknown>;
    const goods: Record<string, unknown>[] =
      (json?.result as Record<string, unknown>)?.goods_list as Record<string, unknown>[] ??
      (json?.data as Record<string, unknown>)?.goods_list as Record<string, unknown>[] ??
      (json?.goods_list as Record<string, unknown>[]) ?? [];

    const items = goods.slice(0, 20).flatMap<FlipSource>((g) => {
      const priceCents = si(g?.price_info) || si((g?.price as Record<string, unknown>)?.price);
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
        rating: sf(g?.goods_rate ?? g?.rating) || undefined,
        totalOrders: si(g?.sold_count ?? g?.total_sold) || undefined,
      }];
    });

    return items.length > 0
      ? { status: 'ok', items }
      : { status: 'empty', items: [], detail: `${goods.length} goods, 0 priced. Keys: ${Object.keys(json).join(', ')}` };
  } catch (e) {
    return { status: 'error', items: [], detail: String((e as Error).message) };
  }
}

// ── Shein ─────────────────────────────────────────────────────────────────
export async function searchShein(query: string, fetcher: NativeFetcher): Promise<SourceResult> {
  try {
    const params = new URLSearchParams({
      SearchWord: query, page: '1', limit: '40',
      currency: 'USD', country: 'US', lang: 'en', sort: '0',
    });
    const r = await fetcher(`https://us.shein.com/api/productList/info/v1?${params}`, {
      headers: {
        ...BASE,
        Accept: 'application/json, */*; q=0.01',
        Referer: 'https://us.shein.com/',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    if (r.status !== 200) return { status: 'error', items: [], detail: `HTTP ${r.status}` };
    if (!r.content_type.includes('json')) {
      return { status: 'error', items: [], detail: `non-JSON: ${r.body.slice(0, 150)}` };
    }

    const json = JSON.parse(r.body) as Record<string, unknown>;
    const goods: Record<string, unknown>[] =
      (json?.info as Record<string, unknown>)?.products as Record<string, unknown>[] ??
      (json?.products as Record<string, unknown>[]) ??
      (json?.goods as Record<string, unknown>[]) ??
      (json?.data as Record<string, unknown>)?.products as Record<string, unknown>[] ?? [];

    if (goods.length === 0) {
      return { status: 'empty', items: [], detail: `0 goods. Keys: ${Object.keys(json).join(', ')}` };
    }

    const items = goods.slice(0, 25).flatMap<FlipSource>((g) => {
      const priceObj = g?.salePrice as Record<string, unknown> | undefined;
      const price = sf(priceObj?.amount ?? priceObj?.usdAmount ?? g?.price ?? g?.salePrice);
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
        rating: sf(g?.comment_rank_average ?? g?.rating) || undefined,
        totalOrders: si(g?.sales_count ?? g?.sold_count) || undefined,
      }];
    });

    return items.length > 0
      ? { status: 'ok', items }
      : { status: 'empty', items: [], detail: `${goods.length} goods, 0 priced` };
  } catch (e) {
    return { status: 'error', items: [], detail: String((e as Error).message) };
  }
}
