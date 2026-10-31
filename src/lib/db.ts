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
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { auth, db } from '../firebase';
import type { Gig, GigStatus, ReportReason } from './types';
import { BROWSE_LIMIT, HIDE_AFTER_REPORTS, MAX_ACTIVE_GIGS } from './constants';
import { SAMPLE_GIGS } from './samples';

export class RateLimitError extends Error {
  constructor() {
    super('RATE_LIMIT');
  }
}

// ---------- Browse ----------

export async function getActiveGigs(): Promise<Gig[]> {
  const q = query(
    collection(db, 'gigs'),
    where('status', '==', 'active'),
    orderBy('createdAt', 'desc'),
    limit(BROWSE_LIMIT)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Gig);
}

export async function getGig(id: string): Promise<Gig | null> {
  const snap = await getDoc(doc(db, 'gigs', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Gig;
}

export async function getGigsByIds(ids: string[]): Promise<Gig[]> {
  const out: Gig[] = [];
  for (const id of ids.slice(0, 60)) {
    const g = await getGig(id);
    if (g) out.push(g);
  }
  return out;
}

// ---------- Post (SMS-verified phone required) ----------

export interface PostGigInput {
  title: string;
  description: string;
  category: Gig['category'];
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

  await runTransaction(db, async (tx) => {
    const counter = await tx.get(counterRef);
    const count = counter.exists() ? (counter.data().count as number) : 0;
    if (count >= MAX_ACTIVE_GIGS) throw new RateLimitError();
    tx.set(counterRef, { count: count + 1 });
    tx.set(gigRef, {
      title: input.title.trim(),
      description: input.description.trim(),
      category: input.category,
      payMin: Math.round(input.payMin),
      payMax: Math.round(input.payMax),
      neighborhood: input.neighborhood,
      posterPhone: phone,
      counterId: phone,
      flags: 0,
      status: 'active' as GigStatus,
      verified: true,
      isSample: false,
      createdAt: serverTimestamp()
    });
  });
  return gigRef.id;
}

export async function getRemainingForPhone(phone: string): Promise<number> {
  const snap = await getDoc(doc(db, 'phoneCounters', phone));
  if (!snap.exists()) return MAX_ACTIVE_GIGS;
  return Math.max(0, MAX_ACTIVE_GIGS - (snap.data().count as number));
}

// ---------- Report ----------

export async function reportGig(gigId: string, reason: ReportReason): Promise<void> {
  if (!auth.currentUser) {
    try {
      await signInAnonymously(auth);
    } catch {
      // Anon sign-in failed (network?) — caller shows generic error.
    }
  }
  const user = auth.currentUser;
  if (!user) throw new Error('NO_AUTH');

  const gigRef = doc(db, 'gigs', gigId);
  const reportRef = doc(collection(db, 'reports'));

  await runTransaction(db, async (tx) => {
    const g = await tx.get(gigRef);
    if (!g.exists()) throw new Error('NOT_FOUND');
    if (g.data().status !== 'active') throw new Error('NOT_ACTIVE');
    const flags = (g.data().flags as number) || 0;
    const newFlags = flags + 1;
    tx.set(reportRef, {
      gigId,
      reason,
      reporterId: user.uid,
      createdAt: serverTimestamp()
    });
    tx.update(gigRef, {
      flags: newFlags,
      status: newFlags >= HIDE_AFTER_REPORTS ? 'hidden' : 'active'
    });
  });
}

// ---------- Admin ----------

export async function getAdminQueue(): Promise<{ latest: Gig[]; flagged: Gig[] }> {
  const flaggedQ = query(
    collection(db, 'gigs'),
    where('flags', '>', 0),
    orderBy('createdAt', 'desc'),
    limit(BROWSE_LIMIT)
  );
  const latestQ = query(collection(db, 'gigs'), orderBy('createdAt', 'desc'), limit(BROWSE_LIMIT));
  const [fs, ls] = await Promise.all([getDocs(flaggedQ), getDocs(latestQ)]);
  const flagged = fs.docs.map((d) => ({ id: d.id, ...d.data() }) as Gig);
  const latest = ls.docs.map((d) => ({ id: d.id, ...d.data() }) as Gig);
  return { latest, flagged };
}

export async function adminApprove(gigId: string): Promise<void> {
  await updateDoc(doc(db, 'gigs', gigId), { status: 'active', flags: 0 });
}

export async function adminRemove(gigId: string): Promise<void> {
  const gigRef = doc(db, 'gigs', gigId);
  await runTransaction(db, async (tx) => {
    const g = await tx.get(gigRef);
    if (!g.exists()) return;
    const data = g.data();
    // Free the poster's rate-limit slot if the gig was still active.
    if (data.status === 'active' && typeof data.counterId === 'string' && data.counterId !== 'sample') {
      const c = await tx.get(doc(db, 'phoneCounters', data.counterId));
      if (c.exists() && (c.data().count as number) >= 1) {
        tx.set(doc(db, 'phoneCounters', data.counterId), { count: (c.data().count as number) - 1 });
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

export async function seedSamples(): Promise<void> {
  for (const s of SAMPLE_GIGS) {
    const ref = doc(collection(db, 'gigs'));
    await setDoc(ref, {
      title: s.title,
      description: s.description,
      category: s.category,
      payMin: s.payMin,
      payMax: s.payMax,
      neighborhood: s.neighborhood,
      posterPhone: 'sample',
      counterId: 'sample',
      flags: 0,
      status: 'active' as GigStatus,
      verified: false,
      isSample: true,
      createdAt: serverTimestamp()
    });
  }
}

export async function removeAllSamples(): Promise<number> {
  const q = query(collection(db, 'gigs'), where('isSample', '==', true), limit(BROWSE_LIMIT));
  const snap = await getDocs(q);
  let removed = 0;
  for (const d of snap.docs) {
    if (d.data().status !== 'removed') {
      await updateDoc(doc(db, 'gigs', d.id), { status: 'removed' });
      removed += 1;
    }
  }
  return removed;
}

// ---------- Saved (localStorage, offline-first) ----------

const SAVED_KEY = 'khadma-saved';

export function getSavedIds(): string[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function toggleSaved(id: string): boolean {
  const cur = getSavedIds();
  const has = cur.includes(id);
  const next = has ? cur.filter((x) => x !== id) : [...cur, id];
  localStorage.setItem(SAVED_KEY, JSON.stringify(next));
  return !has;
}

export function isSaved(id: string): boolean {
  return getSavedIds().includes(id);
}
