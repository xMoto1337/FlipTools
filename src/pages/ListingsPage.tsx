import { useEffect, useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useListingStore } from '../stores/listingStore';
import { usePlatformStore } from '../stores/platformStore';
import { useRequireAuth } from '../hooks/useRequireAuth';
import { listingsApi } from '../api/listings';
import type { ListingInput } from '../api/listings';
import { getPlatform, getAllPlatforms } from '../api/platforms';
import type { PlatformId } from '../api/platforms';
import { supabase } from '../api/supabase';
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
    updateListing,
    updateListings,
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

  // Bulk action modals
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showBulkCrossList, setShowBulkCrossList] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);

  // Bulk edit state
  const [editFields, setEditFields] = useState<Record<string, boolean>>({ price: false, cost: false, category: false, condition: false });
  const [priceMode, setPriceMode] = useState<'set' | 'increase' | 'decrease' | 'percent_up' | 'percent_down'>('set');
  const [editValues, setEditValues] = useState<{ price: number; cost: number; category: string; condition: string }>({ price: 0, cost: 0, category: '', condition: 'good' });
  const [bulkEditBusy, setBulkEditBusy] = useState(false);

  // Bulk cross-list state
  const { isConnected, getToken } = usePlatformStore();
  const platforms = getAllPlatforms();
  const [crossListTargets, setCrossListTargets] = useState<Set<PlatformId>>(new Set());
  const [crossListStatus, setCrossListStatus] = useState<Record<string, string>>({});
  const [isCrossListing, setIsCrossListing] = useState(false);

  // Close status menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setShowStatusMenu(false);
      }
    };
    if (showStatusMenu) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showStatusMenu]);

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
    setShowDeleteConfirm(false);
  };

  const handleBulkStatusChange = async (status: 'active' | 'draft' | 'ended') => {
    const ids = [...selectedIds];
    try {
      await listingsApi.bulkUpdateStatus(ids, status);
      updateListings(ids, { status });
      clearSelection();
    } catch (err) {
      console.error('Bulk status change failed:', err);
    }
    setShowStatusMenu(false);
  };

  const handleBulkEdit = async () => {
    setBulkEditBusy(true);
    const ids = [...selectedIds];
    try {
      // For "set" mode, we can do a single bulk update
      if (priceMode === 'set' || !editFields.price) {
        const updates: Partial<ListingInput> = {};
        if (editFields.price) updates.price = editValues.price;
        if (editFields.cost) updates.cost = editValues.cost;
        if (editFields.category) updates.category = editValues.category;
        if (editFields.condition) updates.condition = editValues.condition;

        if (Object.keys(updates).length > 0) {
          await listingsApi.bulkUpdate(ids, updates);
          updateListings(ids, updates as Record<string, unknown>);
        }
      } else {
        // Price adjustment mode — each listing gets a different price
        const store = useListingStore.getState();
        for (const id of ids) {
          const listing = store.listings.find((l) => l.id === id);
          if (!listing) continue;
          const currentPrice = listing.price || 0;
          let newPrice = currentPrice;

          if (priceMode === 'increase') newPrice = currentPrice + editValues.price;
          else if (priceMode === 'decrease') newPrice = Math.max(0, currentPrice - editValues.price);
          else if (priceMode === 'percent_up') newPrice = currentPrice * (1 + editValues.price / 100);
          else if (priceMode === 'percent_down') newPrice = currentPrice * (1 - editValues.price / 100);

          newPrice = Math.round(Math.max(0, newPrice) * 100) / 100;

          const updates: Partial<ListingInput> = { price: newPrice };
          if (editFields.cost) updates.cost = editValues.cost;
          if (editFields.category) updates.category = editValues.category;
          if (editFields.condition) updates.condition = editValues.condition;

          await listingsApi.update(id, updates);
          updateListing(id, updates as Record<string, unknown>);
        }
      }
      clearSelection();
      setShowBulkEdit(false);
    } catch (err) {
      console.error('Bulk edit failed:', err);
    } finally {
      setBulkEditBusy(false);
    }
  };

  const handleBulkCrossList = async () => {
    if (crossListTargets.size === 0) return;
    setIsCrossListing(true);
    const store = useListingStore.getState();

    for (const listingId of selectedIds) {
      const listing = store.listings.find((l) => l.id === listingId);
      if (!listing) continue;

      for (const platformId of crossListTargets) {
        if (listing.platforms[platformId]) {
          setCrossListStatus((s) => ({ ...s, [`${listingId}-${platformId}`]: 'Already listed' }));
          continue;
        }

        const token = getToken(platformId);
        if (!token) {
          setCrossListStatus((s) => ({ ...s, [`${listingId}-${platformId}`]: 'Not connected' }));
          continue;
        }

        setCrossListStatus((s) => ({ ...s, [`${listingId}-${platformId}`]: 'Listing...' }));
        try {
          const adapter = getPlatform(platformId);
          const result = await adapter.createListing(
            {
              title: listing.title,
              description: listing.description || '',
              price: listing.price || 0,
              category: listing.category || '',
              condition: listing.condition || 'good',
              images: listing.images,
              tags: listing.tags,
            },
            token
          );

          // Save platform mapping to Supabase
          const updatedPlatforms = {
            ...listing.platforms,
            [platformId]: { id: result.externalId, url: result.url, status: result.status },
          };
          await supabase.from('listings').update({ platforms: updatedPlatforms }).eq('id', listingId);
          updateListing(listingId, { platforms: updatedPlatforms });

          setCrossListStatus((s) => ({ ...s, [`${listingId}-${platformId}`]: 'Success' }));
        } catch (err) {
          setCrossListStatus((s) => ({
            ...s,
            [`${listingId}-${platformId}`]: `Failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          }));
        }
      }
    }
    setIsCrossListing(false);
  };

  const openBulkEdit = () => {
    setEditFields({ price: false, cost: false, category: false, condition: false });
    setPriceMode('set');
    setEditValues({ price: 0, cost: 0, category: '', condition: 'good' });
    setShowBulkEdit(true);
  };

  const openBulkCrossList = () => {
    setCrossListTargets(new Set());
    setCrossListStatus({});
    setShowBulkCrossList(true);
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
            <option value="etsy">Etsy</option>
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
          <button className="btn btn-sm btn-secondary" onClick={selectAll}>Select All</button>
          <button className="btn btn-sm btn-secondary" onClick={clearSelection}>Clear</button>
          <div style={{ width: 1, height: 20, background: 'var(--border-color)', margin: '0 4px' }} />
          <button className="btn btn-sm btn-secondary" onClick={requireAuth(openBulkEdit, 'Sign in to edit listings')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit
          </button>
          <div style={{ position: 'relative' }} ref={statusMenuRef}>
            <button className="btn btn-sm btn-secondary" onClick={() => setShowStatusMenu(!showStatusMenu)}>
              Status
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 4 }}><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {showStatusMenu && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, marginTop: 4, background: 'var(--bg-card)',
                border: '1px solid var(--border-color)', borderRadius: 8, overflow: 'hidden', zIndex: 100,
                minWidth: 140, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              }}>
                {(['active', 'draft', 'ended'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => handleBulkStatusChange(s)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 16px',
                      background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer',
                      fontSize: 13, textAlign: 'left',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >
                    <span className={`status-badge ${s}`}><span className="status-dot" />{s}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="btn btn-sm btn-secondary" onClick={requireAuth(openBulkCrossList, 'Sign in to cross-list')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
            Cross-List
          </button>
          <button className="btn btn-sm btn-danger" onClick={() => setShowDeleteConfirm(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            Delete
          </button>
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

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Delete Listings</div>
              <button className="modal-close" onClick={() => setShowDeleteConfirm(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-body">
              <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
                Are you sure you want to delete <strong style={{ color: 'var(--text-primary)' }}>{selectedIds.size} listing{selectedIds.size !== 1 ? 's' : ''}</strong>? This cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleBulkDelete}>Delete {selectedIds.size} Listing{selectedIds.size !== 1 ? 's' : ''}</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Edit Modal */}
      {showBulkEdit && (
        <div className="modal-overlay" onClick={() => setShowBulkEdit(false)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Edit {selectedIds.size} Listing{selectedIds.size !== 1 ? 's' : ''}</div>
              <button className="modal-close" onClick={() => setShowBulkEdit(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-body">
              <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>Check the fields you want to update. Unchecked fields will not be changed.</p>

              {/* Price */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16, padding: 12, borderRadius: 8, background: editFields.price ? 'var(--bg-hover)' : 'transparent' }}>
                <input type="checkbox" className="table-checkbox" checked={editFields.price} onChange={() => setEditFields({ ...editFields, price: !editFields.price })} style={{ marginTop: 4 }} />
                <div style={{ flex: 1 }}>
                  <label className="form-label" style={{ marginBottom: 8 }}>Price</label>
                  {editFields.price && (
                    <>
                      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
                        {([
                          ['set', 'Set to $'],
                          ['increase', '+ $'],
                          ['decrease', '- $'],
                          ['percent_up', '+ %'],
                          ['percent_down', '- %'],
                        ] as const).map(([mode, label]) => (
                          <button
                            key={mode}
                            className={`btn btn-sm ${priceMode === mode ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setPriceMode(mode)}
                            style={{ fontSize: 11, padding: '4px 10px' }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <input
                        type="number"
                        className="form-input"
                        value={editValues.price || ''}
                        onChange={(e) => setEditValues({ ...editValues, price: Number(e.target.value) })}
                        placeholder={priceMode === 'percent_up' || priceMode === 'percent_down' ? 'Percentage' : '0.00'}
                        min={0}
                        step={priceMode === 'percent_up' || priceMode === 'percent_down' ? 1 : 0.01}
                      />
                    </>
                  )}
                </div>
              </div>

              {/* Cost */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16, padding: 12, borderRadius: 8, background: editFields.cost ? 'var(--bg-hover)' : 'transparent' }}>
                <input type="checkbox" className="table-checkbox" checked={editFields.cost} onChange={() => setEditFields({ ...editFields, cost: !editFields.cost })} style={{ marginTop: 4 }} />
                <div style={{ flex: 1 }}>
                  <label className="form-label" style={{ marginBottom: 8 }}>Cost ($)</label>
                  {editFields.cost && (
                    <input
                      type="number"
                      className="form-input"
                      value={editValues.cost || ''}
                      onChange={(e) => setEditValues({ ...editValues, cost: Number(e.target.value) })}
                      placeholder="0.00"
                      min={0}
                      step={0.01}
                    />
                  )}
                </div>
              </div>

              {/* Category */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16, padding: 12, borderRadius: 8, background: editFields.category ? 'var(--bg-hover)' : 'transparent' }}>
                <input type="checkbox" className="table-checkbox" checked={editFields.category} onChange={() => setEditFields({ ...editFields, category: !editFields.category })} style={{ marginTop: 4 }} />
                <div style={{ flex: 1 }}>
                  <label className="form-label" style={{ marginBottom: 8 }}>Category</label>
                  {editFields.category && (
                    <select className="form-input form-select" value={editValues.category} onChange={(e) => setEditValues({ ...editValues, category: e.target.value })}>
                      <option value="">Select...</option>
                      <option value="clothing">Clothing</option>
                      <option value="shoes">Shoes</option>
                      <option value="electronics">Electronics</option>
                      <option value="collectibles">Collectibles</option>
                      <option value="home">Home</option>
                      <option value="toys">Toys</option>
                      <option value="other">Other</option>
                    </select>
                  )}
                </div>
              </div>

              {/* Condition */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: 8, background: editFields.condition ? 'var(--bg-hover)' : 'transparent' }}>
                <input type="checkbox" className="table-checkbox" checked={editFields.condition} onChange={() => setEditFields({ ...editFields, condition: !editFields.condition })} style={{ marginTop: 4 }} />
                <div style={{ flex: 1 }}>
                  <label className="form-label" style={{ marginBottom: 8 }}>Condition</label>
                  {editFields.condition && (
                    <select className="form-input form-select" value={editValues.condition} onChange={(e) => setEditValues({ ...editValues, condition: e.target.value })}>
                      <option value="new">New</option>
                      <option value="like new">Like New</option>
                      <option value="very good">Very Good</option>
                      <option value="good">Good</option>
                      <option value="acceptable">Acceptable</option>
                    </select>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowBulkEdit(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleBulkEdit}
                disabled={bulkEditBusy || !Object.values(editFields).some(Boolean)}
              >
                {bulkEditBusy ? 'Updating...' : `Update ${selectedIds.size} Listing${selectedIds.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Cross-List Modal */}
      {showBulkCrossList && (
        <div className="modal-overlay" onClick={() => !isCrossListing && setShowBulkCrossList(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Cross-List {selectedIds.size} Item{selectedIds.size !== 1 ? 's' : ''}</div>
              <button className="modal-close" onClick={() => !isCrossListing && setShowBulkCrossList(false)} disabled={isCrossListing}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-body">
              {/* Platform selection */}
              <div style={{ marginBottom: 20 }}>
                <label className="form-label" style={{ marginBottom: 8 }}>Target Platforms</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {platforms.map((p) => (
                    <button
                      key={p.id}
                      className={`btn ${crossListTargets.has(p.id) ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => {
                        const next = new Set(crossListTargets);
                        if (next.has(p.id)) next.delete(p.id);
                        else next.add(p.id);
                        setCrossListTargets(next);
                      }}
                      disabled={!isConnected(p.id) || isCrossListing}
                    >
                      {p.name}
                      {!isConnected(p.id) && <span style={{ fontSize: 11, opacity: 0.7 }}> (not connected)</span>}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fee preview & status */}
              {crossListTargets.size > 0 && (
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Listing</th>
                        {[...crossListTargets].map((p) => (
                          <th key={p}>{p} Fees</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...selectedIds].map((id) => {
                        const listing = allListings.find((l) => l.id === id);
                        if (!listing) return null;
                        return (
                          <tr key={id}>
                            <td style={{ maxWidth: 200 }}>
                              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{listing.title}</div>
                            </td>
                            {[...crossListTargets].map((p) => {
                              const adapter = getPlatform(p);
                              const fees = adapter.calculateFees(listing.price || 0);
                              const statusKey = `${id}-${p}`;
                              const status = crossListStatus[statusKey];
                              return (
                                <td key={p}>
                                  <div style={{ fontSize: 12 }}>
                                    Fees: {formatCurrency(fees.totalFees)}
                                    <br />
                                    Net: <span style={{ color: 'var(--neon-green)' }}>{formatCurrency(fees.netProceeds)}</span>
                                  </div>
                                  {status && (
                                    <div style={{
                                      fontSize: 11, marginTop: 4,
                                      color: status === 'Success' ? 'var(--neon-green)' : status === 'Listing...' ? 'var(--neon-cyan)' : 'var(--neon-orange)',
                                    }}>
                                      {status === 'Listing...' && <span className="spinner" style={{ width: 10, height: 10, display: 'inline-block', marginRight: 4 }} />}
                                      {status}
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowBulkCrossList(false)} disabled={isCrossListing}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleBulkCrossList}
                disabled={crossListTargets.size === 0 || isCrossListing}
              >
                {isCrossListing ? 'Cross-listing...' : `Cross-List to ${crossListTargets.size} Platform${crossListTargets.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
