export interface FirebasePublicConfig {
  apiKey?: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export type FirebaseTargetEnv = 'emulator' | 'staging' | 'production';

export const PRODUCTION_PROJECT_ID = 'khadma-oran';
export const STAGING_PROJECT_ID = 'khadma-oran-staging';

export interface FirebaseEnvInput {
  PROD?: boolean;
  VITE_USE_EMULATORS?: string;
  VITE_FIREBASE_ENV?: string;
  VITE_FIREBASE_PROJECT_ID?: string;
  VITE_FIREBASE_AUTH_DOMAIN?: string;
  VITE_FIREBASE_STORAGE_BUCKET?: string;
  VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  VITE_FIREBASE_APP_ID?: string;
  VITE_FIREBASE_API_KEY?: string;
}

export interface ResolvedFirebaseRuntime {
  targetEnv: FirebaseTargetEnv;
  useEmulators: boolean;
  config: FirebasePublicConfig;
}

/**
 * Resolves the Firebase runtime configuration with strict environment isolation:
 * - Production builds (`PROD === true`) can NEVER connect to local emulators.
 * - Staging builds (`VITE_FIREBASE_ENV === 'staging'`) MUST NOT target `khadma-oran`.
 * - Production builds MUST NOT embed staging project identifiers (`khadma-oran-staging`).
 */
export function resolveFirebaseRuntimeConfig(env: FirebaseEnvInput): ResolvedFirebaseRuntime {
  const isProdBuild = env.PROD === true;
  const useEmulators = !isProdBuild && env.VITE_USE_EMULATORS === 'true';

  if (useEmulators) {
    const projectId = (env.VITE_FIREBASE_PROJECT_ID || 'demo-khadma').trim();
    if (!projectId.startsWith('demo-')) {
      throw new Error(`Emulator runtime requires a demo-* projectId, got "${projectId}".`);
    }
    return {
      targetEnv: 'emulator',
      useEmulators: true,
      config: {
        apiKey: env.VITE_FIREBASE_API_KEY || 'fake-api-key',
        authDomain: `${projectId}.firebaseapp.com`,
        projectId,
        storageBucket: `${projectId}.firebasestorage.app`,
        messagingSenderId: '000000000000',
        appId: `1:000000000000:web:emulator`
      }
    };
  }

  const requestedEnv = (env.VITE_FIREBASE_ENV || 'production').trim();
  if (requestedEnv !== 'staging' && requestedEnv !== 'production') {
    throw new Error(`Unsupported VITE_FIREBASE_ENV "${requestedEnv}".`);
  }

  if (requestedEnv === 'staging') {
    const projectId = (env.VITE_FIREBASE_PROJECT_ID || STAGING_PROJECT_ID).trim();
    if (projectId === PRODUCTION_PROJECT_ID) {
      throw new Error('Staging build cannot target production project khadma-oran.');
    }
    return {
      targetEnv: 'staging',
      useEmulators: false,
      config: {
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: (env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`).trim(),
        projectId,
        storageBucket: (env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`).trim(),
        messagingSenderId: (env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim(),
        appId: (env.VITE_FIREBASE_APP_ID || '').trim()
      }
    };
  }

  const projectId = (env.VITE_FIREBASE_PROJECT_ID || PRODUCTION_PROJECT_ID).trim();
  if (projectId === STAGING_PROJECT_ID || projectId.startsWith('demo-')) {
    throw new Error(`Production build cannot target non-production project "${projectId}".`);
  }

  return {
    targetEnv: 'production',
    useEmulators: false,
    config: {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: (env.VITE_FIREBASE_AUTH_DOMAIN || 'khadma-oran.firebaseapp.com').trim(),
      projectId,
      storageBucket: (env.VITE_FIREBASE_STORAGE_BUCKET || 'khadma-oran.firebasestorage.app').trim(),
      messagingSenderId: (env.VITE_FIREBASE_MESSAGING_SENDER_ID || '1000158969612').trim(),
      appId: (env.VITE_FIREBASE_APP_ID || '1:1000158969612:web:1e92c73336c232a8d25329').trim()
    }
  };
}

export function validateFirebaseConfig(config: FirebasePublicConfig): string[] {
  const missing: string[] = [];
  if (!config.apiKey || !config.apiKey.trim()) {
    missing.push('VITE_FIREBASE_API_KEY');
  }
  if (!config.projectId.trim()) {
    missing.push('projectId');
  }
  if (!config.appId.trim()) {
    missing.push('appId');
  }
  return missing;
}
