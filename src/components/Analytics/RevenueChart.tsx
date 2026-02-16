import { useEffect, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import type { Sale } from '../../api/analytics';

interface RevenueChartProps {
  sales: Sale[];
  isLoading: boolean;
}

export function RevenueChart({ sales, isLoading }: RevenueChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartContainerRef.current || isLoading || sales.length === 0) return;

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

    // Aggregate sales by date
    const dailyRevenue = new Map<string, number>();
    const dailyProfit = new Map<string, number>();

    for (const sale of sales) {
      const date = sale.sold_at.split('T')[0];
      dailyRevenue.set(date, (dailyRevenue.get(date) || 0) + sale.sale_price);
      dailyProfit.set(date, (dailyProfit.get(date) || 0) + sale.profit);
    }

    const sortedDates = [...dailyRevenue.keys()].sort();

    const revenueData = sortedDates.map((date) => ({
      time: date,
      value: dailyRevenue.get(date) || 0,
    }));

    const profitData = sortedDates.map((date) => ({
      time: date,
      value: dailyProfit.get(date) || 0,
    }));

    const revenueSeries = chart.addAreaSeries({
      lineColor: '#00ffff',
      topColor: '#00ffff30',
      bottomColor: '#00ffff05',
      lineWidth: 2,
      priceFormat: { type: 'custom', formatter: (price: number) => `$${price.toFixed(2)}` },
    });
    revenueSeries.setData(revenueData as Parameters<typeof revenueSeries.setData>[0]);

    const profitSeries = chart.addAreaSeries({
      lineColor: '#00ff41',
      topColor: '#00ff4120',
      bottomColor: '#00ff4105',
      lineWidth: 2,
      priceFormat: { type: 'custom', formatter: (price: number) => `$${price.toFixed(2)}` },
    });
    profitSeries.setData(profitData as Parameters<typeof profitSeries.setData>[0]);

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (container) {
        chart.applyOptions({ width: container.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [sales, isLoading]);

  if (isLoading) {
    return (
      <div style={{ height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (sales.length === 0) {
    return (
      <div style={{ height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        <p>No sales data for this period</p>
      </div>
    );
  }

  return (
    <div>
      <div ref={chartContainerRef} />
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8 }}>
        <span style={{ fontSize: 12, color: '#888' }}>
          <span style={{ display: 'inline-block', width: 12, height: 3, background: '#00ffff', marginRight: 6, verticalAlign: 'middle' }} />
          Revenue
        </span>
        <span style={{ fontSize: 12, color: '#888' }}>
          <span style={{ display: 'inline-block', width: 12, height: 3, background: '#00ff41', marginRight: 6, verticalAlign: 'middle' }} />
          Profit
        </span>
      </div>
    </div>
  );
}
