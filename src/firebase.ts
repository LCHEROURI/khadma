import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { resolveFirebaseRuntimeConfig, validateFirebaseConfig } from './lib/firebaseConfig';

const runtime = resolveFirebaseRuntimeConfig({
  PROD: import.meta.env.PROD,
  VITE_USE_EMULATORS: import.meta.env.VITE_USE_EMULATORS,
  VITE_FIREBASE_ENV: import.meta.env.VITE_FIREBASE_ENV,
  VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
  VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY
});

const missingConfig = validateFirebaseConfig(runtime.config);
if (missingConfig.length > 0 && typeof console !== 'undefined') {
  console.warn(`KHADMA: Missing Firebase config keys: ${missingConfig.join(', ')}`);
}

export const app = initializeApp(runtime.config);
export const auth = getAuth(app);
export const functions = getFunctions(app, 'europe-west1');

/**
 * Lazy Firebase App Check initialization (Phase 6A cost & security balance):
 * - Initialized on-demand right before protected Cloud Function invocations rather than
 *   eagerly on passive public browse loads, avoiding billable reCAPTCHA Enterprise assessments
 *   for read-only visitors who never call a protected endpoint.
 * - `isTokenAutoRefreshEnabled: false` avoids background token refreshes on idle tabs;
 *   Firebase SDK automatically fetches a fresh token when an expired token is needed for a call.
 * - Cloud Functions still strictly enforce `enforceAppCheck: true` server-side.
 */
let appCheckInstance: AppCheck | null = null;

export function ensureAppCheckInitialized(): AppCheck | null {
  if (appCheckInstance || runtime.useEmulators || typeof window === 'undefined') {
    return appCheckInstance;
  }
  const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
  if (!recaptchaSiteKey) return null;
  appCheckInstance = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: false
  });
  return appCheckInstance;
}

// Offline-tolerant reads: Firestore local cache persists across restarts and tabs
// (memoryLocalCache used in isolated emulator E2E runs for clean test isolation).
export const db = initializeFirestore(app, {
  localCache: runtime.useEmulators
    ? memoryLocalCache()
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

if (runtime.useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
