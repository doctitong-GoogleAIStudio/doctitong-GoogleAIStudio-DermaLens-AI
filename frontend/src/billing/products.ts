/**
 * Google Play subscription product IDs.
 * These MUST match the subscription IDs created in Google Play Console
 * (Monetize -> Products -> Subscriptions), each with an active base plan.
 * Never rename these after shipping.
 */
export const PRODUCT_IDS = {
  monthly: "premium_monthly",
  yearly: "premium_yearly",
} as const;

export const SUBSCRIPTION_IDS: string[] = [PRODUCT_IDS.monthly, PRODUCT_IDS.yearly];

/** Analyses allowed before the paywall kicks in. */
export const FREE_ANALYSES = 1;
