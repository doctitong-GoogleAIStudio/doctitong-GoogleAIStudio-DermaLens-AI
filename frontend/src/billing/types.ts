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

/**
 * Lifecycle of a Google Play subscription as far as the app can tell.
 *
 * From the on-device Billing Library alone:  none | active | cancelled | pending | on_hold | expired
 * Additionally, when the backend verifies the purchase token with the Google
 * Play Developer API:                        trial | grace_period | paused (+ exact expiry)
 *
 * Google Play remains the source of truth — this is a label, never a gate.
 */
export type SubscriptionStatus =
  | "none"
  | "active"
  | "trial"
  | "cancelled"
  | "grace_period"
  | "on_hold"
  | "paused"
  | "pending"
  | "expired";

export interface ActivePlanInfo {
  productId: string;
  /** "Monthly" | "Yearly" | the raw product id if unknown */
  title: string;
  autoRenewing: boolean;
  /** When the subscription was first purchased (ms). */
  since?: number;
  /** Play's own token for this purchase — lets the backend look it up. */
  purchaseToken?: string;
  /** Base plan id from Play (e.g. "monthly"), when known. */
  basePlanId?: string;
  /** Current period end (ms). Only known after server-side verification. */
  expiresAt?: number;
  /** True when the backend confirmed the status with the Google Play Developer API. */
  verified: boolean;
}

/** Shape shared by the Android (real) and non-Android (no-op) billing modules. */
export interface StoreBilling {
  /** True only where Google Play Billing can actually run. */
  available: boolean;
  connected: boolean;
  isSubscribed: boolean;
  /** Human-meaningful lifecycle state; `isSubscribed` is what actually gates access. */
  status: SubscriptionStatus;
  activePlan: ActivePlanInfo | null;
  plans: PlanOption[];
  loadingPlans: boolean;
  isPurchasing: boolean;
  error: string | null;
  buy: (plan: PlanKey) => Promise<void>;
  refresh: () => Promise<void>;
  /** Opens the Google Play subscription settings for this app. */
  openManage: () => void;
  clearError: () => void;
}
