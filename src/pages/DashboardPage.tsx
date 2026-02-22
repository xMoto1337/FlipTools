import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useListingStore } from '../stores/listingStore';
import { useAnalyticsStore } from '../stores/analyticsStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useRequireAuth } from '../hooks/useRequireAuth';
import { analyticsApi } from '../api/analytics';
import { listingsApi } from '../api/listings';
import { formatCurrency, formatDate } from '../utils/formatters';

export default function DashboardPage() {
  const { subscription, isAuthenticated } = useAuthStore();
  const { requireAuth } = useRequireAuth();
  const { listings, setListings } = useListingStore();
  const {
    isSyncing,
    setSyncing,
    setLastSyncedAt,
  } = useAnalyticsStore();
  const { totalValue, totalItems } = useInventoryStore();
  const navigate = useNavigate();
  const [syncError, setSyncError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const mountedRef = useRef(true);

  // Dashboard-local state for 7-day window
  const [dashStats, setDashStats] = useState<{ totalRevenue: number; totalProfit: number; totalSales: number; avgProfit: number; avgSalePrice: number } | null>(null);
  const [recentSales, setRecentSales] = useState<typeof sales>([]);

  // Borrow the sales type
  const { sales } = useAnalyticsStore();

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const runSyncAndLoad = async (cancelled: { current: boolean }) => {
    setSyncError('');

    // Only sync if not already syncing (prevents race conditions on tab switch)
    const store = useAnalyticsStore.getState();
    if (!store.isSyncing) {
      setSyncing(true);
      try {
        const result = await analyticsApi.syncPlatformSales();
        if (!cancelled.current) {
          setLastSyncedAt(new Date().toISOString());
          setLastSynced(new Date());
          if (result.errors.length > 0) {
            setSyncError(result.errors.join('; '));
          }
        }
      } catch (err) {
        if (!cancelled.current) {
          console.error('Dashboard sync error:', err);
          setSyncError(err instanceof Error ? err.message : 'Sync failed');
        }
      } finally {
        setSyncing(false);
      }
    } else {
      // Wait for existing sync to finish
      while (useAnalyticsStore.getState().isSyncing) {
        await new Promise((r) => setTimeout(r, 500));
        if (cancelled.current) return;
      }
    }

    if (cancelled.current) return;

    // Load 7-day stats for dashboard
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    try {
      const [statsData, salesData, allListings] = await Promise.all([
        analyticsApi.getStats(sevenDaysAgo),
        analyticsApi.getSales({ limit: 10 }),
        listingsApi.getAll(),
      ]);
      if (!cancelled.current) {
        setDashStats(statsData);
        setRecentSales(salesData);
        setListings(allListings);
      }
    } catch (err) {
      if (!cancelled.current) console.error('Dashboard load error:', err);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    const cancelled = { current: false };
    runSyncAndLoad(cancelled);
    return () => { cancelled.current = true; };
  }, [isAuthenticated]);

  const handleManualRefresh = async () => {
    if (isRefreshing || isSyncing) return;
    setIsRefreshing(true);
    const cancelled = { current: false };
    await runSyncAndLoad(cancelled);
    setIsRefreshing(false);
  };

  const activeListings = listings.filter((l) => l.status === 'active').length;
  const draftListings = listings.filter((l) => l.status === 'draft').length;
  const topSales = recentSales.slice(0, 5);

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <div className="page-header-actions">
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Past 7 days</span>
          <button className="btn btn-primary" onClick={requireAuth(() => navigate('/listings'), 'Sign in to create listings')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Listing
          </button>
        </div>
      </div>

      {!isAuthenticated && (
        <div className="upgrade-prompt">
          <div className="upgrade-prompt-text">
            <h4>Welcome to FlipTools</h4>
            <p>Sign in to save your listings, track sales, and cross-list across platforms</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/auth')}>
            Sign In
          </button>
        </div>
      )}

      {isAuthenticated && subscription?.tier === 'free' && (
        <div className="upgrade-prompt">
          <div className="upgrade-prompt-text">
            <h4>Unlock unlimited cross-listing</h4>
            <p>Upgrade to Pro for unlimited listings, image search, and no ads</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/pricing')}>
            Upgrade
          </button>
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Revenue (7D)</div>
          <div className="stat-value">{formatCurrency(dashStats?.totalRevenue || 0)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Profit (7D)</div>
          <div className={`stat-value ${(dashStats?.totalProfit || 0) >= 0 ? 'positive' : 'negative'}`}>
            {formatCurrency(dashStats?.totalProfit || 0)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Listings</div>
          <div className="stat-value">{activeListings}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Items Sold (7D)</div>
          <div className="stat-value">{dashStats?.totalSales || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Inventory Value</div>
          <div className="stat-value">{formatCurrency(totalValue())}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Inventory Items</div>
          <div className="stat-value">{totalItems()}</div>
        </div>
      </div>

      {/* Recent Sales */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div className="card-title">Recent Sales</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {(isSyncing || isRefreshing) ? (
              <span style={{ fontSize: 12, color: 'var(--neon-cyan)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <div className="spinner" style={{ width: 14, height: 14 }} />
                Syncing...
              </span>
            ) : lastSynced ? (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Synced {lastSynced.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : null}
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleManualRefresh}
              disabled={isSyncing || isRefreshing}
              title="Refresh sales from eBay now"
              style={{ padding: '4px 8px' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                style={{ display: 'block', animation: (isSyncing || isRefreshing) ? 'spin 1s linear infinite' : undefined }}>
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
              </svg>
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => navigate('/analytics')}
              style={{ fontSize: 12 }}
            >
              View All
            </button>
          </div>
        </div>

        {syncError && (
          <div style={{
            margin: '0 0 12px',
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgba(255,59,48,0.08)',
            border: '1px solid var(--neon-red)',
            color: 'var(--neon-red)',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Sync error: {syncError}
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/settings')} style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--neon-cyan)' }}>
              Settings
            </button>
          </div>
        )}

        {(isSyncing || isRefreshing) && topSales.length === 0 ? (
          <div className="loading-spinner" style={{ padding: 32 }}><div className="spinner" /></div>
        ) : topSales.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
            {isAuthenticated
              ? syncError
                ? 'Could not load sales — check the error above and try refreshing.'
                : 'No sales yet. Connect eBay in Settings to sync your sales.'
              : 'Sign in to view your sales.'}
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Platform</th>
                <th>Sale Price</th>
                <th>Profit</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {topSales.map((sale) => (
                <tr key={sale.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {sale.item_image_url && (
                        <img
                          src={sale.item_image_url}
                          alt=""
                          style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover' }}
                        />
                      )}
                      <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sale.item_title || sale.listing?.title || 'Unknown item'}
                      </span>
                    </div>
                  </td>
                  <td><span className={`platform-badge ${sale.platform}`}>{sale.platform}</span></td>
                  <td>{formatCurrency(sale.sale_price)}</td>
                  <td style={{ color: sale.profit >= 0 ? 'var(--neon-green)' : 'var(--neon-red)' }}>
                    {formatCurrency(sale.profit)}
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>{formatDate(sale.sold_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <div className="card-header">
            <div className="card-title">Quick Actions</div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={requireAuth(() => navigate('/cross-list'), 'Sign in to cross-list items')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
              Cross List
            </button>
            <button className="btn btn-secondary" onClick={requireAuth(() => navigate('/research'), 'Sign in to use price research')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              Price Research
            </button>
            <button className="btn btn-secondary" onClick={requireAuth(() => navigate('/inventory'), 'Sign in to track inventory')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
              Add Inventory
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Listing Summary</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Active</span>
              <span className="status-badge active"><span className="status-dot" />{activeListings}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Drafts</span>
              <span className="status-badge draft"><span className="status-dot" />{draftListings}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Total</span>
              <span>{listings.length}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
