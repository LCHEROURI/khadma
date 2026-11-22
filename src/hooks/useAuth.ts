import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../firebase';
import { ADMIN_EMAIL } from '../lib/constants';

export interface AuthState {
  user: User | null;
  loading: boolean;
  phoneNumber: string | null;
  isAdmin: boolean;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [loading, setLoading] = useState<boolean>(auth.currentUser === null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  return {
    user,
    loading,
    phoneNumber: user?.phoneNumber ?? null,
    isAdmin: Boolean(user?.email === ADMIN_EMAIL && user?.emailVerified)
  };
}
