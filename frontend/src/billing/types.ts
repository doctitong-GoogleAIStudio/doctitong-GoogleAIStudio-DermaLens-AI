/** One purchasable credit pack, as Google Play describes it. */
export interface CreditPack {
  /** Play product id, e.g. "credits_10". */
  id: string;
  /** How many analyses it grants. */
  credits: number;
  /** Formatted price straight from Play in the user's own currency, e.g. "₱99.00". */
  price: string;
  title: string;
}

/**
 * Shape shared by the Android (real Google Play) and non-Android (no-op)
 * billing modules. Metro picks store.android.ts on Android and store.ts
 * everywhere else.
 */
export interface StoreBilling {
  /** True only where Google Play Billing can actually run. */
  available: boolean;
  connected: boolean;
  /** Packs offered, with Play's localized prices. Empty until loaded. */
  packs: CreditPack[];
  loadingPacks: boolean;
  isPurchasing: boolean;
  error: string | null;
  /** Starts the Play purchase flow for one pack. */
  buy: (productId: string) => Promise<void>;
  /** Re-queries Play for purchases that were paid for but never credited. */
  restore: () => Promise<void>;
  clearError: () => void;
}
