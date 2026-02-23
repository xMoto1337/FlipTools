import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useAnalyticsStore } from '../stores/analyticsStore';
import { analyticsApi } from '../api/analytics';
import { useSubscription, useFeatureGate } from '../hooks/useSubscription';
import { PaywallGate } from '../components/Subscription/PaywallGate';
import { RevenueChart } from '../components/Analytics/RevenueChart';
import { formatCurrency, formatDate } from '../utils/formatters';

const dateRanges = [
  { value: '7d' as const, label: '7D' },
  { value: '30d' as const, label: '30D' },
  { value: '90d' as const, label: '90D' },
  { value: '1y' as const, label: '1Y' },
  { value: '2y' as const, label: '2Y' },
];

export default function AnalyticsPage() {
  const { isAuthenticated } = useAuthStore();
  const {
    sales,
    stats,
    dateRange,
    platformFilter,
    isLoading,
    isSyncing,
    setSales,
    setStats,
    setDateRange,
    setPlatformFilter,
    setLoading,
    setSyncing,
    setLastSyncedAt,
    getDateRangeStart,
  } = useAnalyticsStore();

  const { isFree } = useSubscription();
  const { allowed: advancedAllowed } = useFeatureGate('advanced-analytics');
  const cancelledRef = useRef(false);

  const syncAndLoad = async (forceSync = false) => {
    if (!isAuthenticated) return;

    const store = useAnalyticsStore.getState();

    // Sync platform sales (skip if already syncing, unless forced)
    if (forceSync || !store.isSyncing) {
      if (!forceSync && store.isSyncing) {
        // Wait for existing sync
        while (useAnalyticsStore.getState().isSyncing) {
          await new Promise((r) => setTimeout(r, 500));
          if (cancelledRef.current) return;
        }
      } else {
        setSyncing(true);
        try {
          // Always sync ALL historical sales regardless of the display filter.
          // The display date filter is applied when loading from Supabase below.
          const result = await analyticsApi.syncPlatformSales(undefined, forceSync);
          if (!cancelledRef.current) {
            setLastSyncedAt(new Date().toISOString());
          }
          if (result.errors.length > 0) {
            console.warn('Sync issues:', result.errors);
          }
        } catch (err) {
          console.error('Sync error:', err);
        } finally {
          setSyncing(false);
        }
      }
    }

    if (cancelledRef.current) return;

    // Load from Supabase
    setLoading(true);
    try {
      const startDate = getDateRangeStart();
      const [salesData, statsData] = await Promise.all([
        analyticsApi.getSales({ startDate, platform: platformFilter || undefined }),
        analyticsApi.getStats(startDate),
      ]);
      if (!cancelledRef.current) {
        setSales(salesData);
        setStats(statsData);
      }
    } catch (err) {
      console.error('Analytics load error:', err);
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    cancelledRef.current = false;
    syncAndLoad();
    return () => { cancelledRef.current = true; };
  }, [dateRange, platformFilter, isAuthenticated]);

  // Get unique platforms from sales data for filter
  const platforms = [...new Set(sales.map((s) => s.platform))];

  // Filter sales by platform client-side for responsiveness
  const filteredSales = platformFilter
    ? sales.filter((s) => s.platform === platformFilter)
    : sales;

  return (
    <div>
      <div className="page-header">
        <h1>Analytics</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {isSyncing && (
            <span style={{ fontSize: 12, color: 'var(--neon-cyan)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <div className="spinner" style={{ width: 14, height: 14 }} />
              Syncing sales...
            </span>
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => syncAndLoad(true)}
            disabled={isSyncing || isLoading}
            title="Sync sales from connected platforms"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
          </button>
          <div className="date-range-picker">
            {dateRanges.map((r) => {
              const isRestricted = isFree && (r.value === '90d' || r.value === '1y' || r.value === '2y');
              return (
                <button
                  key={r.value}
                  className={`date-range-btn ${dateRange === r.value ? 'active' : ''}`}
                  onClick={() => !isRestricted && setDateRange(r.value)}
                  disabled={isRestricted}
                  title={isRestricted ? 'Upgrade to Pro for full history' : ''}
                >
                  {r.label}
                  {isRestricted && ' *'}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Revenue</div>
          <div className="stat-value">{formatCurrency(stats?.totalRevenue || 0)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Profit</div>
          <div className={`stat-value ${(stats?.totalProfit || 0) >= 0 ? 'positive' : 'negative'}`}>
            {formatCurrency(stats?.totalProfit || 0)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Items Sold</div>
          <div className="stat-value">{stats?.totalSales || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Profit per Sale</div>
          <div className={`stat-value ${(stats?.avgProfit || 0) >= 0 ? 'positive' : 'negative'}`}>
            {formatCurrency(stats?.avgProfit || 0)}
          </div>
        </div>
      </div>

      {/* Sales Chart */}
      <div className="chart-container" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div className="card-title">Revenue Over Time</div>
        </div>
        <RevenueChart sales={filteredSales} isLoading={isLoading || isSyncing} />
      </div>

      {/* Export - Pro only */}
      {!advancedAllowed && (
        <PaywallGate feature="CSV Export & Advanced Analytics">
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-title">Export Data</div>
          </div>
        </PaywallGate>
      )}

      {/* Recent Sales Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Sales</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {platforms.length > 0 && (
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  className={`btn btn-ghost btn-sm ${!platformFilter ? 'active' : ''}`}
                  onClick={() => setPlatformFilter('')}
                  style={{ fontSize: 11 }}
                >
                  All
                </button>
                {platforms.map((p) => (
                  <button
                    key={p}
                    className={`btn btn-ghost btn-sm ${platformFilter === p ? 'active' : ''}`}
                    onClick={() => setPlatformFilter(platformFilter === p ? '' : p)}
                    style={{ fontSize: 11 }}
                  >
                    <span className={`platform-badge ${p}`} style={{ fontSize: 10, padding: '1px 6px' }}>{p}</span>
                  </button>
                ))}
              </div>
            )}
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{filteredSales.length} sales</span>
          </div>
        </div>

        {isSyncing && filteredSales.length === 0 ? (
          <div className="loading-spinner" style={{ padding: 40 }}><div className="spinner" /></div>
        ) : filteredSales.length === 0 ? (
          <div className="empty-state" style={{ padding: 40 }}>
            <p style={{ color: 'var(--text-muted)' }}>
              {isAuthenticated ? 'No sales recorded yet. Connect eBay in Settings to sync your sales.' : 'Sign in to view your sales analytics.'}
            </p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Platform</th>
                <th>Sale Price</th>
                <th>Fees</th>
                <th>Profit</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {filteredSales.map((sale) => {
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
                      {sale.item_title || sale.listing?.title || 'Unknown item'}
                    </div>
                  </td>
                  <td><span className={`platform-badge ${sale.platform}`}>{sale.platform}</span></td>
                  <td>{formatCurrency(sale.sale_price)}</td>
                  <td style={{ color: 'var(--neon-red)' }}>{formatCurrency(sale.platform_fees)}</td>
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
    </div>
  );
}
