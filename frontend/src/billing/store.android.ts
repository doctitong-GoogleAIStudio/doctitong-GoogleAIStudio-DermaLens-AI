import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Linking } from "react-native";
import * as Application from "expo-application";
import { useIAP, isUserCancelledError, type Purchase } from "expo-iap";

import { serverSubscriptionStatus, type ServerSubscriptionStatus } from "@/src/api";
import { PRODUCT_IDS, SUBSCRIPTION_IDS } from "./products";
import {
  clearEntitlement,
  clearLapsed,
  markLapsed,
  readEntitlement,
  readLapsed,
  writeEntitlement,
} from "./localState";
import type { ActivePlanInfo, PlanKey, PlanOption, StoreBilling, SubscriptionStatus } from "./types";

/**
 * Google Play Billing (no RevenueCat).
 *
 * Play is the source of truth: access is granted only for a PURCHASED
 * subscription, purchases are acknowledged locally with finishTransaction,
 * and Play is re-queried on launch and on every foreground so purchases made
 * while the app was closed (or cancellations) are picked up. The on-device
 * snapshot exists only so an offline launch keeps working.
 *
 * Lifecycle states the Billing Library reports by itself:
 *   active (auto-renewing) · cancelled (still active until the period ends,
 *   autoRenewing=false) · on hold/suspended · pending · expired (no longer
 *   returned; we remember that one existed) · restored (availablePurchases
 *   sweep after a reinstall).
 * Free trial, billing grace period, pause and the exact expiry date are only
 * visible through the Google Play Developer API, so when the backend has a
 * service account configured the purchase token is verified there and the
 * label is refined. That never changes `isSubscribed` — Play does.
 */
const planTitle = (productId: string) =>
  productId === PRODUCT_IDS.monthly ? "Monthly" : productId === PRODUCT_IDS.yearly ? "Yearly" : productId;

export function useStoreBilling(): StoreBilling {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lapsed, setLapsed] = useState(false);
  const [server, setServer] = useState<ServerSubscriptionStatus | null>(null);
  const hydrated = useRef(false);

  const grant = useCallback(async (productId: string) => {
    await writeEntitlement(productId);
    await clearLapsed();
    setLapsed(false);
    setIsSubscribed(true);
  }, []);

  const {
    connected,
    subscriptions,
    fetchProducts,
    requestPurchase,
    finishTransaction,
    hasActiveSubscriptions,
    getActiveSubscriptions,
    activeSubscriptions,
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
      setLapsed(await readLapsed());
      hydrated.current = true;
    })();
  }, []);

  const refresh = useCallback(async () => {
    if (!connected) return;
    try {
      const active = await hasActiveSubscriptions(SUBSCRIPTION_IDS);
      setIsSubscribed(active);
      await getActiveSubscriptions(SUBSCRIPTION_IDS);
      if (!active) {
        // Play stopped reporting a subscription we had granted: it expired,
        // was refunded, or the account is on hold. Remember it for the label.
        if (await readEntitlement()) {
          await markLapsed();
          setLapsed(true);
        }
        await clearEntitlement();
        setServer(null);
      }
    } catch {
      // Offline / Play unavailable — keep the cached state.
    }
  }, [connected, hasActiveSubscriptions, getActiveSubscriptions]);

  useEffect(() => {
    if (!connected) return;
    fetchProducts({ skus: SUBSCRIPTION_IDS, type: "subs" }).catch(() => {});
    getAvailablePurchases().catch(() => {});
    refresh();
  }, [connected, fetchProducts, getAvailablePurchases, refresh]);

  // A subscription bought while the app was closed (or restored after a
  // reinstall) arrives here, not via the purchase callback — and it may still
  // need acknowledging.
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

  const activeSub = useMemo(
    () => activeSubscriptions.find((s) => SUBSCRIPTION_IDS.includes(s.productId) && s.isActive) ?? null,
    [activeSubscriptions],
  );

  // Ask the backend to confirm the purchase with Google's Developer API. It is
  // a no-op unless a service account is configured; the result only refines
  // the label (trial / grace period / expiry), never the entitlement.
  useEffect(() => {
    const token = activeSub?.purchaseTokenAndroid ?? activeSub?.purchaseToken;
    let cancelled = false;
    // Resolve asynchronously in both branches so state is never set mid-render.
    const lookup = activeSub && token ? serverSubscriptionStatus(activeSub.productId, token) : Promise.resolve(null);
    lookup.then((res) => {
      if (!cancelled) setServer(res);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSub]);

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

  const activePlan = useMemo<ActivePlanInfo | null>(() => {
    if (!activeSub) return null;
    const serverMatches = server?.productId === activeSub.productId;
    const expiresAt = serverMatches && server?.expiryTime ? Date.parse(server.expiryTime) : NaN;
    return {
      productId: activeSub.productId,
      title: planTitle(activeSub.productId),
      autoRenewing:
        serverMatches && typeof server?.autoRenewing === "boolean"
          ? server.autoRenewing
          : (activeSub.autoRenewingAndroid ?? true),
      since: activeSub.transactionDate,
      purchaseToken: activeSub.purchaseTokenAndroid ?? activeSub.purchaseToken ?? undefined,
      basePlanId: activeSub.basePlanIdAndroid ?? (serverMatches ? (server?.basePlanId ?? undefined) : undefined),
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
      verified: serverMatches,
    };
  }, [activeSub, server]);

  const status = useMemo<SubscriptionStatus>(() => {
    if (activeSub) {
      if (activePlan?.verified && server?.state) {
        switch (server.state) {
          case "grace_period":
            return "grace_period";
          case "on_hold":
            return "on_hold";
          case "paused":
            return "paused";
          case "cancelled":
            return "cancelled";
          case "active":
            return server.isTrial ? "trial" : "active";
          default:
            break; // fall through to the Billing Library view
        }
      }
      const suspended = availablePurchases.some(
        (p) => p.productId === activeSub.productId && "isSuspendedAndroid" in p && p.isSuspendedAndroid === true,
      );
      if (suspended) return "on_hold";
      if (activeSub.autoRenewingAndroid === false) return "cancelled";
      return "active";
    }
    if (isSubscribed) return "active"; // cached entitlement while Play is unreachable
    if (availablePurchases.some((p) => p.purchaseState === "pending" && SUBSCRIPTION_IDS.includes(p.productId))) {
      return "pending";
    }
    return lapsed ? "expired" : "none";
  }, [activeSub, activePlan, server, availablePurchases, isSubscribed, lapsed]);

  const openManage = useCallback(() => {
    const id = activePlan?.productId ?? PRODUCT_IDS.monthly;
    const pkg = Application.applicationId ?? "";
    // Deep link documented by Google: opens THIS app's subscription in Play,
    // where the user can change, pause or cancel it.
    const url = pkg
      ? `https://play.google.com/store/account/subscriptions?sku=${id}&package=${pkg}`
      : "https://play.google.com/store/account/subscriptions";
    Linking.openURL(url).catch(() => {});
  }, [activePlan]);

  return {
    available: true,
    connected,
    isSubscribed,
    status,
    activePlan,
    plans,
    loadingPlans: connected && plans.length === 0,
    isPurchasing,
    error,
    buy,
    refresh,
    openManage,
    clearError: () => setError(null),
  };
}
