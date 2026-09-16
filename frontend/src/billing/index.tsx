import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/src/auth";
import { serverUsage } from "@/src/api";
import { useStoreBilling } from "./store";
import { FREE_ANALYSES } from "./products";
import { readUsedAnalyses, reconcileUsedAnalyses, recordAnalysisUsed } from "./localState";
import type { StoreBilling } from "./types";

export { FREE_ANALYSES, PRODUCT_IDS } from "./products";
export type { ActivePlanInfo, PlanKey, PlanOption, SubscriptionStatus } from "./types";
export { describeSubscription } from "./status";

interface SubscriptionValue extends StoreBilling {
  /** Analyses already run — the higher of this device's count and the account's server count. */
  used: number;
  freeLeft: number;
  /** False only when the free analysis is spent and there is no subscription. */
  canAnalyze: boolean;
  /** Call right after a successful analysis. */
  countAnalysis: () => Promise<void>;
}

const Context = createContext<SubscriptionValue | null>(null);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const store = useStoreBilling();
  const { user, needsReconnect } = useAuth();
  const [used, setUsed] = useState(0);
  const [allowance, setAllowance] = useState(FREE_ANALYSES);
  // The counter lives per account, so it must be re-read whenever the signed-in
  // account changes (sign out / switch account), never carried over.
  const account = user?.email ?? null;

  useEffect(() => {
    let alive = true;
    readUsedAnalyses(account).then((v) => {
      if (alive) setUsed(v);
    });
    return () => {
      alive = false;
    };
  }, [account]);

  // The free analysis belongs to the ACCOUNT: the backend counts every successful
  // analysis for that account, so a reinstall (which wipes AsyncStorage) or a fresh
  // sign-in cannot hand out another one. The on-device counter is only that
  // account's offline cache — it is no longer a device-wide floor, which used to
  // make every new account on the phone start with its free analysis already spent.
  const syncWithAccount = useCallback(async () => {
    if (!user) return;
    const remote = await serverUsage();
    if (!remote) return; // offline / no token yet — keep what the device knows
    if (remote.freeAnalyses > 0) setAllowance(remote.freeAnalyses);
    setUsed(await reconcileUsedAnalyses(remote.analysesUsed, user.email));
  }, [user]);

  useEffect(() => {
    // Deferred so the (async) sync never sets state synchronously inside the effect.
    const t = setTimeout(syncWithAccount, 0);
    return () => clearTimeout(t);
  }, [syncWithAccount, needsReconnect]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") syncWithAccount();
    });
    return () => sub.remove();
  }, [syncWithAccount]);

  const countAnalysis = useCallback(async () => {
    setUsed(await recordAnalysisUsed(account));
    // The server already logged this analysis; pull its count so both agree.
    syncWithAccount();
  }, [account, syncWithAccount]);

  const freeLeft = Math.max(0, allowance - used);
  // Where Play Billing cannot run there is no way to subscribe, so gating is off.
  const canAnalyze = !store.available || store.isSubscribed || freeLeft > 0;

  return (
    <Context.Provider value={{ ...store, used, freeLeft, canAnalyze, countAnalysis }}>{children}</Context.Provider>
  );
}

export function useSubscription(): SubscriptionValue {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useSubscription must be used within a SubscriptionProvider");
  return ctx;
}
