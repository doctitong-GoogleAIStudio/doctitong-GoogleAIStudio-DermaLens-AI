import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useIAP, isUserCancelledError, type Purchase } from "expo-iap";

import { redeemCreditPurchase } from "@/src/api";
import { CREDITS_PER_PRODUCT, CREDIT_PRODUCT_LIST } from "./products";
import type { CreditPack, StoreBilling } from "./types";

/**
 * Google Play Billing for consumable credit packs (no RevenueCat).
 *
 * The ordering here is the whole design:
 *
 *   purchase -> VERIFY WITH OUR SERVER -> grant credits -> consume with Play
 *
 * The purchase is never consumed until the backend has verified it with the
 * Google Play Developer API and granted the credits. A consumed token may no
 * longer verify, so consuming first risks taking someone's money without
 * giving them anything. If verification fails the purchase is deliberately
 * left unconsumed: Play keeps returning it in availablePurchases, so the next
 * launch or a manual "restore" retries it.
 *
 * The cost of that choice: Play automatically refunds a consumable that is
 * never acknowledged within three days. That is the correct outcome — if our
 * server cannot credit the purchase for three days, the customer should get
 * their money back rather than hold a token nobody honours.
 *
 * Credits themselves are never stored on the device. The balance is money, so
 * the server owns it and this module only triggers a refresh.
 */

const packTitle = (productId: string) => {
  const n = CREDITS_PER_PRODUCT[productId];
  return n ? `${n} analyses` : productId;
};

export function useStoreBilling(onCreditsGranted?: () => void): StoreBilling {
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [loadingPacks, setLoadingPacks] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetched = useRef(false);
  // Tokens already sent to the server this session, so a re-delivered purchase
  // event does not fire a second redeem while the first is still in flight.
  const inFlight = useRef<Set<string>>(new Set());

  // Held in a ref so redeemThenConsume does not need to be rebuilt (and the
  // purchase listener re-registered) every time the callback identity changes.
  const grantedCb = useRef(onCreditsGranted);
  useEffect(() => {
    grantedCb.current = onCreditsGranted;
  }, [onCreditsGranted]);

  const tokenOf = (purchase: Purchase): string | null =>
    (purchase as any).purchaseTokenAndroid ?? (purchase as any).purchaseToken ?? null;

  const redeemThenConsume = useCallback(
    async (purchase: Purchase, finish: (args: { purchase: Purchase; isConsumable?: boolean }) => Promise<void>) => {
      if (purchase.purchaseState !== "purchased") return; // pending (e.g. cash) grants nothing
      if (!CREDIT_PRODUCT_LIST.includes(purchase.productId)) return;

      const token = tokenOf(purchase);
      if (!token) {
        setError("Google Play did not return a purchase token. Try Restore purchases.");
        return;
      }
      if (inFlight.current.has(token)) return;
      inFlight.current.add(token);

      try {
        const result = await redeemCreditPurchase(purchase.productId, token);
        if (!result) {
          // Leave it unconsumed on purpose — it will be retried.
          setError("Your purchase could not be confirmed yet. It will be applied automatically.");
          return;
        }
        grantedCb.current?.();
        // Safe now: the credits are on the account, so losing the token costs nothing.
        await finish({ purchase, isConsumable: true });
      } catch (e: any) {
        setError(e?.message ?? "Your purchase could not be confirmed yet.");
      } finally {
        inFlight.current.delete(token);
      }
    },
    [],
  );

  const { connected, products, fetchProducts, requestPurchase, finishTransaction, getAvailablePurchases, availablePurchases } =
    useIAP({
      onPurchaseSuccess: async (purchase: Purchase) => {
        setIsPurchasing(false);
        await redeemThenConsume(purchase, finishTransaction);
      },
      onPurchaseError: (e) => {
        setIsPurchasing(false);
        if (isUserCancelledError(e)) return;
        setError(e?.message ?? "The purchase could not be completed.");
      },
      onError: (e) => setError(e?.message ?? null),
    });

  // Load the packs and their localized Play prices once connected.
  useEffect(() => {
    if (!connected || fetched.current) return;
    fetched.current = true;
    (async () => {
      try {
        await fetchProducts({ skus: CREDIT_PRODUCT_LIST, type: "in-app" });
      } catch (e: any) {
        setError(e?.message ?? "Could not load the credit packs.");
      } finally {
        setLoadingPacks(false);
      }
    })();
  }, [connected, fetchProducts]);

  // Sweep for purchases that were paid for but never credited — a crash
  // between paying and verifying, or a server that was briefly unreachable.
  const sweep = useCallback(async () => {
    if (!connected) return;
    try {
      await getAvailablePurchases();
    } catch {
      // Not fatal: the next foreground tries again.
    }
  }, [connected, getAvailablePurchases]);

  useEffect(() => {
    sweep();
  }, [sweep]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") sweep();
    });
    return () => sub.remove();
  }, [sweep]);

  // Anything Play still lists as owned has not been consumed, so it was never
  // credited. Redeem it.
  useEffect(() => {
    if (!availablePurchases?.length) return;
    (async () => {
      for (const p of availablePurchases) {
        await redeemThenConsume(p, finishTransaction);
      }
    })();
  }, [availablePurchases, finishTransaction, redeemThenConsume]);

  const packs: CreditPack[] = CREDIT_PRODUCT_LIST.map((id) => {
    const p = products.find((x) => x.id === id);
    return {
      id,
      credits: CREDITS_PER_PRODUCT[id] ?? 0,
      price: p?.displayPrice ?? "",
      title: p?.title || packTitle(id),
    };
  }).filter((p) => p.credits > 0);

  const buy = useCallback(
    async (productId: string) => {
      if (!CREDIT_PRODUCT_LIST.includes(productId)) return;
      setError(null);
      setIsPurchasing(true);
      try {
        await requestPurchase({ type: "in-app", request: { google: { skus: [productId] } } });
      } catch (e: any) {
        setIsPurchasing(false);
        if (!isUserCancelledError(e)) setError(e?.message ?? "The purchase could not be started.");
      }
    },
    [requestPurchase],
  );

  return {
    available: true,
    connected,
    packs,
    loadingPacks: loadingPacks && packs.every((p) => !p.price),
    isPurchasing,
    error,
    buy,
    restore: sweep,
    clearError: () => setError(null),
  };
}
