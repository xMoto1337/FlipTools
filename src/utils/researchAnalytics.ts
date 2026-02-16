import type { SoldItem } from '../api/platforms/types';

export interface MarketAnalysis {
  avgPrice: number;
  medianPrice: number;
  minPrice: number;
  maxPrice: number;
  priceStdDev: number;
  resultCount: number;
  demandScore: number;
  demandLabel: string;
  avgDaysToSell: number;
  sellThroughRate: number;
  bestDayOfWeek: string;
  dayOfWeekDistribution: Record<string, number>;
  priceDistribution: { min: number; max: number; count: number }[];
  priceTrend: 'up' | 'down' | 'stable';
  trendPercent: number;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function computeMarketAnalysis(results: SoldItem[]): MarketAnalysis {
  const prices = results.map((r) => r.price).filter((p) => p > 0);
  const sorted = [...prices].sort((a, b) => a - b);

  const resultCount = results.length;
  const avgPrice = prices.length > 0 ? prices.reduce((s, p) => s + p, 0) / prices.length : 0;
  const medianPrice = sorted.length > 0
    ? sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)]
    : 0;
  const minPrice = sorted.length > 0 ? sorted[0] : 0;
  const maxPrice = sorted.length > 0 ? sorted[sorted.length - 1] : 0;

  // Standard deviation
  const variance = prices.length > 1
    ? prices.reduce((s, p) => s + Math.pow(p - avgPrice, 2), 0) / (prices.length - 1)
    : 0;
  const priceStdDev = Math.sqrt(variance);

  // Parse sold dates
  const itemsWithDates = results
    .filter((r) => r.soldDate && !isNaN(new Date(r.soldDate).getTime()))
    .map((r) => ({ ...r, parsedDate: new Date(r.soldDate) }))
    .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());

  // Demand score (0-100)
  let demandScore = 0;
  let avgDaysToSell = 0;
  if (itemsWithDates.length >= 2) {
    const oldest = itemsWithDates[0].parsedDate.getTime();
    const newest = itemsWithDates[itemsWithDates.length - 1].parsedDate.getTime();
    const spanDays = Math.max(1, (newest - oldest) / (1000 * 60 * 60 * 24));
    const velocity = itemsWithDates.length / spanDays;
    demandScore = Math.min(100, Math.round(velocity * 20));
    avgDaysToSell = Math.round(spanDays / itemsWithDates.length);
  } else if (itemsWithDates.length === 1) {
    demandScore = 30;
    avgDaysToSell = 0;
  }

  const demandLabel = demandScore >= 80 ? 'Very High'
    : demandScore >= 60 ? 'High'
    : demandScore >= 40 ? 'Medium'
    : demandScore >= 20 ? 'Low'
    : 'Very Low';

  // Sell-through rate
  const sellThroughRate = resultCount > 0
    ? Math.round((itemsWithDates.length / resultCount) * 100)
    : 0;

  // Best day of week
  const dayOfWeekDistribution: Record<string, number> = {};
  DAY_NAMES.forEach((d) => { dayOfWeekDistribution[d] = 0; });
  itemsWithDates.forEach((item) => {
    const day = DAY_NAMES[item.parsedDate.getDay()];
    dayOfWeekDistribution[day]++;
  });
  const bestDayOfWeek = Object.entries(dayOfWeekDistribution)
    .sort(([, a], [, b]) => b - a)[0]?.[0] || 'N/A';

  // Price distribution histogram (8 buckets)
  const priceDistribution: { min: number; max: number; count: number }[] = [];
  if (sorted.length > 0 && maxPrice > minPrice) {
    const bucketCount = Math.min(8, sorted.length);
    const bucketSize = (maxPrice - minPrice) / bucketCount;
    for (let i = 0; i < bucketCount; i++) {
      const bucketMin = minPrice + i * bucketSize;
      const bucketMax = i === bucketCount - 1 ? maxPrice + 0.01 : minPrice + (i + 1) * bucketSize;
      const count = sorted.filter((p) => p >= bucketMin && p < bucketMax).length;
      priceDistribution.push({
        min: Math.round(bucketMin * 100) / 100,
        max: Math.round(bucketMax * 100) / 100,
        count,
      });
    }
  } else if (sorted.length > 0) {
    priceDistribution.push({ min: minPrice, max: maxPrice, count: sorted.length });
  }

  // Price trend (first half vs second half by date)
  let priceTrend: 'up' | 'down' | 'stable' = 'stable';
  let trendPercent = 0;
  if (itemsWithDates.length >= 4) {
    const mid = Math.floor(itemsWithDates.length / 2);
    const firstHalf = itemsWithDates.slice(0, mid);
    const secondHalf = itemsWithDates.slice(mid);
    const firstAvg = firstHalf.reduce((s, i) => s + i.price, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, i) => s + i.price, 0) / secondHalf.length;
    if (firstAvg > 0) {
      trendPercent = Math.round(((secondAvg - firstAvg) / firstAvg) * 1000) / 10;
      if (trendPercent > 5) priceTrend = 'up';
      else if (trendPercent < -5) priceTrend = 'down';
    }
  }

  return {
    avgPrice: Math.round(avgPrice * 100) / 100,
    medianPrice: Math.round(medianPrice * 100) / 100,
    minPrice: Math.round(minPrice * 100) / 100,
    maxPrice: Math.round(maxPrice * 100) / 100,
    priceStdDev: Math.round(priceStdDev * 100) / 100,
    resultCount,
    demandScore,
    demandLabel,
    avgDaysToSell,
    sellThroughRate,
    bestDayOfWeek,
    dayOfWeekDistribution,
    priceDistribution,
    priceTrend,
    trendPercent,
  };
}
