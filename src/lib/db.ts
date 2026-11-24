import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot
} from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, db, ensureAppCheckInitialized, functions } from '../firebase';
import type {
  AdminReportItem,
  AuditLogEntry,
  ContactMethod,
  EmployerProfile,
  Gig,
  GigStatus,
  ListingType,
  MarketplaceModerationSettings,
  ReportReason
} from './types';
import { isSafeContactUrl } from './contactLink';
import {
  ADMIN_QUEUE_LIMIT,
  ADMIN_REPORTS_PAGE_SIZE,
  BROWSE_PAGE_SIZE,
  MAX_ACTIVE_GIGS
} from './constants';
import { buildBrowseCacheKey, publicBrowseCache } from './browseCache';
import { SAMPLE_GIGS } from './samples';
import { readStringList, writeStringList } from './storage';

export class RateLimitError extends Error {
  constructor() {
    super('RATE_LIMIT');
  }
}

export class AlreadyReportedError extends Error {
  constructor() {
    super('ALREADY_REPORTED');
  }
}

// ---------- Browse (Bounded 2-Min Public Session Cache) ----------

export function invalidatePublicBrowseCache(gigId?: string): void {
  publicBrowseCache.invalidate(gigId);
}

export interface ActiveGigsPageOptions {
  bypassCache?: boolean;
  mode?: string;
  category?: string;
  neighborhood?: string;
}

export async function getActiveGigsPage(
  after: QueryDocumentSnapshot<DocumentData> | null = null,
  pageSize = BROWSE_PAGE_SIZE,
  options: ActiveGigsPageOptions = {}
): Promise<{ gigs: Gig[]; lastDoc: QueryDocumentSnapshot<DocumentData> | null; hasMore: boolean }> {
  const key = buildBrowseCacheKey({
    mode: options.mode,
    category: options.category,
    neighborhood: options.neighborhood,
    cursorId: after?.id ?? null,
    pageSize
  });

  return publicBrowseCache.getOrFetchPage(
    key,
    async () => {
      const q = after
        ? query(
            collection(db, 'gigs'),
            where('status', '==', 'active'),
            orderBy('createdAt', 'desc'),
            startAfter(after),
            limit(pageSize)
          )
        : query(
            collection(db, 'gigs'),
            where('status', '==', 'active'),
            orderBy('createdAt', 'desc'),
            limit(pageSize)
          );
      const snap = await getDocs(q);
      const gigs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Gig);
      const hasMore = snap.docs.length === pageSize;
      return {
        gigs,
        lastDoc: hasMore ? snap.docs[snap.docs.length - 1] : null,
        hasMore
      };
    },
    { bypassCache: options.bypassCache }
  ) as Promise<{
    gigs: Gig[];
    lastDoc: QueryDocumentSnapshot<DocumentData> | null;
    hasMore: boolean;
  }>;
}

export async function getGig(id: string, options: { bypassCache?: boolean } = {}): Promise<Gig | null> {
  return publicBrowseCache.getOrFetchPublicGig(
    id,
    async () => {
      const snap = await getDoc(doc(db, 'gigs', id));
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() } as Gig;
    },
    { bypassCache: options.bypassCache }
  );
}

export async function getGigsByIds(ids: string[]): Promise<Gig[]> {
  const uniqueIds = Array.from(new Set(ids)).slice(0, 60);
  const results = await Promise.all(
    uniqueIds.map((id) => getGig(id).catch(() => null))
  );
  return results.filter((g): g is Gig => g !== null);
}

// ---------- Post (SMS-verified phone required) ----------

export interface PostGigInput {
  title: string;
  description: string;
  category: Gig['category'];
  listingType: ListingType;
  payMin: number;
  payMax: number;
  neighborhood: string;
}

export async function postGig(input: PostGigInput): Promise<string> {
  const user = auth.currentUser;
  const phone = user?.phoneNumber;
  if (!user || !phone) throw new Error('NOT_VERIFIED');

  const counterRef = doc(db, 'phoneCounters', phone);
  const gigRef = doc(collection(db, 'gigs'));
  const contactRef = doc(db, 'gigContacts', gigRef.id);

  await runTransaction(db, async (tx) => {
    const counter = await tx.get(counterRef);
    const count = counter.exists() ? (counter.data().count as number) : 0;
    if (count >= MAX_ACTIVE_GIGS) throw new RateLimitError();
    const now = serverTimestamp();
    tx.set(counterRef, { count: count + 1 });
    tx.set(gigRef, {
      title: input.title.trim(),
      description: input.description.trim(),
      category: input.category,
      listingType: input.listingType,
      payMin: Math.round(input.payMin),
      payMax: Math.round(input.payMax),
      neighborhood: input.neighborhood,
      posterUid: user.uid,
      flags: 0,
      status: 'active' as GigStatus,
      verified: true,
      isSample: false,
      createdAt: now
    });
    tx.set(contactRef, {
      posterPhone: phone,
      counterId: phone,
      posterUid: user.uid,
      createdAt: now
    });
  });
  return gigRef.id;
}

export async function getMyGigs(uid: string): Promise<Gig[]> {
  const q = query(collection(db, 'gigs'), where('posterUid', '==', uid), limit(25));
  const snap = await getDocs(q);
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Gig);
  return items.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
}

export async function getRemainingForPhone(phone: string): Promise<number> {
  const snap = await getDoc(doc(db, 'phoneCounters', phone));
  if (!snap.exists()) return MAX_ACTIVE_GIGS;
  return Math.max(0, MAX_ACTIVE_GIGS - (snap.data().count as number));
}

export async function getEmployerProfile(uid: string): Promise<EmployerProfile | null> {
  const snap = await getDoc(doc(db, 'employers', uid));
  if (!snap.exists()) return null;
  return { uid: snap.id, ...snap.data() } as EmployerProfile;
}

export interface ManageListingResult {
  gigId: string;
  status: GigStatus;
  expiresAtMs: number | null;
  quotaUsed: number;
  quotaMax: number;
  idempotentReplay?: boolean;
}

export async function callManageEmployerListing(
  payload: Record<string, unknown>
): Promise<ManageListingResult> {
  ensureAppCheckInitialized();
  const call = httpsCallable<Record<string, unknown>, ManageListingResult>(
    functions,
    'manageEmployerListing'
  );
  const res = await call(payload);
  invalidatePublicBrowseCache(res.data?.gigId);
  return res.data;
}

export interface AdminMutationResponse {
  ok: true;
  action: string;
  targetId: string;
  status?: GigStatus;
  requirePreApproval?: boolean;
  remoderateMaterialEdits?: boolean;
  hiddenActiveCount?: number;
}

export async function callAdminManageMarketplace(
  payload: Record<string, unknown>
): Promise<AdminMutationResponse> {
  ensureAppCheckInitialized();
  const call = httpsCallable<Record<string, unknown>, AdminMutationResponse>(
    functions,
    'adminManageMarketplace'
  );
  const res = await call(payload);
  invalidatePublicBrowseCache(typeof payload.gigId === 'string' ? payload.gigId : undefined);
  return res.data;
}

export async function getMarketplaceModerationSettings(): Promise<MarketplaceModerationSettings | null> {
  const snap = await getDoc(doc(db, 'settings', 'marketplace'));
  if (!snap.exists()) return null;
  return snap.data() as MarketplaceModerationSettings;
}

export async function getAdminPendingGigs(): Promise<Gig[]> {
  const q = query(
    collection(db, 'gigs'),
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc'),
    limit(ADMIN_QUEUE_LIMIT)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Gig);
}

export async function getAdminEmployers(): Promise<EmployerProfile[]> {
  const q = query(collection(db, 'employers'), limit(50));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as EmployerProfile);
}

export async function getAdminAuditLogs(): Promise<AuditLogEntry[]> {
  const q = query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(50));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AuditLogEntry);
}

// ---------- Contact (Account-Free + App Check + Server-Side IP/Listing Rate Limit) ----------

export async function requestGigContactLink(
  gigId: string,
  lang: string,
  channel: ContactMethod = 'whatsapp'
): Promise<string> {
  // V1.4 Decision 2 (Option A): genuinely account-free contact retrieval (no auth required).
  ensureAppCheckInitialized();
  const call = httpsCallable<
    { gigId: string; channel: ContactMethod; lang: string },
    { url?: string; waUrl?: string; mailtoUrl?: string; channel?: ContactMethod }
  >(functions, 'getGigContactLink');
  const res = await call({ gigId, channel, lang });
  const resolvedUrl =
    res.data?.url ?? (channel === 'whatsapp' ? res.data?.waUrl : res.data?.mailtoUrl);
  if (!isSafeContactUrl(resolvedUrl, channel)) {
    throw new Error('NO_CONTACT');
  }
  return resolvedUrl;
}

// ---------- Report (App Check + Auth + IP-Sybil Protection) ----------

export async function reportGig(gigId: string, reason: ReportReason): Promise<void> {
  if (!auth.currentUser) {
    try {
      await signInAnonymously(auth);
    } catch {
      // Anon sign-in failed (network?) — caller shows generic error.
    }
  }
  if (!auth.currentUser) throw new Error('NO_AUTH');

  ensureAppCheckInitialized();
  const call = httpsCallable<{ gigId: string; reason: ReportReason }, { flags: number; status: string }>(
    functions,
    'reportGigListing'
  );
  try {
    await call({ gigId, reason });
    invalidatePublicBrowseCache(gigId);
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (code === 'functions/already-exists') {
      throw new AlreadyReportedError();
    }
    throw err;
  }
}

// ---------- Admin ----------

export async function getAdminQueue(): Promise<{ latest: Gig[]; flagged: Gig[] }> {
  const flaggedQ = query(
    collection(db, 'gigs'),
    where('flags', '>', 0),
    orderBy('flags', 'asc'),
    orderBy('createdAt', 'desc'),
    limit(ADMIN_QUEUE_LIMIT)
  );
  const latestQ = query(collection(db, 'gigs'), orderBy('createdAt', 'desc'), limit(ADMIN_QUEUE_LIMIT));
  const [fs, ls] = await Promise.all([getDocs(flaggedQ), getDocs(latestQ)]);
  const flagged = fs.docs.map((d) => ({ id: d.id, ...d.data() }) as Gig);
  const latest = ls.docs.map((d) => ({ id: d.id, ...d.data() }) as Gig);
  return { latest, flagged };
}

export interface AdminReportsPage {
  items: AdminReportItem[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

export async function getAdminReportsPage(
  after: QueryDocumentSnapshot<DocumentData> | null = null,
  pageSize = ADMIN_REPORTS_PAGE_SIZE
): Promise<AdminReportsPage> {
  const bounded = Math.max(1, Math.min(ADMIN_REPORTS_PAGE_SIZE, pageSize));
  const q = after
    ? query(
        collection(db, 'reports'),
        orderBy('createdAt', 'desc'),
        startAfter(after),
        limit(bounded + 1)
      )
    : query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(bounded + 1));

  const snap = await getDocs(q);
  const hasMore = snap.docs.length > bounded;
  const pageDocs = hasMore ? snap.docs.slice(0, bounded) : snap.docs;
  const lastDoc = pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;

  const uniqueGigIds = Array.from(
    new Set(
      pageDocs
        .map((d) => d.data().gigId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  );
  const gigsList = uniqueGigIds.length > 0 ? await getGigsByIds(uniqueGigIds) : [];
  const gigMap = new Map<string, Gig>(gigsList.map((g) => [g.id, g]));

  // Intentionally omit reporterId from AdminReportItem to avoid unnecessary identity disclosure.
  const items: AdminReportItem[] = pageDocs.map((d) => {
    const data = d.data();
    const gigId = typeof data.gigId === 'string' ? data.gigId : '';
    const reason = (typeof data.reason === 'string' ? data.reason : 'other') as ReportReason;
    const createdAt =
      data.createdAt && typeof data.createdAt === 'object' && 'seconds' in data.createdAt
        ? (data.createdAt as { seconds: number; nanoseconds?: number })
        : null;
    return {
      id: d.id,
      gigId,
      reason,
      createdAt,
      gig: gigMap.get(gigId) ?? null
    };
  });

  return { items, lastDoc, hasMore };
}

export async function adminApprove(gigId: string): Promise<void> {
  const gigRef = doc(db, 'gigs', gigId);
  const contactRef = doc(db, 'gigContacts', gigId);
  await runTransaction(db, async (tx) => {
    const g = await tx.get(gigRef);
    if (!g.exists()) return;
    const data = g.data();
    const contactSnap = await tx.get(contactRef);
    const counterId =
      (contactSnap.exists() ? (contactSnap.data().counterId as string | undefined) : undefined) ??
      (typeof data.counterId === 'string' ? data.counterId : undefined);
    // Re-claim the poster's rate-limit slot if restoring a previously removed gig.
    if (data.status === 'removed' && counterId && counterId !== 'sample') {
      const counterRef = doc(db, 'phoneCounters', counterId);
      const c = await tx.get(counterRef);
      if (c.exists()) {
        const cur = c.data().count as number;
        tx.set(counterRef, { count: Math.min(MAX_ACTIVE_GIGS, cur + 1) });
      }
    }
    tx.update(gigRef, { status: 'active', flags: 0 });
  });
}

export async function adminRemove(gigId: string): Promise<void> {
  const gigRef = doc(db, 'gigs', gigId);
  const contactRef = doc(db, 'gigContacts', gigId);
  await runTransaction(db, async (tx) => {
    const g = await tx.get(gigRef);
    if (!g.exists()) return;
    const data = g.data();
    const contactSnap = await tx.get(contactRef);
    const counterId =
      (contactSnap.exists() ? (contactSnap.data().counterId as string | undefined) : undefined) ??
      (typeof data.counterId === 'string' ? data.counterId : undefined);
    // Free the poster's rate-limit slot if the gig was active or auto-hidden.
    if ((data.status === 'active' || data.status === 'hidden') && counterId && counterId !== 'sample') {
      const counterRef = doc(db, 'phoneCounters', counterId);
      const c = await tx.get(counterRef);
      if (c.exists() && (c.data().count as number) >= 1) {
        tx.set(counterRef, { count: (c.data().count as number) - 1 });
      }
    }
    tx.update(gigRef, { status: 'removed' });
  });
}

export async function hasSamples(): Promise<boolean> {
  const q = query(collection(db, 'gigs'), where('isSample', '==', true), limit(ADMIN_QUEUE_LIMIT));
  const snap = await getDocs(q);
  return snap.docs.some((d) => d.data().status !== 'removed');
}

export async function seedSamples(): Promise<void> {
  await callAdminManageMarketplace({
    action: 'seedSamples',
    samples: SAMPLE_GIGS
  });
}

export async function removeAllSamples(): Promise<number> {
  const res = (await callAdminManageMarketplace({
    action: 'removeAllSamples'
  })) as { count?: number };
  return typeof res.count === 'number' ? res.count : 0;
}

// ---------- Saved (localStorage, offline-first) ----------

const SAVED_KEY = 'khadma-saved';

export function getSavedIds(): string[] {
  return readStringList(SAVED_KEY);
}

export function toggleSaved(id: string): boolean {
  const cur = getSavedIds();
  const has = cur.includes(id);
  const next = has ? cur.filter((x) => x !== id) : [...cur, id];
  writeStringList(SAVED_KEY, next);
  return !has;
}

export function isSaved(id: string): boolean {
  return getSavedIds().includes(id);
}
