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

## Next Tasks
1. Replace placeholder GCash QR with the owner's uploaded QR.
2. Add history item delete + pull-to-refresh.
3. Optional: paywall polish (activation success confetti, receipt reference in email).
