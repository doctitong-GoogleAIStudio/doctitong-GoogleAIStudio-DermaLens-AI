export type PlanKey = "monthly" | "yearly";

export interface PlanOption {
  /** Play subscription product id */
  id: string;
  plan: PlanKey;
  title: string;
  /** Formatted price straight from Google Play, e.g. "$4.99" */
  price: string;
  period: string;
}

/** Shape shared by the Android (real) and non-Android (no-op) billing modules. */
export interface StoreBilling {
  /** True only where Google Play Billing can actually run. */
  available: boolean;
  connected: boolean;
  isSubscribed: boolean;
  plans: PlanOption[];
  loadingPlans: boolean;
  isPurchasing: boolean;
  error: string | null;
  buy: (plan: PlanKey) => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
}
