import type { MarketAnalysis as MarketAnalysisType } from '../../utils/researchAnalytics';
import { useFeatureGate } from '../../hooks/useSubscription';
import { PaywallGate } from '../Subscription/PaywallGate';
import { DemandMeter } from './DemandMeter';
import { formatCurrency, formatPercent } from '../../utils/formatters';

interface MarketAnalysisProps {
  analysis: MarketAnalysisType;
}

export function MarketAnalysis({ analysis }: MarketAnalysisProps) {
  const { allowed: advancedAllowed } = useFeatureGate('market-analysis');

  const maxDayCount = Math.max(...Object.values(analysis.dayOfWeekDistribution), 1);

  return (
    <div>
      <div className="stats-grid">
        {/* Always visible */}
        <div className="stat-card">
          <div className="stat-label">Avg Sold Price</div>
          <div className="stat-value">{formatCurrency(analysis.avgPrice)}</div>
          <div className="stat-sub">Median: {formatCurrency(analysis.medianPrice)}</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Price Range</div>
          <div className="stat-value" style={{ fontSize: 18 }}>
            {formatCurrency(analysis.minPrice)} – {formatCurrency(analysis.maxPrice)}
          </div>
          <div className="stat-sub">Std Dev: {formatCurrency(analysis.priceStdDev)}</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Results Found</div>
          <div className="stat-value">{analysis.resultCount}</div>
          <div className="stat-sub">{analysis.sellThroughRate}% with sold dates</div>
        </div>

        {/* Pro-only cards */}
        {!advancedAllowed ? (
          <PaywallGate feature="Market Analysis & Demand Scoring">
            <div className="stat-card">
              <div className="stat-label">Demand Score</div>
              <div className="stat-value">--</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Best Day to Sell</div>
              <div className="stat-value">--</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Price Trend</div>
              <div className="stat-value">--</div>
            </div>
          </PaywallGate>
        ) : (
          <>
            <div className="stat-card">
              <div className="stat-label">Demand Score</div>
              <DemandMeter score={analysis.demandScore} label={analysis.demandLabel} />
            </div>

            <div className="stat-card">
              <div className="stat-label">Best Day to Sell</div>
              <div className="stat-value" style={{ fontSize: 18 }}>{analysis.bestDayOfWeek}</div>
              <div className="day-distribution">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => {
                  const fullDay = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i];
                  const count = analysis.dayOfWeekDistribution[fullDay] || 0;
                  return (
                    <div key={day} className="day-bar-wrapper">
                      <div
                        className="day-bar"
                        style={{ height: `${(count / maxDayCount) * 100}%` }}
                        title={`${fullDay}: ${count} sales`}
                      />
                      <span className="day-label">{day}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-label">Price Trend</div>
              <div className={`stat-value ${analysis.priceTrend === 'up' ? 'positive' : analysis.priceTrend === 'down' ? 'negative' : ''}`}>
                {analysis.priceTrend === 'up' ? '↑' : analysis.priceTrend === 'down' ? '↓' : '→'}{' '}
                {formatPercent(analysis.trendPercent)}
              </div>
              <div className="stat-sub">
                {analysis.priceTrend === 'up' ? 'Prices rising' : analysis.priceTrend === 'down' ? 'Prices falling' : 'Prices stable'}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
