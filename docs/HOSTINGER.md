# Hosting DermaLens AI on Hostinger

Short answer to the two questions:

**No — there is no Laravel anywhere in this project.** The backend is Python
(FastAPI) with MongoDB. There is not a single `.php` file in the repository.

**Yes — Hostinger can host it, but only on a VPS plan,** not on shared/Premium/
Business web hosting. Details and the full walkthrough below.

- [Why shared hosting cannot run this backend](#why-shared-hosting-cannot-run-this-backend)
- [Should you rewrite it in Laravel?](#should-you-rewrite-it-in-laravel)
- [What goes where](#what-goes-where)
- [Walkthrough — Hostinger VPS](#walkthrough--hostinger-vps)
- [Serving the web app from your existing Hostinger site](#serving-the-web-app-from-your-existing-hostinger-site)
- [Database choice](#database-choice)
- [Backups](#backups)
- [Costs](#costs)

> Hostinger renames plans and changes specs regularly, and this guide avoids
> quoting prices or plan tiers for that reason. What matters is the capability:
> you need **root SSH access**, which means a **VPS**, not web hosting.

---

## Why shared hosting cannot run this backend

Hostinger's web hosting plans (Premium, Business, Cloud) run PHP behind
Apache/LiteSpeed with MySQL, managed through hPanel. They give you no root
access. This backend needs four things none of those plans provide:

| What the app needs | Shared hosting |
|---|---|
| A long-lived Python ASGI process (`uvicorn`) listening on a port | No. PHP is invoked per request; you cannot keep a daemon running. |
| **MongoDB** | No. Only MySQL is offered, and you cannot install a database server. |
| Requests that run up to **90 seconds** (Gemini image analysis — `GEMINI_TIMEOUT_SECONDS` in `server.py`) | Usually capped well below that by `max_execution_time`. |
| Request bodies up to **32 MB** (up to 4 base64-encoded photos per analysis) | Typically capped far lower by `upload_max_filesize`. |

The last two are worth noting because they are not Python problems — they are
*shared hosting* problems. They would bite a PHP rewrite too. See below.

**Hostinger VPS** plans are a different product: a full Ubuntu machine with root
SSH. Docker runs, MongoDB runs, `uvicorn` runs. Everything already in this repo
(`docker-compose.yml`, `deploy/`) works there unchanged.

---

## Should you rewrite it in Laravel?

My recommendation: **no.** Three reasons, in order of how much they'd cost you.

**1. It would not actually solve the hosting problem.** The reason to rewrite
would be to fit on cheap shared hosting. But the two hard limits above —
90-second requests and 32 MB uploads — are enforced by the hosting plan, not by
the language. A Laravel version of `/api/analyze` would still need to hold a
request open while Gemini analyses up to four photos. You would do the whole
rewrite and still need a VPS.

**2. Your app is already published and has users.** `versionCode 124` is live on
Google Play. Installed copies talk to a fixed API contract — 23 endpoints, JWT
format, the HMAC activation scheme, the exact JSON shapes the app parses. A
rewrite has to reproduce all of it bug-for-bug, and anything you get subtly
wrong breaks apps already on people's phones, which you cannot roll back.

**3. The volume is larger than it looks.** ~1,600 lines of backend, and the
non-trivial parts are the parts hardest to port: Gemini vision prompting and
strict-JSON parsing, PDF report generation, Google Play purchase verification,
HMAC device activation that must stay byte-compatible with the shipped app and
the offline key generator, per-account rate limiting, and the GDPR account
deletion / de-identification flow. Plus the backend tests, which all assume the
current API.

A VPS costs a few dollars a month. A rewrite costs weeks and risks your live
users. If you want Laravel for other reasons — your own familiarity, other
projects on the same stack — that is a legitimate choice, but do it as a
deliberate migration later, not as a way to avoid renting a VPS.

---

## What goes where

You do not have to move your website. Split it:

| Piece | Where | Why |
|---|---|---|
| `aivicventures.com` — your existing site | **Stays on Hostinger web hosting**, untouched | It is already working. Nothing in this repo touches your apex domain. |
| `api.aivicventures.com` — the backend + MongoDB | **Hostinger VPS** | Needs root, Docker, a long-lived process. |
| `app.aivicventures.com` — the web version of the app (optional) | Either: the VPS, or **Hostinger web hosting as static files** | It is a static export; see below. |

Only the `api` subdomain's DNS record points at the VPS.

---

## Walkthrough — Hostinger VPS

### 1. The VPS

This guide assumes **KVM 2**: 2 vCPU, 8 GB RAM, 100 GB NVMe, 8 TB bandwidth.
That is comfortably more than this app needs — the backend idles at a few
hundred MB and MongoDB's working set stays small, because photos and scan
results never reach the server. You will not need to resize, and there is no
reason to offload the database.

Rough budget on this box: backend ~300-500 MB, MongoDB ~1 GB with headroom to
grow, Caddy negligible. That leaves most of the 8 GB unused, which is the point
— nothing here should ever approach the limit.

Confirm on the box if you are unsure what you have:

```bash
nproc && free -h && df -h /
```

**Region.** Pick the datacentre nearest your users; Singapore or Kuala Lumpur
are the closest to the Philippines. Changing region later means rebuilding the
VPS, so get this right before you deploy. It affects app latency only — the
Gemini call goes out to Google from the server either way.

#### Choosing the OS template

hPanel's **VPS → Operating System** page splits templates across tabs. Which
tab you pick matters more than which Ubuntu version:

| Tab | Pick? | Why |
|---|---|---|
| **Application** → *Ubuntu 24.04 with Docker* | **Best** | Docker and the Compose plugin are already installed, so step 3 is mostly done. |
| **Operating System** → *Ubuntu 24.04* | **Fine** | Plain Ubuntu. `deploy/hostinger-vps-setup.sh` installs Docker for you. |
| **Panel** → CyberPanel, cPanel, Plesk, Webmin | **No** | These install a hosting control panel that binds ports 80 and 443 and runs its own web server. It will fight Caddy for those ports and for TLS certificates. |

The Panel row is the one to avoid. It looks like the familiar shared-hosting
experience, which is exactly why it is tempting — but this stack brings its own
web server and certificate handling, and a control panel on the same box means
two things competing for the same ports.

Either of the first two options is fine. If you are unsure, take plain
**Ubuntu 24.04**: the setup script handles the rest, and it keeps the box free
of software you did not choose.

> **Reinstalling wipes the VPS.** Everything on the disk is destroyed and you
> get a fresh root password; your SSH client will also warn that the host key
> changed, which is expected. On a VPS you have not deployed to yet there is
> nothing to lose — but do not do this once the app is live without a backup.
> See [Backups](#backups).

### 2. Point DNS at it

Note the VPS's IPv4 address from hPanel, then in your DNS zone for
`aivicventures.com` add:

| Type | Name | Value | TTL |
|---|---|---|---|
| `A` | `api` | the VPS IP | default |

Leave the apex (`@`) record alone — that is your website.

Confirm before continuing, because Caddy requests a TLS certificate on first
start and Let's Encrypt rate-limits repeated failures:

```bash
dig +short api.aivicventures.com
```

### 3. Connect and prepare the server

SSH in as root using the credentials from hPanel:

```bash
ssh root@<your-vps-ip>
```

Clone the repo and run the prep script, which installs Docker, creates a
non-root user, and configures the firewall:

```bash
apt-get update && apt-get install -y git
git clone https://github.com/doctitong-GoogleAIStudio/doctitong-GoogleAIStudio-DermaLens-AI.git /opt/dermalens-src
cd /opt/dermalens-src
less deploy/hostinger-vps-setup.sh     # read it — it runs as root
bash deploy/hostinger-vps-setup.sh
```

It detects which port `sshd` is really listening on before enabling the
firewall, so a VPS whose SSH has been moved off 22 does not lock you out. If
detection is ever wrong, pass the port explicitly:

```bash
SSH_PORT=2222 bash deploy/hostinger-vps-setup.sh
```

The script is idempotent — re-running it is safe.

Or do the same by hand:

```bash
apt-get update && apt-get upgrade -y
curl -fsSL https://get.docker.com | sh
adduser --disabled-password --gecos "" dermalens
usermod -aG docker dermalens

ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable
```

Only 22, 80 and 443 are open. MongoDB is never exposed — it is reachable only
from the backend container on Docker's internal network.

### 4. Deploy

```bash
su - dermalens
git clone https://github.com/doctitong-GoogleAIStudio/doctitong-GoogleAIStudio-DermaLens-AI.git
cd doctitong-GoogleAIStudio-DermaLens-AI

cp .env.example .env
cp backend/.env.example backend/.env
```

Edit `.env`:

```bash
MONGO_ROOT_PASSWORD=<openssl rand -hex 24>
API_DOMAIN=api.aivicventures.com
TLS_EMAIL=admin@aivicventures.com
WEB_DOMAIN=                      # leave empty unless serving the web app here
```

Edit `backend/.env`:

```bash
WEB_CONCURRENCY=2                # see the note below if `nproc` shows >2 cores
JWT_SECRET=<openssl rand -hex 32>
GEMINI_API_KEY=<from https://aistudio.google.com/apikey>
DB_NAME=dermalens
PUBLIC_BASE_URL=https://api.aivicventures.com
```

`WEB_CONCURRENCY` is the number of uvicorn worker processes, and 2 matches
KVM 2's 2 vCPUs. Do not raise it: the slow paths are already non-blocking —
Gemini analysis is awaited, and PDF rendering runs on a thread pool — so each
worker serves many concurrent requests by itself. More workers than cores would
just add memory and context switching.

**Fresh install, no existing accounts?** Generate new secrets and skip the
migration entirely — nothing carries over and there is nothing to break. This
is also the moment to set a brand-new `ACTIVATION_SECRET` (`openssl rand -hex
32`): the value that used to be hardcoded in this repository is in public git
history, so anyone could mint activation keys with it. Leave
`ACTIVATION_SECRET` empty if you do not use device activation at all — those
endpoints then return 503 and everything else works normally.

> **Migrating an existing database?** Then do the opposite: copy the
> **existing** `JWT_SECRET` and `ACTIVATION_SECRET` rather than generating new
> ones, or you will sign out every user and invalidate every activation key
> already issued. See
> [SELF-HOSTING.md](SELF-HOSTING.md#migrating-data-off-emergent).

Start it:

```bash
docker compose --profile proxy up -d --build
docker compose ps
docker compose logs -f backend
```

### 5. Verify

```bash
curl -s https://api.aivicventures.com/api/health
```

Expect `"status": "ok"` with `"mongo": true`. If TLS fails, check
`docker compose logs caddy` — nearly always DNS not yet propagated.

### 6. Rebuild the app against the new URL

`EXPO_PUBLIC_BACKEND_URL` is compiled into the bundle, so the published app will
keep calling the old backend until you ship a new build. Set it to
`https://api.aivicventures.com` and build with `versionCode` **≥ 125**. See
[SELF-HOSTING.md](SELF-HOSTING.md#pointing-the-mobile-app-at-your-backend) and
[SIGNING.md](SIGNING.md).

Also update the Play Console URLs, which still point at the Emergent preview
host:

- Privacy policy → `https://api.aivicventures.com/api/privacy-policy`
- Account deletion → `https://api.aivicventures.com/api/account-deletion`

### 7. Updating later

```bash
cd ~/doctitong-GoogleAIStudio-DermaLens-AI
git pull
docker compose --profile proxy up -d --build
```

---

## Serving the web app from your existing Hostinger site

The web build is plain static files, so Hostinger **web** hosting can serve it —
no VPS needed for this part. Build it on your own machine:

```bash
cd frontend
EXPO_PUBLIC_BACKEND_URL=https://api.aivicventures.com \
  npx expo export --platform web --output-dir dist
```

Upload the contents of `dist/` to `public_html/` (or a subdomain's folder) with
hPanel's File Manager or FTP.

Two things to get right:

1. **SPA fallback.** Expo Router needs unknown paths to serve `index.html`, or
   refreshing `/assessment` gives a 404. Add `.htaccess` next to `index.html`:

   ```apache
   <IfModule mod_rewrite.c>
     RewriteEngine On
     RewriteBase /
     RewriteRule ^index\.html$ - [L]
     RewriteCond %{REQUEST_FILENAME} !-f
     RewriteCond %{REQUEST_FILENAME} !-d
     RewriteRule . /index.html [L]
   </IfModule>
   ```

2. **CORS.** The browser will call the API cross-origin, so allow that origin in
   `backend/.env` on the VPS:

   ```bash
   CORS_ALLOW_ORIGINS=https://aivicventures.com,https://app.aivicventures.com
   ```

   Then `docker compose up -d backend`. (The mobile app is unaffected — it sends
   no `Origin` header.)

---

## Database choice

Two options, both fine:

**MongoDB in Docker on the VPS** (the default — already in `docker-compose.yml`).
Nothing to configure. The data lives in the `mongo-data` volume. Back it up
yourself (below).

**MongoDB Atlas** — their free tier is enough for this app's data (accounts,
usage counters, subscriptions; photos and scans never reach the server). Managed
backups, and it survives you rebuilding the VPS. To use it, comment out the
`MONGO_URL` override in `docker-compose.yml`'s `backend` service, set the
`mongodb+srv://` URI in `backend/.env`, and allow-list the VPS IP in Atlas.

On KVM 2 there is no resource reason to pick Atlas — running MongoDB in Docker
on the box is fine and keeps everything in one place. Choose Atlas only if you
want someone else handling backups and point-in-time restore.

---

## Backups

Hostinger VPS plans include **snapshots** in hPanel — take one after the first
successful deploy. Snapshots are whole-machine and manual, so also dump the
database on a schedule:

```bash
# crontab -e  (as the dermalens user)
0 3 * * * cd ~/doctitong-GoogleAIStudio-DermaLens-AI && \
  docker compose exec -T mongo mongodump --username dermalens \
  --password "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin \
  --archive --gzip > ~/backups/dermalens-$(date -u +\%Y\%m\%d).gz
```

Keep `backend/.env` somewhere off the server. `JWT_SECRET` and
`ACTIVATION_SECRET` cannot be regenerated without disrupting live users.

---

## Costs

What you will be paying for, as an order of magnitude — check current pricing in
hPanel, since this changes:

| Item | Notes |
|---|---|
| Hostinger VPS (KVM 2) | Already paid, annually. Replaces the Emergent hosting cost. |
| Your existing web hosting | Unchanged — keep it for aivicventures.com. |
| TLS certificates | Free. Caddy gets them from Let's Encrypt automatically. |
| MongoDB | Free on the VPS, or Atlas free tier. |
| Gemini API | Pay-per-use, billed by Google per token. The real variable cost — `ANALYSES_PER_HOUR` and `FREE_ANALYSES` in `backend/.env` are your ceilings. Measure it with `python3 scripts/measure-gemini-cost.py` before launch, and set a budget alert in Google Cloud Billing. |
| Email | Free. SMTP through a mailbox you already have, or Resend's free tier. |
