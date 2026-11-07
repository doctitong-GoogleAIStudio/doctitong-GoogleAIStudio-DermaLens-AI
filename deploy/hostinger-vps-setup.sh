#!/usr/bin/env bash
#
# One-time preparation of a fresh Hostinger VPS (Ubuntu 22.04 or newer) to run
# DermaLens AI. Installs Docker, creates a non-root user, and closes every port
# except SSH and HTTP(S).
#
# Run as root on a NEW server, from a clone of this repo:
#     bash deploy/hostinger-vps-setup.sh
#
# Override the SSH port if sshd moved and detection guesses wrong:
#     SSH_PORT=2222 bash deploy/hostinger-vps-setup.sh
#
# It does not deploy the app — see docs/HOSTINGER.md step 4 for that. Safe to
# re-run: every step checks before acting.

set -euo pipefail

APP_USER="${APP_USER:-dermalens}"

log() { printf '\n==> %s\n' "$1"; }
warn() { printf '\n!!  %s\n' "$1" >&2; }

# Work out which port sshd actually listens on before touching the firewall —
# allowing only 22 on a server moved to another port locks you out of it.
detect_ssh_port() {
	local port=""
	# The live socket is the authority; config files can disagree with it.
	if command -v ss >/dev/null 2>&1; then
		port="$(ss -tlnp 2>/dev/null | awk '/sshd/ {sub(/.*:/, "", $4); print $4; exit}')"
	fi
	if [ -z "$port" ] && [ -r /etc/ssh/sshd_config ]; then
		port="$(awk '/^[[:space:]]*Port[[:space:]]+[0-9]+/ {print $2; exit}' /etc/ssh/sshd_config)"
	fi
	# SSH_CONNECTION is "<client ip> <client port> <server ip> <server port>".
	if [ -z "$port" ] && [ -n "${SSH_CONNECTION:-}" ]; then
		port="$(printf '%s' "$SSH_CONNECTION" | awk '{print $4}')"
	fi
	printf '%s' "${port:-22}"
}

SSH_PORT="${SSH_PORT:-$(detect_ssh_port)}"

if [ "$(id -u)" -ne 0 ]; then
	warn "Run this as root (you are $(id -un))."
	exit 1
fi

if ! grep -qi ubuntu /etc/os-release 2>/dev/null; then
	warn "This script expects Ubuntu. Detected:"
	grep -i '^PRETTY_NAME' /etc/os-release >&2 || true
	warn "Continuing anyway in 10s — Ctrl-C to abort."
	sleep 10
fi

# ---------------------------------------------------------------------------
log "Updating base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq ca-certificates curl git ufw

# ---------------------------------------------------------------------------
if command -v docker >/dev/null 2>&1; then
	log "Docker already installed ($(docker --version))"
else
	log "Installing Docker"
	# Hostinger's "Ubuntu with Docker" template ships it already; this covers
	# the plain template. get.docker.com is preferred (newest Docker), but it
	# fails on an Ubuntu release Docker's repo does not carry yet, so fall back
	# to the packages in Ubuntu's own archive, which always match the release.
	if curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sh /tmp/get-docker.sh; then
		log "Installed from get.docker.com"
	else
		warn "get.docker.com failed (common on a brand-new Ubuntu release)."
		warn "Falling back to Ubuntu's own docker.io packages."
		apt-get install -y -qq docker.io docker-compose-v2
	fi
	rm -f /tmp/get-docker.sh
fi

if docker compose version >/dev/null 2>&1; then
	log "Compose plugin present ($(docker compose version --short))"
else
	log "Installing the Compose plugin"
	# docker-compose-plugin comes from Docker's repo, docker-compose-v2 from
	# Ubuntu's. Try each; only one will exist depending on the path above.
	apt-get install -y -qq docker-compose-plugin \
		|| apt-get install -y -qq docker-compose-v2 \
		|| warn "Could not install a Compose plugin automatically."
fi

systemctl enable --now docker

# Fail loudly here rather than three steps later at `docker compose up`.
if ! docker --version >/dev/null 2>&1; then
	warn "Docker is still not working. Stopping."
	exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
	warn "Docker works but 'docker compose' does not. Stopping."
	warn "Try: apt-get install -y docker-compose-v2"
	exit 1
fi

# ---------------------------------------------------------------------------
if id "$APP_USER" >/dev/null 2>&1; then
	log "User '$APP_USER' already exists"
else
	log "Creating user '$APP_USER'"
	# No password: this account is reached with `su - $APP_USER` from root, or
	# via an SSH key you add to ~$APP_USER/.ssh/authorized_keys.
	adduser --disabled-password --gecos "" "$APP_USER"
fi

log "Granting '$APP_USER' access to Docker"
usermod -aG docker "$APP_USER"

# Carry root's SSH keys over so key-based login works for the new user too.
if [ -f /root/.ssh/authorized_keys ] && [ ! -f "/home/$APP_USER/.ssh/authorized_keys" ]; then
	log "Copying root's authorized_keys to '$APP_USER'"
	install -d -m 700 -o "$APP_USER" -g "$APP_USER" "/home/$APP_USER/.ssh"
	install -m 600 -o "$APP_USER" -g "$APP_USER" \
		/root/.ssh/authorized_keys "/home/$APP_USER/.ssh/authorized_keys"
fi

# ---------------------------------------------------------------------------
log "Configuring the firewall (SSH on port $SSH_PORT)"
# Order matters: allow SSH before enabling, or you lock yourself out.
ufw allow "$SSH_PORT/tcp" comment 'SSH'
ufw allow 80/tcp comment 'HTTP (ACME challenge + redirect)'
ufw allow 443/tcp comment 'HTTPS'
ufw default deny incoming
ufw default allow outgoing
ufw --force enable
ufw status verbose

# MongoDB is deliberately absent above: docker-compose.yml never publishes it to
# the host, so it is reachable only from the backend container.

# ---------------------------------------------------------------------------
log "Enabling unattended security updates"
apt-get install -y -qq unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

# ---------------------------------------------------------------------------
cat <<EOF

==> Server prepared.

    Docker:   $(docker --version)
    Compose:  $(docker compose version --short 2>/dev/null || echo 'unknown')
    User:     $APP_USER (in the docker group)
    Firewall: $SSH_PORT, 80, 443 open; everything else denied

Next (docs/HOSTINGER.md step 4):

    su - $APP_USER
    git clone https://github.com/doctitong-GoogleAIStudio/doctitong-GoogleAIStudio-DermaLens-AI.git
    cd doctitong-GoogleAIStudio-DermaLens-AI
    cp .env.example .env && cp backend/.env.example backend/.env
    # fill both in, then:
    docker compose --profile proxy up -d --build

Make sure api.aivicventures.com already resolves to this server before starting
Caddy, or Let's Encrypt will rate-limit the failed certificate attempts.

EOF
