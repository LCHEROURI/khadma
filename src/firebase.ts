import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache } from 'firebase/firestore';

// Public web SDK config (no secrets — safe to commit).
// From: firebase apps:sdkconfig web 1:1000158969612:web:1e92c73336c232a8d25329 --project khadma-oran
const firebaseConfig = {
  apiKey: 'AIzaSyB2XVuo1NkrGyD77fiK11FzjVGwC0f7VpQ',
  authDomain: 'khadma-oran.firebaseapp.com',
  projectId: 'khadma-oran',
  storageBucket: 'khadma-oran.firebasestorage.app',
  messagingSenderId: '1000158969612',
  appId: '1:1000158969612:web:1e92c73336c232a8d25329'
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Offline-tolerant reads: Firestore local cache persists across restarts.
export const db = initializeFirestore(app, { localCache: persistentLocalCache() });
