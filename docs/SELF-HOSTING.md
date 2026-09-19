# Self-hosting DermaLens AI

This app no longer depends on Emergent. Everything it needs — FastAPI, MongoDB,
Gemini, email, Google Play verification — runs on infrastructure you control.

- [What changed](#what-changed)
- [What you need before you start](#what-you-need-before-you-start)
- [Option A — Docker Compose (recommended)](#option-a--docker-compose-recommended)
- [Option B — A plain VM with systemd](#option-b--a-plain-vm-with-systemd)
- [Option C — A managed platform](#option-c--a-managed-platform)
- [Pointing the mobile app at your backend](#pointing-the-mobile-app-at-your-backend)
- [Migrating data off Emergent](#migrating-data-off-emergent)
- [Email](#email)
- [Backups](#backups)
- [Verifying the deployment](#verifying-the-deployment)
- [Environment variables](#environment-variables)

---

## What changed

| Emergent dependency | Replacement |
|---|---|
| `.emergent/` pod scaffolding (webhook cron daemon polling `ea.int.apis.emergentagent.com`) | Deleted. No cron jobs were defined — only the platform's own reconcile watcher. |
| `emergentintegrations==0.2.0` and a `litellm` wheel served from `customer-assets.emergentagent.com` | Removed from `requirements.txt`. Neither was ever imported — that URL only resolves inside Emergent's build network, so `pip install -r requirements.txt` used to fail anywhere else. |
| Email via `https://integrations.emergentagent.com` with `EMERGENT_EMAIL_KEY` | `backend/mailer.py` — SMTP (any provider) or the Resend API, or disabled entirely. |
| `*.preview.emergentagent.com` hardcoded as the test fallback URL | `http://localhost:8000`. |
| Emergent build pods | `backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml`, `deploy/`. |

**Gemini was never proxied through Emergent.** `server.py` calls
`generativelanguage.googleapis.com` directly with your own `GEMINI_API_KEY`, so
AI analysis needed no migration.

### One thing that intentionally did *not* change

The Android package name stays **`com.emergent.aidermatologistapp.r2pygs`**.

Google Play identifies a published app by its package name permanently. Changing
it creates a *different* app — new listing, no existing installs, no reviews, no
subscribers. The string contains "emergent" for historical reasons only; it has
no runtime connection to the platform. Leave it alone.

---

## What you need before you start

- A server with a public IP — 1 vCPU / 2 GB RAM handles this app comfortably.
- A domain with an A record for the API, e.g. `api.your-domain.com`.
- A **Gemini API key** from <https://aistudio.google.com/apikey>.
- Docker + the Compose plugin (Option A), or Python 3.11 and MongoDB 6/7
  (Option B).

Optional: an SMTP account or Resend key for admin notifications, and a Google
Play service account if you sell subscriptions.

---

## Option A — Docker Compose (recommended)

Brings up MongoDB, the API, optionally the web build, and Caddy for automatic
Let's Encrypt certificates.

```bash
git clone https://github.com/doctitong-GoogleAIStudio/doctitong-GoogleAIStudio-DermaLens-AI.git
cd doctitong-GoogleAIStudio-DermaLens-AI

cp .env.example .env                    # stack settings (DB password, domains)
cp backend/.env.example backend/.env    # app settings (Gemini key, JWT secret)
```

Fill in the two files. At minimum:

```bash
# .env
MONGO_ROOT_PASSWORD=$(openssl rand -hex 24)
API_DOMAIN=api.your-domain.com
TLS_EMAIL=you@your-domain.com

# backend/.env
JWT_SECRET=$(openssl rand -hex 32)
GEMINI_API_KEY=...
DB_NAME=dermalens
PUBLIC_BASE_URL=https://api.your-domain.com
```

> `MONGO_ROOT_PASSWORD` is applied when the database volume is first created.
> Set it **before** the first `up` — changing it later has no effect on an
> existing volume.

Start it:

```bash
docker compose up -d --build                      # mongo + backend
docker compose --profile proxy up -d              # + HTTPS on your domain
docker compose --profile web --profile proxy up -d  # + the web version of the app
```

The backend is deliberately published on `127.0.0.1:8000` only — Caddy is what
faces the internet. If you run without the proxy profile, change that port
mapping in `docker-compose.yml` or nothing will reach it from outside.

Check it:

```bash
curl -s https://api.your-domain.com/api/health | jq
docker compose logs -f backend
```

Upgrading later:

```bash
git pull
docker compose up -d --build
```

---

## Option B — A plain VM with systemd

For a host that already runs nginx and MongoDB.

```bash
sudo useradd --system --create-home --home-dir /opt/dermalens dermalens
sudo -u dermalens git clone <repo-url> /opt/dermalens
cd /opt/dermalens

sudo -u dermalens python3.11 -m venv .venv
sudo -u dermalens .venv/bin/pip install -r backend/requirements.txt

sudo -u dermalens cp backend/.env.example backend/.env
sudo -u dermalens $EDITOR backend/.env
sudo chmod 600 backend/.env
```

Install MongoDB from <https://www.mongodb.com/docs/manual/administration/install-on-linux/>,
then point `MONGO_URL` at it (`mongodb://localhost:27017`, or a
`mongodb+srv://` Atlas URI — `dnspython` is installed for that).

```bash
sudo cp deploy/dermalens-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dermalens-backend
sudo systemctl status dermalens-backend

sudo cp deploy/nginx-api.conf /etc/nginx/sites-available/dermalens
sudo ln -s /etc/nginx/sites-available/dermalens /etc/nginx/sites-enabled/
sudo certbot --nginx -d api.your-domain.com
sudo nginx -t && sudo systemctl reload nginx
```

The unit file is hardened (`ProtectSystem=strict`, `NoNewPrivileges`) and
assumes the layout above; adjust the paths if you deploy elsewhere.

---

## Option C — A managed platform

The backend is an ordinary FastAPI app, so Fly.io, Render, Railway, Google Cloud
Run and friends all work. Two things to get right:

1. **Start command** — the container must bind the platform's port:
   ```
   uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'
   ```
   (`backend/Dockerfile` hardcodes 8000; override the command or the port.)
2. **Database** — these platforms have ephemeral disks. Use MongoDB Atlas and
   set `MONGO_URL` to the `mongodb+srv://` string. Allow-list the platform's
   egress IPs in Atlas.

Set `/api/health` as the health check path.

---

## Pointing the mobile app at your backend

`EXPO_PUBLIC_BACKEND_URL` is **compiled into the bundle** — it is not read at
runtime. A new backend URL means a new build.

```bash
cd frontend
cp .env.example .env
# EXPO_PUBLIC_BACKEND_URL=https://api.your-domain.com
```

Development:

```bash
yarn install
npx expo start
```

Web export (what `frontend/Dockerfile` does):

```bash
EXPO_PUBLIC_BACKEND_URL=https://api.your-domain.com npx expo export --platform web --output-dir dist
```

Android release build with EAS — Emergent's build service is not involved:

```bash
npm install -g eas-cli
eas login
eas build:configure                      # creates eas.json on first run
eas build --platform android --profile production
```

Put `EXPO_PUBLIC_BACKEND_URL` in the profile's `env` block in `eas.json` so the
cloud builder sees it.

Signing keys are covered in [SIGNING.md](SIGNING.md) — releases must be signed
with **your** upload key, not the per-build key Emergent used. `versionCode`
must exceed the highest already on Play (currently **124**).

---

## Migrating data off Emergent

If accounts already exist on the Emergent-hosted database, move them before
switching the app over. Get the old connection string from that environment's
`backend/.env`.

```bash
# Dump from the old database
mongodump --uri="<OLD_MONGO_URL>" --db=<OLD_DB_NAME> --out=./dump

# Restore into the new one
mongorestore --uri="mongodb://dermalens:<password>@localhost:27017/?authSource=admin" \
             --nsFrom='<OLD_DB_NAME>.*' --nsTo='dermalens.*' ./dump
```

Into the compose stack:

```bash
docker compose cp ./dump mongo:/tmp/dump
docker compose exec mongo mongorestore \
  --username dermalens --password "<password>" --authenticationDatabase admin \
  --nsFrom='<OLD_DB_NAME>.*' --nsTo='dermalens.*' /tmp/dump
```

Collections carried over: `users`, `analysis_logs`, `activated_devices`,
`activation_requests`, `subscriptions`, `account_deletions`. Indexes are
recreated on startup, so a restore without them is fine.

Two values must be copied across verbatim or you will break existing users:

- **`JWT_SECRET`** — a new one signs out every logged-in device.
- **`ACTIVATION_SECRET`** — a new one invalidates every activation key already
  issued. It also has to match the secret baked into
  `AiDerma-Activation-Generator.html` and the shipped app.

Scan history, photos and notes live **on each device**, never on the server —
nothing to migrate, and nothing lost by switching hosts.

---

## Email

Only admin notifications are sent: device-activation requests and
account-deletion notices. Configure one provider in `backend/.env`.

**SMTP** — any mail provider, or your own server:

```bash
EMAIL_PROVIDER=smtp
EMAIL_FROM=noreply@your-domain.com
ADMIN_EMAIL=you@your-domain.com
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_SECURITY=starttls        # or ssl for port 465
```

**Resend** — HTTPS API, no SMTP port needed (useful where outbound 587 is
blocked, which is common on cloud VMs):

```bash
EMAIL_PROVIDER=resend
EMAIL_FROM=noreply@your-domain.com
ADMIN_EMAIL=you@your-domain.com
RESEND_API_KEY=re_...
```

**Leave it all blank to disable email.** Nothing breaks: `/api/device/request-activation`
returns `{"status": "recorded", "emailed": false}` and the request is still
stored in the `activation_requests` collection, where you can read it with
`mongosh`. `ADMIN_EMAIL` accepts a comma-separated list.

`/api/health` reports the active provider, so you can confirm config without
sending anything.

---

## Backups

The database holds accounts, subscription state and device activations. Losing
it means every user has to sign up again and every paid activation is lost.

```bash
#!/bin/sh
# /etc/cron.daily/dermalens-backup
set -eu
STAMP=$(date -u +%Y%m%d)
DEST=/var/backups/dermalens
mkdir -p "$DEST"
docker compose -f /opt/dermalens/docker-compose.yml exec -T mongo \
  mongodump --username dermalens --password "$MONGO_ROOT_PASSWORD" \
  --authenticationDatabase admin --archive --gzip > "$DEST/dermalens-$STAMP.gz"
find "$DEST" -name 'dermalens-*.gz' -mtime +30 -delete
```

Also keep `backend/.env` somewhere safe and offline — `JWT_SECRET` and
`ACTIVATION_SECRET` cannot be regenerated without disrupting live users.

Restore test (do this once, before you need it):

```bash
docker compose exec -T mongo mongorestore --username dermalens \
  --password "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin \
  --archive --gzip --drop < /var/backups/dermalens/dermalens-20260101.gz
```

---

## Verifying the deployment

```bash
curl -s https://api.your-domain.com/api/health | jq
```

```json
{
  "status": "ok",
  "checks": {
    "mongo": true,
    "gemini_key": true,
    "email": { "provider": "smtp", "enabled": true, "from": "noreply@your-domain.com" }
  }
}
```

It returns **503** when MongoDB is unreachable, so container and load-balancer
health checks fail loudly instead of serving a broken API.

Then exercise the real paths:

```bash
BASE=https://api.your-domain.com

curl -s -X POST $BASE/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"full_name":"Test User","email":"test@example.com","password":"secret123"}'

curl -s -X POST $BASE/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"secret123"}'

curl -s $BASE/api/privacy-policy | head -20
```

The API integration suite runs against a live server:

```bash
pip install -r backend/requirements-dev.txt
EXPO_PUBLIC_BACKEND_URL=https://api.your-domain.com pytest backend/tests
```

It creates real accounts and consumes real Gemini quota — point it at a staging
deployment, not production.

---

## Environment variables

Full annotated list: [`backend/.env.example`](../backend/.env.example).

### Required

| Variable | Notes |
|---|---|
| `MONGO_URL` | Connection string. Compose overrides this with the `mongo` service. |
| `DB_NAME` | Database name, e.g. `dermalens`. |
| `JWT_SECRET` | `openssl rand -hex 32`. Changing it logs everyone out. |
| `GEMINI_API_KEY` | Server-side only — never reaches the app bundle. |

### Commonly set

| Variable | Default | Notes |
|---|---|---|
| `GEMINI_MODEL` | `gemini-3.1-pro-preview` | Vision model. |
| `PUBLIC_BASE_URL` | — | Public origin; printed in the privacy policy. |
| `SUPPORT_EMAIL` | — | Contact address on the public pages. |
| `ANALYSES_PER_HOUR` | `10` | Per-account rate limit. |
| `FREE_ANALYSES` | `1` | Must match `FREE_ANALYSES` in `frontend/src/billing/products.ts`. |
| `JWT_EXPIRE_MINUTES` | `43200` | 30 days. |
| `WEB_CONCURRENCY` | `2` | Uvicorn workers. |

### Email, Play, activation

| Variable | Notes |
|---|---|
| `ADMIN_EMAIL` | Notification recipients, comma-separated. |
| `EMAIL_PROVIDER` | `smtp`, `resend`, or blank to auto-detect/disable. |
| `EMAIL_FROM` / `EMAIL_FROM_NAME` | Envelope sender. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_SECURITY` | SMTP provider. |
| `RESEND_API_KEY` | Resend provider. |
| `ANDROID_PACKAGE_NAME` | Leave as `com.emergent.aidermatologistapp.r2pygs`. |
| `PLAY_SERVICE_ACCOUNT_JSON` | Inline JSON or a file path. Blank skips verification. |
| `PLAY_TRIAL_OFFER_IDS` | Comma-separated free-trial offer ids. |
| `ACTIVATION_SECRET` | Must match the app and the offline key generator. |
| `DELETION_RECORD_RETENTION_DAYS` | `730`. TTL on `sha256(email)` deletion records. |
