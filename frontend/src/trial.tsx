import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { AppState } from "react-native";

import { api } from "@/src/api";
import { storage } from "@/src/utils/storage";
import { useAuth } from "@/src/auth";
import { resolveDeviceId, validateActivationKey, computeActivationKey } from "@/src/device";

export const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;

const TRIAL_START_KEY = "trial_start_ms";
const ACTIVATED_KEY = "device_activated";

interface TrialContextValue {
  ready: boolean;
  deviceId: string;
  trialStartMs: number;
  activated: boolean;
  now: number;
  msRemaining: number;
  expired: boolean;
  activate: (key: string) => Promise<boolean>;
  requestActivation: () => Promise<{ status: string; emailed: boolean }>;
}

const TrialContext = createContext<TrialContextValue | undefined>(undefined);

export function TrialProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [trialStartMs, setTrialStartMs] = useState(0);
  const [activated, setActivated] = useState(false);
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

  // Activation lives on the server too, keyed by Device ID, so a reinstall or a
  // different account on the same phone stays activated.
  useEffect(() => {
    if (!user || !deviceId) return;
    let cancelled = false;
    (async () => {
      try {
        if (activated) {
          // Make sure a device activated before this sync existed is registered.
          await api.deviceActivate(deviceId, computeActivationKey(deviceId));
          return;
        }
        const res = await api.deviceStatus(deviceId);
        if (cancelled || !res.activated) return;
        await storage.setItem(ACTIVATED_KEY, true);
        setActivated(true);
      } catch {
        // Offline or server unreachable — the local flag still applies.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, deviceId, activated]);

  const activate = useCallback(
    async (key: string) => {
      if (!deviceId) return false;
      if (validateActivationKey(deviceId, key)) {
        await storage.setItem(ACTIVATED_KEY, true);
        setActivated(true);
        try {
          await api.deviceActivate(deviceId, key);
        } catch {
          // Recorded locally; the sync effect will retry on the next launch.
        }
        return true;
      }
      return false;
    },
    [deviceId],
  );

  const requestActivation = useCallback(async () => {
    return api.requestActivation(deviceId);
  }, [deviceId]);

  const msRemaining = Math.max(0, trialStartMs + TRIAL_MS - now);
  const expired = !activated && ready && trialStartMs > 0 && msRemaining <= 0;

  return (
    <TrialContext.Provider
      value={{ ready, deviceId, trialStartMs, activated, now, msRemaining, expired, activate, requestActivation }}
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
