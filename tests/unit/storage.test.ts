import { beforeEach, describe, expect, it } from 'vitest';
import { validateFirebaseConfig } from '../../src/lib/firebaseConfig';
import { readStringList, writeStringList } from '../../src/lib/storage';

const memory = new Map<string, string>();
const mockStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => {
    memory.set(k, v);
  },
  removeItem: (k: string) => {
    memory.delete(k);
  },
  clear: () => {
    memory.clear();
  }
};

describe('storage string-list helper (QUAL-003)', () => {
  beforeEach(() => {
    memory.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      configurable: true
    });
  });

  it('writes and reads string arrays cleanly', () => {
    writeStringList('khadma-saved', ['gig_1', 'gig_2']);
    expect(readStringList('khadma-saved')).toEqual(['gig_1', 'gig_2']);
  });

  it('handles missing, corrupt, non-array, and mixed-type storage safely', () => {
    expect(readStringList('missing')).toEqual([]);
    memory.set('corrupt', '{not-json');
    expect(readStringList('corrupt')).toEqual([]);
    memory.set('obj', '{"a":1}');
    expect(readStringList('obj')).toEqual([]);
    memory.set('mixed', '["ok", 42, null, "also-ok"]');
    expect(readStringList('mixed')).toEqual(['ok', 'also-ok']);
  });
});

describe('validateFirebaseConfig (ARCH-003)', () => {
  it('flags missing VITE_FIREBASE_API_KEY without exposing secret values', () => {
    const missing = validateFirebaseConfig({
      apiKey: '',
      authDomain: 'khadma-oran.firebaseapp.com',
      projectId: 'khadma-oran',
      storageBucket: 'khadma-oran.firebasestorage.app',
      messagingSenderId: '1000158969612',
      appId: '1:1000158969612:web:1e92c73336c232a8d25329'
    });
    expect(missing).toEqual(['VITE_FIREBASE_API_KEY']);
  });

  it('passes when all required fields are non-empty', () => {
    const missing = validateFirebaseConfig({
      apiKey: 'placeholder-non-empty',
      authDomain: 'khadma-oran.firebaseapp.com',
      projectId: 'khadma-oran',
      storageBucket: 'khadma-oran.firebasestorage.app',
      messagingSenderId: '1000158969612',
      appId: '1:1000158969612:web:1e92c73336c232a8d25329'
    });
    expect(missing).toEqual([]);
  });
});
