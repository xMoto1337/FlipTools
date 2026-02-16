import { useEffect, useState } from 'react';
import { researchApi, type SavedSearch } from '../../api/research';
import { useAuthStore } from '../../stores/authStore';
import { formatCurrency, formatTimeAgo } from '../../utils/formatters';

interface SavedSearchesProps {
  onReSearch: (query: string) => void;
  currentQuery: string;
  currentAvgPrice: number;
  currentResultCount: number;
  currentResults: { title: string; price: number; soldDate: string; condition: string; imageUrl: string; url: string; platform: string }[];
}

export function SavedSearches({ onReSearch, currentQuery, currentAvgPrice, currentResultCount, currentResults }: SavedSearchesProps) {
  const { isAuthenticated } = useAuthStore();
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [savingQuery, setSavingQuery] = useState('');

  useEffect(() => {
    if (!isAuthenticated) return;
    loadSaved();
  }, [isAuthenticated]);

  const loadSaved = async () => {
    setIsLoading(true);
    try {
      const data = await researchApi.getSavedSearches();
      setSavedSearches(data);
    } catch (err) {
      console.error('Failed to load saved searches:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!currentQuery.trim()) return;
    try {
      const saved = await researchApi.saveSearch({
        name: savingQuery || currentQuery,
        query: currentQuery,
        search_type: 'keyword',
        last_avg_price: currentAvgPrice,
        last_result_count: currentResultCount,
        result_snapshot: currentResults,
      });
      setSavedSearches([saved, ...savedSearches]);
      setSavingQuery('');
    } catch (err) {
      console.error('Failed to save search:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await researchApi.deleteSavedSearch(id);
      setSavedSearches(savedSearches.filter((s) => s.id !== id));
    } catch (err) {
      console.error('Failed to delete saved search:', err);
    }
  };

  const handleToggleWatch = async (search: SavedSearch) => {
    try {
      const updated = await researchApi.updateSavedSearch(search.id, { is_watching: !search.is_watching });
      setSavedSearches(savedSearches.map((s) => s.id === search.id ? updated : s));
    } catch (err) {
      console.error('Failed to toggle watch:', err);
    }
  };

  const handleReRun = async (search: SavedSearch) => {
    onReSearch(search.query);
    // Price snapshot will be recorded after search completes from the page
  };

  const getPriceChange = (search: SavedSearch): { change: number; direction: 'up' | 'down' | 'same' } | null => {
    if (!search.price_history || search.price_history.length < 2) return null;
    const latest = search.price_history[search.price_history.length - 1];
    const previous = search.price_history[search.price_history.length - 2];
    const change = latest.avgPrice - previous.avgPrice;
    return {
      change,
      direction: change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'same',
    };
  };

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">Saved Searches</div>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{savedSearches.length} saved</span>
      </div>

      {/* Save current search */}
      {currentQuery && currentResultCount > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            className="form-input"
            placeholder={`Save "${currentQuery}"...`}
            value={savingQuery}
            onChange={(e) => setSavingQuery(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary btn-sm" onClick={handleSave}>Save</button>
        </div>
      )}

      {isLoading ? (
        <div className="loading-spinner"><div className="spinner" /></div>
      ) : savedSearches.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No saved searches yet. Search for something and save it!</p>
      ) : (
        <div className="saved-searches-list">
          {savedSearches.map((search) => {
            const priceChange = getPriceChange(search);
            return (
              <div key={search.id} className="saved-search-item">
                <div className="saved-search-info">
                  <div className="saved-search-name">
                    {search.is_watching && <span style={{ color: 'var(--neon-cyan)', marginRight: 4 }}>●</span>}
                    {search.name}
                  </div>
                  <div className="saved-search-meta">
                    <span>{search.last_result_count || 0} results</span>
                    <span>{search.last_avg_price ? formatCurrency(search.last_avg_price) : '--'} avg</span>
                    {priceChange && priceChange.direction !== 'same' && (
                      <span className={`saved-search-price-change ${priceChange.direction}`}>
                        {priceChange.direction === 'up' ? '↑' : '↓'} {formatCurrency(Math.abs(priceChange.change))}
                      </span>
                    )}
                    <span>{formatTimeAgo(search.last_searched_at)}</span>
                  </div>
                </div>
                <div className="saved-search-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleToggleWatch(search)}
                    title={search.is_watching ? 'Stop watching' : 'Watch for changes'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={search.is_watching ? 'var(--neon-cyan)' : 'none'} stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleReRun(search)} title="Re-run search">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                    </svg>
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(search.id)} title="Delete" style={{ color: 'var(--neon-red)' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
