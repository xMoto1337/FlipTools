import { useState, useMemo } from 'react';
import { useListingStore } from '../stores/listingStore';
import { usePlatformStore } from '../stores/platformStore';
import { useRequireAuth } from '../hooks/useRequireAuth';
import { getPlatform, getAllPlatforms } from '../api/platforms';
import type { PlatformId } from '../api/platforms';
import type { Listing } from '../api/listings';
import { useFeatureGate } from '../hooks/useSubscription';
import { PaywallGate } from '../components/Subscription/PaywallGate';
import { formatCurrency } from '../utils/formatters';
import { supabase } from '../api/supabase';

interface ValidationResult {
  errors: string[];
  warnings: string[];
}

function validateListingForPlatform(listing: Listing, platformId: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!listing.title || listing.title.trim().length < 3) errors.push('Title must be at least 3 characters');
  if (!listing.price || listing.price <= 0) errors.push('Price must be greater than $0');
  if (!listing.description || listing.description.trim().length < 10) warnings.push('Description is very short');

  switch (platformId) {
    case 'ebay':
      if (!listing.condition) warnings.push('Condition recommended');
      if (listing.images.length === 0) warnings.push('At least 1 image recommended');
      break;
    case 'poshmark':
      if (!listing.brand) errors.push('Brand is required');
      if (!listing.size) errors.push('Size is required');
      if (!listing.color) warnings.push('Color recommended');
      if (listing.images.length === 0) errors.push('At least 1 image required');
      if (!listing.condition) warnings.push('Condition recommended');
      break;
    case 'mercari':
      if (!listing.condition) errors.push('Condition is required');
      if (listing.images.length === 0) errors.push('At least 1 image required');
      if (!listing.brand) warnings.push('Brand recommended');
      if (!listing.shipping_weight) warnings.push('Shipping weight recommended for calculated shipping');
      break;
    case 'depop':
      if (!listing.condition) warnings.push('Condition recommended');
      if (listing.images.length === 0) errors.push('At least 1 image required');
      if (!listing.size) warnings.push('Size recommended for clothing');
      break;
    case 'etsy':
      if (listing.images.length === 0) errors.push('At least 1 image required');
      if (!listing.tags || listing.tags.length === 0) warnings.push('Tags help with Etsy search visibility');
      break;
    case 'facebook':
      if (listing.images.length === 0) warnings.push('Images strongly recommended');
      if (!listing.condition) warnings.push('Condition recommended');
      break;
  }

  return { errors, warnings };
}

const PLATFORM_COLORS: Record<string, string> = {
  ebay: '#e53238',
  etsy: '#f1641e',
  depop: '#ff2300',
};

const COLLECTION_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
  '#f97316', '#06b6d4',
];

export default function CrossListPage() {
  const { requireAuth } = useRequireAuth();
  const { listings, updateListing } = useListingStore();
  const { isConnected, getToken } = usePlatformStore();
  const [selectedListings, setSelectedListings] = useState<Set<string>>(new Set());
  const [targetPlatforms, setTargetPlatforms] = useState<Set<PlatformId>>(new Set());
  const [crossListStatus, setCrossListStatus] = useState<Record<string, string>>({});
  const [isCrossListing, setIsCrossListing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCollection, setActiveCollection] = useState('__all__');
  const [userCollections, setUserCollections] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('ft_collections') || '[]'); } catch { return []; }
  });
  const [showNewInput, setShowNewInput] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');

  const { allowed: crossListAllowed } = useFeatureGate('cross-list');
  const platforms = getAllPlatforms();

  // All collections: only user-created ones (stored in localStorage)
  const allCollections = useMemo(() => {
    return [...userCollections].sort();
  }, [userCollections]);

  const eligibleListings = useMemo(
    () => listings.filter(l => l.status === 'active' || l.status === 'draft'),
    [listings]
  );

  // Listings visible in the current tab + search
  const visibleListings = useMemo(() => {
    let result = eligibleListings;
    if (activeCollection !== '__all__') {
      result = result.filter(l => l.category?.trim() === activeCollection);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(l => l.title.toLowerCase().includes(q));
    }
    return result;
  }, [eligibleListings, activeCollection, searchQuery]);

  // Validation
  const validationMap = useMemo(() => {
    const map: Record<string, ValidationResult> = {};
    for (const id of selectedListings) {
      const listing = listings.find(l => l.id === id);
      if (!listing) continue;
      for (const platformId of targetPlatforms) {
        if (listing.platforms[platformId]) continue;
        map[`${id}-${platformId}`] = validateListingForPlatform(listing, platformId);
      }
    }
    return map;
  }, [selectedListings, targetPlatforms, listings]);

  const hasBlockingErrors = useMemo(
    () => Object.values(validationMap).some(v => v.errors.length > 0),
    [validationMap]
  );

  // Collection management
  const createCollection = () => {
    const name = newCollectionName.trim();
    if (!name || userCollections.includes(name) || allCollections.includes(name)) return;
    const updated = [...userCollections, name].sort();
    setUserCollections(updated);
    localStorage.setItem('ft_collections', JSON.stringify(updated));
    setActiveCollection(name);
    setNewCollectionName('');
    setShowNewInput(false);
  };

  const moveSelectedTo = async (collectionName: string | null) => {
    const ids = [...selectedListings];
    await supabase.from('listings').update({ category: collectionName }).in('id', ids);
    ids.forEach(id => updateListing(id, { category: collectionName }));
    setSelectedListings(new Set());
    if (collectionName) setActiveCollection(collectionName);
  };

  // Selection
  const toggleListing = (id: string) => {
    const next = new Set(selectedListings);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedListings(next);
  };

  const toggleSelectAll = () => {
    const allSelected = visibleListings.every(l => selectedListings.has(l.id));
    const next = new Set(selectedListings);
    if (allSelected) visibleListings.forEach(l => next.delete(l.id));
    else visibleListings.forEach(l => next.add(l.id));
    setSelectedListings(next);
  };

  const deselectAll = () => setSelectedListings(new Set());

  const togglePlatform = (id: PlatformId) => {
    const next = new Set(targetPlatforms);
    if (next.has(id)) next.delete(id); else next.add(id);
    setTargetPlatforms(next);
  };

  const handleCrossList = async () => {
    if (selectedListings.size === 0 || targetPlatforms.size === 0) return;
    setIsCrossListing(true);

    for (const listingId of selectedListings) {
      const listing = listings.find(l => l.id === listingId);
      if (!listing) continue;

      for (const platformId of targetPlatforms) {
        if (listing.platforms[platformId]) {
          setCrossListStatus(s => ({ ...s, [`${listingId}-${platformId}`]: 'Already listed' }));
          continue;
        }
        const token = getToken(platformId);
        if (!token) {
          setCrossListStatus(s => ({ ...s, [`${listingId}-${platformId}`]: 'Not connected' }));
          continue;
        }
        setCrossListStatus(s => ({ ...s, [`${listingId}-${platformId}`]: 'Listing...' }));
        try {
          const adapter = getPlatform(platformId);
          const result = await adapter.createListing({
            title: listing.title,
            description: listing.description || '',
            price: listing.price || 0,
            category: listing.category || '',
            condition: listing.condition || 'good',
            images: listing.images,
            tags: listing.tags,
          }, token);
          const updatedPlatforms = {
            ...listing.platforms,
            [platformId]: { id: result.externalId, url: result.url, status: result.status },
          };
          await supabase.from('listings').update({ platforms: updatedPlatforms }).eq('id', listingId);
          updateListing(listingId, { platforms: updatedPlatforms });
          setCrossListStatus(s => ({ ...s, [`${listingId}-${platformId}`]: 'Success' }));
        } catch (err) {
          setCrossListStatus(s => ({
            ...s,
            [`${listingId}-${platformId}`]: `Failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          }));
        }
      }
    }
    setIsCrossListing(false);
  };

  const allVisibleSelected = visibleListings.length > 0 && visibleListings.every(l => selectedListings.has(l.id));

  return (
    <div>
      <div className="page-header">
        <h1>Cross List</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>
          Organize your listings into collections, then cross-list to other platforms
        </p>
      </div>

      {/* Step 1: Select Listings */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header" style={{ marginBottom: 14 }}>
          <div className="card-title">1. Select Listings</div>
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{eligibleListings.length} listings</span>
        </div>

        {/* Collection tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {/* All */}
          <button
            onClick={() => setActiveCollection('__all__')}
            style={{
              padding: '5px 16px', borderRadius: 20, border: 'none', cursor: 'pointer',
              background: activeCollection === '__all__' ? 'var(--neon-cyan)' : 'var(--bg-tertiary)',
              color: activeCollection === '__all__' ? '#0a0a0a' : 'var(--text-secondary)',
              fontWeight: 700, fontSize: 13, transition: 'all 0.15s',
            }}
          >
            All · {eligibleListings.length}
          </button>

          {/* Named collections */}
          {allCollections.map((col, i) => {
            const color = COLLECTION_COLORS[i % COLLECTION_COLORS.length];
            const count = eligibleListings.filter(l => l.category?.trim() === col).length;
            const isActive = activeCollection === col;
            return (
              <button
                key={col}
                onClick={() => setActiveCollection(col)}
                style={{
                  padding: '5px 16px', borderRadius: 20, cursor: 'pointer',
                  border: `1.5px solid ${isActive ? color : 'transparent'}`,
                  background: isActive ? `color-mix(in srgb, ${color} 18%, var(--bg-card))` : 'var(--bg-tertiary)',
                  color: isActive ? color : 'var(--text-secondary)',
                  fontWeight: 600, fontSize: 13, transition: 'all 0.15s',
                }}
              >
                {col.charAt(0).toUpperCase() + col.slice(1)} · {count}
              </button>
            );
          })}

          {/* New collection */}
          {showNewInput ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                autoFocus
                value={newCollectionName}
                onChange={e => setNewCollectionName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') createCollection();
                  if (e.key === 'Escape') { setShowNewInput(false); setNewCollectionName(''); }
                }}
                placeholder="Collection name..."
                style={{
                  fontSize: 13, padding: '4px 12px', borderRadius: 20,
                  border: '1.5px solid var(--neon-cyan)', background: 'var(--bg-card)',
                  color: 'var(--text-primary)', width: 160, outline: 'none',
                }}
              />
              <button
                onClick={createCollection}
                style={{
                  padding: '4px 14px', borderRadius: 20, background: 'var(--neon-cyan)',
                  color: '#0a0a0a', fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer',
                }}
              >Create</button>
              <button
                onClick={() => { setShowNewInput(false); setNewCollectionName(''); }}
                style={{
                  padding: '4px 12px', borderRadius: 20, background: 'var(--bg-tertiary)',
                  color: 'var(--text-muted)', fontWeight: 600, fontSize: 13, border: 'none', cursor: 'pointer',
                }}
              >Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => setShowNewInput(true)}
              style={{
                padding: '5px 14px', borderRadius: 20, cursor: 'pointer',
                border: '1.5px dashed var(--border-color)', background: 'transparent',
                color: 'var(--text-muted)', fontWeight: 600, fontSize: 13,
                display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> New collection
            </button>
          )}
        </div>

        {/* Search */}
        <div style={{ marginBottom: 12 }}>
          <input
            type="text"
            className="form-input"
            placeholder={`Search${activeCollection !== '__all__' ? ` in "${activeCollection}"` : ' all listings'}...`}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Selection action bar */}
        {selectedListings.size > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            padding: '10px 14px', borderRadius: 10, marginBottom: 14,
            background: 'color-mix(in srgb, var(--neon-green) 6%, var(--bg-card))',
            border: '1px solid color-mix(in srgb, var(--neon-green) 22%, transparent)',
          }}>
            <span style={{ color: 'var(--neon-green)', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
              {selectedListings.size} selected
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: 12, flexShrink: 0 }}>Move to:</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
              {allCollections.map((col, i) => {
                const color = COLLECTION_COLORS[i % COLLECTION_COLORS.length];
                return (
                  <button
                    key={col}
                    onClick={() => moveSelectedTo(col)}
                    style={{
                      padding: '3px 12px', borderRadius: 14, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: `1px solid ${color}55`,
                      background: `color-mix(in srgb, ${color} 12%, transparent)`,
                      color, transition: 'all 0.1s',
                    }}
                  >
                    {col.charAt(0).toUpperCase() + col.slice(1)}
                  </button>
                );
              })}
              {activeCollection !== '__all__' && (
                <button
                  onClick={() => moveSelectedTo(null)}
                  style={{
                    padding: '3px 12px', borderRadius: 14, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)',
                  }}
                >
                  Remove from {activeCollection}
                </button>
              )}
            </div>
            <button
              onClick={deselectAll}
              style={{
                padding: '3px 12px', borderRadius: 14, fontSize: 12, cursor: 'pointer', flexShrink: 0,
                border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)',
              }}
            >
              Deselect all
            </button>
          </div>
        )}

        {/* Listings grid */}
        {visibleListings.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
            {searchQuery
              ? 'No listings match your search.'
              : activeCollection === '__all__'
                ? 'No active listings yet.'
                : (
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>This collection is empty</div>
                      <div style={{ fontSize: 13 }}>Go to "All", select listings, then move them here</div>
                    </div>
                  )
            }
          </div>
        ) : (
          <>
            {/* Select all row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <button
                onClick={toggleSelectAll}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 12, color: 'var(--text-muted)', background: 'none',
                  border: 'none', cursor: 'pointer', padding: 0,
                }}
              >
                <div style={{
                  width: 15, height: 15, borderRadius: 3, flexShrink: 0,
                  border: '1.5px solid var(--border-color)',
                  background: allVisibleSelected ? 'var(--neon-green)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {allVisibleSelected && (
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="3.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                {allVisibleSelected ? 'Deselect all' : 'Select all'}
              </button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {visibleListings.length} listing{visibleListings.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))',
              gap: 10,
            }}>
              {visibleListings.map(listing => {
                const isSelected = selectedListings.has(listing.id);
                const existingPlatforms = Object.keys(listing.platforms);
                const statusEntries = [...targetPlatforms].map(p => ({
                  platform: p,
                  status: crossListStatus[`${listing.id}-${p}`],
                }));

                return (
                  <div
                    key={listing.id}
                    onClick={requireAuth(() => toggleListing(listing.id), 'Sign in to cross-list items')}
                    style={{
                      borderRadius: 12, cursor: 'pointer', overflow: 'hidden', position: 'relative',
                      border: isSelected ? '2px solid var(--neon-green)' : '2px solid transparent',
                      background: 'var(--bg-hover)',
                      boxShadow: isSelected ? '0 0 0 1px color-mix(in srgb, var(--neon-green) 30%, transparent)' : 'none',
                      transition: 'border-color 0.15s, box-shadow 0.15s',
                    }}
                  >
                    {/* Checkmark overlay */}
                    <div style={{
                      position: 'absolute', top: 7, right: 7, zIndex: 2,
                      width: 22, height: 22, borderRadius: '50%',
                      background: isSelected ? 'var(--neon-green)' : 'rgba(0,0,0,0.45)',
                      border: isSelected ? 'none' : '1.5px solid rgba(255,255,255,0.3)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s',
                    }}>
                      {isSelected && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>

                    {/* Image */}
                    <div style={{ width: '100%', paddingBottom: '85%', position: 'relative', background: 'var(--bg-card)' }}>
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1">
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <path d="M21 15l-5-5L5 21" />
                        </svg>
                      </div>
                      {listing.images?.[0] && (
                        <img
                          src={listing.images[0]}
                          alt={listing.title}
                          referrerPolicy="no-referrer"
                          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      )}
                    </div>

                    {/* Content */}
                    <div style={{ padding: '8px 10px 10px' }}>
                      <div style={{
                        fontWeight: 600, fontSize: 12, lineHeight: 1.35, marginBottom: 5,
                        display: '-webkit-box', WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}>
                        {listing.title}
                      </div>
                      <div style={{ color: 'var(--neon-green)', fontWeight: 700, fontSize: 14, marginBottom: 5 }}>
                        {formatCurrency(listing.price || 0)}
                      </div>
                      {existingPlatforms.length > 0 && (
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                          {existingPlatforms.map(p => (
                            <span key={p} style={{
                              fontSize: 9, padding: '1px 5px', borderRadius: 4, fontWeight: 700,
                              textTransform: 'uppercase',
                              background: `color-mix(in srgb, ${PLATFORM_COLORS[p] || '#888'} 15%, transparent)`,
                              color: PLATFORM_COLORS[p] || '#888',
                            }}>{p}</span>
                          ))}
                        </div>
                      )}
                      {statusEntries.some(s => s.status) && (
                        <div style={{ marginTop: 4, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                          {statusEntries.filter(s => s.status).map(s => (
                            <span key={s.platform} style={{
                              fontSize: 9, padding: '1px 5px', borderRadius: 4,
                              background: s.status === 'Success'
                                ? 'color-mix(in srgb, var(--neon-green) 15%, transparent)'
                                : s.status === 'Listing...'
                                  ? 'color-mix(in srgb, var(--neon-blue) 15%, transparent)'
                                  : 'color-mix(in srgb, var(--neon-orange) 15%, transparent)',
                              color: s.status === 'Success' ? 'var(--neon-green)'
                                : s.status === 'Listing...' ? 'var(--neon-blue)' : 'var(--neon-orange)',
                            }}>
                              {s.platform}: {s.status}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Step 2: Select Target Platforms */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div className="card-title">2. Select Target Platforms</div>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {platforms.map((p) => {
            const selected = targetPlatforms.has(p.id);
            const connected = isConnected(p.id);
            const color = PLATFORM_COLORS[p.id] || '#888';
            return (
              <button
                key={p.id}
                onClick={requireAuth(() => togglePlatform(p.id), 'Sign in to connect platforms')}
                disabled={!connected}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px',
                  borderRadius: 10,
                  border: selected ? `2px solid ${color}` : '2px solid var(--border)',
                  background: selected ? `color-mix(in srgb, ${color} 10%, var(--bg-card))` : 'var(--bg-card)',
                  color: selected ? color : connected ? 'var(--text-primary)' : 'var(--text-muted)',
                  cursor: connected ? 'pointer' : 'not-allowed',
                  opacity: connected ? 1 : 0.5,
                  fontWeight: 600, fontSize: 14, transition: 'all 0.15s ease',
                }}
              >
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: connected ? color : 'var(--text-muted)',
                  opacity: connected ? 1 : 0.3,
                }} />
                {p.name}
                {!connected && <span style={{ fontSize: 11, opacity: 0.7 }}>(connect in Settings)</span>}
                {selected && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 3: Review & Cross List */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div className="card-title">3. Review & Cross List</div>
        </div>

        {selectedListings.size > 0 && targetPlatforms.size > 0 ? (
          <div style={{ marginBottom: 16 }}>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: 12, maxHeight: 400, overflowY: 'auto', marginBottom: 16,
            }}>
              {[...selectedListings].map((id) => {
                const listing = listings.find(l => l.id === id);
                if (!listing) return null;
                return (
                  <div key={id} style={{
                    display: 'flex', gap: 10, padding: 12, borderRadius: 8,
                    background: 'var(--bg-hover)', border: '1px solid var(--border)',
                  }}>
                    <div style={{ position: 'relative', width: 48, height: 48, borderRadius: 6, flexShrink: 0, background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      {listing.images?.[0] && (
                        <img src={listing.images[0]} alt="" referrerPolicy="no-referrer" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                      )}
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                      </svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {listing.title}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--neon-green)', fontWeight: 600 }}>
                        {formatCurrency(listing.price || 0)}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                        {[...targetPlatforms].map((p) => {
                          const alreadyListed = !!listing.platforms[p];
                          const adapter = getPlatform(p);
                          const fees = adapter.calculateFees(listing.price || 0);
                          const status = crossListStatus[`${id}-${p}`];
                          const color = PLATFORM_COLORS[p] || '#888';
                          const validation = validationMap[`${id}-${p}`];
                          return (
                            <div key={p} style={{
                              fontSize: 11, padding: '3px 8px', borderRadius: 5,
                              background: alreadyListed
                                ? 'color-mix(in srgb, var(--text-muted) 10%, transparent)'
                                : validation?.errors.length
                                  ? 'color-mix(in srgb, var(--neon-red) 8%, transparent)'
                                  : `color-mix(in srgb, ${color} 10%, transparent)`,
                              border: `1px solid ${alreadyListed ? 'var(--border)' : validation?.errors.length ? 'var(--neon-red)' : color + '33'}`,
                            }}>
                              <span style={{ fontWeight: 600, color: alreadyListed ? 'var(--text-muted)' : color, textTransform: 'uppercase' }}>{p}</span>
                              {alreadyListed ? (
                                <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>Already listed</span>
                              ) : (
                                <span style={{ color: 'var(--text-secondary)', marginLeft: 4 }}>
                                  Fee: {formatCurrency(fees.totalFees)} | Net: {formatCurrency(fees.netProceeds)}
                                </span>
                              )}
                              {status && (
                                <span style={{
                                  marginLeft: 4, fontWeight: 600,
                                  color: status === 'Success' ? 'var(--neon-green)' : status === 'Listing...' ? 'var(--neon-blue)' : 'var(--neon-orange)',
                                }}>{status}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {(() => {
                        const allErrors: string[] = [];
                        const allWarnings: string[] = [];
                        for (const p of targetPlatforms) {
                          const v = validationMap[`${id}-${p}`];
                          if (!v) continue;
                          v.errors.forEach(e => allErrors.push(`[${p}] ${e}`));
                          v.warnings.forEach(w => allWarnings.push(`[${p}] ${w}`));
                        }
                        if (allErrors.length === 0 && allWarnings.length === 0) return null;
                        return (
                          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {allErrors.map(e => (
                              <div key={e} style={{ fontSize: 11, color: 'var(--neon-red)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                {e}
                              </div>
                            ))}
                            {allWarnings.map(w => (
                              <div key={w} style={{ fontSize: 11, color: 'var(--neon-orange)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                                {w}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, display: 'flex', gap: 16 }}>
              <span>{selectedListings.size} item{selectedListings.size !== 1 ? 's' : ''}</span>
              <span>{targetPlatforms.size} platform{targetPlatforms.size !== 1 ? 's' : ''}</span>
              <span>
                Total est. fees:{' '}
                <span style={{ color: 'var(--neon-orange)' }}>
                  {formatCurrency(
                    [...selectedListings].reduce((acc, id) => {
                      const listing = listings.find(l => l.id === id);
                      if (!listing) return acc;
                      return acc + [...targetPlatforms].reduce((feeAcc, p) => {
                        if (listing.platforms[p]) return feeAcc;
                        return feeAcc + getPlatform(p).calculateFees(listing.price || 0).totalFees;
                      }, 0);
                    }, 0)
                  )}
                </span>
              </span>
            </div>
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>
            {selectedListings.size === 0 ? 'Select some listings above' : 'Choose target platforms'}
          </p>
        )}

        {hasBlockingErrors && selectedListings.size > 0 && targetPlatforms.size > 0 && (
          <div style={{
            marginBottom: 12, padding: '10px 14px', borderRadius: 8,
            background: 'color-mix(in srgb, var(--neon-red) 8%, transparent)',
            border: '1px solid var(--neon-red)', color: 'var(--neon-red)',
            fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Fix the errors above before cross-listing. Missing required fields must be filled in on the listing first.
          </div>
        )}

        {!crossListAllowed ? (
          <PaywallGate feature="Unlimited cross-listing">
            <button className="btn btn-primary btn-lg" disabled>Cross List Now</button>
          </PaywallGate>
        ) : (
          <button
            className="btn btn-primary btn-lg"
            onClick={requireAuth(handleCrossList, 'Sign in to cross-list items')}
            disabled={selectedListings.size === 0 || targetPlatforms.size === 0 || isCrossListing || hasBlockingErrors}
            style={{ width: '100%' }}
          >
            {isCrossListing ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                  <path d="M21 12a9 9 0 11-6.219-8.56" />
                </svg>
                {' '}Cross-listing...
              </>
            ) : (
              `Cross List ${selectedListings.size} item${selectedListings.size !== 1 ? 's' : ''} to ${targetPlatforms.size} platform${targetPlatforms.size !== 1 ? 's' : ''}`
            )}
          </button>
        )}
      </div>
    </div>
  );
}
