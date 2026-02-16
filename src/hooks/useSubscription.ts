import { useAuthStore } from '../stores/authStore';

export const useSubscription = () => {
  const { subscription, isFree, isPro, isLifetime, isPaid } = useAuthStore();

  return {
    subscription,
    tier: subscription?.tier || 'free',
    isFree: isFree(),
    isPro: isPro(),
    isLifetime: isLifetime(),
    isPaid: isPaid(),
  };
};

export const useFeatureGate = (feature: string): { allowed: boolean; limit?: number } => {
  const { isPaid } = useSubscription();

  const freeLimits: Record<string, number> = {
    'cross-list': 10,
    'image-search': 5,
    'keyword-search': 10,
    'search-history': 5,
    'analytics-days': 30,
    'platform-connections': 1,
  };

  const premiumOnly = [
    'bulk-actions',
    'export-csv',
    'advanced-analytics',
    'market-analysis',
    'saved-searches',
    'profit-calculator-multi',
    'price-trend-chart',
  ];

  if (isPaid) return { allowed: true };

  if (premiumOnly.includes(feature)) {
    return { allowed: false };
  }

  if (freeLimits[feature] !== undefined) {
    return { allowed: true, limit: freeLimits[feature] };
  }

  return { allowed: true };
};
