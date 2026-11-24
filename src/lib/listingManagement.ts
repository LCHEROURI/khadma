import { LISTING_RENEWAL_WINDOW_MS } from './constants';
import type { Gig, GigStatus } from './types';

export type OwnedStatusFilter = 'all' | GigStatus;

export interface OwnedListingsSummary {
  total: number;
  active: number;
  pending: number;
  expired: number;
  archived: number;
  hidden: number;
  removed: number;
}

const STATUS_ORDER: Record<GigStatus, number> = {
  active: 0,
  pending: 1,
  hidden: 2,
  expired: 3,
  archived: 4,
  removed: 5
};

export function getGigExpiresAtMs(gig: Pick<Gig, 'expiresAt'>): number | null {
  if (!gig.expiresAt || typeof gig.expiresAt.seconds !== 'number') return null;
  return gig.expiresAt.seconds * 1000;
}

export function isEligibleForRenewal(gig: Pick<Gig, 'status' | 'expiresAt'>, nowMs = Date.now()): boolean {
  if (gig.status !== 'active') return false;
  const expMs = getGigExpiresAtMs(gig);
  if (expMs === null) return false;
  return nowMs >= expMs - LISTING_RENEWAL_WINDOW_MS && nowMs < expMs;
}

export function canRepublishGig(gig: Pick<Gig, 'status' | 'expiresAt'>, nowMs = Date.now()): boolean {
  if (gig.status === 'expired' || gig.status === 'archived') return true;
  if (gig.status === 'active') {
    const expMs = getGigExpiresAtMs(gig);
    return expMs !== null && nowMs >= expMs;
  }
  return false;
}

export function summarizeOwnedListings(gigs: readonly Gig[]): OwnedListingsSummary {
  const counts: OwnedListingsSummary = {
    total: gigs.length,
    active: 0,
    pending: 0,
    expired: 0,
    archived: 0,
    hidden: 0,
    removed: 0
  };
  for (const g of gigs) {
    if (g.status in counts) {
      counts[g.status] += 1;
    }
  }
  return counts;
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
