import { filterGigsByMode, type BrowseMode } from './listingType';
import type { Gig } from './types';

export interface ListingFilterCriteria {
  mode: BrowseMode;
  query?: string;
  category?: string;
  neighborhood?: string;
}

/**
 * Normalizes French accents and Arabic diacritics/letter variants for bounded
 * client-side matching across retrieved listing titles and descriptions.
 */
export function normalizeSearchText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Latin combining diacritics
    .replace(/[\u064B-\u065F\u0670]/g, '') // Arabic tashkeel / harakat
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function countActiveFilters(criteria: Omit<ListingFilterCriteria, 'mode'>): number {
  let count = 0;
  if (criteria.query && criteria.query.trim().length > 0) count += 1;
  if (criteria.category) count += 1;
  if (criteria.neighborhood) count += 1;
  return count;
}

/**
 * Applies strict listing-type separation first, then bounded client-side
 * filtering by category, neighborhood, and normalized multi-token text search
 * over title, description, and neighborhood.
 */
export function filterListings(gigs: readonly Gig[], criteria: ListingFilterCriteria): Gig[] {
  const modeGigs = filterGigsByMode(gigs, criteria.mode);
  const tokens = normalizeSearchText(criteria.query ?? '')
    .split(' ')
    .filter(Boolean);

  return modeGigs.filter((g) => {
    if (criteria.category && g.category !== criteria.category) return false;
    if (criteria.neighborhood && g.neighborhood !== criteria.neighborhood) return false;
    if (tokens.length === 0) return true;

    const haystack = normalizeSearchText(`${g.title} ${g.description} ${g.neighborhood}`);
    return tokens.every((token) => haystack.includes(token));
  });
}
