/**
 * Google Play consumable product IDs for analysis credits.
 *
 * These MUST match the products created in Play Console under
 * Monetize -> Products -> In-app products, each created as a MANAGED product
 * (Play's consumables) and activated. They must also match CREDIT_PRODUCTS in
 * backend/.env, which is what actually grants the credits — if the two disagree
 * the customer is either shortchanged or given credits for free.
 *
 * Never rename these after shipping: Play identifies a product by its id.
 */
export const CREDIT_PRODUCT_IDS = {
  pack10: "credits_10",
  pack30: "credits_30",
  pack100: "credits_100",
} as const;

/** How many analyses each pack grants. Must equal the backend's mapping. */
export const CREDITS_PER_PRODUCT: Record<string, number> = {
  [CREDIT_PRODUCT_IDS.pack10]: 10,
  [CREDIT_PRODUCT_IDS.pack30]: 30,
  [CREDIT_PRODUCT_IDS.pack100]: 100,
};

/** Order the packs appear on the buy screen. */
export const CREDIT_PRODUCT_LIST: string[] = [
  CREDIT_PRODUCT_IDS.pack10,
  CREDIT_PRODUCT_IDS.pack30,
  CREDIT_PRODUCT_IDS.pack100,
];

/** Analyses allowed before anything must be bought. Must match FREE_ANALYSES in backend/.env. */
export const FREE_ANALYSES = 1;
