import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useListingStore } from '../stores/listingStore';
import { useRequireAuth } from '../hooks/useRequireAuth';
import { listingsApi } from '../api/listings';
import type { ListingInput } from '../api/listings';
import { formatCurrency, formatTimeAgo } from '../utils/formatters';

export default function ListingsPage() {
  const { isAuthenticated } = useAuthStore();
  const { requireAuth } = useRequireAuth();
  const {
    selectedIds,
    viewMode,
    searchQuery,
    statusFilter,
    isLoading,
    setListings,
    addListing,
    removeListings,
    toggleSelect,
    selectAll,
    clearSelection,
    setViewMode,
    setSearchQuery,
    setStatusFilter,
    setLoading,
    filteredListings,
  } = useListingStore();

  const location = useLocation();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [editorData, setEditorData] = useState<ListingInput>({
    title: '',
    description: '',
    price: 0,
    category: '',
    condition: 'good',
    images: [],
    tags: [],
  });

  const syncAndLoad = async (force = false) => {
    if (!isAuthenticated) return;
    setSyncError('');

    // Sync platform listings first
    setIsSyncing(true);
    try {
      const result = await listingsApi.syncPlatformListings(force);
      if (result.errors.length > 0) {
        setSyncError(result.errors.join('; '));
      }
    } catch (err) {
      console.error('Listing sync error:', err);
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setIsSyncing(false);
    }

    // Then load from Supabase
    setLoading(true);
    try {
      const data = await listingsApi.getAll();
      setListings(data);
    } catch (err) {
      console.error('Failed to load listings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    syncAndLoad();
  }, [isAuthenticated, location.key]);

  const handleCreate = async () => {
    try {
      const listing = await listingsApi.create(editorData);
      addListing(listing);
      setShowEditor(false);
      setEditorData({ title: '', description: '', price: 0, category: '', condition: 'good', images: [], tags: [] });
    } catch (err) {
      console.error('Failed to create listing:', err);
    }
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    try {
      await listingsApi.bulkDelete(ids);
      removeListings(ids);
      clearSelection();
    } catch (err) {
      console.error('Bulk delete failed:', err);
    }
  };

  const filtered = filteredListings();

  return (
    <div>
      <div className="page-header">
        <h1>Listings</h1>
        <div className="page-header-actions">
          {isSyncing ? (
            <span style={{ fontSize: 12, color: 'var(--neon-cyan)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <div className="spinner" style={{ width: 14, height: 14 }} />
              Syncing...
            </span>
          ) : (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => syncAndLoad(true)}
              disabled={isSyncing || isLoading}
              title="Re-sync listings from connected platforms"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
              </svg>
            </button>
          )}
          <button className="btn btn-primary" onClick={requireAuth(() => setShowEditor(true), 'Sign in to create listings')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Listing
          </button>
        </div>
      </div>

      {syncError && (
        <div style={{
          padding: '10px 16px',
          marginBottom: 16,
          borderRadius: 8,
          background: 'rgba(255,59,48,0.1)',
          border: '1px solid var(--neon-red)',
          color: 'var(--neon-red)',
          fontSize: 13,
        }}>
          Sync issue: {syncError}
        </div>
      )}

      <div className="toolbar">
        <div className="toolbar-left">
          <div className="search-input-wrapper">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              type="text"
              className="search-input"
              placeholder="Search listings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="sold">Sold</option>
            <option value="ended">Ended</option>
          </select>
        </div>
        <div className="toolbar-right">
          <div className="view-toggle">
            <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            </button>
            <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </button>
          </div>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="bulk-actions">
          <span className="bulk-count">{selectedIds.size} selected</span>
          <button className="btn btn-sm btn-secondary" onClick={selectAll}>Select All</button>
          <button className="btn btn-sm btn-secondary" onClick={clearSelection}>Clear</button>
          <button className="btn btn-sm btn-danger" onClick={handleBulkDelete}>Delete Selected</button>
        </div>
      )}

      {isLoading ? (
        <div className="loading-spinner"><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>
          <h3>No listings yet</h3>
          <p>Create your first listing to get started with cross-listing</p>
          <button className="btn btn-primary" onClick={requireAuth(() => setShowEditor(true), 'Sign in to create listings')}>Create Listing</button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="listing-grid">
          {filtered.map((listing) => (
            <div
              key={listing.id}
              className={`listing-card ${selectedIds.has(listing.id) ? 'selected' : ''}`}
              onClick={() => toggleSelect(listing.id)}
            >
              {listing.images[0] ? (
                <img src={listing.images[0]} alt={listing.title} className="listing-image" />
              ) : (
                <div className="listing-image-placeholder">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                </div>
              )}
              <div className="listing-body">
                <div className="listing-title">{listing.title}</div>
                <div className="listing-price">{formatCurrency(listing.price || 0)}</div>
                <div className="listing-meta">
                  <span className={`status-badge ${listing.status}`}>
                    <span className="status-dot" />
                    {listing.status}
                  </span>
                  <span>{formatTimeAgo(listing.created_at)}</span>
                </div>
                <div className="listing-platforms">
                  {Object.keys(listing.platforms).map((p) => (
                    <span key={p} className={`platform-badge ${p}`}>{p}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th className="checkbox-cell">
                <input type="checkbox" className="table-checkbox" onChange={() => selectedIds.size === filtered.length ? clearSelection() : selectAll()} checked={selectedIds.size === filtered.length && filtered.length > 0} />
              </th>
              <th>Title</th>
              <th>Price</th>
              <th>Status</th>
              <th>Platforms</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((listing) => (
              <tr key={listing.id}>
                <td className="checkbox-cell">
                  <input type="checkbox" className="table-checkbox" checked={selectedIds.has(listing.id)} onChange={() => toggleSelect(listing.id)} />
                </td>
                <td>{listing.title}</td>
                <td>{formatCurrency(listing.price || 0)}</td>
                <td><span className={`status-badge ${listing.status}`}><span className="status-dot" />{listing.status}</span></td>
                <td>
                  <div className="listing-platforms">
                    {Object.keys(listing.platforms).map((p) => (
                      <span key={p} className={`platform-badge ${p}`}>{p}</span>
                    ))}
                  </div>
                </td>
                <td style={{ color: 'var(--text-muted)' }}>{formatTimeAgo(listing.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* New Listing Modal */}
      {showEditor && (
        <div className="modal-overlay" onClick={() => setShowEditor(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">New Listing</div>
              <button className="modal-close" onClick={() => setShowEditor(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Title</label>
                <input className="form-input" value={editorData.title} onChange={(e) => setEditorData({ ...editorData, title: e.target.value })} placeholder="Item title" />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea className="form-input form-textarea" value={editorData.description} onChange={(e) => setEditorData({ ...editorData, description: e.target.value })} placeholder="Item description" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Price ($)</label>
                  <input type="number" className="form-input" value={editorData.price || ''} onChange={(e) => setEditorData({ ...editorData, price: Number(e.target.value) })} placeholder="0.00" />
                </div>
                <div className="form-group">
                  <label className="form-label">Cost ($)</label>
                  <input type="number" className="form-input" value={editorData.cost || ''} onChange={(e) => setEditorData({ ...editorData, cost: Number(e.target.value) })} placeholder="0.00" />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Category</label>
                  <select className="form-input form-select" value={editorData.category} onChange={(e) => setEditorData({ ...editorData, category: e.target.value })}>
                    <option value="">Select...</option>
                    <option value="clothing">Clothing</option>
                    <option value="shoes">Shoes</option>
                    <option value="electronics">Electronics</option>
                    <option value="collectibles">Collectibles</option>
                    <option value="home">Home</option>
                    <option value="toys">Toys</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Condition</label>
                  <select className="form-input form-select" value={editorData.condition} onChange={(e) => setEditorData({ ...editorData, condition: e.target.value })}>
                    <option value="new">New</option>
                    <option value="like new">Like New</option>
                    <option value="very good">Very Good</option>
                    <option value="good">Good</option>
                    <option value="acceptable">Acceptable</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowEditor(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={!editorData.title}>Create Listing</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
