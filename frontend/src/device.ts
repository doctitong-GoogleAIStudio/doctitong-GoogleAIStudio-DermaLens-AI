import { Platform } from "react-native";
import * as Application from "expo-application";
import { sha256 } from "js-sha256";

import { storage } from "@/src/utils/storage";

// Must match ACTIVATION_SECRET in backend/.env — the offline generator uses the
// same constant so keys validate without any server round-trip.
const ACTIVATION_SECRET = "DERM-ACT-2026-x7Qp9Lm3Vt8Bz1Ns";
const RAW_FALLBACK_KEY = "raw_device_fallback";

function randomRaw(): string {
  return "fallback-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function getRawDeviceId(): Promise<string> {
  try {
    if (Platform.OS === "android") {
      const id = Application.getAndroidId?.();
      if (id) return "android-" + id;
    } else if (Platform.OS === "ios") {
      const id = await Application.getIosIdForVendorAsync();
      if (id) return "ios-" + id;
    }
  } catch {
    // fall through to persisted fallback
  }
  let raw = await storage.getItem<string>(RAW_FALLBACK_KEY, "");
  if (!raw) {
    raw = randomRaw();
    await storage.setItem(RAW_FALLBACK_KEY, raw);
  }
  return raw;
}

function group(s: string, size: number): string {
  return (s.match(new RegExp(`.{1,${size}}`, "g")) || [s]).join("-");
}

export function formatDeviceId(raw: string): string {
  const h = sha256(raw).toUpperCase();
  return group(h.slice(0, 12), 4); // XXXX-XXXX-XXXX
}

export function computeActivationKey(deviceId: string): string {
  const norm = deviceId.trim().toUpperCase();
  const h = sha256.hmac(ACTIVATION_SECRET, norm).toUpperCase();
  return group(h.slice(0, 16), 4); // AAAA-BBBB-CCCC-DDDD
}

export function validateActivationKey(deviceId: string, key: string): boolean {
  const norm = key.trim().toUpperCase().replace(/\s+/g, "");
  return norm === computeActivationKey(deviceId);
}

export async function resolveDeviceId(): Promise<string> {
  const raw = await getRawDeviceId();
  return formatDeviceId(raw);
}
