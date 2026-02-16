import { useState } from 'react';
import { useResearchStore } from '../../stores/researchStore';
import { formatCurrency, formatTimeAgo } from '../../utils/formatters';

interface SearchHistoryProps {
  onReSearch: (query: string) => void;
  maxEntries: number;
}

export function SearchHistory({ onReSearch, maxEntries }: SearchHistoryProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { searchHistory, clearHistory } = useResearchStore();

  const visibleHistory = searchHistory.slice(0, maxEntries);

  if (visibleHistory.length === 0) return null;

  return (
    <div className="search-history-wrapper">
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => setIsOpen(!isOpen)}
        title="Search history"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </button>

      {isOpen && (
        <div className="search-history-dropdown">
          <div className="search-history-header">
            <span>Recent Searches</span>
            <button className="btn btn-ghost btn-sm" onClick={clearHistory} style={{ fontSize: 11 }}>Clear</button>
          </div>
          {visibleHistory.map((entry) => (
            <button
              key={entry.id}
              className="search-history-item"
              onClick={() => { onReSearch(entry.query); setIsOpen(false); }}
            >
              <div className="search-history-query">
                {entry.searchType === 'image' ? '📷 ' : ''}{entry.query}
              </div>
              <div className="search-history-meta">
                <span>{entry.resultCount} results</span>
                <span>{formatCurrency(entry.avgPrice)} avg</span>
                <span>{formatTimeAgo(entry.timestamp)}</span>
              </div>
            </button>
          ))}
          {searchHistory.length > maxEntries && (
            <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
              Upgrade to Pro for full history
            </div>
          )}
        </div>
      )}
    </div>
  );
}
