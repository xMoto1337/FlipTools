import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
type FlipSourceId = 'alibaba' | 'aliexpress' | 'dhgate' | 'wish' | 'temu' | 'shein';
interface FlipSource {
  id: string;
  title: string;
  buyPrice: number;
  image: string;
  url: string;
  source: FlipSourceId;
  minOrder: number;
  shippingDesc: string;
  rating?: number;
  totalOrders?: number;
}
// webCompatible: true = works from Vercel server IPs; false = blocked by bot detection, needs desktop app
const FF_SOURCES: { id: FlipSourceId; label: string; color: string; bg: string; border: string; webCompatible: boolean }[] = [
  { id: 'alibaba',    label: 'Alibaba',    color: '#ff6a00', bg: 'rgba(255,106,0,0.15)',   border: 'rgba(255,106,0,0.4)',    webCompatible: true },
  { id: 'dhgate',     label: 'DHgate',     color: 'var(--neon-cyan)', bg: 'rgba(0,180,255,0.12)', border: 'rgba(0,180,255,0.3)', webCompatible: true },
  { id: 'aliexpress', label: 'AliExpress', color: '#ff6600', bg: 'rgba(255,102,0,0.15)',   border: '#ff660055',              webCompatible: false },
  { id: 'wish',       label: 'Wish',       color: '#a855f7', bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.3)',   webCompatible: false },
  { id: 'temu',       label: 'Temu',       color: '#f43f5e', bg: 'rgba(244,63,94,0.12)',  border: 'rgba(244,63,94,0.3)',    webCompatible: false },
  { id: 'shein',      label: 'Shein',      color: '#ff69b4', bg: 'rgba(255,105,180,0.12)', border: 'rgba(255,105,180,0.3)', webCompatible: false },
];
import { useDropzone } from 'react-dropzone';
import { usePlatformStore } from '../stores/platformStore';
import { useResearchStore } from '../stores/researchStore';
import { useRequireAuth } from '../hooks/useRequireAuth';
import { getPlatform, getPlatformIds } from '../api/platforms';
import { useSubscription, useFeatureGate } from '../hooks/useSubscription';
import { PaywallGate } from '../components/Subscription/PaywallGate';
import { MarketAnalysis } from '../components/Research/MarketAnalysis';
import { PriceTrendChart } from '../components/Research/PriceTrendChart';
import { ProfitCalculator } from '../components/Research/ProfitCalculator';
import { SearchHistory } from '../components/Research/SearchHistory';
import { SavedSearches } from '../components/Research/SavedSearches';
import { isTauri } from '../utils/isTauri';
import {
  searchAlibaba as ffAlibaba,
  searchAliExpress as ffAliExpress,
  searchDHgate as ffDHgate,
  searchWish as ffWish,
  searchTemu as ffTemu,
  searchShein as ffShein,
  type FlipSource as FFSourceType,
  type NativeFetcher,
} from '../api/flipFinderSources';

export default function ResearchPage() {
  const { requireAuth } = useRequireAuth();
  const { isConnected, getToken } = usePlatformStore();
  const { isPaid } = useSubscription();
  const { allowed: imageSearchAllowed } = useFeatureGate('image-search');
  const { allowed: trendAllowed } = useFeatureGate('price-trend-chart');
  const { allowed: savedAllowed } = useFeatureGate('saved-searches');
  const { limit: searchLimit } = useFeatureGate('keyword-search');
  const { limit: historyLimit } = useFeatureGate('search-history');

  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const {
    results,
    analysis,
    isSearching,
    searchQuery,
    searchType,
    imagePreview,
    setResults,
    setIsSearching,
    setSearchQuery,
    setSearchType,
    setImagePreview,
    addToHistory,
    computeAnalysis,
    incrementSearchCount,
    getSearchesRemaining,
  } = useResearchStore();

  // Check if any platform is connected
  const hasConnectedPlatform = getPlatformIds().some(
    (id) => isConnected(id) && getToken(id)
  );

  const handleKeywordSearch = async () => {
    if (!searchQuery.trim()) return;

    setSearchError(null);

    // Check if any platform is connected
    if (!hasConnectedPlatform) {
      setSearchError('Connect a platform (like eBay) in Settings to search sold items.');
      return;
    }

    // Check monthly limit for free users
    if (!isPaid && searchLimit) {
      const remaining = getSearchesRemaining(searchLimit);
      if (remaining <= 0) {
        setSearchError('You\'ve reached your monthly search limit. Upgrade to Pro for unlimited searches.');
        return;
      }
    }

    setIsSearching(true);
    setResults([]);
    setHasSearched(true);

    try {
      const allResults: typeof results = [];

      // Search across all connected platforms
      const searchPromises = getPlatformIds().map(async (platformId) => {
        const token = getToken(platformId);
        if (!token || !isConnected(platformId)) return [];
        const adapter = getPlatform(platformId);
        return adapter.searchSold(searchQuery, token);
      });

      const settled = await Promise.allSettled(searchPromises);
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          allResults.push(...result.value);
        }
      }

      setResults(allResults);
      incrementSearchCount();

      // Add to history
      const avgPrice = allResults.length > 0
        ? allResults.reduce((s, r) => s + r.price, 0) / allResults.length
        : 0;
      addToHistory({
        query: searchQuery,
        searchType: 'keyword',
        resultCount: allResults.length,
        avgPrice: Math.round(avgPrice * 100) / 100,
      });
    } catch (err) {
      console.error('Search error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setSearchError(`Search failed: ${msg}`);
    } finally {
      setIsSearching(false);
    }
  };

  // Compute analysis whenever results change
  const prevResultsRef = useResearchStore.getState().results;
  if (results !== prevResultsRef && results.length > 0 && !analysis) {
    computeAnalysis();
  }

  // Run analysis after search
  const runSearchAndAnalyze = async () => {
    await handleKeywordSearch();
    computeAnalysis();
  };

  const handleReSearch = (query: string) => {
    setSearchQuery(query);
    setSearchType('keyword');
    setTimeout(() => {
      useResearchStore.getState().setSearchQuery(query);
      runSearchAndAnalyze();
    }, 0);
  };

  const onDropInner = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setSearchError(null);

    // Check if any platform is connected
    const connected = getPlatformIds().some(
      (id) => isConnected(id) && getToken(id)
    );
    if (!connected) {
      setSearchError('Connect a platform (like eBay) in Settings to use image search.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);

    setIsSearching(true);
    setResults([]);
    setHasSearched(true);

    try {
      const allResults: typeof results = [];

      for (const platformId of getPlatformIds()) {
        const token = getToken(platformId);
        if (!token || !isConnected(platformId)) continue;
        const adapter = getPlatform(platformId);
        if (adapter.searchByImage) {
          try {
            const items = await adapter.searchByImage(URL.createObjectURL(file), token);
            allResults.push(...items);
          } catch {
            // Platform doesn't support image search
          }
        }
      }

      setResults(allResults);
      incrementSearchCount();
      computeAnalysis();

      const avgPrice = allResults.length > 0
        ? allResults.reduce((s, r) => s + r.price, 0) / allResults.length
        : 0;
      addToHistory({
        query: file.name,
        searchType: 'image',
        resultCount: allResults.length,
        avgPrice: Math.round(avgPrice * 100) / 100,
      });
    } catch (err) {
      console.error('Image search error:', err);
      setSearchError('Image search failed. Please try again.');
    } finally {
      setIsSearching(false);
    }
  }, [getToken, isConnected]);

  const onDrop = requireAuth(onDropInner, 'Sign in to use image search');

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp'] },
    maxFiles: 1,
  });

  const searchesRemaining = searchLimit ? getSearchesRemaining(searchLimit) : null;

  // ── Flip Finder state ──────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'comps' | 'flipfinder'>('comps');
  const [ffQuery, setFfQuery] = useState('');
  // On web (non-Tauri), default only web-compatible sources on; desktop-only sources are still toggleable
  const [ffSources, setFfSources] = useState<Record<string, boolean>>(() => {
    const desktop = isTauri();
    return { alibaba: true, dhgate: true, aliexpress: desktop, wish: desktop, temu: desktop, shein: desktop };
  });
  const [ffMaxBuy, setFfMaxBuy] = useState('');
  const [ffMinRoi, setFfMinRoi] = useState('');
  const [ffSort, setFfSort] = useState<'score' | 'roi' | 'profit' | 'demand'>('score');
  const [ffLoading, setFfLoading] = useState(false);
  const [ffWholesale, setFfWholesale] = useState<FlipSource[]>([]);
  const [ffEbaySold, setFfEbaySold] = useState<{ title: string; price: number }[]>([]);
  const [ffError, setFfError] = useState<string | null>(null);
  const [ffSearched, setFfSearched] = useState(false);
  const [ffSourceStatus, setFfSourceStatus] = useState<Record<string, 'ok' | 'empty' | 'error'>>({});
  const [ffSourceErrors, setFfSourceErrors] = useState<Record<string, string>>({});

  const [ffShowDebug, setFfShowDebug] = useState(false);
  const [ffSaved, setFfSaved] = useState<FlipSource[]>(() => {
    try { return JSON.parse(localStorage.getItem('ft_ff_saved') || '[]'); } catch { return []; }
  });
  const ffInputRef = useRef<HTMLInputElement>(null);

  const EBAY_FEE_RATE = 0.1335;
  const EST_SHIP_TO_BUYER = 5.5;

  function calcFlip(src: FlipSource, avgEbay: number) {
    const netRevenue = avgEbay * (1 - EBAY_FEE_RATE) - EST_SHIP_TO_BUYER;
    const profit = netRevenue - src.buyPrice;
    const roi = src.buyPrice > 0 ? (profit / src.buyPrice) * 100 : 0;
    const margin = avgEbay > 0 ? (profit / avgEbay) * 100 : 0;
    const ebayFees = avgEbay * EBAY_FEE_RATE;
    return { profit, roi, margin, ebayFees, netRevenue };
  }

  function calcScore(src: FlipSource, avgEbay: number, compCount: number) {
    const { roi, margin } = calcFlip(src, avgEbay);
    const roiPts = Math.min(Math.max(roi, 0), 600) / 600 * 40;
    const demandPts = Math.min(compCount, 60) / 60 * 25;
    const marginPts = Math.min(Math.max(margin, 0), 65) / 65 * 20;
    const accessPts = src.buyPrice < 10 ? 15 : src.buyPrice < 25 ? 11 : src.buyPrice < 50 ? 7 : 3;
    return Math.round(roiPts + demandPts + marginPts + accessPts);
  }

  // Average eBay sold price for the current query
  const avgEbayPrice = useMemo(() => {
    if (ffEbaySold.length === 0) return 0;
    return ffEbaySold.reduce((s, i) => s + i.price, 0) / ffEbaySold.length;
  }, [ffEbaySold]);

  // Enrich + filter + sort wholesale results
  const ffResults = useMemo(() => {
    const maxBuy = parseFloat(ffMaxBuy) || Infinity;
    const minRoi = parseFloat(ffMinRoi) || 0;

    return ffWholesale
      .filter((s) => s.buyPrice <= maxBuy)
      .map((s) => {
        const flip = calcFlip(s, avgEbayPrice);
        const score = calcScore(s, avgEbayPrice, ffEbaySold.length);
        return { ...s, ...flip, score, compCount: ffEbaySold.length };
      })
      .filter((s) => s.roi >= minRoi)
      .sort((a, b) => {
        if (ffSort === 'roi') return b.roi - a.roi;
        if (ffSort === 'profit') return b.profit - a.profit;
        if (ffSort === 'demand') return b.compCount - a.compCount;
        return b.score - a.score;
      });
  }, [ffWholesale, ffEbaySold, avgEbayPrice, ffMaxBuy, ffMinRoi, ffSort]);

  const handleFlipSearch = async () => {
    const q = ffQuery.trim();
    if (!q) return;

    setFfError(null);
    setFfLoading(true);
    setFfSearched(true);
    setFfWholesale([]);
    setFfEbaySold([]);
    setFfSourceStatus({});
    setFfSourceErrors({});
    setFfShowDebug(false);

    const activeSources = Object.entries(ffSources)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(',') || 'all';

    // eBay comps always runs in parallel regardless of wholesale path
    const ebayCompsPromise = (async () => {
      if (!hasConnectedPlatform) return [];
      const all: { title: string; price: number }[] = [];
      for (const pid of getPlatformIds()) {
        const token = getToken(pid);
        if (!token || !isConnected(pid)) continue;
        const items = await getPlatform(pid).searchSold(q, token);
        all.push(...items.map((i) => ({ title: i.title, price: i.price })));
      }
      return all;
    })();

    try {
      const newStatus: Record<string, 'ok' | 'empty' | 'error'> = {};
      const newErrors: Record<string, string> = {};
      let wItems: FlipSource[] = [];

      if (isTauri()) {
        // ── Desktop path: native HTTP from user's own residential IP ──────
        const { invoke } = await import('@tauri-apps/api/core');

        const fetcher: NativeFetcher = (url, opts) =>
          invoke<{ status: number; content_type: string; body: string }>('native_fetch', {
            url,
            method: opts?.method ?? 'GET',
            headers: opts?.headers ?? {},
            body: opts?.body ?? null,
          });

        type SourceEntry = [string, () => Promise<{ status: string; items: FFSourceType[]; detail?: string }>];
        const sourceMap: SourceEntry[] = (
          [
            ['alibaba',    () => ffAlibaba(q, fetcher)],
            ['aliexpress', () => ffAliExpress(q, fetcher)],
            ['dhgate',     () => ffDHgate(q, fetcher)],
            ['wish',       () => ffWish(q, fetcher)],
            ['temu',       () => ffTemu(q, fetcher)],
            ['shein',      () => ffShein(q, fetcher)],
          ] as SourceEntry[]
        ).filter(([id]) => ffSources[id]);

        const results = await Promise.allSettled(sourceMap.map(([, fn]) => fn()));
        for (let i = 0; i < results.length; i++) {
          const name = sourceMap[i][0];
          const r = results[i];
          if (r.status === 'fulfilled') {
            wItems.push(...(r.value.items as FlipSource[]));
            newStatus[name] = r.value.status as 'ok' | 'empty' | 'error';
            if (r.value.status !== 'ok' && r.value.detail) newErrors[name] = r.value.detail;
          } else {
            newStatus[name] = 'error';
            newErrors[name] = String(r.reason?.message ?? r.reason);
          }
        }
      } else {
        // ── Web path: Vercel serverless function ──────────────────────────
        const rawRes = await fetch(
          `/api/flip-finder?q=${encodeURIComponent(q)}&source=${activeSources}`
        );
        if (!rawRes.ok) {
          const errText = await rawRes.text().catch(() => `HTTP ${rawRes.status}`);
          throw new Error(`Search API error (${rawRes.status}): ${errText.slice(0, 300)}`);
        }
        const apiRes = await rawRes.json() as {
          results?: FlipSource[];
          sourceStatus?: Record<string, string>;
          sourceErrors?: Record<string, string>;
        };

        wItems = apiRes.results ?? [];
        for (const [src, st] of Object.entries(apiRes.sourceStatus ?? {})) {
          newStatus[src] = st as 'ok' | 'empty' | 'error';
        }
        Object.assign(newErrors, apiRes.sourceErrors ?? {});
      }

      wItems.sort((a, b) => a.buyPrice - b.buyPrice);
      setFfWholesale(wItems);
      setFfSourceStatus(newStatus);
      setFfSourceErrors(newErrors);

      const ebayComps = await ebayCompsPromise.catch(() => []);
      setFfEbaySold(ebayComps as { title: string; price: number }[]);
    } catch (err) {
      console.error('[FlipFinder]', err);
      const msg = err instanceof Error ? err.message : String(err);
      setFfError(`Search failed: ${msg}`);
    } finally {
      setFfLoading(false);
    }
  };

  const toggleSaved = (src: FlipSource) => {
    setFfSaved((prev) => {
      const exists = prev.some((s) => s.id === src.id);
      const next = exists ? prev.filter((s) => s.id !== src.id) : [src, ...prev];
      localStorage.setItem('ft_ff_saved', JSON.stringify(next));
      return next;
    });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeTab === 'flipfinder') ffInputRef.current?.focus(); }, [activeTab]);

  function scoreLabel(score: number): { label: string; color: string } {
    if (score >= 75) return { label: 'Hot', color: 'var(--neon-green)' };
    if (score >= 55) return { label: 'Good', color: 'var(--neon-cyan)' };
    if (score >= 35) return { label: 'Fair', color: 'var(--neon-orange)' };
    return { label: 'Weak', color: 'var(--text-muted)' };
  }

  function formatPct(n: number) { return `${n >= 0 ? '+' : ''}${Math.round(n)}%`; }
  function fmt(n: number) { return `$${n.toFixed(2)}`; }

  return (
    <div>
      <div className="page-header">
        <h1>Product Research</h1>
        {!isPaid && searchesRemaining !== null && (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {searchesRemaining} searches left this month
          </span>
        )}
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === 'comps' && searchType === 'keyword' ? 'active' : ''}`} onClick={() => { setActiveTab('comps'); setSearchType('keyword'); }}>
          Keyword Search
        </button>
        <button className={`tab ${activeTab === 'comps' && searchType === 'image' ? 'active' : ''}`} onClick={() => { setActiveTab('comps'); setSearchType('image'); }}>
          Image Search
        </button>
        <button className={`tab ${activeTab === 'flipfinder' ? 'active' : ''}`} onClick={() => setActiveTab('flipfinder')} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          Flip Finder
        </button>
      </div>

      {/* ── Comps tab content ─────────────────────────────────────────────── */}
      {activeTab === 'comps' && (
        <>
          {searchType === 'keyword' ? (
            <div className="card" style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div className="search-input-wrapper" style={{ flex: 1, maxWidth: 'none' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input
                    className="search-input"
                    placeholder="Search sold items (e.g. 'Nike Air Max 90 size 10')"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && requireAuth(runSearchAndAnalyze, 'Sign in to search sold items')()}
                  />
                </div>
                <SearchHistory
                  onReSearch={handleReSearch}
                  maxEntries={isPaid ? 50 : (historyLimit || 5)}
                />
                <button
                  className="btn btn-primary"
                  onClick={requireAuth(runSearchAndAnalyze, 'Sign in to search sold items')}
                  disabled={isSearching || (!isPaid && searchesRemaining !== null && searchesRemaining <= 0)}
                >
                  {isSearching ? 'Searching...' : 'Search'}
                </button>
              </div>
            </div>
          ) : (
            <div className="card" style={{ marginBottom: 24 }}>
              {!imageSearchAllowed ? (
                <PaywallGate feature="Unlimited image searches">
                  <div {...getRootProps()} className={`image-uploader ${isDragActive ? 'drag-active' : ''}`}>
                    <input {...getInputProps()} />
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    <p>Drag & drop an image or <span className="highlight">click to browse</span></p>
                  </div>
                </PaywallGate>
              ) : (
                <div {...getRootProps()} className={`image-uploader ${isDragActive ? 'drag-active' : ''}`}>
                  <input {...getInputProps()} />
                  {imagePreview ? (
                    <img src={imagePreview} alt="Preview" style={{ maxWidth: 200, maxHeight: 200, borderRadius: 8 }} />
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                      <p>Drag & drop an image or <span className="highlight">click to browse</span></p>
                      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Supports PNG, JPG, WEBP</p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {searchError && (
            <div className="card" style={{ marginBottom: 24, padding: '14px 20px', border: '1px solid var(--neon-red)', background: 'rgba(255, 0, 60, 0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--neon-red)" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>{searchError}</span>
              </div>
            </div>
          )}

          {!hasConnectedPlatform && !searchError && (
            <div className="card" style={{ marginBottom: 24, padding: '14px 20px', border: '1px solid var(--neon-cyan)', background: 'rgba(0, 255, 255, 0.03)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--neon-cyan)" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>
                  Connect a platform in <Link to="/settings" style={{ color: 'var(--neon-cyan)' }}>Settings</Link> to start searching sold items.
                </span>
              </div>
            </div>
          )}

          {analysis && !isSearching && (
            <div style={{ marginBottom: 24 }}><MarketAnalysis analysis={analysis} /></div>
          )}

          {results.length > 0 && !isSearching && (
            <div className="research-analysis-grid">
              <div className="chart-container">
                <div className="card-header"><div className="card-title">Price Trends</div></div>
                {!trendAllowed ? (
                  <PaywallGate feature="Price Trend Charts">
                    <div style={{ height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                      <p>Upgrade to see price trends over time</p>
                    </div>
                  </PaywallGate>
                ) : (
                  <PriceTrendChart results={results} analysis={analysis} isLoading={isSearching} />
                )}
              </div>
              <ProfitCalculator avgPrice={analysis?.avgPrice || 0} />
            </div>
          )}

          {isSearching ? (
            <div className="loading-spinner"><div className="spinner" /></div>
          ) : results.length > 0 ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600 }}>{results.length} Comparable{results.length !== 1 ? 's' : ''} Found</h3>
              </div>
              <div className="comp-grid" style={{ marginBottom: 24 }}>
                {results.map((item, i) => (
                  <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" className="comp-card" style={{ textDecoration: 'none', color: 'inherit' }}>
                    {item.imageUrl && <img src={item.imageUrl} alt={item.title} referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                    <div className="comp-card-body">
                      <div className="comp-card-title">{item.title}</div>
                      <div className="comp-card-price">${item.price.toFixed(2)}</div>
                      {item.soldDate && (
                        <div className="comp-card-date">{new Date(item.soldDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                      )}
                      <span className={`platform-badge ${item.platform}`} style={{ marginTop: 4 }}>{item.platform}</span>
                    </div>
                  </a>
                ))}
              </div>
            </>
          ) : hasSearched && !searchError ? (
            <div className="card" style={{ marginBottom: 24, padding: '32px 20px', textAlign: 'center' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" style={{ marginBottom: 12 }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 4 }}>No results found for "{searchQuery}"</p>
              <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Try a different search term or check your spelling</p>
            </div>
          ) : null}

          {!savedAllowed ? (
            <PaywallGate feature="Saved Searches & Watchlist">
              <div className="card" style={{ marginBottom: 24 }}>
                <div className="card-title">Saved Searches</div>
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Save and track your product research over time</p>
              </div>
            </PaywallGate>
          ) : (
            <SavedSearches
              onReSearch={handleReSearch}
              currentQuery={searchQuery}
              currentAvgPrice={analysis?.avgPrice || 0}
              currentResultCount={results.length}
              currentResults={results}
            />
          )}
        </>
      )}

      {/* ── Flip Finder tab content ────────────────────────────────────────── */}
      {activeTab === 'flipfinder' && (
        <div>
          {/* Search bar */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <div className="search-input-wrapper" style={{ flex: 1, maxWidth: 'none' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input
                  ref={ffInputRef}
                  className="search-input"
                  placeholder="Search a product to find flip opportunities… (e.g. 'led strip lights')"
                  value={ffQuery}
                  onChange={(e) => setFfQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleFlipSearch()}
                />
              </div>
              <button className="btn btn-primary" onClick={handleFlipSearch} disabled={ffLoading} style={{ minWidth: 100 }}>
                {ffLoading ? 'Searching…' : 'Find Flips'}
              </button>
            </div>

            {/* Source toggles */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Sources</span>
              {FF_SOURCES.map((src) => {
                const on = ffSources[src.id];
                const webOnly = !isTauri() && !src.webCompatible;
                return (
                  <button key={src.id} onClick={() => setFfSources((p) => ({ ...p, [src.id]: !p[src.id] }))}
                    title={webOnly ? 'May be blocked on web — works reliably in the desktop app' : undefined}
                    style={{
                      padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid',
                      background: on ? src.bg : 'transparent',
                      borderColor: on ? src.border : 'var(--border-color)',
                      color: on ? src.color : 'var(--text-muted)',
                      transition: 'all 0.15s',
                      display: 'flex', alignItems: 'center', gap: 5,
                      opacity: webOnly && !on ? 0.5 : 1,
                    }}
                  >
                    {on && <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M20 6L9 17l-5-5"/></svg>}
                    {src.label}
                    {webOnly && (
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.6 }}>
                        <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                      </svg>
                    )}
                  </button>
                );
              })}
              {!isTauri() && (
                <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 2 }}>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: 'middle', marginRight: 3 }}><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                  = desktop app only
                </span>
              )}
            </div>

            {/* Filters row */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Max Buy */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Max Buy Price</span>
                <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, overflow: 'hidden', height: 34 }}>
                  <span style={{ padding: '0 8px', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, borderRight: '1px solid var(--border-color)', height: '100%', display: 'flex', alignItems: 'center' }}>$</span>
                  <input
                    type="number" min="0" placeholder="Any"
                    value={ffMaxBuy}
                    onChange={(e) => setFfMaxBuy(e.target.value)}
                    style={{ width: 72, padding: '0 10px', background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 13 }}
                  />
                </div>
              </div>

              {/* Min ROI */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Min ROI</span>
                <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8, overflow: 'hidden', height: 34 }}>
                  <input
                    type="number" min="0" placeholder="0"
                    value={ffMinRoi}
                    onChange={(e) => setFfMinRoi(e.target.value)}
                    style={{ width: 72, padding: '0 0 0 10px', background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 13 }}
                  />
                  <span style={{ padding: '0 8px', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, borderLeft: '1px solid var(--border-color)', height: '100%', display: 'flex', alignItems: 'center' }}>%</span>
                </div>
              </div>

              {/* Sort */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sort By</span>
                <select
                  value={ffSort}
                  onChange={(e) => setFfSort(e.target.value as typeof ffSort)}
                  style={{ height: 34, padding: '0 10px', borderRadius: 8, background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer', outline: 'none' }}
                >
                  <option value="score">Best Score</option>
                  <option value="roi">Best ROI</option>
                  <option value="profit">Best Profit</option>
                  <option value="demand">Most Demand</option>
                </select>
              </div>
            </div>
          </div>

          {/* eBay warning when not connected */}
          {!hasConnectedPlatform && (
            <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, border: '1px solid var(--neon-orange)', background: 'rgba(255,149,0,0.07)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--neon-orange)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                <Link to="/settings" style={{ color: 'var(--neon-orange)' }}>Connect eBay</Link> to see resale price comparisons and ROI estimates.
              </span>
            </div>
          )}

          {/* Error */}
          {ffError && (
            <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, border: '1px solid var(--neon-red)', background: 'rgba(255,0,60,0.06)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--neon-red)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{ffError}</span>
            </div>
          )}

          {/* Loading */}
          {ffLoading && (
            <div style={{ padding: '48px 0', textAlign: 'center' }}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Scanning sources &amp; pulling eBay comps…</div>
            </div>
          )}

          {/* Results header */}
          {!ffLoading && ffSearched && (
            <>
              {ffResults.length > 0 ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>{ffResults.length} flip opportunit{ffResults.length !== 1 ? 'ies' : 'y'}</span>
                      {avgEbayPrice > 0 && (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 10 }}>
                          avg eBay sold: <span style={{ color: 'var(--neon-green)' }}>${avgEbayPrice.toFixed(2)}</span>
                          {ffEbaySold.length > 0 && <span> ({ffEbaySold.length} comps)</span>}
                        </span>
                      )}
                    </div>
                    {ffSaved.length > 0 && (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ffSaved.length} saved</span>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                    {ffResults.map((item) => {
                      const sl = scoreLabel(item.score);
                      const isSaved = ffSaved.some((s) => s.id === item.id);
                      const hasEbay = avgEbayPrice > 0;
                      return (
                        <div key={item.id} className="ff-card" style={{
                          background: 'var(--bg-card)',
                          border: item.score >= 75
                            ? '1px solid rgba(0,255,65,0.35)'
                            : item.score >= 55
                              ? '1px solid rgba(0,255,255,0.2)'
                              : '1px solid var(--border-color)',
                          borderRadius: 10,
                          padding: 14,
                          display: 'flex',
                          gap: 14,
                          transition: 'border-color 0.15s',
                        }}>
                          {/* Thumbnail */}
                          <div style={{ flexShrink: 0, width: 72, height: 72, borderRadius: 8, background: 'var(--bg-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                            {item.image && (
                              <img src={item.image} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} />
                            )}
                          </div>

                          {/* Main content */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {/* Title row */}
                            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>{item.title}</div>
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                  {(() => { const s = FF_SOURCES.find((x) => x.id === item.source); return s ? (
                                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.04em', background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
                                      {s.label}
                                    </span>
                                  ) : null; })()}
                                  {item.minOrder > 1 && (
                                    <span style={{ fontSize: 10, color: 'var(--text-muted)', padding: '2px 6px', borderRadius: 10, border: '1px solid var(--border-color)' }}>
                                      Min {item.minOrder}
                                    </span>
                                  )}
                                  {item.totalOrders && item.totalOrders > 0 ? (
                                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.totalOrders.toLocaleString()} orders</span>
                                  ) : null}
                                  {item.rating && item.rating > 0 ? (
                                    <span style={{ fontSize: 10, color: 'var(--neon-yellow)', display: 'flex', alignItems: 'center', gap: 2 }}>
                                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                                      {item.rating.toFixed(1)}
                                    </span>
                                  ) : null}
                                </div>
                              </div>

                              {/* Score badge */}
                              <div style={{ flexShrink: 0, textAlign: 'center', padding: '4px 10px', borderRadius: 8, background: 'var(--bg-hover)', border: `1px solid ${sl.color}33`, minWidth: 52 }}>
                                <div style={{ fontSize: 18, fontWeight: 800, color: sl.color, lineHeight: 1 }}>{item.score}</div>
                                <div style={{ fontSize: 9, fontWeight: 700, color: sl.color, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 1 }}>{sl.label}</div>
                              </div>
                            </div>

                            {/* Numbers row */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '6px 14px', marginBottom: 10 }}>
                              <div className="ff-stat">
                                <div className="ff-stat-label">Buy Price</div>
                                <div className="ff-stat-value" style={{ color: 'var(--neon-orange)' }}>{fmt(item.buyPrice)}</div>
                              </div>
                              {hasEbay ? (
                                <>
                                  <div className="ff-stat">
                                    <div className="ff-stat-label">Avg eBay Sold</div>
                                    <div className="ff-stat-value" style={{ color: 'var(--neon-green)' }}>{fmt(avgEbayPrice)}</div>
                                  </div>
                                  <div className="ff-stat">
                                    <div className="ff-stat-label">Est. Profit</div>
                                    <div className="ff-stat-value" style={{ color: item.profit >= 0 ? 'var(--neon-green)' : 'var(--neon-red)' }}>{fmt(item.profit)}</div>
                                  </div>
                                  <div className="ff-stat">
                                    <div className="ff-stat-label">ROI</div>
                                    <div className="ff-stat-value" style={{ color: item.roi >= 100 ? 'var(--neon-green)' : item.roi >= 0 ? 'var(--neon-cyan)' : 'var(--neon-red)' }}>
                                      {formatPct(item.roi)}
                                    </div>
                                  </div>
                                  <div className="ff-stat">
                                    <div className="ff-stat-label">Margin</div>
                                    <div className="ff-stat-value" style={{ color: 'var(--text-secondary)' }}>{formatPct(item.margin)}</div>
                                  </div>
                                  <div className="ff-stat">
                                    <div className="ff-stat-label">eBay Fees</div>
                                    <div className="ff-stat-value" style={{ color: 'var(--text-muted)' }}>~{fmt(item.ebayFees)}</div>
                                  </div>
                                  <div className="ff-stat">
                                    <div className="ff-stat-label">eBay Comps</div>
                                    <div className="ff-stat-value" style={{ color: 'var(--text-secondary)' }}>{item.compCount}</div>
                                  </div>
                                </>
                              ) : (
                                <div className="ff-stat" style={{ gridColumn: 'span 3' }}>
                                  <div className="ff-stat-label">Resale price</div>
                                  <div className="ff-stat-value" style={{ color: 'var(--text-muted)', fontSize: 11 }}>Connect eBay to see</div>
                                </div>
                              )}
                            </div>

                            {/* Demand bar (only when we have eBay data) */}
                            {hasEbay && item.compCount > 0 && (
                              <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Demand</span>
                                <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--bg-hover)', overflow: 'hidden' }}>
                                  <div style={{
                                    height: '100%', borderRadius: 2,
                                    width: `${Math.min(item.compCount / 60 * 100, 100)}%`,
                                    background: item.compCount >= 40 ? 'var(--neon-green)' : item.compCount >= 15 ? 'var(--neon-cyan)' : 'var(--neon-orange)',
                                  }} />
                                </div>
                                <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                  {item.compCount < 10 ? 'Low' : item.compCount < 25 ? 'Medium' : item.compCount < 50 ? 'High' : 'Very High'}
                                </span>
                              </div>
                            )}

                            {/* Shipping note */}
                            {item.shippingDesc && (
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                                Source shipping: {item.shippingDesc} &nbsp;·&nbsp; Est. buyer ship: ~{fmt(EST_SHIP_TO_BUYER)} (included in calc)
                              </div>
                            )}

                            {/* Action buttons */}
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <a href={item.url} target="_blank" rel="noopener noreferrer"
                                style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, background: 'var(--bg-hover)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5 }}
                              >
                                View on {FF_SOURCES.find((x) => x.id === item.source)?.label ?? item.source}
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                              </a>
                              <button
                                onClick={() => { setActiveTab('comps'); setSearchType('keyword'); setSearchQuery(ffQuery); setTimeout(() => requireAuth(runSearchAndAnalyze, 'Sign in to research')(), 0); }}
                                style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, background: 'var(--bg-hover)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', cursor: 'pointer' }}
                              >
                                Research on eBay
                              </button>
                              <button
                                onClick={() => toggleSaved(item)}
                                style={{
                                  fontSize: 12, padding: '4px 12px', borderRadius: 6, cursor: 'pointer', border: '1px solid',
                                  background: isSaved ? 'rgba(0,255,65,0.1)' : 'var(--bg-hover)',
                                  borderColor: isSaved ? 'var(--neon-green)' : 'var(--border-color)',
                                  color: isSaved ? 'var(--neon-green)' : 'var(--text-muted)',
                                  display: 'flex', alignItems: 'center', gap: 5,
                                }}
                              >
                                {isSaved ? (
                                  <><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> Saved</>
                                ) : (
                                  <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> Save</>
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : ffWholesale.length === 0 ? (
                /* No buy-side results */
                <div className="card" style={{ padding: '32px 20px', marginBottom: 24 }}>
                  {/* Status badges */}
                  {Object.keys(ffSourceStatus).length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                      {Object.entries(ffSourceStatus).map(([src, st]) => (
                        <span key={src} style={{
                          fontSize: 11, padding: '3px 10px', borderRadius: 12, fontWeight: 600,
                          background: st === 'ok' ? 'rgba(0,255,65,0.1)' : st === 'error' ? 'rgba(255,60,60,0.08)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${st === 'ok' ? 'rgba(0,255,65,0.35)' : st === 'error' ? 'rgba(255,80,80,0.3)' : 'var(--border-color)'}`,
                          color: st === 'ok' ? 'var(--neon-green)' : st === 'error' ? '#ff6b6b' : 'var(--text-muted)',
                        }}>
                          {src} {st === 'ok' ? '✓' : st === 'error' ? '✗' : '—'}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Desktop app nudge when web sources are blocked */}
                  {!isTauri() && Object.values(ffSourceStatus).some(s => s === 'error') && (
                    <div style={{ padding: '12px 14px', borderRadius: 8, background: 'rgba(0,180,255,0.07)', border: '1px solid rgba(0,180,255,0.25)', marginBottom: 16, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                      <span style={{ color: 'var(--neon-cyan)', fontWeight: 600 }}>Tip: </span>
                      Wholesale sites block requests from server IPs. The <strong style={{ color: 'var(--text-primary)' }}>desktop app</strong> routes searches through your own internet connection — no restrictions, no fees.
                    </div>
                  )}

                  {/* Debug toggle */}
                  {Object.keys(ffSourceErrors).length > 0 && (
                    <div>
                      <button
                        onClick={() => setFfShowDebug(v => !v)}
                        style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', marginBottom: 8 }}
                      >
                        {ffShowDebug ? 'Hide' : 'Show'} error details ({Object.keys(ffSourceErrors).length} sources)
                      </button>
                      {ffShowDebug && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {Object.entries(ffSourceErrors).map(([src, detail]) => (
                            <div key={src} style={{ padding: '8px 10px', borderRadius: 6, background: 'var(--bg-hover)', border: '1px solid var(--border-color)', fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', color: 'var(--text-secondary)' }}>
                              <span style={{ color: '#ff6b6b', fontWeight: 700 }}>{src}:</span> {detail}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {Object.keys(ffSourceStatus).length === 0 && (
                    <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>No wholesale results found for "{ffQuery}" — try a broader keyword.</p>
                  )}
                </div>
              ) : (
                /* Wholesale found but all filtered out */
                <div className="card" style={{ padding: '32px 20px', textAlign: 'center', marginBottom: 24 }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>All {ffWholesale.length} results filtered out — try lowering your Min ROI or raising Max Buy Price.</p>
                </div>
              )}
            </>
          )}

          {/* Empty state before first search */}
          {!ffLoading && !ffSearched && (
            <div className="card" style={{ padding: '52px 20px', textAlign: 'center', marginBottom: 24, border: '1px dashed var(--border-color)' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.2" style={{ marginBottom: 16 }}>
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Find products to flip for profit</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 400, margin: '0 auto 20px' }}>
                Search any product keyword. Flip Finder scans wholesale sources (Alibaba, DHgate{isTauri() ? ', AliExpress, Temu, Shein, Wish' : ''}), then cross-references eBay sold comps to estimate your ROI.
                {!isTauri() && <span style={{ display: 'block', marginTop: 6, color: 'var(--text-muted)', fontSize: 11 }}>The desktop app unlocks all sources — some wholesale sites block server IPs.</span>}
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                {['led strip lights', 'phone stand', 'bluetooth speaker', 'fidget toy', 'cable organizer'].map((ex) => (
                  <button key={ex} onClick={() => { setFfQuery(ex); setTimeout(handleFlipSearch, 50); }}
                    style={{ fontSize: 12, padding: '5px 12px', borderRadius: 20, background: 'var(--bg-hover)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', cursor: 'pointer' }}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Saved items list */}
          {ffSaved.length > 0 && !ffLoading && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="var(--neon-green)"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                Saved Products ({ffSaved.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {ffSaved.map((s) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 6, background: 'var(--bg-hover)', flexShrink: 0, overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                      {s.image && <img src={s.image} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmt(s.buyPrice)} on {FF_SOURCES.find((x) => x.id === s.source)?.label ?? s.source}</div>
                    </div>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--neon-cyan)', textDecoration: 'none', flexShrink: 0 }}>View ↗</a>
                    <button onClick={() => toggleSaved(s)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, flexShrink: 0 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
