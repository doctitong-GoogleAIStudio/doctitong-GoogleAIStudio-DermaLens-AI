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
