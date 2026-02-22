import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useListingStore } from '../stores/listingStore';
import { useAnalyticsStore } from '../stores/analyticsStore';
import { analyticsApi } from '../api/analytics';
import { listingsApi } from '../api/listings';
import { formatCurrency, formatDate } from '../utils/formatters';

export default function DashboardPage() {
  const { subscription, isAuthenticated } = useAuthStore();
  const { listings, setListings } = useListingStore();
  const {
    isSyncing,
    setSyncing,
    setLastSyncedAt,
  } = useAnalyticsStore();
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

  const runSyncAndLoad = async (cancelled: { current: boolean }, force = false) => {
    setSyncError('');

    // Only sync if not already syncing (prevents race conditions on tab switch)
    const store = useAnalyticsStore.getState();
    if (!store.isSyncing) {
      setSyncing(true);
      try {
        const result = await analyticsApi.syncPlatformSales(undefined, force);
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

    // Load dashboard data: 7-day stats, recent 10 sales for table,
    // and up to 500 sales over 2 years for platform breakdown
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const twoYearsAgo = (() => {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 2);
      return d.toISOString();
    })();
    try {
      const [statsData, salesData, allListings] = await Promise.all([
        analyticsApi.getStats(sevenDaysAgo),
        analyticsApi.getSales({ startDate: twoYearsAgo, limit: 500 }),
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
    await runSyncAndLoad(cancelled, true); // force = true bypasses 10-min cache
    setIsRefreshing(false);
  };

  const activeListings = listings.filter((l) => l.status === 'active').length;
  const soldListings = listings.filter((l) => l.status === 'sold').length;

  // Platform performance breakdown from recent sales
  const platformBreakdown = recentSales.reduce<Record<string, { revenue: number; profit: number; count: number }>>((acc, sale) => {
    const p = sale.platform || 'unknown';
    if (!acc[p]) acc[p] = { revenue: 0, profit: 0, count: 0 };
    acc[p].revenue += sale.sale_price || 0;
    acc[p].profit += sale.profit || 0;
    acc[p].count += 1;
    return acc;
  }, {});
  const platformEntries = Object.entries(platformBreakdown).sort((a, b) => b[1].revenue - a[1].revenue);

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <div className="page-header-actions">
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Past 7 days</span>
          <button className="btn btn-primary" onClick={() => navigate('/listings')}>
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
          <div className="stat-label">Avg Profit/Sale (7D)</div>
          <div className={`stat-value ${(dashStats?.avgProfit || 0) >= 0 ? 'positive' : 'negative'}`}>
            {formatCurrency(dashStats?.avgProfit || 0)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Sold</div>
          <div className="stat-value">{soldListings}</div>
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

        {(isSyncing || isRefreshing) && recentSales.length === 0 ? (
          <div className="loading-spinner" style={{ padding: 32 }}><div className="spinner" /></div>
        ) : recentSales.length === 0 ? (
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
              {recentSales.slice(0, 10).map((sale) => (
                <tr key={sale.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {sale.item_image_url ? (
                        <img
                          src={sale.item_image_url}
                          alt=""
                          style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
                        />
                      ) : (
                        <div style={{ width: 32, height: 32, borderRadius: 4, background: 'var(--bg-tertiary)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                        </div>
                      )}
                      <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

      {/* Bottom row: Platform Performance + Listing Health */}
      <div className="dashboard-grid">
        {/* Platform Performance */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Platform Performance</div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Past 2Y</span>
          </div>
          {platformEntries.length === 0 ? (
            <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No sales data yet
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {platformEntries.map(([platform, stats]) => {
                const totalRevenue = platformEntries.reduce((s, [, v]) => s + v.revenue, 0);
                const pct = totalRevenue > 0 ? Math.round((stats.revenue / totalRevenue) * 100) : 0;
                const margin = stats.revenue > 0 ? Math.round((stats.profit / stats.revenue) * 100) : 0;
                return (
                  <div key={platform}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className={`platform-badge ${platform}`}>{platform}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{stats.count} sale{stats.count !== 1 ? 's' : ''}</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{formatCurrency(stats.revenue)}</div>
                        <div style={{ fontSize: 11, color: stats.profit >= 0 ? 'var(--neon-green)' : 'var(--neon-red)' }}>
                          {formatCurrency(stats.profit)} ({margin}% margin)
                        </div>
                      </div>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, borderRadius: 2, background: 'var(--neon-cyan)', transition: 'width 0.4s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Listing Health */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Listing Health</div>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/listings')} style={{ fontSize: 12 }}>
              Manage
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              { label: 'Active', count: activeListings, color: 'var(--neon-green)', total: listings.length },
              { label: 'Sold', count: soldListings, color: 'var(--neon-cyan)', total: listings.length },
              { label: 'Draft', count: listings.filter((l) => l.status === 'draft').length, color: 'var(--text-muted)', total: listings.length },
              { label: 'Ended', count: listings.filter((l) => l.status === 'ended').length, color: 'var(--neon-red)', total: listings.length },
            ].map(({ label, count, color, total }) => (
              <div key={label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color }}>{count}</span>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: total > 0 ? `${Math.round((count / total) * 100)}%` : '0%', borderRadius: 2, background: color, transition: 'width 0.4s ease' }} />
                </div>
              </div>
            ))}
            <div style={{ paddingTop: 4, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
              <span>Total listings</span>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{listings.length}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
