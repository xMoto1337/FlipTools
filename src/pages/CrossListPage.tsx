import { useState } from 'react';
import { useListingStore } from '../stores/listingStore';
import { usePlatformStore } from '../stores/platformStore';
import { useRequireAuth } from '../hooks/useRequireAuth';
import { getPlatform, getAllPlatforms } from '../api/platforms';
import type { PlatformId } from '../api/platforms';
import { useFeatureGate } from '../hooks/useSubscription';
import { PaywallGate } from '../components/Subscription/PaywallGate';
import { formatCurrency } from '../utils/formatters';
import { supabase } from '../api/supabase';

export default function CrossListPage() {
  const { requireAuth } = useRequireAuth();
  const { listings } = useListingStore();
  const { isConnected, getToken } = usePlatformStore();
  const [selectedListings, setSelectedListings] = useState<Set<string>>(new Set());
  const [targetPlatforms, setTargetPlatforms] = useState<Set<PlatformId>>(new Set());
  const [crossListStatus, setCrossListStatus] = useState<Record<string, string>>({});
  const [isCrossListing, setIsCrossListing] = useState(false);

  const { allowed: crossListAllowed } = useFeatureGate('cross-list');
  const platforms = getAllPlatforms();

  const toggleListing = (id: string) => {
    const next = new Set(selectedListings);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedListings(next);
  };

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

          // Save cross-listing mapping to Supabase (critical for auto-delist)
          const updatedPlatforms = {
            ...listing.platforms,
            [platformId]: { id: result.externalId, url: result.url, status: result.status },
          };
          await supabase.from('listings').update({ platforms: updatedPlatforms }).eq('id', listingId);
          // Also update local state
          listing.platforms = updatedPlatforms;

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

  const eligibleListings = listings.filter((l) => l.status === 'active' || l.status === 'draft');

  return (
    <div>
      <div className="page-header">
        <h1>Cross List</h1>
      </div>

      {/* Step 1: Select Listings */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div className="card-title">1. Select Listings</div>
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{selectedListings.size} selected</span>
        </div>
        {eligibleListings.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>No listings available. Create some listings first.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
            {eligibleListings.map((listing) => (
              <label key={listing.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 8, borderRadius: 8, cursor: 'pointer', background: selectedListings.has(listing.id) ? 'var(--bg-hover)' : 'transparent' }}>
                <input type="checkbox" className="table-checkbox" checked={selectedListings.has(listing.id)} onChange={requireAuth(() => toggleListing(listing.id), 'Sign in to cross-list items')} />
                <span style={{ flex: 1 }}>{listing.title}</span>
                <span style={{ color: 'var(--neon-green)', fontWeight: 600 }}>{formatCurrency(listing.price || 0)}</span>
                <div className="listing-platforms">
                  {Object.keys(listing.platforms).map((p) => (
                    <span key={p} className={`platform-badge ${p}`}>{p}</span>
                  ))}
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Step 2: Select Target Platforms */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div className="card-title">2. Select Target Platforms</div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {platforms.map((p) => (
            <button
              key={p.id}
              className={`btn ${targetPlatforms.has(p.id) ? 'btn-primary' : 'btn-secondary'}`}
              onClick={requireAuth(() => togglePlatform(p.id), 'Sign in to connect platforms')}
              disabled={!isConnected(p.id)}
            >
              {p.name}
              {!isConnected(p.id) && <span style={{ fontSize: 11, opacity: 0.7 }}> (not connected)</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Step 3: Review & Cross List */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div className="card-title">3. Review & Cross List</div>
        </div>

        {/* Fee Preview */}
        {selectedListings.size > 0 && targetPlatforms.size > 0 && (
          <div style={{ marginBottom: 16 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Listing</th>
                  {[...targetPlatforms].map((p) => (
                    <th key={p}>{p} Fees</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...selectedListings].map((id) => {
                  const listing = listings.find((l) => l.id === id);
                  if (!listing) return null;
                  return (
                    <tr key={id}>
                      <td>{listing.title}</td>
                      {[...targetPlatforms].map((p) => {
                        const adapter = getPlatform(p);
                        const fees = adapter.calculateFees(listing.price || 0);
                        const statusKey = `${id}-${p}`;
                        return (
                          <td key={p}>
                            <div style={{ fontSize: 12 }}>
                              Fees: {formatCurrency(fees.totalFees)}
                              <br />
                              Net: <span style={{ color: 'var(--neon-green)' }}>{formatCurrency(fees.netProceeds)}</span>
                            </div>
                            {crossListStatus[statusKey] && (
                              <div style={{ fontSize: 11, marginTop: 4, color: crossListStatus[statusKey] === 'Success' ? 'var(--neon-green)' : 'var(--neon-orange)' }}>
                                {crossListStatus[statusKey]}
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

        {!crossListAllowed ? (
          <PaywallGate feature="Unlimited cross-listing">
            <button className="btn btn-primary btn-lg" disabled>Cross List Now</button>
          </PaywallGate>
        ) : (
          <button
            className="btn btn-primary btn-lg"
            onClick={requireAuth(handleCrossList, 'Sign in to cross-list items')}
            disabled={selectedListings.size === 0 || targetPlatforms.size === 0 || isCrossListing}
          >
            {isCrossListing ? 'Cross-listing...' : `Cross List ${selectedListings.size} item${selectedListings.size !== 1 ? 's' : ''} to ${targetPlatforms.size} platform${targetPlatforms.size !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>
    </div>
  );
}
