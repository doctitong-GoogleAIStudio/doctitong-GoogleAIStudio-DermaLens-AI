import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
export const API_URL = `${BASE}/api`;
export const TOKEN_KEY = "access_token";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await storage.secureGet<string>(TOKEN_KEY, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  // Never let a stalled network call hang the app (e.g. auth bootstrap on launch).
  const controller = new AbortController();
  const timeoutMs = path === "/analyze" ? 120000 : 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers, signal: controller.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new ApiError("The server took too long to respond.", 0);
    throw new ApiError("Network error. Check your connection and try again.", 0);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!res.ok) {
    const detail = typeof body?.detail === "string" ? body.detail : `Request failed (${res.status})`;
    throw new ApiError(detail, res.status);
  }
  return body as T;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: { id: string; full_name: string; email: string };
}

export const api = {
  signup: (full_name: string, email: string, password: string) =>
    request<AuthResponse>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ full_name, email, password }),
    }),
  login: (email: string, password: string) =>
    request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<{ id: string; full_name: string; email: string }>("/auth/me"),
  analyze: (images: string[]) =>
    request<any>("/analyze", { method: "POST", body: JSON.stringify({ images }) }),
  requestActivation: (device_id: string) =>
    request<{ status: string; emailed: boolean }>("/device/request-activation", {
      method: "POST",
      body: JSON.stringify({ device_id }),
    }),
  /** Records this device as activated server-side so it survives reinstall/logout. */
  deviceActivate: (device_id: string, key: string) =>
    request<{ activated: boolean }>("/device/activate", {
      method: "POST",
      body: JSON.stringify({ device_id, key }),
    }),
  deviceStatus: (device_id: string) =>
    request<{ activated: boolean }>(`/device/status?device_id=${encodeURIComponent(device_id)}`),
  /** Renders report HTML into a real PDF on the server and returns the raw bytes. */
  reportPdf: async (html: string, filename: string): Promise<Blob> => {
    const token = await storage.secureGet<string>(TOKEN_KEY, "");
    const res = await fetch(`${API_URL}/report/pdf`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ html, filename }),
    });
    if (!res.ok) throw new ApiError(`Could not build the PDF (${res.status})`, res.status);
    return res.blob();
  },
};
