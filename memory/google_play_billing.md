# Google Play Billing — direct integration (no RevenueCat)

User explicitly refused RevenueCat. Subscriptions run through Google Play Billing
directly from the client with `expo-iap` (v5.6.0). No server: there is no backend
in this app at all.

## Business rules
- 1 free AI analysis per device, then the paywall.
- Plans: Monthly + Yearly, no free trial on the subscription.
- No "Restore purchases" screen (a small "Already subscribed? Refresh" action exists
  on the paywall so a reinstalled subscriber can recover access).

## Product IDs (must match Google Play Console exactly)
- `premium_monthly` — subscription, monthly base plan
- `premium_yearly` — subscription, yearly base plan
Defined in `/app/frontend/src/billing/products.ts`. NEVER rename after shipping.

## Code map
- `src/billing/products.ts` — product IDs + FREE_ANALYSES = 1
- `src/billing/types.ts` — shared `StoreBilling` shape
- `src/billing/localState.ts` — free-analysis counter + cached entitlement snapshot
  (AsyncStorage). Cache only — Google Play is the source of truth.
- `src/billing/store.android.ts` — real billing via `useIAP`: fetchProducts(type "subs"),
  requestPurchase with the Android `offerToken`, `finishTransaction({isConsumable:false})`
  to ACKNOWLEDGE (required within 3 days or Google refunds), `hasActiveSubscriptions`
  on launch + every foreground, and `availablePurchases` sweep for purchases made
  while the app was closed. Only `purchaseState === "purchased"` grants access.
- `src/billing/store.ts` — no-op for web/iOS (`available:false` → gating disabled so
  the web preview stays usable; nothing can be sold there).
- `src/billing/index.tsx` — `SubscriptionProvider` + `useSubscription()`
  (`canAnalyze`, `freeLeft`, `countAnalysis`, plus everything from the store).
- `app/paywall.tsx` — paywall screen (prices come from Play, never hardcoded).
- Gates: `app/capture.tsx` `analyze()` (hard gate + `countAnalysis()` after success),
  `app/(tabs)/index.tsx` FAB + plan banner, `app/assessment.tsx` `go()`.
- `app.json`: `expo-iap` config plugin added (it injects `com.android.vending.BILLING`).

## What the USER must still do in Google Play Console
1. Monetize → Products → Subscriptions → create `premium_monthly` and `premium_yearly`,
   each with an ACTIVE base plan (monthly / yearly) and a price. Activate the products.
2. Upload a signed AAB to at least the internal-testing track (products stay invisible
   to the app until a build is on a track).
3. Settings → License testing → add tester Google accounts.
4. Set up the payments profile for the app.

## Testing limits
Play Billing has no web/Expo Go implementation — the paywall and the 1-free-analysis
gate can ONLY be verified in an Android build installed from a Play testing track with
a license-tester account. On web the app is intentionally ungated.

## Known non-fraud-resistant by design
Client-only verification (no backend), so a modified client could forge local state and
refunds/revocations are only picked up on the next online Play refresh. Moving to
server-side `purchaseToken` verification would require adding a backend.
