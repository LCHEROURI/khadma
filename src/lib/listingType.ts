import type { Gig, ListingType } from './types';

export type BrowseMode = 'job' | 'service' | 'all';

export const LISTING_TYPES: readonly ListingType[] = ['job', 'service'] as const;

export function isValidListingType(value: unknown): value is ListingType {
  return value === 'job' || value === 'service';
}

/**
 * Strictly separates job offers from service listings without auto-classifying
 * legacy listings (where listingType is undefined).
 * - 'job': returns ONLY listings explicitly tagged listingType === 'job'.
 * - 'service': returns ONLY listings explicitly tagged listingType === 'service'.
 * - 'all': returns all listings, including legacy unclassified listings.
 */
export function filterGigsByMode(gigs: readonly Gig[], mode: BrowseMode): Gig[] {
  if (mode === 'all') return [...gigs];
  return gigs.filter((g) => g.listingType === mode);
}

export function isLegacyUnclassified(gig: Pick<Gig, 'listingType'>): boolean {
  return !isValidListingType(gig.listingType);
}
