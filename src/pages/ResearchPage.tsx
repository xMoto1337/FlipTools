import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
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
      setSearchError('Search failed. Please try again.');
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
        <button className={`tab ${searchType === 'keyword' ? 'active' : ''}`} onClick={() => setSearchType('keyword')}>
          Keyword Search
        </button>
        <button className={`tab ${searchType === 'image' ? 'active' : ''}`} onClick={() => setSearchType('image')}>
          Image Search
        </button>
      </div>

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

      {/* Connection / Error Banner */}
      {searchError && (
        <div className="card" style={{ marginBottom: 24, padding: '14px 20px', border: '1px solid var(--neon-red)', background: 'rgba(255, 0, 60, 0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--neon-red)" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>{searchError}</span>
          </div>
        </div>
      )}

      {!hasConnectedPlatform && !searchError && (
        <div className="card" style={{ marginBottom: 24, padding: '14px 20px', border: '1px solid var(--neon-cyan)', background: 'rgba(0, 255, 255, 0.03)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--neon-cyan)" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>
              Connect a platform in <Link to="/settings" style={{ color: 'var(--neon-cyan)' }}>Settings</Link> to start searching sold items.
            </span>
          </div>
        </div>
      )}

      {/* Market Analysis */}
      {analysis && !isSearching && (
        <div style={{ marginBottom: 24 }}>
          <MarketAnalysis analysis={analysis} />
        </div>
      )}

      {/* Price Trend Chart + Profit Calculator (2-column) */}
      {results.length > 0 && !isSearching && (
        <div className="research-analysis-grid">
          <div className="chart-container">
            <div className="card-header">
              <div className="card-title">Price Trends</div>
            </div>
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

      {/* Results Grid */}
      {isSearching ? (
        <div className="loading-spinner"><div className="spinner" /></div>
      ) : results.length > 0 ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>
              {results.length} Comparable{results.length !== 1 ? 's' : ''} Found
            </h3>
          </div>
          <div className="comp-grid" style={{ marginBottom: 24 }}>
            {results.map((item, i) => (
              <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" className="comp-card" style={{ textDecoration: 'none', color: 'inherit' }}>
                {item.imageUrl && <img src={item.imageUrl} alt={item.title} referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                <div className="comp-card-body">
                  <div className="comp-card-title">{item.title}</div>
                  <div className="comp-card-price">${item.price.toFixed(2)}</div>
                  {item.soldDate && (
                    <div className="comp-card-date">
                      {new Date(item.soldDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
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

      {/* Saved Searches (Pro only) */}
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
    </div>
  );
}
