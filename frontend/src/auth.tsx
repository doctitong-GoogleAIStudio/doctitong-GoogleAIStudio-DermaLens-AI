import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

import { localSignIn, localSignUp, localSignOut, localGetSession } from "@/src/localAuth";
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
    setUser(await localSignIn(email, password));
  }, []);

  const signUp = useCallback(async (fullName: string, email: string, password: string) => {
    setUser(await localSignUp(fullName, email, password));
  }, []);

  const signOut = useCallback(async () => {
    await localSignOut();
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
