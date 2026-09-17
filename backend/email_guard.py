"""Email hygiene for sign-up: throwaway-domain blocklist, MX (deliverability) check,
and the transactional-email safety gate that every send path must pass through.

Kept in its own module so server.py stays readable and so the blocklist can grow
without touching route code.
"""

import ipaddress
import logging
import re
import time
from html.parser import HTMLParser
from typing import Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 1. Throwaway / disposable domains
# ---------------------------------------------------------------------------
# Addresses on these providers are deliberately short-lived, so an account made
# with one cannot be recovered and cannot receive a subscription receipt.
DISPOSABLE_DOMAINS = {
    "0-mail.com", "10minutemail.com", "10minutemail.net", "20minutemail.com", "33mail.com",
    "anonbox.net", "anonymbox.com", "armyspy.com", "bccto.me", "binkmail.com", "bobmail.info",
    "bugmenot.com", "burnermail.io", "byom.de", "cuvox.de", "dayrep.com", "deadaddress.com",
    "discard.email", "discardmail.com", "disposableinbox.com", "dispostable.com", "dodgeit.com",
    "dodgit.com", "dontreg.com", "dropmail.me", "e4ward.com", "easytrashmail.com", "einrot.com",
    "emailfake.com", "emailondeck.com", "emailsensei.com", "emailtemporanea.com", "emltmp.com",
    "explodemail.com", "fakeinbox.com", "fakemail.net", "fakemailgenerator.com", "fastmazda.com",
    "filzmail.com", "fleckens.hu", "forgetmail.com", "fux0ringduh.com", "get2mail.fr",
    "getairmail.com", "getnada.com", "getonemail.com", "grr.la", "guerrillamail.biz",
    "guerrillamail.com", "guerrillamail.de", "guerrillamail.info", "guerrillamail.net",
    "guerrillamail.org", "guerrillamailblock.com", "gustr.com", "harakirimail.com", "hidemail.de",
    "hmamail.com", "inbox.si", "inboxalias.com", "inboxbear.com", "incognitomail.com",
    "jetable.org", "jourrapide.com", "kasmail.com", "koszmail.pl", "letthemeatspam.com",
    "lroid.com", "luxusmail.org", "mail-temporaire.fr", "mail.tm", "mail7.io", "mailbidon.com",
    "mailcatch.com", "maildrop.cc", "maileater.com", "mailexpire.com", "mailforspam.com",
    "mailinator.com", "mailinator.net", "mailinator2.com", "mailmetrash.com", "mailnesia.com",
    "mailnull.com", "mailsac.com", "mailslurp.com", "mailtemp.info", "mailtothis.com",
    "meltmail.com", "mintemail.com", "moakt.com", "mohmal.com", "msgsafe.io", "mt2015.com",
    "mailtrap.io", "mytemp.email", "mytrashmail.com", "nada.email", "nomail.xl.cx",
    "no-spam.ws", "nowmymail.com", "objectmail.com", "onewaymail.com", "pokemail.net",
    "politikerclub.de", "pookmail.com", "privacy.net", "proxymail.eu", "putthisinyourspamdatabase.com",
    "quickinbox.com", "rcpt.at", "reallymymail.com", "receiveee.com", "rtrtr.com", "safetymail.info",
    "sharklasers.com", "shieldemail.com", "shitmail.me", "slopsbox.com", "smashmail.de",
    "sneakemail.com", "sofimail.com", "spam4.me", "spamavert.com", "spambob.com", "spambog.com",
    "spambox.us", "spamcowboy.com", "spamdecoy.net", "spamfree24.org", "spamgourmet.com",
    "spamhole.com", "spaml.com", "spamspot.com", "spamthis.co.uk", "superrito.com",
    "teleworm.us", "temp-mail.io", "temp-mail.org", "tempail.com", "tempemail.com",
    "tempemail.net", "tempinbox.com", "tempmail.altmails.com", "tempmail.de", "tempmail.net",
    "tempmail.plus", "tempmail2.com", "tempmailer.com", "tempmailo.com", "tempomail.fr",
    "temporaryemail.net", "temporaryinbox.com", "tempr.email", "thankyou2010.com", "throwawaymail.com",
    "tmail.ws", "tmailinator.com", "trash-mail.com", "trash2009.com", "trashmail.com",
    "trashmail.de", "trashmail.me", "trashmail.net", "trbvm.com", "tyldd.com", "wegwerfmail.de",
    "wegwerfmail.net", "wh4f.org", "willselfdestruct.com", "wuzup.net", "yopmail.com",
    "yopmail.fr", "yopmail.net", "yourdomain.com", "zehnminutenmail.de", "zippymail.info",
}

# RFC 2606 / RFC 6761 reserved names — they can never receive real mail.
RESERVED_TLDS = {"test", "invalid", "example", "localhost", "local", "internal"}
RESERVED_DOMAINS = {"example.com", "example.net", "example.org"}

# A stricter shape than the "anything@anything.anything" the app used before:
# labelled domain, alphabetic TLD of 2+ chars, no leading/trailing/double dots.
_EMAIL_RE = re.compile(
    r"^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*"
    r"@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*"
    r"\.[A-Za-z]{2,}$"
)


def email_domain(email: str) -> str:
    return email.rsplit("@", 1)[-1].strip().lower() if "@" in email else ""


def malformed_email(email: str) -> bool:
    """Belt-and-braces shape check on top of Pydantic's EmailStr."""
    email = email.strip()
    if not email or len(email) > 254 or ".." in email:
        return True
    local = email.rsplit("@", 1)[0]
    if len(local) > 64:
        return True
    return not _EMAIL_RE.match(email)


def is_disposable_email(email: str) -> bool:
    domain = email_domain(email)
    if not domain:
        return True
    if domain in DISPOSABLE_DOMAINS or domain in RESERVED_DOMAINS:
        return True
    if domain.rsplit(".", 1)[-1] in RESERVED_TLDS:
        return True
    # Sub-domains of a blocked provider (e.g. foo.mailinator.com).
    return any(domain.endswith("." + d) for d in DISPOSABLE_DOMAINS)


# ---------------------------------------------------------------------------
# 2. Deliverability (MX) check
# ---------------------------------------------------------------------------
# domain -> (accepts_mail, checked_at). Keeps DNS out of the hot path.
_mx_cache: dict[str, tuple[Optional[bool], float]] = {}
_MX_CACHE_TTL = 24 * 3600
_MX_TIMEOUT = 5.0


def domain_accepts_mail_sync(domain: str) -> Optional[bool]:
    """True = has a mail host, False = definitively none, None = inconclusive.

    Blocking DNS — always call through run_in_threadpool. `None` is returned for
    timeouts/SERVFAIL so the caller can fail open: a wrong "no such domain" would
    lock a real user out, while a fake domain simply never delivers the code.
    """
    domain = (domain or "").strip().lower().rstrip(".")
    if not domain:
        return False

    cached = _mx_cache.get(domain)
    if cached and time.time() - cached[1] < _MX_CACHE_TTL:
        return cached[0]

    result: Optional[bool] = False
    try:
        import dns.exception
        import dns.resolver

        resolver = dns.resolver.Resolver()
        resolver.timeout = _MX_TIMEOUT
        resolver.lifetime = _MX_TIMEOUT

        try:
            answers = resolver.resolve(domain, "MX")
            if any(str(getattr(r, "exchange", "")).rstrip(".") for r in answers):
                result = True
        except dns.resolver.NoAnswer:
            result = False  # no MX — fall through to the implicit-MX A/AAAA lookup
        except dns.resolver.NXDOMAIN:
            result = False
        except (dns.exception.Timeout, dns.resolver.NoNameservers):
            result = None
        except Exception as e:  # pragma: no cover - defensive
            logger.warning(f"MX lookup error for {domain}: {e}")
            result = None

        if result is False:
            # RFC 5321 §5.1: with no MX record, the A/AAAA record is the mail host.
            for rrtype in ("A", "AAAA"):
                try:
                    if resolver.resolve(domain, rrtype):
                        result = True
                        break
                except dns.resolver.NoAnswer:
                    continue
                except dns.resolver.NXDOMAIN:
                    result = False
                    break
                except (dns.exception.Timeout, dns.resolver.NoNameservers):
                    result = None
                    break
                except Exception:
                    result = None
                    break
    except ImportError:  # pragma: no cover - dnspython missing
        logger.warning("dnspython is not installed; skipping the MX check")
        return None

    _mx_cache[domain] = (result, time.time())
    return result


# ---------------------------------------------------------------------------
# 3. Transactional-email safety gate (from the Emergent email playbook)
# ---------------------------------------------------------------------------
_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")  # G2 ask-back phrasing
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)   # host-looking text


def _host_ok(host: str) -> bool:
    """Reject empty, punycode, IP-literal (v4 AND v6), and shortener hosts."""
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def assert_safe_email(subject: str, html: str) -> None:
    """Structural guard for every send path: no forms/inputs, no credential
    ask-backs, https-only links/assets, anchor text that matches its real host.
    If a legitimate email trips this, rewrite the copy - never weaken the gate.
    """
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} != real link host {real!r} (G3)")
