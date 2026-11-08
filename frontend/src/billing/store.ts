import type { StoreBilling } from "./types";

/**
 * Non-Android fallback (web preview, iOS). Google Play Billing does not exist
 * here, so there is nothing to sell and nothing to gate — `available: false`
 * makes the app skip the buy screen instead of dead-ending the user.
 * Metro picks store.android.ts on Android.
 */
export function useStoreBilling(_onCreditsGranted?: () => void): StoreBilling {
  return {
    available: false,
    connected: false,
    packs: [],
    loadingPacks: false,
    isPurchasing: false,
    error: null,
    buy: async () => {},
    restore: async () => {},
    clearError: () => {},
  };
}
