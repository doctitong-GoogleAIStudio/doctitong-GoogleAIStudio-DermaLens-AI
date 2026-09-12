import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

import { useStoreBilling } from "./store";
import { FREE_ANALYSES } from "./products";
import { readUsedAnalyses, recordAnalysisUsed } from "./localState";
import type { StoreBilling } from "./types";

export { FREE_ANALYSES, PRODUCT_IDS } from "./products";
export type { PlanKey, PlanOption } from "./types";

interface SubscriptionValue extends StoreBilling {
  /** Analyses already run on this device. */
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
  const [used, setUsed] = useState(0);

  useEffect(() => {
    readUsedAnalyses().then(setUsed);
  }, []);

  const countAnalysis = useCallback(async () => {
    setUsed(await recordAnalysisUsed());
  }, []);

  const freeLeft = Math.max(0, FREE_ANALYSES - used);
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
