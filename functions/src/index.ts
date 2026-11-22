import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';

initializeApp();
const db = getFirestore();

const WA_MESSAGES: Record<string, string> = {
  dar: 'Salam 👋 Choftek 3la KHADMA, 7abbit nse9sik 3la li3lan.',
  fr: 'Bonjour 👋 Je vous contacte via KHADMA au sujet de votre annonce.',
  ar: 'سلام 👋 تواصلت معك عبر خدامة بخصوص إعلانك.'
};

const GIG_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Privacy-safe WhatsApp handoff endpoint: GET /api/contact/:gigId?lang=dar|fr|ar
 * Keeps posterPhone out of public Firestore reads while preserving 1-tap wa.me UX.
 */
export const contactGig = onRequest(
  { region: 'europe-west1', invoker: 'public', maxInstances: 20 },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');

    if (req.method !== 'GET') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const segments = req.path.split('/').filter(Boolean);
    const gigId = segments[segments.length - 1] ?? '';
    if (!GIG_ID_RE.test(gigId)) {
      res.status(400).send('Invalid gig ID');
      return;
    }

    try {
      const gigSnap = await db.collection('gigs').doc(gigId).get();
      if (!gigSnap.exists) {
        res.status(404).send('Listing not found');
        return;
      }
      const gig = gigSnap.data();
      if (!gig || gig.status !== 'active' || gig.isSample === true) {
        res.status(404).send('Contact unavailable');
        return;
      }

      // Prefer private gigContacts/{gigId}; fall back to legacy gigs/{gigId}.posterPhone
      // until an approved migration moves existing live documents.
      const contactSnap = await db.collection('gigContacts').doc(gigId).get();
      const rawPhone =
        (contactSnap.exists ? (contactSnap.data()?.posterPhone as string | undefined) : undefined) ??
        (typeof gig.posterPhone === 'string' ? gig.posterPhone : undefined);

      if (!rawPhone || !/^\+213[567]\d{8}$/.test(rawPhone)) {
        res.status(404).send('Contact unavailable');
        return;
      }

      const langParam = typeof req.query.lang === 'string' ? req.query.lang : 'dar';
      const msg = WA_MESSAGES[langParam] ?? WA_MESSAGES.dar;
      const waUrl = `https://wa.me/${rawPhone.replace(/^\+/, '')}?text=${encodeURIComponent(msg)}`;
      res.redirect(302, waUrl);
    } catch {
      res.status(500).send('Internal Server Error');
    }
  }
);
