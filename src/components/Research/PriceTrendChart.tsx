import { useEffect, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import type { SoldItem } from '../../api/platforms/types';
import type { MarketAnalysis } from '../../utils/researchAnalytics';
import { formatCurrency } from '../../utils/formatters';

interface PriceTrendChartProps {
  results: SoldItem[];
  analysis: MarketAnalysis | null;
  isLoading: boolean;
}

export function PriceTrendChart({ results, analysis, isLoading }: PriceTrendChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartContainerRef.current || isLoading) return;

    // Only render if we have items with dates
    const itemsWithDates = results
      .filter((r) => r.soldDate && !isNaN(new Date(r.soldDate).getTime()))
      .map((r) => ({ date: r.soldDate.split('T')[0], price: r.price }))
      .sort((a, b) => a.date.localeCompare(b.date));

    if (itemsWithDates.length === 0) return;

    const container = chartContainerRef.current;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#888888',
      },
      grid: {
        vertLines: { color: '#1a1a1a' },
        horzLines: { color: '#1a1a1a' },
      },
      width: container.clientWidth,
      height: 250,
      timeScale: {
        borderColor: '#222222',
        timeVisible: false,
      },
      rightPriceScale: {
        borderColor: '#222222',
      },
      crosshair: {
        vertLine: { color: '#00ffff40', width: 1, labelBackgroundColor: '#111111' },
        horzLine: { color: '#00ffff40', width: 1, labelBackgroundColor: '#111111' },
      },
    });

    // Aggregate by date (average prices on same day)
    const dateMap = new Map<string, { sum: number; count: number }>();
    for (const item of itemsWithDates) {
      const existing = dateMap.get(item.date);
      if (existing) {
        existing.sum += item.price;
        existing.count++;
      } else {
        dateMap.set(item.date, { sum: item.price, count: 1 });
      }
    }

    const chartData = [...dateMap.entries()]
      .map(([date, { sum, count }]) => ({ time: date, value: sum / count }))
      .sort((a, b) => a.time.localeCompare(b.time));

    // Sold prices series
    const priceSeries = chart.addAreaSeries({
      lineColor: '#00ffff',
      topColor: '#00ffff25',
      bottomColor: '#00ffff05',
      lineWidth: 2,
      priceFormat: { type: 'custom', formatter: (price: number) => `$${price.toFixed(2)}` },
    });
    priceSeries.setData(chartData as Parameters<typeof priceSeries.setData>[0]);

    // 7-point moving average
    if (chartData.length >= 3) {
      const windowSize = Math.min(7, Math.floor(chartData.length / 2));
      const maData = chartData.map((point, i) => {
        const start = Math.max(0, i - windowSize + 1);
        const window = chartData.slice(start, i + 1);
        const avg = window.reduce((s, p) => s + p.value, 0) / window.length;
        return { time: point.time, value: avg };
      });

      const maSeries = chart.addLineSeries({
        color: '#00ff41',
        lineWidth: 2,
        lineStyle: 0,
        priceFormat: { type: 'custom', formatter: (price: number) => `$${price.toFixed(2)}` },
      });
      maSeries.setData(maData as Parameters<typeof maSeries.setData>[0]);
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (container) chart.applyOptions({ width: container.clientWidth });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [results, isLoading]);

  const hasDateData = results.some((r) => r.soldDate && !isNaN(new Date(r.soldDate).getTime()));

  if (isLoading) {
    return (
      <div style={{ height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!hasDateData) {
    return (
      <div style={{ height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        <p>No date data available for price trends</p>
      </div>
    );
  }

  return (
    <div>
      <div ref={chartContainerRef} />
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8 }}>
        <span style={{ fontSize: 12, color: '#888' }}>
          <span style={{ display: 'inline-block', width: 12, height: 3, background: '#00ffff', marginRight: 6, verticalAlign: 'middle' }} />
          Sold Prices
        </span>
        <span style={{ fontSize: 12, color: '#888' }}>
          <span style={{ display: 'inline-block', width: 12, height: 3, background: '#00ff41', marginRight: 6, verticalAlign: 'middle' }} />
          Moving Avg
        </span>
      </div>

      {/* Price Distribution Histogram */}
      {analysis && analysis.priceDistribution.length > 1 && (
        <div className="price-histogram" style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Price Distribution</div>
          {analysis.priceDistribution.map((bucket, i) => {
            const maxCount = Math.max(...analysis.priceDistribution.map((b) => b.count), 1);
            return (
              <div key={i} className="price-histogram-row">
                <span className="price-histogram-label">
                  {formatCurrency(bucket.min)}
                </span>
                <div className="price-histogram-bar-track">
                  <div
                    className="price-histogram-bar"
                    style={{ width: `${(bucket.count / maxCount) * 100}%` }}
                  />
                </div>
                <span className="price-histogram-count">{bucket.count}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
