import type { Category, ReportReason } from './types';

export const CATEGORIES: Category[] = [
  'construction',
  'delivery',
  'cleaning',
  'tutoring',
  'restaurant',
  'events',
  'digital'
];

export const NEIGHBORHOODS: string[] = [
  'Bir El Djir',
  'Es Sénia',
  'Canastel',
  'Maraval',
  'Gambetta',
  'El Hamri',
  'Ain El Turk',
  'Wahran El Jadida'
];

export const REPORT_REASONS: ReportReason[] = ['scam', 'offensive', 'wrongInfo', 'spam', 'other'];

export const MAX_ACTIVE_GIGS = 5;
export const HIDE_AFTER_REPORTS = 3;
export const ADMIN_EMAIL = 'cherouri@gmail.com';
export const BROWSE_LIMIT = 150;
