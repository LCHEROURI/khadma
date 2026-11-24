import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { validateFirebaseConfig } from './lib/firebaseConfig';

// Strictly impossible in production builds (`import.meta.env.PROD === true`):
// Vite replaces `import.meta.env.PROD` at build time so production bundles can NEVER connect to local emulators.
const useEmulators = !import.meta.env.PROD && import.meta.env.VITE_USE_EMULATORS === 'true';

// Web SDK config. The API key lives in .env (gitignored, loaded at build time)
// — see .env.example. Everything else is public project metadata.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: 'khadma-oran.firebaseapp.com',
  projectId: useEmulators ? (import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-khadma') : 'khadma-oran',
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
if (typeof window !== 'undefined' && recaptchaSiteKey && !useEmulators) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true
  });
}

// Offline-tolerant reads: Firestore local cache persists across restarts and tabs
// (memoryLocalCache used in isolated emulator E2E runs for clean test isolation).
export const db = initializeFirestore(app, {
  localCache: useEmulators
    ? memoryLocalCache()
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
