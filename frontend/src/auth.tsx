import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

import { localSignIn, localSignUp, localSignOut, localGetSession, localUpsertAccount, localVerify } from "@/src/localAuth";
import { OfflineError, clearToken, serverEmailExists, serverLogin, serverSignUp, setToken, tokenIsValid } from "@/src/api";
import type { AuthUser } from "@/src/types";

interface AuthContextValue {
  ready: boolean;
  user: AuthUser | null;
  /** A local session exists but the app has no valid backend token yet. */
  needsReconnect: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (fullName: string, email: string, password: string) => Promise<void>;
  /** Re-authenticates an existing local session so AI analysis works again. */
  reconnect: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const WRONG_PASSWORD_ON_SERVER =
  "This email is registered with a different password. Use that password or reset it.";
const BAD_CREDENTIALS = "Email or password is incorrect.";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);

  useEffect(() => {
    (async () => {
      let session: AuthUser | null = null;
      try {
        session = await localGetSession();
      } catch {
        session = null;
      }
      setUser(session);
      if (session) setNeedsReconnect(!(await tokenIsValid()));
      setReady(true);
    })();
  }, []);

  /**
   * Signs in against the backend first, so accounts created on the server or
   * on another phone work. A legacy local-only account (older builds had no
   * server) is migrated by registering it with the same credentials.
   */
  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const res = await serverLogin(email, password);
      if (res.status === 200 && res.token) {
        await setToken(res.token);
        setUser(await localUpsertAccount(res.fullName ?? "", email, password));
        setNeedsReconnect(false);
        return;
      }

      // Not on the server — migrate the local account if the password matches.
      const local = await localVerify(email, password);
      if (!local) {
        // No local account either: say which of the two problems it is.
        if (await serverEmailExists(email)) throw new Error(WRONG_PASSWORD_ON_SERVER);
        throw new Error(BAD_CREDENTIALS);
      }

      const signup = await serverSignUp(local.full_name, email, password);
      if (signup.token) {
        await setToken(signup.token);
        setUser(await localUpsertAccount(local.full_name, email, password));
        setNeedsReconnect(false);
        return;
      }
      if (signup.status === 409) throw new Error(WRONG_PASSWORD_ON_SERVER);
      throw new Error(BAD_CREDENTIALS);
    } catch (e) {
      if (!(e instanceof OfflineError)) throw e;
      // Offline: local sign-in only. AI analysis stays disabled until online.
      setUser(await localSignIn(email, password));
      setNeedsReconnect(true);
    }
  }, []);

  const signUp = useCallback(async (fullName: string, email: string, password: string) => {
    const account = await localSignUp(fullName, email, password);
    setUser(account);
    try {
      const res = await serverSignUp(fullName, account.email, password);
      if (res.token) {
        await setToken(res.token);
        setNeedsReconnect(false);
        return;
      }
      if (res.status === 409) {
        const login = await serverLogin(account.email, password);
        if (login.token) {
          await setToken(login.token);
          setNeedsReconnect(false);
          return;
        }
      }
      setNeedsReconnect(true);
    } catch {
      setNeedsReconnect(true); // offline
    }
  }, []);

  const reconnect = useCallback(
    async (password: string) => {
      if (!user) return;
      try {
        const res = await serverLogin(user.email, password);
        if (res.status === 200 && res.token) {
          await setToken(res.token);
          setUser(await localUpsertAccount(res.fullName ?? user.full_name, user.email, password));
          setNeedsReconnect(false);
          return;
        }

        const local = await localVerify(user.email, password);
        if (!local) throw new Error("That password is incorrect.");

        const signup = await serverSignUp(local.full_name, user.email, password);
        if (signup.token) {
          await setToken(signup.token);
          setNeedsReconnect(false);
          return;
        }
        if (signup.status === 409) throw new Error(WRONG_PASSWORD_ON_SERVER);
        throw new Error("Could not enable AI analysis. Please try again.");
      } catch (e) {
        if (e instanceof OfflineError) {
          throw new Error("No internet connection. Connect to the internet and try again.");
        }
        throw e;
      }
    },
    [user],
  );

  const signOut = useCallback(async () => {
    await localSignOut();
    await clearToken();
    setNeedsReconnect(false);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ ready, user, needsReconnect, signIn, signUp, reconnect, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
