import type { PlatformAdapter, PlatformId } from './types';
import { ebayAdapter } from './ebay';
import { depopAdapter } from './depop';

const platformRegistry: Record<PlatformId, PlatformAdapter> = {
  ebay: ebayAdapter,
  depop: depopAdapter,
};

export const getPlatform = (id: PlatformId): PlatformAdapter => {
  const adapter = platformRegistry[id];
  if (!adapter) throw new Error(`Unknown platform: ${id}`);
  return adapter;
};

export const getAllPlatforms = (): PlatformAdapter[] => {
  return Object.values(platformRegistry);
};

export const getPlatformIds = (): PlatformId[] => {
  return Object.keys(platformRegistry) as PlatformId[];
};

export type { PlatformAdapter, PlatformId, TokenPair, ListingData, PlatformListing, SoldItem, FeeBreakdown } from './types';
