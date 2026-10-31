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
  posterPhone: string; // E.164, never rendered
  counterId: string; // phoneCounters doc id (E.164) or 'sample'
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
