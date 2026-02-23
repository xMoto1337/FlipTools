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
  const [insightTab, setInsightTab] = useState<'flips' | 'stale' | 'monthly' | 'velocity'>('flips');
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

  const now = Date.now();

  // Stale Listings: active listings sorted by time since their last sale
  // Build a title → listing id lookup for fallback matching (listing_id is rarely set on synced sales)
  const listingByTitle = listings.reduce<Record<string, string>>((acc, l) => {
    acc[l.title.toLowerCase().trim()] = l.id;
    return acc;
  }, {});
  const lastSaleByListing = recentSales.reduce<Record<string, number>>((acc, sale) => {
    const t = new Date(sale.sold_at).getTime();
    // Prefer direct listing_id link, fall back to title match
    const listingId = sale.listing_id ?? listingByTitle[sale.item_title?.toLowerCase().trim() ?? ''];
    if (listingId) {
      if (!acc[listingId] || t > acc[listingId]) acc[listingId] = t;
    }
    return acc;
  }, {});
  const staleListings = listings
    .filter((l) => l.status === 'active')
    .map((l) => {
      const lastSale = lastSaleByListing[l.id];
      const daysSinceSale = lastSale ? Math.floor((now - lastSale) / 86400000) : null;
      const daysListed = Math.floor((now - new Date(l.created_at).getTime()) / 86400000);
      return { ...l, daysSinceSale, daysListed };
    })
    // Only show listings with no sale in 30+ days, or listed 30+ days with no sales at all
    .filter((l) => l.daysSinceSale !== null ? l.daysSinceSale >= 30 : l.daysListed >= 30)
    .sort((a, b) => {
      // Slow sellers (have sold before, just not recently) come first — most actionable
      // Never-sold listings go at the end
      const aHasSales = a.daysSinceSale !== null;
      const bHasSales = b.daysSinceSale !== null;
      if (aHasSales && !bHasSales) return -1;
      if (!aHasSales && bHasSales) return 1;
      // Within each group, sort by days descending (worst first)
      const aDays = a.daysSinceSale ?? a.daysListed;
      const bDays = b.daysSinceSale ?? b.daysListed;
      return bDays - aDays;
    })
    .slice(0, 50);

  // Best Flips: top 50 sales sorted by profit descending
  const bestFlips = [...recentSales].sort((a, b) => b.profit - a.profit).slice(0, 50);

  // Monthly Snapshot: this month vs last month
  const startOfThisMonth = new Date(); startOfThisMonth.setDate(1); startOfThisMonth.setHours(0, 0, 0, 0);
  const startOfLastMonth = new Date(startOfThisMonth); startOfLastMonth.setMonth(startOfLastMonth.getMonth() - 1);
  const thisMonthSales = recentSales.filter((s) => new Date(s.sold_at) >= startOfThisMonth);
  const lastMonthSales = recentSales.filter((s) => new Date(s.sold_at) >= startOfLastMonth && new Date(s.sold_at) < startOfThisMonth);
  const monthlySnap = {
    thisRevenue: thisMonthSales.reduce((s, x) => s + x.sale_price, 0),
    lastRevenue: lastMonthSales.reduce((s, x) => s + x.sale_price, 0),
    thisProfit: thisMonthSales.reduce((s, x) => s + x.profit, 0),
    lastProfit: lastMonthSales.reduce((s, x) => s + x.profit, 0),
    thisCount: thisMonthSales.length,
    lastCount: lastMonthSales.length,
  };

  // Sales Velocity: avg sales/week over 4 weeks, week-by-week breakdown
  const weekMs = 7 * 86400000;
  const velocityWeeks = [0, 1, 2, 3].map((i) => {
    const end = new Date(now - i * weekMs);
    const start = new Date(now - (i + 1) * weekMs);
    return recentSales.filter((s) => { const d = new Date(s.sold_at); return d >= start && d < end; }).length;
  }).reverse(); // oldest to newest
  const avgPerWeek = velocityWeeks.reduce((a, b) => a + b, 0) / 4;
  const thisWeekSales = velocityWeeks[3];
  const lastWeekSales = velocityWeeks[2];
  const velocityTrend = thisWeekSales - lastWeekSales;
  const maxWeekSales = Math.max(...velocityWeeks, 1);

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
              {recentSales.slice(0, 10).map((sale) => {
                const saleImg = sale.item_image_url || sale.listing?.images?.[0];
                return (
                <tr key={sale.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ position: 'relative', width: 32, height: 32, borderRadius: 4, background: 'var(--bg-tertiary)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {saleImg && (
                          <img
                            src={saleImg}
                            alt=""
                            referrerPolicy="no-referrer"
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', borderRadius: 4, objectFit: 'cover' }}
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                        )}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                      </div>
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
              )})}
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

        {/* Insights — tabbed: Best Flips / Stale / Monthly / Velocity */}
        <div className="card">
          <div className="card-header" style={{ flexDirection: 'column', gap: 10, alignItems: 'stretch' }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {([
                { id: 'flips', label: 'Best Flips' },
                { id: 'stale', label: 'Stale' },
                { id: 'monthly', label: 'Monthly' },
                { id: 'velocity', label: 'Velocity' },
              ] as const).map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setInsightTab(id)}
                  style={{
                    padding: '3px 10px',
                    borderRadius: 6,
                    border: '1px solid',
                    fontSize: 11,
                    cursor: 'pointer',
                    background: insightTab === id ? 'var(--neon-cyan)' : 'transparent',
                    borderColor: insightTab === id ? 'var(--neon-cyan)' : 'var(--border)',
                    color: insightTab === id ? '#000' : 'var(--text-secondary)',
                    fontWeight: insightTab === id ? 600 : 400,
                    transition: 'all 0.15s',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Best Flips */}
          {insightTab === 'flips' && (
            <div>
              {bestFlips.length === 0 ? (
                <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No sales data yet</div>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto', paddingRight: 4 }}>
                    {bestFlips.map((sale, i) => {
                      const saleImg = sale.item_image_url || sale.listing?.images?.[0];
                      return (
                      <div
                        key={sale.id}
                        onClick={() => navigate('/analytics')}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '6px 8px', borderRadius: 8, cursor: 'pointer',
                          transition: 'background 0.12s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 18, flexShrink: 0, textAlign: 'right' }}>{i + 1}.</span>
                        <div style={{ position: 'relative', width: 32, height: 32, borderRadius: 4, background: 'var(--bg-tertiary)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {saleImg && (
                            <img src={saleImg} alt="" referrerPolicy="no-referrer" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', borderRadius: 4, objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                          )}
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {sale.item_title || sale.listing?.title || 'Unknown'}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 6, marginTop: 1 }}>
                            <span className={`platform-badge ${sale.platform}`} style={{ fontSize: 9, padding: '1px 5px' }}>{sale.platform}</span>
                            <span>{formatCurrency(sale.sale_price)}</span>
                            <span>{formatDate(sale.sold_at)}</span>
                          </div>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: sale.profit >= 0 ? 'var(--neon-green)' : 'var(--neon-red)', flexShrink: 0 }}>
                          {sale.profit >= 0 ? '+' : ''}{formatCurrency(sale.profit)}
                        </span>
                      </div>
                    )})}
                  </div>
                  <div style={{ paddingTop: 6, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                    Top {bestFlips.length} by profit · past 2Y · click to view in Analytics
                  </div>
                </>
              )}
            </div>
          )}

          {/* Stale Listings */}
          {insightTab === 'stale' && (
            <div>
              {staleListings.length === 0 ? (
                <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  No listings 30+ days without a sale
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto', paddingRight: 4 }}>
                    {staleListings.map((l) => {
                      const neverSold = l.daysSinceSale === null;
                      const staleDays = l.daysSinceSale ?? l.daysListed;
                      const color = staleDays >= 90 ? 'var(--neon-red)' : staleDays >= 60 ? '#f5a623' : 'var(--text-secondary)';
                      const platformUrl = Object.values(l.platforms).find((p) => (p as { url?: string }).url)?.url as string | undefined;
                      const handleClick = () => {
                        if (platformUrl) window.open(platformUrl, '_blank', 'noopener');
                        else navigate('/listings');
                      };
                      return (
                        <div
                          key={l.id}
                          onClick={handleClick}
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '6px 8px', borderRadius: 8, cursor: 'pointer', transition: 'background 0.12s',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <div style={{ position: 'relative', width: 28, height: 28, borderRadius: 4, background: 'var(--bg-tertiary)', flexShrink: 0 }}>
                              {l.images?.[0] && (
                                <img src={l.images[0]} alt="" referrerPolicy="no-referrer" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', borderRadius: 4, objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                              )}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{l.title}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1, display: 'flex', gap: 5, alignItems: 'center' }}>
                                {l.price ? <span style={{ color: 'var(--neon-green)', fontWeight: 600 }}>{formatCurrency(l.price)}</span> : null}
                                {Object.keys(l.platforms).length > 0
                                  ? Object.keys(l.platforms).map((p) => (
                                      <span key={p} className={`platform-badge ${p}`} style={{ fontSize: 9, padding: '1px 5px' }}>{p}</span>
                                    ))
                                  : <span>no platform</span>}
                              </div>
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color }}>
                              {neverSold ? `${l.daysListed}d listed` : `${l.daysSinceSale}d since sale`}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                              {neverSold ? 'never sold' : `listed ${l.daysListed}d`}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ paddingTop: 6, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                    <span>Red = 90+d · Yellow = 60+d · Slow sellers first</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => navigate('/listings')} style={{ fontSize: 11, padding: 0 }}>Manage</button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Monthly Snapshot */}
          {insightTab === 'monthly' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {([
                { label: 'Revenue', thisVal: monthlySnap.thisRevenue, lastVal: monthlySnap.lastRevenue, fmt: formatCurrency },
                { label: 'Profit', thisVal: monthlySnap.thisProfit, lastVal: monthlySnap.lastProfit, fmt: formatCurrency },
                { label: 'Items Sold', thisVal: monthlySnap.thisCount, lastVal: monthlySnap.lastCount, fmt: (v: number) => String(v) },
              ] as const).map(({ label, thisVal, lastVal, fmt }) => {
                const diff = thisVal - lastVal;
                const pct = lastVal > 0 ? Math.round((diff / lastVal) * 100) : 0;
                const up = diff >= 0;
                return (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{fmt(thisVal)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: up ? 'var(--neon-green)' : 'var(--neon-red)', fontWeight: 600 }}>
                        {up ? '▲' : '▼'} {Math.abs(pct)}%
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>vs {fmt(lastVal)} last mo</div>
                    </div>
                  </div>
                );
              })}
              <div style={{ paddingTop: 4, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)' }}>
                {new Date().toLocaleString('default', { month: 'long', year: 'numeric' })} vs prior month
              </div>
            </div>
          )}

          {/* Sales Velocity */}
          {insightTab === 'velocity' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{avgPerWeek.toFixed(1)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>avg sales / week</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: velocityTrend >= 0 ? 'var(--neon-green)' : 'var(--neon-red)' }}>
                    {velocityTrend >= 0 ? '▲' : '▼'} {Math.abs(velocityTrend)} this week
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{thisWeekSales} vs {lastWeekSales} last week</div>
                </div>
              </div>
              {/* Mini bar chart — 4 weeks */}
              <div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 48 }}>
                  {velocityWeeks.map((count, i) => (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                      <div style={{
                        width: '100%',
                        height: `${Math.round((count / maxWeekSales) * 40) + 4}px`,
                        borderRadius: '3px 3px 0 0',
                        background: i === 3 ? 'var(--neon-cyan)' : 'var(--bg-tertiary)',
                        border: i === 3 ? '1px solid var(--neon-cyan)' : '1px solid var(--border)',
                        minHeight: 4,
                        transition: 'height 0.3s ease',
                      }} />
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{count}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
                  <span>4W ago</span><span>3W</span><span>2W</span><span style={{ color: 'var(--neon-cyan)' }}>This W</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
