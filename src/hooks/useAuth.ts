import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../firebase';
import { ADMIN_EMAIL } from '../lib/constants';

export interface AuthState {
  user: User | null;
  loading: boolean;
  email: string | null;
  emailVerified: boolean;
  phoneNumber: string | null;
  isAnonymous: boolean;
  isPhoneUser: boolean;
  isVerifiedEmailEmployer: boolean;
  isEmployer: boolean;
  isAdmin: boolean;
  refreshAuth: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [loading, setLoading] = useState<boolean>(auth.currentUser === null);
  const [, setVersion] = useState(0);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  const refreshAuth = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) return;
    await current.reload();
    await current.getIdToken(true);
    setUser(auth.currentUser);
    setVersion((v) => v + 1);
  }, []);

  const email = user?.email ?? null;
  const emailVerified = Boolean(user?.emailVerified);
  const phoneNumber = user?.phoneNumber ?? null;
  const isAnonymous = Boolean(user?.isAnonymous);
  const isPhoneUser = Boolean(phoneNumber);
  const isVerifiedEmailEmployer = Boolean(email && emailVerified && !isAnonymous);
  const isEmployer = isVerifiedEmailEmployer || isPhoneUser;

  return {
    user,
    loading,
    email,
    emailVerified,
    phoneNumber,
    isAnonymous,
    isPhoneUser,
    isVerifiedEmailEmployer,
    isEmployer,
    isAdmin: Boolean(email === ADMIN_EMAIL && emailVerified),
    refreshAuth
  };
}
