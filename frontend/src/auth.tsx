import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";

import {
  localDeleteAccount,
  localGetSession,
  localSignIn,
  localSignOut,
  localUpsertAccount,
  localVerify,
} from "@/src/localAuth";
import {
  OfflineError,
  clearToken,
  serverDeleteAccount,
  serverEmailExists,
  serverLogin,
  setToken,
  signUpResend,
  signUpStart,
  signUpVerify,
  tokenIsValid,
  type SignupStartResult,
} from "@/src/api";
import { clearUserData } from "@/src/localData";
import { emailError, normalizeEmail, passwordError } from "@/src/validation";
import type { AuthUser } from "@/src/types";

/** A sign-in either lands in the app, or needs the emailed code first. */
export type SignInResult = "signed-in" | "needs-verification";

export interface PendingSignup {
  fullName: string;
  email: string;
  resendAfterSeconds: number;
}

interface AuthContextValue {
  ready: boolean;
  user: AuthUser | null;
  /** A local session exists but the app has no valid backend token yet. */
  needsReconnect: boolean;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  /**
   * Step 1 of sign-up: validates the address and asks the backend to email a
   * code. No account — local or remote — exists until `confirmSignUp` succeeds,
   * which is why this needs a connection.
   */
  startSignUp: (fullName: string, email: string, password: string) => Promise<void>;
  /** Step 2: the code creates the account and signs the user in. */
  confirmSignUp: (code: string) => Promise<void>;
  resendCode: () => Promise<SignupStartResult>;
  cancelSignUp: () => void;
  /** Set between the two sign-up steps; drives the confirmation screen. */
  pendingSignup: PendingSignup | null;
  /** Re-authenticates an existing local session so AI analysis works again. */
  reconnect: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Permanently deletes the account on the server and every trace of it on
   * this phone, then signs out. Re-authenticates with the password first.
   */
  deleteAccount: (password: string) => Promise<void>;
}

const WRONG_PASSWORD_ON_SERVER =
  "This email is registered with a different password. Use that password or reset it.";
const BAD_CREDENTIALS = "Email or password is incorrect.";
const NEEDS_INTERNET =
  "An internet connection is required to create an account, so we can email you a verification code.";
const SESSION_GONE = "Please start creating your account again.";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [pendingSignup, setPendingSignup] = useState<PendingSignup | null>(null);
  // The password only ever lives in memory between the two sign-up steps -
  // never in a route param, never on disk.
  const pendingCredentials = useRef<{ fullName: string; email: string; password: string } | null>(null);

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
  const signIn = useCallback(async (email: string, password: string): Promise<SignInResult> => {
    const clean = normalizeEmail(email);
    try {
      const res = await serverLogin(clean, password);
      if (res.status === 200 && res.token) {
        await setToken(res.token);
        setUser(await localUpsertAccount(res.fullName ?? "", clean, password));
        setNeedsReconnect(false);
        return "signed-in";
      }

      // Not on the server — migrate the local account if the password matches.
      const local = await localVerify(clean, password);
      if (!local) {
        // No local account either: say which of the two problems it is.
        if (await serverEmailExists(clean)) throw new Error(WRONG_PASSWORD_ON_SERVER);
        throw new Error(BAD_CREDENTIALS);
      }

      // A local-only account from an older build. Claiming it on the server now
      // means confirming the address first, so send the code instead of
      // silently creating an unverified account.
      const start = await signUpStart(local.full_name, clean, password);
      if (start.sent) {
        setPendingSignup({
          fullName: local.full_name,
          email: clean,
          resendAfterSeconds: start.resendAfterSeconds ?? 60,
        });
        pendingCredentials.current = { fullName: local.full_name, email: clean, password };
        return "needs-verification";
      }
      if (start.status === 409) throw new Error(WRONG_PASSWORD_ON_SERVER);
      throw new Error(start.detail ?? BAD_CREDENTIALS);
    } catch (e) {
      if (!(e instanceof OfflineError)) throw e;
      // Offline: local sign-in only. AI analysis stays disabled until online.
      setUser(await localSignIn(clean, password));
      setNeedsReconnect(true);
      return "signed-in";
    }
  }, []);

  const startSignUp = useCallback(async (fullName: string, email: string, password: string) => {
    const name = fullName.trim();
    const clean = normalizeEmail(email);
    if (!name) throw new Error("Please enter your full name.");
    const invalid = emailError(clean) ?? (clean ? null : "Please enter a valid email address.");
    if (invalid) throw new Error(invalid);
    const weak = passwordError(password) ?? (password ? null : "Please enter a password.");
    if (weak) throw new Error(weak);

    let res: SignupStartResult;
    try {
      res = await signUpStart(name, clean, password);
    } catch (e) {
      if (e instanceof OfflineError) throw new Error(NEEDS_INTERNET);
      throw e;
    }
    if (!res.sent) {
      throw new Error(res.detail ?? "We could not start creating your account. Please try again.");
    }
    setPendingSignup({ fullName: name, email: clean, resendAfterSeconds: res.resendAfterSeconds ?? 60 });
    pendingCredentials.current = { fullName: name, email: clean, password };
  }, []);

  const confirmSignUp = useCallback(async (code: string) => {
    const creds = pendingCredentials.current;
    if (!creds) throw new Error(SESSION_GONE);

    let res;
    try {
      res = await signUpVerify(creds.email, code.trim());
    } catch (e) {
      if (e instanceof OfflineError) {
        throw new Error("No internet connection. Connect to the internet and try again.");
      }
      throw e;
    }

    if (res.token) {
      await setToken(res.token);
      // The account is verified, so it is now safe to keep it on this phone for
      // offline sign-in.
      setUser(await localUpsertAccount(res.fullName ?? creds.fullName, creds.email, creds.password));
      setNeedsReconnect(false);
      setPendingSignup(null);
      pendingCredentials.current = null;
      return;
    }
    throw new Error(res.detail ?? "That code could not be confirmed. Please try again.");
  }, []);

  const resendCode = useCallback(async (): Promise<SignupStartResult> => {
    const creds = pendingCredentials.current;
    if (!creds) throw new Error(SESSION_GONE);
    let res: SignupStartResult;
    try {
      res = await signUpResend(creds.email);
    } catch (e) {
      if (e instanceof OfflineError) throw new Error(NEEDS_INTERNET);
      throw e;
    }
    if (!res.sent) throw new Error(res.detail ?? "Could not send a new code. Please try again.");
    return res;
  }, []);

  const cancelSignUp = useCallback(() => {
    setPendingSignup(null);
    pendingCredentials.current = null;
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

        // The password is right but this account only exists on the phone, and
        // an account may no longer reach the server without a confirmed email.
        throw new Error(
          "This account's email has not been confirmed yet. Please sign out and sign in again to get a code by email.",
        );
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
    setPendingSignup(null);
    pendingCredentials.current = null;
    setUser(null);
  }, []);

  const deleteAccount = useCallback(
    async (password: string) => {
      if (!user) throw new Error("You are not signed in.");
      if (!password) throw new Error("Enter your password to confirm.");

      // 1. Server first — if that fails nothing on the phone is touched.
      let res;
      try {
        res = await serverDeleteAccount(user.email, password);
      } catch (e) {
        if (e instanceof OfflineError) {
          throw new Error("No internet connection. Connect to the internet to delete your account.");
        }
        throw e;
      }
      if (res.status === 401) throw new Error("That password is incorrect.");
      if (res.status === 429) throw new Error(res.detail ?? "Too many attempts. Please try again later.");
      if (res.status === 404) {
        // Never mirrored to the server (legacy local-only account) — still
        // require the password so nobody can wipe a phone they picked up.
        const local = await localVerify(user.email, password);
        if (!local) throw new Error("That password is incorrect.");
      } else if (res.status !== 200) {
        throw new Error(res.detail ?? "Your account could not be deleted. Please try again.");
      }

      // 2. Then this phone: scans, photos, reports, token, account record, session.
      await clearUserData();
      await localDeleteAccount(user.email);
      setNeedsReconnect(false);
      setUser(null);
    },
    [user],
  );

  return (
    <AuthContext.Provider value={{
        ready,
        user,
        needsReconnect,
        signIn,
        startSignUp,
        confirmSignUp,
        resendCode,
        cancelSignUp,
        pendingSignup,
        reconnect,
        signOut,
        deleteAccount,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
