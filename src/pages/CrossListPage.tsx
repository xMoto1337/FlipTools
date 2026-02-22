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
  errors: string[];   // blocking — must fix before posting
  warnings: string[]; // non-blocking — recommended but not required
}

function validateListingForPlatform(listing: Listing, platformId: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Universal requirements
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

export default function CrossListPage() {
  const { requireAuth } = useRequireAuth();
  const { listings, updateListing } = useListingStore();
  const { isConnected, getToken } = usePlatformStore();
  const [selectedListings, setSelectedListings] = useState<Set<string>>(new Set());
  const [targetPlatforms, setTargetPlatforms] = useState<Set<PlatformId>>(new Set());
  const [crossListStatus, setCrossListStatus] = useState<Record<string, string>>({});
  const [isCrossListing, setIsCrossListing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const { allowed: crossListAllowed } = useFeatureGate('cross-list');
  const platforms = getAllPlatforms();

  // Pre-flight validation: compute errors/warnings for each selected listing × target platform
  const validationMap = useMemo(() => {
    const map: Record<string, ValidationResult> = {};
    for (const id of selectedListings) {
      const listing = listings.find((l) => l.id === id);
      if (!listing) continue;
      for (const platformId of targetPlatforms) {
        if (listing.platforms[platformId]) continue; // already listed — skip
        map[`${id}-${platformId}`] = validateListingForPlatform(listing, platformId);
      }
    }
    return map;
  }, [selectedListings, targetPlatforms, listings]);

  const hasBlockingErrors = useMemo(
    () => Object.values(validationMap).some((v) => v.errors.length > 0),
    [validationMap]
  );

  const eligibleListings = useMemo(() => {
    let filtered = listings.filter((l) => l.status === 'active' || l.status === 'draft');
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((l) => l.title.toLowerCase().includes(q));
    }
    if (categoryFilter) {
      filtered = filtered.filter((l) => l.category === categoryFilter);
    }
    return filtered;
  }, [listings, searchQuery, categoryFilter]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    listings.forEach((l) => { if (l.category) cats.add(l.category); });
    return [...cats].sort();
  }, [listings]);

  const toggleListing = (id: string) => {
    const next = new Set(selectedListings);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedListings(next);
  };

  const selectAllVisible = () => {
    const allIds = new Set(selectedListings);
    eligibleListings.forEach((l) => allIds.add(l.id));
    setSelectedListings(allIds);
  };

  const deselectAll = () => setSelectedListings(new Set());

  const togglePlatform = (id: PlatformId) => {
    const next = new Set(targetPlatforms);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTargetPlatforms(next);
  };

  const handleCrossList = async () => {
    if (selectedListings.size === 0 || targetPlatforms.size === 0) return;
    setIsCrossListing(true);

    for (const listingId of selectedListings) {
      const listing = listings.find((l) => l.id === listingId);
      if (!listing) continue;

      for (const platformId of targetPlatforms) {
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

  const allVisibleSelected = eligibleListings.length > 0 && eligibleListings.every((l) => selectedListings.has(l.id));

  return (
    <div>
      <div className="page-header">
        <h1>Cross List</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>
          Select items and choose platforms to list them on
        </p>
      </div>

      {/* Step 1: Select Listings */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div className="card-title">1. Select Listings</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              {selectedListings.size} of {eligibleListings.length} selected
            </span>
            <button className="btn btn-sm btn-secondary" onClick={allVisibleSelected ? deselectAll : selectAllVisible}>
              {allVisibleSelected ? 'Deselect All' : 'Select All'}
            </button>
          </div>
        </div>

        {/* Search & Filter */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <input
            type="text"
            className="form-input"
            placeholder="Search listings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ flex: 1 }}
          />
          {categories.length > 0 && (
            <select
              className="form-input"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              style={{ width: 160 }}
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
        </div>

        {eligibleListings.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 24 }}>
            {searchQuery || categoryFilter ? 'No listings match your filters.' : 'No listings available. Create some listings first.'}
          </p>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 12,
            maxHeight: 480,
            overflowY: 'auto',
            padding: 4,
          }}>
            {eligibleListings.map((listing) => {
              const isSelected = selectedListings.has(listing.id);
              const existingPlatforms = Object.keys(listing.platforms);
              const statusEntries = [...targetPlatforms].map((p) => ({
                platform: p,
                status: crossListStatus[`${listing.id}-${p}`],
                alreadyListed: !!listing.platforms[p],
              }));

              return (
                <div
                  key={listing.id}
                  onClick={requireAuth(() => toggleListing(listing.id), 'Sign in to cross-list items')}
                  style={{
                    display: 'flex',
                    gap: 12,
                    padding: 12,
                    borderRadius: 10,
                    cursor: 'pointer',
                    border: isSelected ? '2px solid var(--neon-green)' : '2px solid var(--border)',
                    background: isSelected ? 'color-mix(in srgb, var(--neon-green) 5%, var(--bg-card))' : 'var(--bg-card)',
                    transition: 'all 0.15s ease',
                    position: 'relative',
                  }}
                >
                  {/* Checkbox */}
                  <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 1 }}>
                    <input
                      type="checkbox"
                      className="table-checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      style={{ pointerEvents: 'none' }}
                    />
                  </div>

                  {/* Thumbnail */}
                  <div style={{
                    width: 80,
                    height: 80,
                    borderRadius: 8,
                    overflow: 'hidden',
                    flexShrink: 0,
                    background: 'var(--bg-hover)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    {listing.images && listing.images.length > 0 ? (
                      <img
                        src={listing.images[0]}
                        alt={listing.title}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="M21 15l-5-5L5 21" />
                      </svg>
                    )}
                  </div>

                  {/* Details */}
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{
                      fontWeight: 600,
                      fontSize: 14,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {listing.title}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--neon-green)', fontWeight: 700, fontSize: 15 }}>
                        {formatCurrency(listing.price || 0)}
                      </span>
                      {listing.condition && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                          {listing.condition}
                        </span>
                      )}
                    </div>

                    {listing.category && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {listing.category}
                      </div>
                    )}

                    {/* Current platforms */}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                      {existingPlatforms.map((p) => (
                        <span key={p} style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: `color-mix(in srgb, ${PLATFORM_COLORS[p] || '#888'} 15%, transparent)`,
                          color: PLATFORM_COLORS[p] || '#888',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                        }}>
                          {p}
                        </span>
                      ))}
                      {existingPlatforms.length === 0 && (
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Not listed anywhere</span>
                      )}
                    </div>

                    {/* Cross-list status for this item */}
                    {statusEntries.some((s) => s.status) && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                        {statusEntries.filter((s) => s.status).map((s) => (
                          <span key={s.platform} style={{
                            fontSize: 10,
                            padding: '1px 5px',
                            borderRadius: 3,
                            background: s.status === 'Success' ? 'color-mix(in srgb, var(--neon-green) 15%, transparent)'
                              : s.status === 'Listing...' ? 'color-mix(in srgb, var(--neon-blue) 15%, transparent)'
                              : 'color-mix(in srgb, var(--neon-orange) 15%, transparent)',
                            color: s.status === 'Success' ? 'var(--neon-green)'
                              : s.status === 'Listing...' ? 'var(--neon-blue)'
                              : 'var(--neon-orange)',
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
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 20px',
                  borderRadius: 10,
                  border: selected ? `2px solid ${color}` : '2px solid var(--border)',
                  background: selected ? `color-mix(in srgb, ${color} 10%, var(--bg-card))` : 'var(--bg-card)',
                  color: selected ? color : connected ? 'var(--text-primary)' : 'var(--text-muted)',
                  cursor: connected ? 'pointer' : 'not-allowed',
                  opacity: connected ? 1 : 0.5,
                  fontWeight: 600,
                  fontSize: 14,
                  transition: 'all 0.15s ease',
                }}
              >
                <span style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
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
            {/* Summary cards */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: 12,
              maxHeight: 400,
              overflowY: 'auto',
              marginBottom: 16,
            }}>
              {[...selectedListings].map((id) => {
                const listing = listings.find((l) => l.id === id);
                if (!listing) return null;
                return (
                  <div key={id} style={{
                    display: 'flex',
                    gap: 10,
                    padding: 12,
                    borderRadius: 8,
                    background: 'var(--bg-hover)',
                    border: '1px solid var(--border)',
                  }}>
                    {/* Small thumbnail */}
                    <div style={{
                      width: 48,
                      height: 48,
                      borderRadius: 6,
                      overflow: 'hidden',
                      flexShrink: 0,
                      background: 'var(--bg-card)',
                    }}>
                      {listing.images?.[0] ? (
                        <img src={listing.images[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                          </svg>
                        </div>
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {listing.title}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--neon-green)', fontWeight: 600 }}>
                        {formatCurrency(listing.price || 0)}
                      </div>
                      {/* Fee breakdown per target platform */}
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
                              fontSize: 11,
                              padding: '3px 8px',
                              borderRadius: 5,
                              background: alreadyListed
                                ? 'color-mix(in srgb, var(--text-muted) 10%, transparent)'
                                : validation?.errors.length
                                  ? 'color-mix(in srgb, var(--neon-red) 8%, transparent)'
                                  : `color-mix(in srgb, ${color} 10%, transparent)`,
                              border: `1px solid ${alreadyListed ? 'var(--border)' : validation?.errors.length ? 'var(--neon-red)' : color + '33'}`,
                            }}>
                              <span style={{ fontWeight: 600, color: alreadyListed ? 'var(--text-muted)' : color, textTransform: 'uppercase' }}>
                                {p}
                              </span>
                              {alreadyListed ? (
                                <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>Already listed</span>
                              ) : (
                                <span style={{ color: 'var(--text-secondary)', marginLeft: 4 }}>
                                  Fee: {formatCurrency(fees.totalFees)} | Net: {formatCurrency(fees.netProceeds)}
                                </span>
                              )}
                              {status && (
                                <span style={{
                                  marginLeft: 4,
                                  fontWeight: 600,
                                  color: status === 'Success' ? 'var(--neon-green)'
                                    : status === 'Listing...' ? 'var(--neon-blue)'
                                    : 'var(--neon-orange)',
                                }}>
                                  {status}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {/* Per-listing validation issues */}
                      {(() => {
                        const allErrors: string[] = [];
                        const allWarnings: string[] = [];
                        for (const p of targetPlatforms) {
                          const v = validationMap[`${id}-${p}`];
                          if (!v) continue;
                          v.errors.forEach((e) => allErrors.push(`[${p}] ${e}`));
                          v.warnings.forEach((w) => allWarnings.push(`[${p}] ${w}`));
                        }
                        if (allErrors.length === 0 && allWarnings.length === 0) return null;
                        return (
                          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {allErrors.map((e) => (
                              <div key={e} style={{ fontSize: 11, color: 'var(--neon-red)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                {e}
                              </div>
                            ))}
                            {allWarnings.map((w) => (
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

            {/* Summary line */}
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, display: 'flex', gap: 16 }}>
              <span>{selectedListings.size} item{selectedListings.size !== 1 ? 's' : ''}</span>
              <span>{targetPlatforms.size} platform{targetPlatforms.size !== 1 ? 's' : ''}</span>
              <span>
                Total est. fees:{' '}
                <span style={{ color: 'var(--neon-orange)' }}>
                  {formatCurrency(
                    [...selectedListings].reduce((acc, id) => {
                      const listing = listings.find((l) => l.id === id);
                      if (!listing) return acc;
                      return acc + [...targetPlatforms].reduce((feeAcc, p) => {
                        if (listing.platforms[p]) return feeAcc; // skip already listed
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
            marginBottom: 12,
            padding: '10px 14px',
            borderRadius: 8,
            background: 'color-mix(in srgb, var(--neon-red) 8%, transparent)',
            border: '1px solid var(--neon-red)',
            color: 'var(--neon-red)',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Fix the errors above before cross-listing. Missing required fields (brand, size, price, etc.) must be filled in on the listing first.
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
