import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

import { api, TOKEN_KEY } from "@/src/api";
import { storage } from "@/src/utils/storage";
import type { AuthUser } from "@/src/types";

interface AuthContextValue {
  ready: boolean;
  user: AuthUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (fullName: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const CACHED_USER_KEY = "cached_user";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    (async () => {
      const token = await storage.secureGet<string>(TOKEN_KEY, "");
      if (token) {
        const cachedRaw = await storage.getItem<string>(CACHED_USER_KEY, "");
        if (cachedRaw) {
          try {
            setUser(JSON.parse(cachedRaw) as AuthUser);
          } catch {}
        }
        try {
          const me = await api.me();
          setUser(me);
          await storage.setItem(CACHED_USER_KEY, JSON.stringify(me));
        } catch (e: any) {
          // Only sign out when the server actively rejects the token. If the
          // server is unreachable, keep working from the cached profile.
          if (e?.status === 401) {
            await storage.secureRemove(TOKEN_KEY);
            await storage.removeItem(CACHED_USER_KEY);
            setUser(null);
          }
        }
      }
      setReady(true);
    })();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api.login(email.trim(), password);
    await storage.secureSet(TOKEN_KEY, res.access_token);
    await storage.setItem(CACHED_USER_KEY, JSON.stringify(res.user));
    setUser(res.user);
  }, []);

  const signUp = useCallback(async (fullName: string, email: string, password: string) => {
    const res = await api.signup(fullName.trim(), email.trim(), password);
    await storage.secureSet(TOKEN_KEY, res.access_token);
    await storage.setItem(CACHED_USER_KEY, JSON.stringify(res.user));
    setUser(res.user);
  }, []);

  const signOut = useCallback(async () => {
    await storage.secureRemove(TOKEN_KEY);
    await storage.removeItem(CACHED_USER_KEY);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ ready, user, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
