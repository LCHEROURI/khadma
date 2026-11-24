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

export type ReportReason = 'scam' | 'offensive' | 'wrongInfo' | 'spam' | 'other';

export interface FirestoreTimestampLike {
  seconds: number;
  nanoseconds: number;
}

export interface Gig {
  id: string;
  title: string;
  description: string;
  category: Category;
  listingType?: ListingType; // Explicit discriminator ('job' | 'service'); undefined on legacy listings
  city?: CityId; // V1.4 Oran-only ('oran'); future-ready for Algeria expansion
  wilayaCode?: WilayaCode; // V1.4 Oran-only ('31'); future-ready for 58 wilayas
  contactMethods?: ContactMethod[]; // Non-PII enabled contact channels ('whatsapp' | 'email')
  payMin: number;
  payMax: number;
  neighborhood: string;
  posterUid?: string; // Firebase UID (non-PII) or 'sample'
  posterPhone?: string; // Legacy pre-migration field only; never written on new gigs or rendered in public UI
  counterId?: string; // Legacy pre-migration field only; stored in private gigContacts/{gigId}
  flags: number;
  status: GigStatus;
  verified: boolean;
  isSample: boolean;
  createdAt: FirestoreTimestampLike | null;
  updatedAt?: FirestoreTimestampLike | null;
  expiresAt?: FirestoreTimestampLike | null;
  moderationReason?: string;
}

export interface GigContact {
  posterUid: string;
  posterPhone?: string | null; // Legacy E.164 phone field
  counterId?: string | null; // Legacy phoneCounter reference
  contactPhone?: string | null; // V1.4 normalized E.164 WhatsApp number
  contactEmail?: string | null; // V1.4 contact email address
  whatsappConsent?: boolean;
  emailConsent?: boolean;
  createdAt: FirestoreTimestampLike | null;
  updatedAt?: FirestoreTimestampLike | null;
}

export interface EmployerProfile {
  uid: string;
  email: string | null;
  legacyPhone: string | null;
  maxActiveGigs: number; // 3 for new employers; 5 retained for legacy phone employers; admin-adjustable
  activeCount: number; // Atomic count of active + pending advertisements (archived/expired excluded)
  trustLevel: EmployerTrustLevel;
  suspended: boolean;
  suspendedReason?: string;
  defaultContactMethods?: ContactMethod[];
  createdAt: FirestoreTimestampLike | null;
  updatedAt: FirestoreTimestampLike | null;
}

export interface MarketplaceModerationSettings {
  requirePreApproval: boolean; // Default false at V1.4 launch; admin runtime toggle
  remoderateMaterialEditsWhenEnabled: boolean; // Default true when requirePreApproval is ON
  updatedAt: FirestoreTimestampLike | null;
  updatedBy: string | null;
}

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

export interface AuditLogEntry {
  id: string;
  actorUid: string;
  actorRole: 'employer' | 'admin';
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  metadata?: Record<string, unknown>;
  createdAt: FirestoreTimestampLike | null;
}

export interface Report {
  id: string;
  gigId: string;
  reason: ReportReason;
  reporterId: string;
  createdAt: unknown;
}

export interface AdminReportItem {
  id: string;
  gigId: string;
  reason: ReportReason;
  createdAt: FirestoreTimestampLike | null;
  gig: Gig | null;
}
