export interface FirebasePublicConfig {
  apiKey?: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
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
