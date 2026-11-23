import type { Gig, GigStatus } from './types';

export type OwnedStatusFilter = 'all' | GigStatus;

export interface OwnedListingsSummary {
  total: number;
  active: number;
  hidden: number;
  removed: number;
}

const STATUS_ORDER: Record<GigStatus, number> = {
  active: 0,
  hidden: 1,
  removed: 2
};

export function summarizeOwnedListings(gigs: readonly Gig[]): OwnedListingsSummary {
  let active = 0;
  let hidden = 0;
  let removed = 0;
  for (const g of gigs) {
    if (g.status === 'active') active += 1;
    else if (g.status === 'hidden') hidden += 1;
    else if (g.status === 'removed') removed += 1;
  }
  return { total: gigs.length, active, hidden, removed };
}

export function sortOwnedListings(gigs: readonly Gig[]): Gig[] {
  return [...gigs].sort((a, b) => {
    const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (statusDiff !== 0) return statusDiff;
    return (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0);
  });
}

export function filterOwnedListings(gigs: readonly Gig[], filter: OwnedStatusFilter): Gig[] {
  const sorted = sortOwnedListings(gigs);
  if (filter === 'all') return sorted;
  return sorted.filter((g) => g.status === filter);
}
