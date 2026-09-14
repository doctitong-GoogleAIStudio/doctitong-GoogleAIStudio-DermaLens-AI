# AI Dermatologist — Product Requirements (PRD)

## Original Problem Statement
Clone the "AI Dermatologist" web app (github.com/doctitong-GoogleAIStudio/...-ai-dermatologist)
as a native mobile app. Users photograph/upload skin lesions and get a preliminary AI analysis.
Added requirements: email/password signup+login (full name, email, password); a fully-functional
7-day free trial with a live countdown (to the minute); after expiry a device-locked "Activate this
Device" screen using a hardware-coded Device ID; email the Device ID to a hidden admin
(docvincent2022@yahoo.com); a complete offline activation generator as a downloadable HTML file;
GCash QR for payment (owner to upload).

## Architecture
- Frontend: Expo (React Native) + expo-router. Sage-green clinical theme, light + dark.
- Backend: FastAPI + MongoDB (motor). JWT auth (passlib/bcrypt + pyjwt).
- AI: Gemini 3.1 Pro (gemini-3.1-pro-preview) via Emergent LLM key + emergentintegrations.
- Email: Emergent-managed Resend (activation requests to hidden admin).
- History: on-device only (@/src/utils/storage), images persisted to app documents dir.
- Offline activation: HMAC-SHA256(ACTIVATION_SECRET, DeviceID) — identical in app (js-sha256),
  backend (python hmac), and the downloadable HTML generator (GET /api/activation-tool).

## User Personas
- Patient / general user: quick preliminary check on a skin lesion, keeps a personal history.
- App owner/admin (Dr. Cavalida): receives Device IDs, collects GCash payment, issues activation keys.

## Core Requirements (static)
1. Email/password accounts (full name, email, password).
2. 7-day trial with per-second/minute live countdown; starts at first app open (device-scoped).
3. Device-locked activation after trial; activatable anytime; offline key validation.
4. Photo capture (camera) + gallery upload; AI structured analysis.
5. On-device analysis history; view past results.
6. Shareable/downloadable PDF report.
7. About screen with disclaimer + Device ID; clinical light/dark UI.

## Implemented (2026-06-06)
- Auth: /api/auth/signup, /login, /me (JWT). Duplicate/validation handling. [DONE]
- AI analysis: /api/analyze (Gemini 3.1 Pro vision, strict JSON). [DONE]
- Trial + live countdown banner (D/H/M/S) on Home. [DONE]
- Device ID (hardware-derived via expo-application, hashed + formatted). [DONE]
- Activation screen: Device ID copy, GCash QR, "Send Device ID" (emails hidden admin),
  activation-key entry, offline local validation, "Device Activated" state. [DONE]
- Offline activation generator HTML: GET /api/activation-tool (embeds js-sha256 + secret). [DONE]
- Capture screen: expo-camera viewfinder + frame overlay + gallery upload + permission flow. [DONE]
- Result screen: image quality, most-likely diagnosis + urgency, differentials, next steps,
  disclaimer; Share/Download PDF (expo-print + expo-sharing). [DONE]
- History (on-device) list + empty state; About screen. [DONE]
- Verified: 15/15 backend tests + all frontend flows incl. full activation loop. [DONE]

## Backlog (prioritized)
- P1: Owner uploads real GCash QR image (currently a placeholder QR); wire a config value/asset.
- P1: Delete / clear individual history items from the UI (hooks exist: useDeleteHistory/useClearHistory).
- P2: Rate limiting on auth endpoints; account email verification.
- P2: Manual light/dark theme toggle (currently follows system).
- P2: Multi-image comparison view in results.

## Standalone offline rewrite (current state, 2026-06)
- App is 100% offline/standalone: no backend calls. `/app/backend` is obsolete/unused.
- Local accounts only: PBKDF2-HMAC-SHA256 in expo-secure-store (fallback AsyncStorage), `src/localAuth.ts`.
- Gemini 3.1 Pro called directly from the client (`src/gemini.ts`, EXPO_PUBLIC_GEMINI_API_KEY).
- Trial + activation removed entirely. Version 1.0.9, credit "aivicventures".
- Two modes: Quick Analysis (1 photo) and Enhanced Analysis (multi-view + clinical history).
- Stay Signed In: session persists in AsyncStorage; sign-out requires confirmation (native Alert,
  window.confirm on web). [DONE 2026-06]
- Android build health pass: expo ~57.0.21, expo-router ~57.0.20, added @expo/log-box;
  removed unused deps (react-native-qrcode-svg, react-native-dotenv, js-sha256, date-fns, dayjs,
  expo-clipboard, expo-blur, expo-mail-composer + its app.json plugin). expo-doctor 20/20.
  Android JS bundle exports successfully. [DONE 2026-06]

- Google Play Billing subscriptions (direct, `expo-iap` 5.6.0 — RevenueCat explicitly refused by
  user): 1 free analysis per device, then paywall with Monthly + Yearly plans
  (`premium_monthly` / `premium_yearly`), no trial. Play is the source of truth; purchases are
  acknowledged client-side; gating is disabled on web/iOS where Play cannot run.
  Details + remaining Play Console steps: `/app/memory/google_play_billing.md`. [DONE 2026-06]

- SECURITY (2026-06): Gemini moved behind the backend. The key used to ship in the mobile
  bundle (`EXPO_PUBLIC_GEMINI_API_KEY` + direct `generativelanguage.googleapis.com` calls).
  Now: `POST /api/analyze` calls Gemini with httpx using `GEMINI_API_KEY`/`GEMINI_MODEL` from
  `backend/.env`; auth = JWT Bearer (or `X-Activation-Key` against `activated_devices`);
  1–4 images, ≤8 MB each, mimes jpeg/png/webp/heic/heif; Google's raw errors never forwarded;
  every call logged to `analysis_logs`. Frontend `src/gemini.ts` deleted → `src/analysis.ts`
  posts to the backend; local accounts are mirrored to `/api/auth/*` (see `src/api.ts`
  `syncServerSession`) so the app holds a JWT while keeping offline sign-in.
  Play review items: `blockedPermissions` RECORD_AUDIO + SYSTEM_ALERT_WINDOW,
  `recordAudioAndroid: false`, version 1.1.1 / versionCode 121. Verified: backend 14/14 pytest
  + frontend E2E, android bundle contains no "AIza" and no "generativelanguage". [DONE]

## Next Tasks
1. Replace placeholder GCash QR with the owner's uploaded QR.
2. Add history item delete + pull-to-refresh.
3. Optional: paywall polish (activation success confetti, receipt reference in email).
