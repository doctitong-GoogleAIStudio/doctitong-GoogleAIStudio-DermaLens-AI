import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

import { localSignIn, localSignUp, localSignOut, localGetSession } from "@/src/localAuth";
import { clearToken, syncServerSession } from "@/src/api";
import type { AuthUser } from "@/src/types";

interface AuthContextValue {
  ready: boolean;
  user: AuthUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (fullName: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setUser(await localGetSession());
      } catch {
        setUser(null);
      }
      setReady(true);
    })();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const account = await localSignIn(email, password);
    setUser(account);
    // Mirrors the account on the backend so the app holds a JWT for /api/analyze.
    // Offline sign-in still works; only AI analysis needs the token.
    await syncServerSession(account.full_name, account.email, password, "login");
  }, []);

  const signUp = useCallback(async (fullName: string, email: string, password: string) => {
    const account = await localSignUp(fullName, email, password);
    setUser(account);
    await syncServerSession(account.full_name, account.email, password, "signup");
  }, []);

  const signOut = useCallback(async () => {
    await localSignOut();
    await clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ ready, user, signIn, signUp, signOut }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
