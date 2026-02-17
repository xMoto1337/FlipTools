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
    platformFilter,
    categoryFilter,
    conditionFilter,
    sortField,
    sortDir,
    currentPage,
    pageSize,
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
    setPlatformFilter,
    setCategoryFilter,
    setConditionFilter,
    setSortField,
    setSortDir,
    setCurrentPage,
    setLoading,
    paginatedListings,
    totalPages,
    totalFiltered,
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

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'title' ? 'asc' : 'desc');
    }
  };

  const paginated = paginatedListings();
  const pages = totalPages();
  const total = totalFiltered();

  // Derive unique categories and conditions from listings for filter dropdowns
  const allListings = useListingStore((s) => s.listings);
  const categories = [...new Set(allListings.map((l) => l.category).filter(Boolean))] as string[];
  const conditions = [...new Set(allListings.map((l) => l.condition).filter(Boolean))] as string[];
  const hasActiveFilters = statusFilter || platformFilter || categoryFilter || conditionFilter || searchQuery;

  const SortIcon = ({ field }: { field: typeof sortField }) => {
    if (sortField !== field) return <span style={{ opacity: 0.3, marginLeft: 4 }}>&#8597;</span>;
    return <span style={{ marginLeft: 4, color: 'var(--neon-cyan)' }}>{sortDir === 'asc' ? '&#9650;' : '&#9660;'}</span>;
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Listings</h1>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 0 }}>
            {total} of {allListings.length} listings
          </span>
        </div>
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

      {/* Filters toolbar */}
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
          {categories.length > 0 && (
            <select className="filter-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          )}
          {conditions.length > 0 && (
            <select className="filter-select" value={conditionFilter} onChange={(e) => setConditionFilter(e.target.value)}>
              <option value="">All Conditions</option>
              {conditions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
          <select className="filter-select" value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
            <option value="">All Platforms</option>
            <option value="ebay">eBay</option>
            <option value="depop">Depop</option>
          </select>
        </div>
        <div className="toolbar-right">
          {hasActiveFilters && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setSearchQuery(''); setStatusFilter(''); setPlatformFilter(''); setCategoryFilter(''); setConditionFilter(''); }}
              style={{ fontSize: 12, color: 'var(--neon-red)' }}
            >
              Clear Filters
            </button>
          )}
          {/* Sort selector */}
          <select
            className="filter-select"
            value={`${sortField}-${sortDir}`}
            onChange={(e) => {
              const [f, d] = e.target.value.split('-');
              setSortField(f as typeof sortField);
              setSortDir(d as 'asc' | 'desc');
            }}
          >
            <option value="created_at-desc">Newest First</option>
            <option value="created_at-asc">Oldest First</option>
            <option value="price-desc">Price: High to Low</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="title-asc">Title: A-Z</option>
            <option value="title-desc">Title: Z-A</option>
          </select>
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

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="bulk-actions">
          <span className="bulk-count">{selectedIds.size} selected</span>
          <button className="btn btn-sm btn-secondary" onClick={selectAll}>Select All on Page</button>
          <button className="btn btn-sm btn-secondary" onClick={clearSelection}>Clear</button>
          <button className="btn btn-sm btn-danger" onClick={handleBulkDelete}>Delete Selected</button>
        </div>
      )}

      {isLoading ? (
        <div className="loading-spinner"><div className="spinner" /></div>
      ) : allListings.length === 0 ? (
        <div className="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>
          <h3>No listings yet</h3>
          <p>Create your first listing or connect eBay in Settings to sync your active listings</p>
          <button className="btn btn-primary" onClick={requireAuth(() => setShowEditor(true), 'Sign in to create listings')}>Create Listing</button>
        </div>
      ) : paginated.length === 0 ? (
        <div className="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <h3>No matches</h3>
          <p>No listings match your current filters</p>
          <button className="btn btn-secondary btn-sm" onClick={() => { setSearchQuery(''); setStatusFilter(''); setPlatformFilter(''); setCategoryFilter(''); setConditionFilter(''); }}>
            Clear All Filters
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="listing-grid">
          {paginated.map((listing) => {
            const platformEntries = Object.entries(listing.platforms);
            const firstPlatformUrl = platformEntries.length > 0 ? (platformEntries[0][1] as { url?: string })?.url : null;

            return (
              <div
                key={listing.id}
                className={`listing-card ${selectedIds.has(listing.id) ? 'selected' : ''}`}
                onClick={() => toggleSelect(listing.id)}
              >
                {listing.images[0] ? (
                  <img src={listing.images[0]} alt={listing.title} className="listing-image" loading="lazy" />
                ) : (
                  <div className="listing-image-placeholder">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  </div>
                )}
                <div className="listing-body">
                  <div className="listing-title">{listing.title}</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div className="listing-price">{formatCurrency(listing.price || 0)}</div>
                    {firstPlatformUrl && (
                      <a
                        href={firstPlatformUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost btn-sm"
                        title="View on platform"
                        onClick={(e) => e.stopPropagation()}
                        style={{ padding: '2px 6px', fontSize: 11 }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                      </a>
                    )}
                  </div>
                  <div className="listing-meta">
                    <span className={`status-badge ${listing.status}`}>
                      <span className="status-dot" />
                      {listing.status}
                    </span>
                    {listing.condition && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{listing.condition}</span>
                    )}
                  </div>
                  <div className="listing-platforms">
                    {Object.keys(listing.platforms).map((p) => (
                      <span key={p} className={`platform-badge ${p}`}>{p}</span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th className="checkbox-cell">
                  <input type="checkbox" className="table-checkbox" onChange={() => selectedIds.size === paginated.length ? clearSelection() : selectAll()} checked={selectedIds.size === paginated.length && paginated.length > 0} />
                </th>
                <th style={{ width: 50 }}></th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('title')}>
                  Title <SortIcon field="title" />
                </th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('price')}>
                  Price <SortIcon field="price" />
                </th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('status')}>
                  Status <SortIcon field="status" />
                </th>
                <th>Condition</th>
                <th>Category</th>
                <th>Platforms</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('created_at')}>
                  Listed <SortIcon field="created_at" />
                </th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((listing) => {
                // Get the first platform URL for "View" link
                const platformEntries = Object.entries(listing.platforms);
                const firstPlatformUrl = platformEntries.length > 0 ? (platformEntries[0][1] as { url?: string })?.url : null;

                return (
                  <tr key={listing.id}>
                    <td className="checkbox-cell">
                      <input type="checkbox" className="table-checkbox" checked={selectedIds.has(listing.id)} onChange={() => toggleSelect(listing.id)} />
                    </td>
                    <td style={{ padding: '8px' }}>
                      {listing.images[0] ? (
                        <img src={listing.images[0]} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover' }} loading="lazy" />
                      ) : (
                        <div style={{ width: 40, height: 40, borderRadius: 6, background: 'var(--bg-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                        </div>
                      )}
                    </td>
                    <td style={{ maxWidth: 250 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{listing.title}</div>
                    </td>
                    <td style={{ fontWeight: 600, color: 'var(--neon-green)' }}>{formatCurrency(listing.price || 0)}</td>
                    <td><span className={`status-badge ${listing.status}`}><span className="status-dot" />{listing.status}</span></td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{listing.condition || '—'}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{listing.category ? listing.category.charAt(0).toUpperCase() + listing.category.slice(1) : '—'}</td>
                    <td>
                      <div className="listing-platforms" style={{ marginTop: 0 }}>
                        {Object.keys(listing.platforms).map((p) => (
                          <span key={p} className={`platform-badge ${p}`}>{p}</span>
                        ))}
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{formatTimeAgo(listing.created_at)}</td>
                    <td>
                      {firstPlatformUrl && (
                        <a
                          href={firstPlatformUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-ghost btn-sm"
                          title="View on platform"
                          onClick={(e) => e.stopPropagation()}
                          style={{ padding: '4px 8px' }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="pagination">
          <button
            className="pagination-btn"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(currentPage - 1)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>

          {Array.from({ length: pages }, (_, i) => i + 1)
            .filter((p) => {
              // Show first, last, current, and neighbors
              if (p === 1 || p === pages) return true;
              if (Math.abs(p - currentPage) <= 1) return true;
              return false;
            })
            .reduce<(number | 'ellipsis')[]>((acc, p, i, arr) => {
              if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('ellipsis');
              acc.push(p);
              return acc;
            }, [])
            .map((item, i) =>
              item === 'ellipsis' ? (
                <span key={`e${i}`} className="pagination-ellipsis">...</span>
              ) : (
                <button
                  key={item}
                  className={`pagination-btn ${currentPage === item ? 'active' : ''}`}
                  onClick={() => setCurrentPage(item as number)}
                >
                  {item}
                </button>
              )
            )}

          <button
            className="pagination-btn"
            disabled={currentPage === pages}
            onClick={() => setCurrentPage(currentPage + 1)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>

          <span style={{ marginLeft: 12, fontSize: 13, color: 'var(--text-muted)' }}>
            {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, total)} of {total}
          </span>
        </div>
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
