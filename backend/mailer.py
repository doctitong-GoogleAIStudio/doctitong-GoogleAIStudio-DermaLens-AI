"""Outbound email for the self-hosted backend.

Replaces the Emergent-managed email integration. Two providers, picked by
EMAIL_PROVIDER (or auto-detected from whichever credentials are present):

  smtp    any SMTP server — your own Postfix, Fastmail, Gmail with an app
          password, Amazon SES, Mailgun, Resend's SMTP bridge, ...
  resend  the Resend HTTPS API (RESEND_API_KEY)

With neither configured email is simply disabled: callers get False back and
the surrounding request still succeeds. Only admin notifications (device
activation requests, account deletions) go out, so the app stays fully usable
without a mail server.
"""

import os
import smtplib
import logging
from email.message import EmailMessage
from email.utils import formataddr
from typing import List, Optional

import httpx
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)

EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "DermaLens AI")
# Envelope sender, e.g. noreply@your-domain.com. Required for both providers.
EMAIL_FROM = os.environ.get("EMAIL_FROM", "").strip()

SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
# "starttls" (default, port 587), "ssl" (port 465) or "none" (unencrypted, LAN relay only).
SMTP_SECURITY = os.environ.get("SMTP_SECURITY", "starttls").strip().lower()
SMTP_TIMEOUT_SECONDS = float(os.environ.get("SMTP_TIMEOUT_SECONDS", "30"))

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "").strip()
RESEND_ENDPOINT = "https://api.resend.com/emails"


def _detect_provider() -> str:
    explicit = os.environ.get("EMAIL_PROVIDER", "").strip().lower()
    if explicit:
        return explicit
    if SMTP_HOST:
        return "smtp"
    if RESEND_API_KEY:
        return "resend"
    return "none"


EMAIL_PROVIDER = _detect_provider()


def email_enabled() -> bool:
    """True when a provider is configured well enough to attempt a send."""
    if not EMAIL_FROM:
        return False
    if EMAIL_PROVIDER == "smtp":
        return bool(SMTP_HOST)
    if EMAIL_PROVIDER == "resend":
        return bool(RESEND_API_KEY)
    return False


def _from_header() -> str:
    return formataddr((EMAIL_FROM_NAME, EMAIL_FROM))


def _send_smtp_sync(to: List[str], subject: str, html: str) -> None:
    msg = EmailMessage()
    msg["From"] = _from_header()
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    # Plain-text part first so the HTML stays the alternative, as clients expect.
    msg.set_content("This message requires an HTML-capable email client.")
    msg.add_alternative(html, subtype="html")

    if SMTP_SECURITY == "ssl":
        smtp: smtplib.SMTP = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS)
    else:
        smtp = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS)
    try:
        smtp.ehlo()
        if SMTP_SECURITY == "starttls":
            smtp.starttls()
            smtp.ehlo()
        if SMTP_USER:
            smtp.login(SMTP_USER, SMTP_PASSWORD)
        smtp.send_message(msg)
    finally:
        try:
            smtp.quit()
        except Exception:
            pass


async def _send_resend(to: List[str], subject: str, html: str) -> None:
    async with httpx.AsyncClient(timeout=30) as hc:
        resp = await hc.post(
            RESEND_ENDPOINT,
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            json={"from": _from_header(), "to": to, "subject": subject, "html": html},
        )
    resp.raise_for_status()


async def send_email(to: List[str], subject: str, html: str) -> bool:
    """Sends one HTML email. Returns False (never raises) when email is not
    configured or the provider rejected the message — the caller decides how
    much that matters."""
    recipients = [addr for addr in (to or []) if addr]
    if not recipients:
        return False
    if not email_enabled():
        return False

    try:
        if EMAIL_PROVIDER == "smtp":
            # smtplib is blocking; keep it off the event loop.
            await run_in_threadpool(_send_smtp_sync, recipients, subject, html)
        elif EMAIL_PROVIDER == "resend":
            await _send_resend(recipients, subject, html)
        else:
            return False
        return True
    except Exception as e:
        logger.error(f"Email send failed via {EMAIL_PROVIDER}: {e}")
        return False


def describe_config() -> dict:
    """Non-secret summary for the /api/health endpoint and startup logging."""
    return {
        "provider": EMAIL_PROVIDER,
        "enabled": email_enabled(),
        "from": EMAIL_FROM or None,
        "smtp_host": SMTP_HOST or None,
    }


def admin_recipients() -> List[str]:
    """ADMIN_EMAIL may hold a comma-separated list."""
    raw: Optional[str] = os.environ.get("ADMIN_EMAIL", "")
    return [x.strip() for x in raw.split(",") if x.strip()]
