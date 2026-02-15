import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useAnalyticsStore } from '../stores/analyticsStore';
import { analyticsApi } from '../api/analytics';
import { useSubscription, useFeatureGate } from '../hooks/useSubscription';
import { PaywallGate } from '../components/Subscription/PaywallGate';
import { formatCurrency, formatDate } from '../utils/formatters';

const dateRanges = [
  { value: '7d' as const, label: '7D' },
  { value: '30d' as const, label: '30D' },
  { value: '90d' as const, label: '90D' },
  { value: '1y' as const, label: '1Y' },
  { value: 'all' as const, label: 'All' },
];

export default function AnalyticsPage() {
  const { isAuthenticated } = useAuthStore();
  const {
    sales,
    stats,
    dateRange,
    isLoading,
    setSales,
    setStats,
    setDateRange,
    setLoading,
    getDateRangeStart,
  } = useAnalyticsStore();

  const { isFree } = useSubscription();
  const { allowed: advancedAllowed } = useFeatureGate('advanced-analytics');

  useEffect(() => {
    if (!isAuthenticated) return;
    const load = async () => {
      setLoading(true);
      try {
        const startDate = getDateRangeStart();
        const [salesData, statsData] = await Promise.all([
          analyticsApi.getSales({ startDate, limit: 100 }),
          analyticsApi.getStats(startDate),
        ]);
        setSales(salesData);
        setStats(statsData);
      } catch (err) {
        console.error('Analytics load error:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [dateRange, isAuthenticated]);

  return (
    <div>
      <div className="page-header">
        <h1>Analytics</h1>
        <div className="date-range-picker">
          {dateRanges.map((r) => {
            const isRestricted = isFree && (r.value === '90d' || r.value === '1y' || r.value === 'all');
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

      {/* Sales Chart placeholder */}
      <div className="chart-container" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div className="card-title">Revenue Over Time</div>
        </div>
        <div style={{ height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
          {isLoading ? (
            <div className="spinner" />
          ) : sales.length > 0 ? (
            <p>Chart visualization will render here with lightweight-charts</p>
          ) : (
            <p>No sales data for this period</p>
          )}
        </div>
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
          <div className="card-title">Recent Sales</div>
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{sales.length} sales</span>
        </div>

        {sales.length === 0 ? (
          <div className="empty-state" style={{ padding: 40 }}>
            <p style={{ color: 'var(--text-muted)' }}>No sales recorded yet</p>
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
              {sales.map((sale) => (
                <tr key={sale.id}>
                  <td>{sale.listing?.title || 'Unknown item'}</td>
                  <td><span className={`platform-badge ${sale.platform}`}>{sale.platform}</span></td>
                  <td>{formatCurrency(sale.sale_price)}</td>
                  <td style={{ color: 'var(--neon-red)' }}>{formatCurrency(sale.platform_fees)}</td>
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
    </div>
  );
}
