import type { Category, CityId, ContactMethod, ReportReason, WilayaCode } from './types';

export const CATEGORIES: Category[] = [
  'construction',
  'delivery',
  'cleaning',
  'tutoring',
  'restaurant',
  'events',
  'digital'
];

// V1.4 launch geography: Oran only (schema future-ready for Algeria expansion).
export const ACTIVE_CITY: CityId = 'oran';
export const ACTIVE_WILAYA_CODE: WilayaCode = '31';

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

export const NEIGHBORHOOD_KEYS: Record<string, string> = {
  'Bir El Djir': 'neighborhoods.birElDjir',
  'Es Sénia': 'neighborhoods.esSenia',
  Canastel: 'neighborhoods.canastel',
  Maraval: 'neighborhoods.maraval',
  Gambetta: 'neighborhoods.gambetta',
  'El Hamri': 'neighborhoods.elHamri',
  'Ain El Turk': 'neighborhoods.ainElTurk',
  'Wahran El Jadida': 'neighborhoods.wahranElJadida'
};

export const CONTACT_METHODS: readonly ContactMethod[] = ['whatsapp', 'email'] as const;

export const REPORT_REASONS: ReportReason[] = ['scam', 'offensive', 'wrongInfo', 'spam', 'other'];

// Quotas (Decision 3: 3 active/pending ads for new employers; 5 retained for legacy employers).
export const MAX_ACTIVE_GIGS = 5; // Legacy phone counter ceiling preserved for V1.3 compatibility
export const NEW_EMPLOYER_MAX_ACTIVE_GIGS = 3;
export const LEGACY_EMPLOYER_MAX_ACTIVE_GIGS = 5;

// Expiration & renewal (Decision 5: 30-day lifespan; free renewal during final 7 days).
export const LISTING_LIFESPAN_DAYS = 30;
export const LISTING_RENEWAL_WINDOW_DAYS = 7;
export const LISTING_LIFESPAN_MS = LISTING_LIFESPAN_DAYS * 24 * 60 * 60 * 1000;
export const LISTING_RENEWAL_WINDOW_MS = LISTING_RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;

// Moderation defaults (Decision 4: pre-approval OFF at initial launch).
export const DEFAULT_REQUIRE_PRE_APPROVAL = false;
export const DEFAULT_REMODERATE_MATERIAL_EDITS = true;

export const MAX_PAY_DZD = 100000000;
export const MIN_TITLE_LENGTH = 3;
export const HIDE_AFTER_REPORTS = 3;
export const ADMIN_EMAIL = 'cherouri@gmail.com';
export const BROWSE_PAGE_SIZE = 50;
export const ADMIN_QUEUE_LIMIT = 150;
