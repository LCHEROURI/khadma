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
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot
} from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../firebase';
import type { EmployerProfile, Gig, GigStatus, ListingType, ReportReason } from './types';
import { ADMIN_QUEUE_LIMIT, BROWSE_PAGE_SIZE, MAX_ACTIVE_GIGS } from './constants';
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

// ---------- Browse ----------

export async function getActiveGigsPage(
  after: QueryDocumentSnapshot<DocumentData> | null = null,
  pageSize = BROWSE_PAGE_SIZE
): Promise<{ gigs: Gig[]; lastDoc: QueryDocumentSnapshot<DocumentData> | null; hasMore: boolean }> {
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
}

export async function getGig(id: string): Promise<Gig | null> {
  const snap = await getDoc(doc(db, 'gigs', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Gig;
}

export async function getGigsByIds(ids: string[]): Promise<Gig[]> {
  const results = await Promise.all(
    ids.slice(0, 60).map((id) => getGig(id).catch(() => null))
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

// ---------- Contact (App Check + Auth + Server-Side Rate Limit) ----------

export async function requestGigContactLink(gigId: string, lang: string): Promise<string> {
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  if (!auth.currentUser) throw new Error('NO_AUTH');

  const call = httpsCallable<{ gigId: string; lang: string }, { waUrl: string }>(
    functions,
    'getGigContactLink'
  );
  const res = await call({ gigId, lang });
  if (!res.data?.waUrl) throw new Error('NO_CONTACT');
  return res.data.waUrl;
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

  const call = httpsCallable<{ gigId: string; reason: ReportReason }, { flags: number; status: string }>(
    functions,
    'reportGigListing'
  );
  try {
    await call({ gigId, reason });
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
  const q = query(collection(db, 'gigs'), where('isSample', '==', true), limit(1));
  const snap = await getDocs(q);
  return !snap.empty;
}

const BATCH_LIMIT = 400;

export async function seedSamples(): Promise<void> {
  for (let i = 0; i < SAMPLE_GIGS.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    const slice = SAMPLE_GIGS.slice(i, i + BATCH_LIMIT);
    for (const s of slice) {
      const ref = doc(collection(db, 'gigs'));
      batch.set(ref, {
        title: s.title,
        description: s.description,
        category: s.category,
        payMin: s.payMin,
        payMax: s.payMax,
        neighborhood: s.neighborhood,
        posterUid: 'sample',
        flags: 0,
        status: 'active' as GigStatus,
        verified: false,
        isSample: true,
        createdAt: serverTimestamp()
      });
    }
    await batch.commit();
  }
}

export async function removeAllSamples(): Promise<number> {
  const q = query(collection(db, 'gigs'), where('isSample', '==', true), limit(ADMIN_QUEUE_LIMIT));
  const snap = await getDocs(q);
  const toRemove = snap.docs.filter((d) => d.data().status !== 'removed');
  for (let i = 0; i < toRemove.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const d of toRemove.slice(i, i + BATCH_LIMIT)) {
      batch.update(doc(db, 'gigs', d.id), { status: 'removed' });
    }
    await batch.commit();
  }
  return toRemove.length;
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
