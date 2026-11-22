export type GigStatus = 'active' | 'hidden' | 'removed';

export type Category =
  | 'construction'
  | 'delivery'
  | 'cleaning'
  | 'tutoring'
  | 'restaurant'
  | 'events'
  | 'digital';

export type ReportReason = 'scam' | 'offensive' | 'wrongInfo' | 'spam' | 'other';

export interface Gig {
  id: string;
  title: string;
  description: string;
  category: Category;
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
  createdAt: { seconds: number; nanoseconds: number } | null;
}

export interface Report {
  id: string;
  gigId: string;
  reason: ReportReason;
  reporterId: string;
  createdAt: unknown;
}
