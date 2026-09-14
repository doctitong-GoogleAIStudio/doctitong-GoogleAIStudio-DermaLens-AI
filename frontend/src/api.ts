import { storage } from "@/src/utils/storage";

/**
 * Thin client for this app's own backend. The Gemini key lives ONLY on the
 * server — the app never talks to Google directly.
 */

const BASE = (process.env.EXPO_PUBLIC_BACKEND_URL ?? "").replace(/\/+$/, "");
const TOKEN_KEY = "api_access_token";

export function apiUrl(path: string): string {
  return `${BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function getToken(): Promise<string> {
  const secure = await storage.secureGet<string>(TOKEN_KEY, "");
  if (secure) return secure;
  return (await storage.getItem<string>(TOKEN_KEY, "")) ?? "";
}

async function setToken(token: string): Promise<void> {
  if (await storage.secureSet(TOKEN_KEY, token)) {
    if ((await storage.secureGet<string>(TOKEN_KEY, "")) === token) return;
  }
  await storage.setItem(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await storage.secureRemove(TOKEN_KEY);
  await storage.removeItem(TOKEN_KEY);
}

async function postJson(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/**
 * Mirrors the on-device account onto the backend so the app holds a JWT for
 * /api/analyze. Best effort: when the phone is offline the app still works,
 * it just cannot run an AI analysis until the next online sign-in.
 */
export async function syncServerSession(
  fullName: string,
  email: string,
  password: string,
  mode: "signup" | "login",
): Promise<boolean> {
  if (!BASE) return false;
  try {
    const first =
      mode === "signup"
        ? await postJson("/api/auth/signup", { full_name: fullName, email, password })
        : await postJson("/api/auth/login", { email, password });

    let token: string | undefined = first.json?.access_token;

    // Signup on a server that already knows this email -> log in instead.
    if (!token && mode === "signup" && first.status === 409) {
      const retry = await postJson("/api/auth/login", { email, password });
      token = retry.json?.access_token;
    }
    // Logging in with an account that only exists on this device -> create it.
    if (!token && mode === "login" && first.status === 401) {
      const retry = await postJson("/api/auth/signup", { full_name: fullName, email, password });
      token = retry.json?.access_token;
    }

    if (!token) return false;
    await setToken(token);
    return true;
  } catch {
    return false; // offline
  }
}
