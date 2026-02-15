import { useSubscription } from './useSubscription';

export const useAds = () => {
  const { isFree } = useSubscription();

  return {
    showAds: isFree,
  };
};
