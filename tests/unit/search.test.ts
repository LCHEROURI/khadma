import { describe, expect, it } from 'vitest';
import {
  filterOwnedListings,
  sortOwnedListings,
  summarizeOwnedListings
} from '../../src/lib/listingManagement';
import { countActiveFilters, filterListings, normalizeSearchText } from '../../src/lib/search';
import type { Gig } from '../../src/lib/types';

function makeGig(overrides: Partial<Gig> & { id: string }): Gig {
  return {
    title: 'Offre de test',
    description: 'Description standard',
    category: 'delivery',
    listingType: 'job',
    payMin: 2000,
    payMax: 3000,
    neighborhood: 'Bir El Djir',
    posterUid: 'owner-1',
    flags: 0,
    status: 'active',
    verified: true,
    isSample: false,
    createdAt: { seconds: 1000, nanoseconds: 0 },
    ...overrides
  };
}

describe('KHADMA V1.3 bounded search and filtering', () => {
  it('normalizes French accents and Arabic diacritics/letter variants', () => {
    expect(normalizeSearchText('Es Sénia — Événementiel')).toBe('es senia — evenementiel');
    expect(normalizeSearchText('خِدْمَة إِصلاح وَهران')).toBe('خدمه اصلاح وهران');
    expect(normalizeSearchText('أعمال   رقمية')).toBe('اعمال رقميه');
  });

  it('filters by title, description, category, and neighborhood while strictly preserving job/service/legacy separation', () => {
    const gigs: Gig[] = [
      makeGig({
        id: 'job-peintre',
        title: 'Cherche peintre bâtiment',
        description: 'Travail rapide à Es Sénia',
        category: 'construction',
        listingType: 'job',
        neighborhood: 'Es Sénia'
      }),
      makeGig({
        id: 'svc-peintre',
        title: 'Peintre professionnel disponible',
        description: 'Peinture intérieure à Es Sénia',
        category: 'construction',
        listingType: 'service',
        neighborhood: 'Es Sénia'
      }),
      makeGig({
        id: 'legacy-ar',
        title: 'دهّان شقق في وهران',
        description: 'خدمة سريعة في بئر الجير',
        category: 'construction',
        listingType: undefined,
        neighborhood: 'Bir El Djir'
      })
    ];

    // Accent-insensitive multi-token search in jobs mode returns ONLY job
    expect(
      filterListings(gigs, { mode: 'job', query: 'peintre senia' }).map((g) => g.id)
    ).toEqual(['job-peintre']);

    // Same query in services mode returns ONLY service
    expect(
      filterListings(gigs, { mode: 'service', query: 'peintre senia' }).map((g) => g.id)
    ).toEqual(['svc-peintre']);

    // Arabic search in all mode finds legacy unclassified listing without leaking into job/service
    expect(
      filterListings(gigs, { mode: 'all', query: 'دهان خدمه' }).map((g) => g.id)
    ).toEqual(['legacy-ar']);
    expect(filterListings(gigs, { mode: 'job', query: 'دهان' })).toEqual([]);

    // Category + neighborhood combined filtering
    expect(
      filterListings(gigs, { mode: 'all', category: 'construction', neighborhood: 'Es Sénia' }).map(
        (g) => g.id
      )
    ).toEqual(['job-peintre', 'svc-peintre']);
  });

  it('counts active filters accurately', () => {
    expect(countActiveFilters({ query: '', category: '', neighborhood: '' })).toBe(0);
    expect(countActiveFilters({ query: '   ', category: '', neighborhood: '' })).toBe(0);
    expect(countActiveFilters({ query: 'peintre', category: '', neighborhood: '' })).toBe(1);
    expect(countActiveFilters({ query: 'peintre', category: 'construction', neighborhood: 'Canastel' })).toBe(3);
  });
});

describe('KHADMA V1.3 owned listing summary and sorting', () => {
  it('summarizes counts, orders active -> hidden -> removed (newest first), and filters by status', () => {
    const gigs: Gig[] = [
      makeGig({ id: 'r1', status: 'removed', createdAt: { seconds: 500, nanoseconds: 0 } }),
      makeGig({ id: 'a1', status: 'active', createdAt: { seconds: 200, nanoseconds: 0 } }),
      makeGig({ id: 'h1', status: 'hidden', createdAt: { seconds: 400, nanoseconds: 0 } }),
      makeGig({ id: 'a2', status: 'active', createdAt: { seconds: 300, nanoseconds: 0 } })
    ];

    expect(summarizeOwnedListings(gigs)).toEqual({
      total: 4,
      active: 2,
      hidden: 1,
      removed: 1
    });

    expect(sortOwnedListings(gigs).map((g) => g.id)).toEqual(['a2', 'a1', 'h1', 'r1']);
    expect(filterOwnedListings(gigs, 'active').map((g) => g.id)).toEqual(['a2', 'a1']);
    expect(filterOwnedListings(gigs, 'hidden').map((g) => g.id)).toEqual(['h1']);
    expect(filterOwnedListings(gigs, 'removed').map((g) => g.id)).toEqual(['r1']);
    expect(filterOwnedListings(gigs, 'all').map((g) => g.id)).toEqual(['a2', 'a1', 'h1', 'r1']);
  });
});
