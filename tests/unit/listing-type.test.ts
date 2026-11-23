import { describe, expect, it } from 'vitest';
import {
  filterGigsByMode,
  isLegacyUnclassified,
  isValidListingType,
  LISTING_TYPES
} from '../../src/lib/listingType';
import type { Gig } from '../../src/lib/types';

function makeGig(id: string, listingType?: 'job' | 'service'): Gig {
  return {
    id,
    title: `Listing ${id}`,
    description: 'Description',
    category: 'delivery',
    ...(listingType ? { listingType } : {}),
    payMin: 2000,
    payMax: 3000,
    neighborhood: 'Bir El Djir',
    posterUid: 'u1',
    flags: 0,
    status: 'active',
    verified: true,
    isSample: false,
    createdAt: null
  };
}

describe('KHADMA V1.2 listingType separation & legacy compatibility', () => {
  it('exposes only job and service as valid listing types', () => {
    expect(LISTING_TYPES).toEqual(['job', 'service']);
    expect(isValidListingType('job')).toBe(true);
    expect(isValidListingType('service')).toBe(true);
    expect(isValidListingType('legacy')).toBe(false);
    expect(isValidListingType('')).toBe(false);
    expect(isValidListingType(undefined)).toBe(false);
    expect(isValidListingType(null)).toBe(false);
  });

  it('strictly separates jobs from services without auto-classifying legacy listings', () => {
    const job = makeGig('g-job', 'job');
    const service = makeGig('g-service', 'service');
    const legacy = makeGig('g-legacy', undefined);
    const all = [job, service, legacy];

    expect(filterGigsByMode(all, 'job').map((g) => g.id)).toEqual(['g-job']);
    expect(filterGigsByMode(all, 'service').map((g) => g.id)).toEqual(['g-service']);
    expect(filterGigsByMode(all, 'all').map((g) => g.id)).toEqual(['g-job', 'g-service', 'g-legacy']);

    expect(isLegacyUnclassified(legacy)).toBe(true);
    expect(isLegacyUnclassified(job)).toBe(false);
    expect(isLegacyUnclassified(service)).toBe(false);
  });
});
