import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { validateFirebaseConfig } from './lib/firebaseConfig';

// Web SDK config. The API key lives in .env (gitignored, loaded at build time)
// — see .env.example. Everything else is public project metadata.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: 'khadma-oran.firebaseapp.com',
  projectId: 'khadma-oran',
  storageBucket: 'khadma-oran.firebasestorage.app',
  messagingSenderId: '1000158969612',
  appId: '1:1000158969612:web:1e92c73336c232a8d25329'
};

const missingConfig = validateFirebaseConfig(firebaseConfig);
if (missingConfig.length > 0 && typeof console !== 'undefined') {
  console.warn(`KHADMA: Missing Firebase config keys: ${missingConfig.join(', ')}`);
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const functions = getFunctions(app, 'europe-west1');

// Enable Firebase App Check via Fraud Defense (reCAPTCHA Enterprise) when site key is configured.
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
if (typeof window !== 'undefined' && recaptchaSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true
  });
}

// Offline-tolerant reads: Firestore local cache persists across restarts and tabs.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
