import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/src/auth";
import { serverUsage } from "@/src/api";
import { useStoreBilling } from "./store";
import { FREE_ANALYSES } from "./products";
import { readUsedAnalyses, reconcileUsedAnalyses, recordAnalysisUsed } from "./localState";
import type { StoreBilling } from "./types";

export { FREE_ANALYSES, CREDIT_PRODUCT_IDS, CREDITS_PER_PRODUCT, CREDIT_PRODUCT_LIST } from "./products";
export type { CreditPack } from "./types";
export { describeCredits } from "./status";

interface CreditsValue extends StoreBilling {
  /** Analyses already run — the higher of this device's count and the account's server count. */
  used: number;
  freeLeft: number;
  /** Credits the account holds, as last reported by the server. */
  credits: number;
  /** False only when the free analysis is spent and there are no credits. */
  canAnalyze: boolean;
  /** Call right after a successful analysis. */
  countAnalysis: () => Promise<void>;
  /** Re-reads usage and credit balance from the server. */
  refresh: () => Promise<void>;
}

const Context = createContext<CreditsValue | null>(null);

export function CreditsProvider({ children }: { children: React.ReactNode }) {
  const { user, needsReconnect } = useAuth();
  const [used, setUsed] = useState(0);
  const [credits, setCredits] = useState(0);

  useEffect(() => {
    readUsedAnalyses().then(setUsed);
  }, []);

  // The free analysis belongs to the ACCOUNT: the backend counts every
  // successful analysis, so a reinstall (which wipes AsyncStorage) or a fresh
  // sign-in cannot hand out another one. The device counter is kept as a floor.
  // The credit balance is read from the server only — it is money, so the
  // device never gets a say in it.
  const syncWithAccount = useCallback(async () => {
    if (!user) return;
    const remote = await serverUsage();
    if (!remote) return; // offline / no token yet — keep what the device knows
    setUsed(await reconcileUsedAnalyses(remote.analysesUsed));
    setCredits(remote.creditBalance);
  }, [user]);

  // Passed to the store so a completed purchase refreshes the balance at once,
  // rather than the user waiting for the next foreground.
  const store = useStoreBilling(syncWithAccount);

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
    setUsed(await recordAnalysisUsed());
    // The server already logged this analysis and spent the credit; pull both
    // so the displayed balance matches what was actually charged.
    syncWithAccount();
  }, [syncWithAccount]);

  const freeLeft = Math.max(0, FREE_ANALYSES - used);
  // Where Play Billing cannot run there is no way to buy anything, so gating is off.
  const canAnalyze = !store.available || credits > 0 || freeLeft > 0;

  return (
    <Context.Provider
      value={{ ...store, used, freeLeft, credits, canAnalyze, countAnalysis, refresh: syncWithAccount }}
    >
      {children}
    </Context.Provider>
  );
}

export function useCredits(): CreditsValue {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useCredits must be used within a CreditsProvider");
  return ctx;
}
