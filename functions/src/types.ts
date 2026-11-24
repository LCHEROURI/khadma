/**
 * KHADMA V1.4 shared server-side schema types and constants (Phase 1 foundation).
 * Kept in sync with src/lib/types.ts and src/lib/constants.ts.
 */

export type GigStatus = 'pending' | 'active' | 'archived' | 'expired' | 'hidden' | 'removed';

export type ListingType = 'job' | 'service';

export type ContactMethod = 'whatsapp' | 'email';

export type CityId = 'oran';

export type WilayaCode = '31';

export type EmployerTrustLevel = 'new' | 'trusted';

export type Category =
  | 'construction'
  | 'delivery'
  | 'cleaning'
  | 'tutoring'
  | 'restaurant'
  | 'events'
  | 'digital';

export type AuditAction =
  | 'create'
  | 'edit'
  | 'archive'
  | 'renew'
  | 'republish'
  | 'update_contact'
  | 'approve'
  | 'remove'
  | 'suspend'
  | 'unsuspend'
  | 'quota_change'
  | 'trust_change'
  | 'moderation_settings_change';

export type AuditTargetType = 'gig' | 'employer' | 'settings';

export interface EmployerProfileDoc {
  uid: string;
  email: string | null;
  legacyPhone: string | null;
  maxActiveGigs: number;
  activeCount: number;
  trustLevel: EmployerTrustLevel;
  suspended: boolean;
  suspendedReason?: string;
  defaultContactMethods?: ContactMethod[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface MarketplaceModerationSettingsDoc {
  requirePreApproval: boolean;
  remoderateMaterialEditsWhenEnabled: boolean;
  updatedAt: unknown;
  updatedBy: string | null;
}

export interface AuditLogDoc {
  actorUid: string;
  actorRole: 'employer' | 'admin';
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  metadata?: Record<string, unknown>;
  createdAt: unknown;
}

export const ACTIVE_CITY: CityId = 'oran';
export const ACTIVE_WILAYA_CODE: WilayaCode = '31';

export const ALLOWED_CATEGORIES: readonly Category[] = [
  'construction',
  'delivery',
  'cleaning',
  'tutoring',
  'restaurant',
  'events',
  'digital'
] as const;

export const ALLOWED_NEIGHBORHOODS: readonly string[] = [
  'Bir El Djir',
  'Es Sénia',
  'Canastel',
  'Maraval',
  'Gambetta',
  'El Hamri',
  'Ain El Turk',
  'Wahran El Jadida'
] as const;

export const NEW_EMPLOYER_MAX_ACTIVE_GIGS = 3;
export const LEGACY_EMPLOYER_MAX_ACTIVE_GIGS = 5;
export const LISTING_LIFESPAN_DAYS = 30;
export const LISTING_RENEWAL_WINDOW_DAYS = 7;
export const LISTING_LIFESPAN_MS = LISTING_LIFESPAN_DAYS * 24 * 60 * 60 * 1000;
export const LISTING_RENEWAL_WINDOW_MS = LISTING_RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
export const DEFAULT_REQUIRE_PRE_APPROVAL = false;
export const DEFAULT_REMODERATE_MATERIAL_EDITS = true;

export const SETTINGS_COLLECTION = 'settings';
export const MARKETPLACE_SETTINGS_DOC_ID = 'marketplace';
export const EMPLOYERS_COLLECTION = 'employers';
export const AUDIT_LOGS_COLLECTION = 'auditLogs';
