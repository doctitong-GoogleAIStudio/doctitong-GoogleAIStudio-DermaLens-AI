import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { AppState, Platform, Linking } from "react-native";
import * as MailComposer from "expo-mail-composer";

import { storage } from "@/src/utils/storage";
import { resolveDeviceId, validateActivationKey } from "@/src/device";

export const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;

const TRIAL_START_KEY = "trial_start_ms";
const ACTIVATED_KEY = "device_activated";
const ACTIVATION_KEY_KEY = "device_activation_key";

interface TrialContextValue {
  ready: boolean;
  deviceId: string;
  trialStartMs: number;
  activated: boolean;
  /** The key that unlocked this device — shown so the user can keep it for a reinstall. */
  activationKey: string;
  now: number;
  msRemaining: number;
  expired: boolean;
  activate: (key: string) => Promise<boolean>;
  requestActivation: () => Promise<{ status: string; emailed: boolean }>;
}

export const ADMIN_EMAIL = process.env.EXPO_PUBLIC_ADMIN_EMAIL ?? "docvincent2022@yahoo.com";

const TrialContext = createContext<TrialContextValue | undefined>(undefined);

export function TrialProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [trialStartMs, setTrialStartMs] = useState(0);
  const [activated, setActivated] = useState(false);
  const [activationKey, setActivationKey] = useState("");
  const [now, setNow] = useState(Date.now());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      const id = await resolveDeviceId();
      setDeviceId(id);

      let start = await storage.getItem<number>(TRIAL_START_KEY, 0);
      if (!start) {
        start = Date.now();
        await storage.setItem(TRIAL_START_KEY, start);
      }
      setTrialStartMs(start);

      const act = await storage.getItem<boolean>(ACTIVATED_KEY, false);
      setActivated(!!act);
      setActivationKey((await storage.getItem<string>(ACTIVATION_KEY_KEY, "")) ?? "");
      setNow(Date.now());
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    timer.current = setInterval(() => setNow(Date.now()), 1000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") setNow(Date.now());
    });
    return () => {
      if (timer.current) clearInterval(timer.current);
      sub.remove();
    };
  }, []);

  // Activation lives entirely on this device — no server, works offline.

  const activate = useCallback(
    async (key: string) => {
      if (!deviceId) return false;
      if (validateActivationKey(deviceId, key)) {
        await storage.setItem(ACTIVATED_KEY, true);
        await storage.setItem(ACTIVATION_KEY_KEY, key.trim().toUpperCase());
        setActivated(true);
        setActivationKey(key.trim().toUpperCase());
        return true;
      }
      return false;
    },
    [deviceId],
  );

  /** Opens the phone's email app with the Device ID pre-filled — no server needed. */
  const requestActivation = useCallback(async () => {
    const subject = "AI Dermatologist — Device Activation Request";
    const body =
      `Hello,\n\nPlease send me the activation key for my device.\n\n` +
      `Device ID: ${deviceId}\n\nThank you.`;

    if (Platform.OS !== "web" && (await MailComposer.isAvailableAsync())) {
      const res = await MailComposer.composeAsync({
        recipients: [ADMIN_EMAIL],
        subject,
        body,
      });
      return { status: res.status, emailed: res.status === "sent" };
    }

    const url = `mailto:${ADMIN_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    await Linking.openURL(url);
    return { status: "opened", emailed: false };
  }, [deviceId]);

  const msRemaining = Math.max(0, trialStartMs + TRIAL_MS - now);
  const expired = !activated && ready && trialStartMs > 0 && msRemaining <= 0;

  return (
    <TrialContext.Provider
      value={{
        ready,
        deviceId,
        trialStartMs,
        activated,
        activationKey,
        now,
        msRemaining,
        expired,
        activate,
        requestActivation,
      }}
    >
      {children}
    </TrialContext.Provider>
  );
}

export function useTrial(): TrialContextValue {
  const ctx = useContext(TrialContext);
  if (!ctx) throw new Error("useTrial must be used within TrialProvider");
  return ctx;
}

export function formatCountdown(ms: number): { days: number; hours: number; minutes: number; seconds: number } {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return { days, hours, minutes, seconds };
}
