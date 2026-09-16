# DermaLens AI — Account & Subscription management (v1.1.3)

Developer / publisher: **aivicventures**. Package stays `com.emergent.aidermatologistapp.r2pygs`.

## In the app

`About` tab → **Your account → Account & Subscription** (`frontend/app/account.tsx`):

| Section | What it does |
|---|---|
| Manage Subscription | Shows the plan and a plain-language status (Active / Free trial / Cancelled — active until … / Payment problem (grace period) / On hold / Paused / Pending / Expired / Free). **Manage Google Play Subscription** deep-links to `https://play.google.com/store/account/subscriptions?sku=<productId>&package=<applicationId>`. Refresh re-queries Play. |
| Cancel Subscription | Explains that Google Play manages the subscription and that cancelling stops renewal without removing access until the period ends. **Manage / Cancel Subscription on Google Play** opens the same Play page. |
| Delete Account | Warning → password (re-authentication) → acknowledgement checkbox → if a subscription may still bill, a blocking warning with *Manage subscription / Delete anyway* → final confirmation dialog with the exact wording from the requirements → deletion. |

### Subscription status — where each state comes from

Google Play is the source of truth. `frontend/src/billing/store.android.ts` derives `status`:

| State | Source |
|---|---|
| active, cancelled-but-active (`autoRenewingAndroid=false`), on hold (`isSuspendedAndroid`), pending, restored (`availablePurchases` sweep after reinstall), expired (Play stops returning a purchase we had granted → `billing_lapsed` marker) | Play Billing Library on the device (`expo-iap`) |
| free trial, billing grace period, paused, exact expiry date, verified auto-renew flag | **Optional** backend check `POST /api/billing/subscription` → Google Play Developer API `purchases.subscriptionsv2.get`. Only refines the label; never changes the entitlement. |

The Billing Library already enforces the entitlement correctly for every state (Play keeps returning the purchase during a grace period and stops returning it during account hold / after expiry), so gating is right even without the server check.

### Deletion flow (`frontend/src/auth.tsx` → `deleteAccount`)

1. `POST /api/account/delete` with the JWT + password (falls back to `POST /api/account-deletion` with email + password when the token is missing/stale). Nothing on the phone is touched if the server refuses.
2. Server (`backend/server.py` → `_delete_user_account`): deletes `users`, `activation_requests`, `subscriptions`; de-identifies `analysis_logs` (user_id → null, `deleted_user: true`) and `activated_devices` (name/email removed); writes `account_deletions {email_hash, deleted_at, source}` (TTL 730 days, `DELETION_RECORD_RETENTION_DAYS`). Photos and analysis results are never stored server-side.
3. Phone: history cleared, `documentDirectory/scans/` deleted, cached PDF reports deleted, JWT removed from secure storage, react-query cache cleared, local account record + session removed → user is signed out → confirmation dialog.
4. A legacy local-only account (404 from the server) still requires the correct password before the phone is wiped.

## Public pages (served by the backend)

| URL | Purpose |
|---|---|
| `https://<backend>/api/account-deletion` | **Google Play Console → App content → Data safety → Account deletion URL.** Email + password → immediate deletion (`POST /api/account-deletion`, throttled to 8 failed attempts / 15 min per address). "Can't sign in?" → `POST /api/account-deletion/request` (always 202, stored in `account_deletion_requests`, admin emailed) — process within 30 days. |
| `https://<backend>/api/privacy-policy` | **Privacy policy URL.** Rendered from `backend/static/privacy-policy.md` (single source — edit that file). |
| `docs/account-deletion.html` | Same page as a standalone file for static hosting; replace `https://YOUR-BACKEND-URL` first. |

## Backend environment variables (new, all optional)

```
SUPPORT_EMAIL=support@yourdomain          # printed on both public pages
PUBLIC_BASE_URL=https://api.yourdomain    # only for the deletion URL shown in the policy text
ANDROID_PACKAGE_NAME=com.emergent.aidermatologistapp.r2pygs
PLAY_SERVICE_ACCOUNT_JSON=<inline JSON or path>   # enables /api/billing/subscription verification
PLAY_TRIAL_OFFER_IDS=freetrial-7d          # optional: which Play offer ids are free trials
DELETION_RECORD_RETENTION_DAYS=730
```

`EMERGENT_EMAIL_KEY` + `ADMIN_EMAIL` (already used for activation requests) also deliver deletion-request notifications.

## Google Play Console — manual steps

1. **App content → Data safety → Account deletion**: set the URL above, tick "users can request account deletion", and update the data-collection answers (name, email, photos *transmitted but not stored*, purchase history).
2. **App content → Privacy policy**: set `https://<backend>/api/privacy-policy` (or wherever you host the same text). Store listing → set the same policy URL.
3. **Monetize → Subscriptions**: keep `premium_monthly` / `premium_yearly`; if you want the 7-day free trial, add a *free-trial offer* to each base plan and put its offer id in `PLAY_TRIAL_OFFER_IDS`. Enable grace period / account hold under *Monetization setup* if desired.
4. For server-side verification: Google Cloud → create a service account → Play Console → Users and permissions → invite it with *View financial data* + *Manage orders and subscriptions* → paste its JSON key into `PLAY_SERVICE_ACCOUNT_JSON`.
5. Upload the v1.1.3 AAB (versionCode 123), signed with `ai-dermatologist-release.keystore`.
