import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache } from 'firebase/firestore';

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
// Offline-tolerant reads: Firestore local cache persists across restarts.
export const db = initializeFirestore(app, { localCache: persistentLocalCache() });
