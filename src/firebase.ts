import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

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

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const functions = getFunctions(app, 'europe-west1');

// Enable Firebase App Check (reCAPTCHA v3) when site key is configured.
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
if (typeof window !== 'undefined' && recaptchaSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true
  });
}

// Offline-tolerant reads: Firestore local cache persists across restarts and tabs.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
