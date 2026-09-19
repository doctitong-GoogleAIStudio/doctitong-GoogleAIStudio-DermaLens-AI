# DermaLens AI

A mobile app for preliminary AI analysis of skin lesions. Photograph or upload a
lesion, get a structured assessment, keep a private history on the device, and
export a PDF report.

> **Not a medical device.** Output is a preliminary, educational assessment and
> is not a diagnosis. Users are told to consult a qualified dermatologist.

**Self-hosted.** The app runs entirely on infrastructure you control — no
Emergent, no vendor platform. See **[docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)**.

---

## Architecture

```
┌──────────────────────┐   HTTPS    ┌─────────────────────┐   HTTPS   ┌────────────────┐
│  Expo / React Native │ ─────────► │  FastAPI backend    │ ────────► │  Gemini API    │
│  (Android, iOS, web) │            │  (your server)      │           │  (Google)      │
└──────────────────────┘            └──────────┬──────────┘           └────────────────┘
   scans, photos, notes                        │
   stay on the device                          ▼
                                      ┌─────────────────┐
                                      │    MongoDB      │
                                      │ accounts, usage │
                                      └─────────────────┘
```

- **Frontend** — Expo (React Native) + expo-router, sage-green clinical theme,
  light and dark. Ships to Android, iOS and the web from one codebase.
- **Backend** — FastAPI + MongoDB (motor), JWT auth (bcrypt + PyJWT).
- **AI** — Google Gemini vision, called **only** from the server. The API key
  never enters the mobile bundle.
- **Privacy** — photos, scan results, notes and history are stored on the
  device. The server keeps accounts, rate-limit counters and subscription state.

## Repository layout

| Path | Contents |
|---|---|
| `backend/` | FastAPI app (`server.py`), public pages, mailer, tests, Dockerfile |
| `frontend/` | Expo app — `app/` routes, `src/` logic, web Dockerfile |
| `deploy/` | Caddyfile, nginx config, systemd unit |
| `docs/` | Self-hosting, release signing, account deletion, rebrand notes |
| `releases/` | Historical release bundles and versionCode patch scripts |
| `memory/` | Product requirements and billing notes |

## Quick start

### Backend

```bash
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env     # set GEMINI_API_KEY, JWT_SECRET, MONGO_URL
uvicorn server:app --reload --port 8000
```

Check it: <http://localhost:8000/api/health> — interactive API docs at
<http://localhost:8000/docs>.

### App

```bash
cd frontend
cp .env.example .env     # EXPO_PUBLIC_BACKEND_URL=http://localhost:8000
yarn install
npx expo start
```

`EXPO_PUBLIC_BACKEND_URL` is compiled into the bundle — changing it requires a
rebuild, not a restart.

### Whole stack with Docker

```bash
cp .env.example .env && cp backend/.env.example backend/.env
docker compose up -d --build
```

## Deploying

[docs/SELF-HOSTING.md](docs/SELF-HOSTING.md) covers Docker Compose, a plain VM
with systemd, managed platforms, HTTPS, email, database migration and backups.

Release signing for the Play Store is in [docs/SIGNING.md](docs/SIGNING.md).
Android `versionCode` must exceed **124**, the highest published so far.

## Testing

```bash
pip install -r backend/requirements-dev.txt
EXPO_PUBLIC_BACKEND_URL=http://localhost:8000 pytest backend/tests
```

These are integration tests that run against a **live** server: they create real
accounts and spend real Gemini quota. Point them at a staging deployment.

## Configuration

Every setting is documented in [`backend/.env.example`](backend/.env.example).
The four that are required: `MONGO_URL`, `DB_NAME`, `JWT_SECRET`,
`GEMINI_API_KEY`.

## License

No license has been declared for this repository. All rights reserved by the
owner unless that changes.
