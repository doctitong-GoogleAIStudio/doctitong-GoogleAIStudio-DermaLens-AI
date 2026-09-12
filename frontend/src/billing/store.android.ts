import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useIAP, isUserCancelledError, type Purchase } from "expo-iap";

import { PRODUCT_IDS, SUBSCRIPTION_IDS } from "./products";
import { clearEntitlement, readEntitlement, writeEntitlement } from "./localState";
import type { PlanKey, PlanOption, StoreBilling } from "./types";

/**
 * Google Play Billing (no RevenueCat, no server).
 *
 * Play is the source of truth: access is granted only for a PURCHASED
 * subscription, purchases are acknowledged locally with finishTransaction,
 * and Play is re-queried on launch and on every foreground so purchases made
 * while the app was closed (or cancellations) are picked up. The on-device
 * snapshot exists only so an offline launch keeps working.
 */
export function useStoreBilling(): StoreBilling {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydrated = useRef(false);

  const grant = useCallback(async (productId: string) => {
    await writeEntitlement(productId);
    setIsSubscribed(true);
  }, []);

  const {
    connected,
    subscriptions,
    fetchProducts,
    requestPurchase,
    finishTransaction,
    hasActiveSubscriptions,
    getAvailablePurchases,
    availablePurchases,
  } = useIAP({
    onPurchaseSuccess: async (purchase: Purchase) => {
      setIsPurchasing(false);
      // Pending purchases (e.g. cash payment) must never unlock anything.
      if (purchase.purchaseState !== "purchased") return;
      if (!SUBSCRIPTION_IDS.includes(purchase.productId)) return;
      // Record the entitlement BEFORE acknowledging, so an acknowledged
      // purchase can never end up ungranted.
      await grant(purchase.productId);
      try {
        // isConsumable: false -> acknowledge (subscriptions are not consumed).
        await finishTransaction({ purchase, isConsumable: false });
      } catch (e: any) {
        setError(e?.message ?? "Could not confirm the purchase with Google Play.");
      }
    },
    onPurchaseError: (e) => {
      setIsPurchasing(false);
      if (isUserCancelledError(e)) return;
      setError(e?.message ?? "The purchase could not be completed.");
    },
    onError: (e) => setError(e?.message ?? null),
  });

  // Offline-safe start: trust the last known state until Play answers.
  useEffect(() => {
    (async () => {
      const snapshot = await readEntitlement();
      if (snapshot && !hydrated.current) setIsSubscribed(true);
      hydrated.current = true;
    })();
  }, []);

  const refresh = useCallback(async () => {
    if (!connected) return;
    try {
      const active = await hasActiveSubscriptions(SUBSCRIPTION_IDS);
      setIsSubscribed(active);
      if (!active) await clearEntitlement();
    } catch {
      // Offline / Play unavailable — keep the cached state.
    }
  }, [connected, hasActiveSubscriptions]);

  useEffect(() => {
    if (!connected) return;
    fetchProducts({ skus: SUBSCRIPTION_IDS, type: "subs" }).catch(() => {});
    getAvailablePurchases().catch(() => {});
    refresh();
  }, [connected, fetchProducts, getAvailablePurchases, refresh]);

  // A subscription bought while the app was closed arrives here, not via the
  // purchase callback — and it may still need acknowledging.
  useEffect(() => {
    const pending = availablePurchases.find(
      (p) => p.purchaseState === "purchased" && SUBSCRIPTION_IDS.includes(p.productId),
    );
    if (!pending) return;
    (async () => {
      await grant(pending.productId);
      if ("isAcknowledgedAndroid" in pending && pending.isAcknowledgedAndroid) return;
      try {
        await finishTransaction({ purchase: pending, isConsumable: false });
      } catch {}
    })();
  }, [availablePurchases, finishTransaction, grant]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const plans = useMemo<PlanOption[]>(() => {
    const build = (plan: PlanKey, id: string, period: string): PlanOption | null => {
      const product = subscriptions.find((p) => p.id === id);
      if (!product) return null;
      const offer = "subscriptionOffers" in product ? product.subscriptionOffers?.[0] : undefined;
      return {
        id,
        plan,
        title: plan === "monthly" ? "Monthly" : "Yearly",
        price: offer?.displayPrice || product.displayPrice || "",
        period,
      };
    };
    return [
      build("monthly", PRODUCT_IDS.monthly, "per month"),
      build("yearly", PRODUCT_IDS.yearly, "per year"),
    ].filter((p): p is PlanOption => p !== null);
  }, [subscriptions]);

  const buy = useCallback(
    async (plan: PlanKey) => {
      const id = plan === "monthly" ? PRODUCT_IDS.monthly : PRODUCT_IDS.yearly;
      const product = subscriptions.find((p) => p.id === id);
      if (!product) {
        setError("That plan is not available from Google Play right now.");
        return;
      }
      const offerToken =
        "subscriptionOffers" in product ? product.subscriptionOffers?.[0]?.offerTokenAndroid : undefined;
      if (!offerToken) {
        setError("Google Play returned no active offer for this plan.");
        return;
      }
      setError(null);
      setIsPurchasing(true);
      try {
        await requestPurchase({
          type: "subs",
          request: { google: { skus: [id], subscriptionOffers: [{ sku: id, offerToken }] } },
        });
      } catch (e: any) {
        setIsPurchasing(false);
        if (!isUserCancelledError(e)) setError(e?.message ?? "The purchase could not be started.");
      }
    },
    [requestPurchase, subscriptions],
  );

  return {
    available: true,
    connected,
    isSubscribed,
    plans,
    loadingPlans: connected && plans.length === 0,
    isPurchasing,
    error,
    buy,
    refresh,
    clearError: () => setError(null),
  };
}
