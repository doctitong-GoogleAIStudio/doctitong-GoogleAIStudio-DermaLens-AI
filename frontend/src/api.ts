import { storage } from "@/src/utils/storage";

/**
 * Thin client for this app's own backend. The Gemini key lives ONLY on the
 * server — the app never talks to Google directly.
 */

const BASE = (process.env.EXPO_PUBLIC_BACKEND_URL ?? "").replace(/\/+$/, "");
const TOKEN_KEY = "api_access_token";
const TIMEOUT_MS = 20000;

export function apiUrl(path: string): string {
  return `${BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function getToken(): Promise<string> {
  const secure = await storage.secureGet<string>(TOKEN_KEY, "");
  if (secure) return secure;
  return (await storage.getItem<string>(TOKEN_KEY, "")) ?? "";
}

export async function setToken(token: string): Promise<void> {
  if (await storage.secureSet(TOKEN_KEY, token)) {
    if ((await storage.secureGet<string>(TOKEN_KEY, "")) === token) return;
  }
  await storage.setItem(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await storage.secureRemove(TOKEN_KEY);
  await storage.removeItem(TOKEN_KEY);
}

/** Thrown when the backend could not be reached at all (offline, DNS, timeout). */
export class OfflineError extends Error {
  constructor() {
    super("offline");
    this.name = "OfflineError";
  }
}

export interface ServerAuthResult {
  status: number;
  token?: string;
  fullName?: string;
  detail?: string;
}

async function postAuth(path: string, body: unknown): Promise<ServerAuthResult> {
  if (!BASE) throw new OfflineError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new OfflineError();
  } finally {
    clearTimeout(timer);
  }

  // 5xx means the server is there but broken — treat it like being offline so
  // the user still gets into the app with their local account.
  if (res.status >= 500) throw new OfflineError();

  const json: any = await res.json().catch(() => ({}));
  return {
    status: res.status,
    token: typeof json?.access_token === "string" ? json.access_token : undefined,
    fullName: typeof json?.user?.full_name === "string" ? json.user.full_name : undefined,
    detail: typeof json?.detail === "string" ? json.detail : undefined,
  };
}

export function serverLogin(email: string, password: string): Promise<ServerAuthResult> {
  return postAuth("/api/auth/login", { email, password });
}

export function serverSignUp(fullName: string, email: string, password: string): Promise<ServerAuthResult> {
  return postAuth("/api/auth/signup", { full_name: fullName, email, password });
}

/** True when the backend already has an account for this email. */
export async function serverEmailExists(email: string): Promise<boolean> {
  if (!BASE) throw new OfflineError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl(`/api/auth/email-exists?email=${encodeURIComponent(email)}`), {
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const json: any = await res.json().catch(() => ({}));
    return json?.exists === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** True when the stored token is still accepted by the backend. */
export async function tokenIsValid(): Promise<boolean> {
  const token = await getToken();
  if (!token || !BASE) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl("/api/auth/me"), {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (res.status === 401) {
      await clearToken();
      return false;
    }
    return res.ok;
  } catch {
    return true; // offline — keep the token, it is probably still good
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Public pages (served by the backend so they always match the deployed API)
// ---------------------------------------------------------------------------
export function privacyPolicyUrl(): string | null {
  return BASE ? apiUrl("/api/privacy-policy") : null;
}

export function accountDeletionPageUrl(): string | null {
  return BASE ? apiUrl("/api/account-deletion") : null;
}

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------
export interface DeleteAccountResult {
  /** 200 deleted · 401 wrong password · 404 no server account · other = server error */
  status: number;
  detail?: string;
}

async function postJson(path: string, body: unknown, token?: string): Promise<{ status: number; json: any }> {
  if (!BASE) throw new OfflineError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new OfflineError();
  } finally {
    clearTimeout(timer);
  }
  if (res.status >= 500) throw new OfflineError();
  const json: any = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/**
 * Deletes the account on the server. Uses the stored session token when there
 * is one (re-authenticating with the password), otherwise the credentials
 * alone — the same path the public web page uses.
 */
export async function serverDeleteAccount(email: string, password: string): Promise<DeleteAccountResult> {
  const token = await getToken();
  let res = token
    ? await postJson("/api/account/delete", { password }, token)
    : await postJson("/api/account-deletion", { email, password });
  // A stale token is not a reason to fail: fall back to credentials.
  if (token && res.status === 401 && res.json?.detail === "Invalid or expired token") {
    res = await postJson("/api/account-deletion", { email, password });
  }
  return { status: res.status, detail: typeof res.json?.detail === "string" ? res.json.detail : undefined };
}

// ---------------------------------------------------------------------------
// Google Play subscription verification (optional, server-side)
// ---------------------------------------------------------------------------
export interface ServerSubscriptionStatus {
  configured: boolean;
  state?: "none" | "active" | "cancelled" | "grace_period" | "on_hold" | "paused" | "expired" | "pending" | "unknown";
  entitled?: boolean;
  productId?: string;
  basePlanId?: string | null;
  offerId?: string | null;
  isTrial?: boolean;
  autoRenewing?: boolean | null;
  /** RFC 3339 timestamp from Google Play. */
  expiryTime?: string | null;
  autoResumeTime?: string | null;
}

/**
 * Asks the backend to look the purchase up in the Google Play Developer API.
 * Returns null when offline, not signed in, or the backend has no service
 * account configured — callers must then rely on the Billing Library alone.
 */
export async function serverSubscriptionStatus(
  productId: string,
  purchaseToken: string,
): Promise<ServerSubscriptionStatus | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    const res = await postJson("/api/billing/subscription", { productId, purchaseToken }, token);
    if (res.status !== 200 || res.json?.configured !== true) return null;
    return res.json as ServerSubscriptionStatus;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Account-bound usage (free-analysis counter that survives reinstall)
// ---------------------------------------------------------------------------
export interface ServerUsage {
  analysesUsed: number;
  freeAnalyses: number;
}

/** Null when offline or not signed in to the backend — caller keeps its local count. */
export async function serverUsage(): Promise<ServerUsage | null> {
  const token = await getToken();
  if (!token || !BASE) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl("/api/billing/usage"), {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json: any = await res.json().catch(() => null);
    if (typeof json?.analyses_used !== "number") return null;
    return { analysesUsed: json.analyses_used, freeAnalyses: json.free_analyses ?? 1 };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
