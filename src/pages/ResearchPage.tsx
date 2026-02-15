import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { usePlatformStore } from '../stores/platformStore';
import { useRequireAuth } from '../hooks/useRequireAuth';
import { getPlatform } from '../api/platforms';
import { useFeatureGate } from '../hooks/useSubscription';
import { PaywallGate } from '../components/Subscription/PaywallGate';
import { formatCurrency, formatDate } from '../utils/formatters';
import type { SoldItem } from '../api/platforms';

export default function ResearchPage() {
  const { requireAuth } = useRequireAuth();
  const [tab, setTab] = useState<'keyword' | 'image'>('keyword');
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SoldItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const { getToken } = usePlatformStore();

  const { allowed: imageSearchAllowed } = useFeatureGate('image-search');

  const handleKeywordSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setResults([]);

    try {
      const ebayToken = getToken('ebay');
      if (ebayToken) {
        const adapter = getPlatform('ebay');
        const items = await adapter.searchSold(searchQuery, ebayToken);
        setResults(items);
      }
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const onDropInner = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);

    setIsSearching(true);
    setResults([]);

    try {
      const ebayToken = getToken('ebay');
      if (ebayToken) {
        const adapter = getPlatform('ebay');
        if (adapter.searchByImage) {
          const items = await adapter.searchByImage(URL.createObjectURL(file), ebayToken);
          setResults(items);
        }
      }
    } catch (err) {
      console.error('Image search error:', err);
    } finally {
      setIsSearching(false);
    }
  }, [getToken]);

  const onDrop = requireAuth(onDropInner, 'Sign in to use image search');

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp'] },
    maxFiles: 1,
  });

  // Stats from results
  const avgPrice = results.length > 0 ? results.reduce((s, r) => s + r.price, 0) / results.length : 0;
  const minPrice = results.length > 0 ? Math.min(...results.map((r) => r.price)) : 0;
  const maxPrice = results.length > 0 ? Math.max(...results.map((r) => r.price)) : 0;

  return (
    <div>
      <div className="page-header">
        <h1>Price Research</h1>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'keyword' ? 'active' : ''}`} onClick={() => setTab('keyword')}>
          Keyword Search
        </button>
        <button className={`tab ${tab === 'image' ? 'active' : ''}`} onClick={() => setTab('image')}>
          Image Search
        </button>
      </div>

      {tab === 'keyword' ? (
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="search-input-wrapper" style={{ flex: 1, maxWidth: 'none' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                className="search-input"
                placeholder="Search sold items (e.g. 'Nike Air Max 90 size 10')"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && requireAuth(handleKeywordSearch, 'Sign in to search sold items')()}
              />
            </div>
            <button className="btn btn-primary" onClick={requireAuth(handleKeywordSearch, 'Sign in to search sold items')} disabled={isSearching}>
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
            <>
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
            </>
          )}
        </div>
      )}

      {/* Stats */}
      {results.length > 0 && (
        <div className="stats-grid" style={{ marginBottom: 24 }}>
          <div className="stat-card">
            <div className="stat-label">Avg Sold Price</div>
            <div className="stat-value">{formatCurrency(avgPrice)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Price Range</div>
            <div className="stat-value" style={{ fontSize: 20 }}>
              {formatCurrency(minPrice)} - {formatCurrency(maxPrice)}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Results Found</div>
            <div className="stat-value">{results.length}</div>
          </div>
        </div>
      )}

      {/* Results */}
      {isSearching ? (
        <div className="loading-spinner"><div className="spinner" /></div>
      ) : results.length > 0 ? (
        <div className="comp-grid">
          {results.map((item, i) => (
            <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" className="comp-card" style={{ textDecoration: 'none', color: 'inherit' }}>
              {item.imageUrl && <img src={item.imageUrl} alt={item.title} />}
              <div className="comp-card-body">
                <div className="comp-card-title">{item.title}</div>
                <div className="comp-card-price">{formatCurrency(item.price)}</div>
                {item.soldDate && <div className="comp-card-date">{formatDate(item.soldDate)}</div>}
                <span className={`platform-badge ${item.platform}`} style={{ marginTop: 4 }}>{item.platform}</span>
              </div>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
