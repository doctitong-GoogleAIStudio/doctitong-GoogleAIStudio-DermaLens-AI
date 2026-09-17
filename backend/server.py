import os
import re
import sys
import io
import time
import base64
import binascii
import hmac
import hashlib
import json
import logging
import secrets
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import jwt
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import HTMLResponse, Response
from starlette.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from motor.motor_asyncio import AsyncIOMotorClient
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, EmailStr, Field, field_validator
from passlib.context import CryptContext
from bson import ObjectId

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')
# Sibling module with the public HTML pages, importable however uvicorn is launched.
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))
from pages import render_account_deletion_page, render_privacy_policy_page  # noqa: E402
from email_guard import (  # noqa: E402
    assert_safe_email,
    domain_accepts_mail_sync,
    email_domain,
    is_disposable_email,
    malformed_email,
)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "43200"))


# Gemini is called ONLY from here. The key must never reach the mobile bundle.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-pro-preview")
GEMINI_ENDPOINT = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
GEMINI_TIMEOUT_SECONDS = 90.0
# A stolen token must not be able to drain the AI budget.
ANALYSES_PER_HOUR = int(os.getenv("ANALYSES_PER_HOUR", "10"))
# Free analyses per ACCOUNT before the paywall. Counted from analysis_logs so a reinstall
# cannot reset it. Must match FREE_ANALYSES in frontend/src/billing/products.ts.
FREE_ANALYSES = int(os.getenv("FREE_ANALYSES", "1"))

EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "DermaLens AI")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "")
# Must stay in sync with ACTIVATION_SECRET in frontend/src/device.ts.
# The fallback guarantees the offline generator keeps producing valid keys even if
# the env var is not present in the deployed environment.
ACTIVATION_SECRET = os.environ.get("ACTIVATION_SECRET") or "DERM-ACT-2026-x7Qp9Lm3Vt8Bz1Ns"

# Public pages (privacy policy / account deletion) and Google Play server-side verification.
SUPPORT_EMAIL = os.environ.get("SUPPORT_EMAIL", "")
# Absolute https origin of this backend as seen from the internet, e.g. https://api.example.com.
# Only used to print the account-deletion URL inside the privacy policy text.
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
# Must equal android.package in frontend/app.json (never changes — Play identifies the app by it).
ANDROID_PACKAGE_NAME = os.environ.get("ANDROID_PACKAGE_NAME", "com.emergent.aidermatologistapp.r2pygs")
# Google Cloud service-account JSON (inline or file path) with the Play Console "View financial data /
# Manage orders and subscriptions" permission. Optional: leave empty to skip server-side verification.
PLAY_SERVICE_ACCOUNT_JSON = os.environ.get("PLAY_SERVICE_ACCOUNT_JSON", "")
# Comma-separated Play offer ids that are free trials (e.g. "freetrial-7d"). Optional.
PLAY_TRIAL_OFFER_IDS = {x.strip() for x in os.environ.get("PLAY_TRIAL_OFFER_IDS", "").split(",") if x.strip()}
# How long the sha256(email)+date deletion record is kept (legal / fraud / billing disputes).
DELETION_RECORD_RETENTION_DAYS = int(os.getenv("DELETION_RECORD_RETENTION_DAYS", "730"))

# --- Email-verified sign-up ---------------------------------------------------
# A new account exists only after the emailed code is confirmed, so an unverified
# (or offline) sign-up cannot create one at all. Accounts made before this was
# introduced are untouched and keep signing in normally.
SIGNUP_CODE_TTL_MINUTES = int(os.getenv("SIGNUP_CODE_TTL_MINUTES", "10"))
SIGNUP_CODE_MAX_ATTEMPTS = int(os.getenv("SIGNUP_CODE_MAX_ATTEMPTS", "5"))
SIGNUP_RESEND_COOLDOWN_SECONDS = int(os.getenv("SIGNUP_RESEND_COOLDOWN_SECONDS", "60"))
SIGNUP_MAX_RESENDS = int(os.getenv("SIGNUP_MAX_RESENDS", "3"))
# Guards our mailer: how many codes one address may be sent per hour.
SIGNUP_SENDS_PER_HOUR = int(os.getenv("SIGNUP_SENDS_PER_HOUR", "5"))
MIN_PASSWORD_LENGTH = 8

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=True)

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class SignupIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=128)


class SignupVerifyIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=10)


class SignupResendIn(BaseModel):
    email: EmailStr


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class PublicUser(BaseModel):
    id: str
    full_name: str
    email: EmailStr


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: PublicUser


class ClinicalHistoryIn(BaseModel):
    location: Optional[str] = None
    duration: Optional[str] = None
    symptoms: Optional[str] = None
    evolution: Optional[str] = None
    medicalHistory: Optional[str] = None
    notes: Optional[str] = None


ALLOWED_IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
MAX_IMAGE_BYTES = 8 * 1024 * 1024


class AnalyzeImageIn(BaseModel):
    mimeType: str
    data: str  # raw base64, no "data:" prefix

    @field_validator("mimeType")
    @classmethod
    def _check_mime(cls, v: str) -> str:
        mime = v.strip().lower()
        if mime not in ALLOWED_IMAGE_MIMES:
            raise ValueError(f"Unsupported image type '{v}'. Allowed: {', '.join(sorted(ALLOWED_IMAGE_MIMES))}.")
        return mime

    @field_validator("data")
    @classmethod
    def _check_data(cls, v: str) -> str:
        payload = v.strip()
        if not payload:
            raise ValueError("Image data is empty.")
        if payload.startswith("data:"):
            raise ValueError("Send raw base64 without the 'data:' prefix.")
        try:
            decoded = base64.b64decode(payload, validate=True)
        except (binascii.Error, ValueError):
            raise ValueError("Image data is not valid base64.")
        if not decoded:
            raise ValueError("Image data is empty.")
        if len(decoded) > MAX_IMAGE_BYTES:
            raise ValueError("Each image must be 8 MB or smaller.")
        return payload


class AnalyzeIn(BaseModel):
    images: List[AnalyzeImageIn] = Field(min_length=1, max_length=4)
    history: Optional[ClinicalHistoryIn] = None
    viewLabels: Optional[List[str]] = None


class ActivationRequestIn(BaseModel):
    device_id: str = Field(min_length=3, max_length=64)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def normalized_email(email: str) -> str:
    return email.strip().lower()


def create_access_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    claims = {"sub": user_id, "iat": now, "exp": now + timedelta(minutes=JWT_EXPIRE_MINUTES)}
    return jwt.encode(claims, JWT_SECRET, algorithm=JWT_ALGORITHM)


def public_user(doc: dict) -> PublicUser:
    return PublicUser(id=str(doc["_id"]), full_name=doc["full_name"], email=doc["email"])


async def get_current_user(token: str = Depends(oauth2_scheme)) -> PublicUser:
    cred_exc = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                             detail="Invalid or expired token",
                             headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        if not user_id or not ObjectId.is_valid(user_id):
            raise cred_exc
    except jwt.PyJWTError:
        raise cred_exc
    doc = await db.users.find_one({"_id": ObjectId(user_id)})
    if not doc:
        raise cred_exc
    return public_user(doc)


def make_activation_key(device_id: str) -> str:
    norm = device_id.strip().upper()
    digest = hmac.new(ACTIVATION_SECRET.encode(), norm.encode(), hashlib.sha256).hexdigest()
    s = digest[:16].upper()
    return "-".join(s[i:i + 4] for i in range(0, 16, 4))


class Principal(BaseModel):
    """Who is calling /api/analyze — a signed-in account or an activated device."""
    kind: str  # "user" | "device"
    id: str


async def analyze_principal(
    authorization: Optional[str] = Header(default=None),
    x_activation_key: Optional[str] = Header(default=None, alias="X-Activation-Key"),
) -> Principal:
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        user = await get_current_user(token)
        return Principal(kind="user", id=user.id)

    if x_activation_key:
        supplied = x_activation_key.strip().upper().replace(" ", "")
        async for doc in db.activated_devices.find({}, {"device_id": 1}):
            device_id = doc.get("device_id") or ""
            if device_id and hmac.compare_digest(supplied, make_activation_key(device_id)):
                return Principal(kind="device", id=device_id)
        raise HTTPException(status_code=403, detail="App is not activated.")

    raise HTTPException(status_code=401, detail="Not authenticated",
                        headers={"WWW-Authenticate": "Bearer"})


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
def _code_hash(email: str, code: str) -> str:
    """Only the hash of a live code is stored, so a database dump reveals none."""
    return hashlib.sha256(f"{normalized_email(email)}:{code.strip()}:{JWT_SECRET}".encode()).hexdigest()


def _verification_email_html(full_name: str, code: str) -> str:
    from html import escape
    first = escape((full_name or "").strip().split(" ")[0] or "there")
    return (
        '<table role="presentation" width="100%" style="font-family:Arial,sans-serif;color:#111814">'
        '<tr><td style="padding:24px">'
        '<h2 style="margin:0 0 8px">Confirm your email address</h2>'
        f'<p style="margin:0 0 16px;color:#5C7066">Hi {first}, here is the code that finishes creating '
        f'your {escape(EMAIL_FROM_NAME)} account.</p>'
        '<table role="presentation" style="border-collapse:collapse;margin:0 0 16px">'
        f'<tr><td style="background:#F1F5F3;border-radius:12px;padding:16px 28px;font-size:32px;'
        f'letter-spacing:8px;font-family:monospace;font-weight:bold;color:#111814">{escape(code)}</td></tr>'
        '</table>'
        f'<p style="margin:0 0 16px;color:#5C7066;font-size:14px">Type it into the app to continue. '
        f'The code stops working in {SIGNUP_CODE_TTL_MINUTES} minutes.</p>'
        '<p style="margin:0;color:#5C7066;font-size:14px">If you did not try to create an account, '
        'you can safely ignore this message and no account will be made.</p>'
        f'<p style="font-size:12px;color:#8E9E96;margin-top:24px">Sent by {escape(EMAIL_FROM_NAME)}. '
        'We never ask for your password or card details by email.</p>'
        '</td></tr></table>'
    )


async def _send_user_email(to: str, subject: str, html: str) -> str:
    """Transactional send to one recipient. Body always comes from a server-side
    template here, never from request input.

    Returns "sent", "rate_limited" (the mail provider is throttling us) or
    "failed", so the caller can tell the user something accurate.
    """
    assert_safe_email(subject, html)
    if not EMAIL_KEY:
        logger.error("EMERGENT_EMAIL_KEY is not configured; cannot send the verification code")
        return "failed"
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    if SUPPORT_EMAIL:
        payload["contact_email"] = SUPPORT_EMAIL
    try:
        async with httpx.AsyncClient(timeout=30) as hc:
            resp = await hc.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                                 headers={"X-Email-Key": EMAIL_KEY}, json=payload)
        resp.raise_for_status()
        return "sent"
    except httpx.HTTPStatusError as e:
        logger.error(f"Verification email rejected: {e.response.status_code} {e.response.text[:200]}")
        return "rate_limited" if e.response.status_code == 429 else "failed"
    except Exception as e:
        logger.error(f"Verification email failed: {e}")
        return "failed"


async def _assert_signup_email_usable(email: str) -> None:
    """Three cheap gates before we agree to email anything: shape, throwaway
    provider, then whether the domain has a mail host at all."""
    if malformed_email(email):
        raise HTTPException(status_code=422, detail="Please enter a valid email address.")
    if is_disposable_email(email):
        raise HTTPException(
            status_code=400,
            detail="Temporary or disposable email addresses are not accepted. Please use a permanent address.",
        )
    accepts = await run_in_threadpool(domain_accepts_mail_sync, email_domain(email))
    if accepts is False:
        raise HTTPException(
            status_code=400,
            detail="That email domain cannot receive mail. Please check your address for typos.",
        )
    # accepts is None -> DNS was inconclusive; let it through, the code simply
    # never arrives if the address is not real.


async def _throttle_signup_sends(email: str) -> None:
    since = datetime.now(timezone.utc) - timedelta(hours=1)
    sent = await db.signup_code_sends.count_documents({"email": email, "created_at": {"$gte": since}})
    if sent >= SIGNUP_SENDS_PER_HOUR:
        raise HTTPException(
            status_code=429,
            detail="Too many verification codes were requested for this address. Please try again later.",
        )


async def _issue_signup_code(email: str, full_name: str, password_hash: str, resends: int) -> dict:
    now = datetime.now(timezone.utc)
    code = f"{secrets.randbelow(1000000):06d}"
    await db.pending_signups.update_one(
        {"email": email},
        {"$set": {
            "email": email,
            "full_name": full_name,
            "password_hash": password_hash,
            "code_hash": _code_hash(email, code),
            "attempts": 0,
            "resends": resends,
            "last_sent_at": now,
            "expires_at": now + timedelta(minutes=SIGNUP_CODE_TTL_MINUTES),
            "created_at": now,
        }},
        upsert=True,
    )
    sent = await _send_user_email(
        email,
        f"Your {EMAIL_FROM_NAME} verification code",
        _verification_email_html(full_name, code),
    )
    if sent != "sent":
        await db.pending_signups.delete_one({"email": email})
        if sent == "rate_limited":
            raise HTTPException(
                status_code=429,
                detail="Too many verification emails are being sent right now. Please try again in a few minutes.",
            )
        raise HTTPException(
            status_code=502,
            detail="We could not send the verification code right now. Please try again in a moment.",
        )
    await db.signup_code_sends.insert_one({"email": email, "created_at": now})
    return {
        "sent": True,
        "email": email,
        "expires_in_seconds": SIGNUP_CODE_TTL_MINUTES * 60,
        "resend_after_seconds": SIGNUP_RESEND_COOLDOWN_SECONDS,
    }


@api_router.post("/auth/signup/start")
async def signup_start(data: SignupIn):
    """Step 1 of 2. Validates the address and emails a code. NO account is created
    here, so an unverified address can never end up with one."""
    email = normalized_email(str(data.email))
    await _assert_signup_email_usable(email)
    if await db.users.find_one({"email": email}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    await _throttle_signup_sends(email)
    return await _issue_signup_code(email, data.full_name.strip(), pwd_context.hash(data.password), 0)


@api_router.post("/auth/signup/resend")
async def signup_resend(data: SignupResendIn):
    email = normalized_email(str(data.email))
    pending = await db.pending_signups.find_one({"email": email})
    if not pending:
        raise HTTPException(status_code=400, detail="Please start creating your account again.")
    if int(pending.get("resends", 0)) >= SIGNUP_MAX_RESENDS:
        raise HTTPException(
            status_code=429,
            detail="We have already resent the code several times. Please start again in a few minutes.",
        )
    last_sent = pending.get("last_sent_at")
    if isinstance(last_sent, datetime):
        if last_sent.tzinfo is None:
            last_sent = last_sent.replace(tzinfo=timezone.utc)
        waited = (datetime.now(timezone.utc) - last_sent).total_seconds()
        if waited < SIGNUP_RESEND_COOLDOWN_SECONDS:
            raise HTTPException(
                status_code=429,
                detail=f"Please wait {int(SIGNUP_RESEND_COOLDOWN_SECONDS - waited)} seconds before asking for a new code.",
            )
    await _throttle_signup_sends(email)
    return await _issue_signup_code(
        email, pending.get("full_name", ""), pending["password_hash"], int(pending.get("resends", 0)) + 1
    )


@api_router.post("/auth/signup/verify", response_model=TokenOut, status_code=201)
async def signup_verify(data: SignupVerifyIn):
    """Step 2 of 2. The correct code is the only thing that creates the account."""
    email = normalized_email(str(data.email))
    pending = await db.pending_signups.find_one({"email": email})
    if not pending:
        raise HTTPException(status_code=400, detail="Please start creating your account again.")

    expires_at = pending.get("expires_at")
    if isinstance(expires_at, datetime):
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            await db.pending_signups.delete_one({"email": email})
            raise HTTPException(status_code=400, detail="That code has expired. Please request a new one.")

    if int(pending.get("attempts", 0)) >= SIGNUP_CODE_MAX_ATTEMPTS:
        await db.pending_signups.delete_one({"email": email})
        raise HTTPException(status_code=429, detail="Too many incorrect codes. Please start again.")

    if not hmac.compare_digest(pending.get("code_hash", ""), _code_hash(email, data.code)):
        await db.pending_signups.update_one({"email": email}, {"$inc": {"attempts": 1}})
        left = SIGNUP_CODE_MAX_ATTEMPTS - int(pending.get("attempts", 0)) - 1
        detail = "That code is not correct."
        if left > 0:
            detail += f" You have {left} attempt{'s' if left != 1 else ''} left."
        raise HTTPException(status_code=400, detail=detail)

    if await db.users.find_one({"email": email}, {"_id": 1}):
        await db.pending_signups.delete_one({"email": email})
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    now = datetime.now(timezone.utc)
    user = {
        "full_name": (pending.get("full_name") or "").strip(),
        "email": email,
        "password_hash": pending["password_hash"],
        "created_at": now,
        "email_verified": True,
        "email_verified_at": now,
    }
    result = await db.users.insert_one(user)
    user["_id"] = result.inserted_id
    await db.pending_signups.delete_one({"email": email})
    pu = public_user(user)
    return TokenOut(access_token=create_access_token(pu.id), user=pu)


@api_router.post("/auth/signup", status_code=410)
async def signup_legacy():
    """Superseded by the two-step /auth/signup/start + /auth/signup/verify flow.
    Kept as an explicit 410 so an older app build cannot create an account whose
    email was never verified."""
    raise HTTPException(
        status_code=410,
        detail="Email verification is now required to create an account. Please update to the latest version of the app.",
    )


@api_router.post("/auth/login", response_model=TokenOut)
async def login(data: LoginIn):
    email = normalized_email(str(data.email))
    user = await db.users.find_one({"email": email})
    if not user or not pwd_context.verify(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password.",
                            headers={"WWW-Authenticate": "Bearer"})
    pu = public_user(user)
    return TokenOut(access_token=create_access_token(pu.id), user=pu)


@api_router.get("/auth/me", response_model=PublicUser)
async def me(current_user: PublicUser = Depends(get_current_user)):
    return current_user


@api_router.get("/auth/email-exists")
async def email_exists(email: str):
    """Lets the app tell 'wrong password' apart from 'unknown account' on sign-in.
    Reveals nothing that /auth/signup's 409 does not already reveal."""
    doc = await db.users.find_one({"email": normalized_email(email)}, {"_id": 1})
    return {"exists": bool(doc)}


# ---------------------------------------------------------------------------
# AI Analysis
# ---------------------------------------------------------------------------
ANALYSIS_SYSTEM = (
    "You are an expert AI dermatologist assisting with preliminary, educational visual analysis "
    "of skin lesion photographs. You never claim certainty and always include a medical disclaimer.\n\n"
    "First, assess the quality of the provided image(s) for clinical analysis. Rate quality as "
    "'Excellent', 'Good', 'Fair', or 'Poor' based on lighting, focus/clarity and framing, with brief "
    "feedback. Then analyze the morphology of the lesion(s) (color, shape, border, size, texture) and "
    "identify key features based ONLY on the information supplied to you.\n\n"
    "If the supplied information is genuinely insufficient for a useful assessment (for example a "
    "severely blurred, dark or overexposed photograph, or a view too distant to show the lesion), do "
    "NOT invent a confident diagnosis: set \"assessmentPossible\" to false and list specific, "
    "actionable items in \"moreInfoNeeded\" (e.g. 'Take a closer, well-lit photo', 'Add another angle', "
    "'Tell us how long the lesion has been present'). Otherwise set \"assessmentPossible\" to true and "
    "leave \"moreInfoNeeded\" as an empty array.\n\n"
    "Respond with a SINGLE valid JSON object and NOTHING ELSE (no markdown, no code fences). "
    "Use exactly this shape:\n"
    "{\n"
    '  "imageQuality": { "score": "Excellent|Good|Fair|Poor", "feedback": "string" },\n'
    '  "assessmentPossible": true,\n'
    '  "moreInfoNeeded": [ "string" ],\n'
    '  "mostLikelyDiagnosis": { "conditionName": "string", "confidence": "High|Medium|Low", '
    '"description": "string", "urgency": "Routine|Requires Prompt Attention|Urgent", "urgencyReason": "string" },\n'
    '  "differentialDiagnoses": [ { "conditionName": "string", "confidence": "High|Medium|Low", "description": "string" } ],\n'
    '  "redFlags": [ "string" ],\n'
    '  "nextSteps": [ "string" ],\n'
    '  "disclaimer": "string"\n'
    "}\n"
    "When assessmentPossible is false, still fill mostLikelyDiagnosis with conditionName "
    "'Insufficient information', confidence 'Low' and a short explanation.\n"
    "The disclaimer must clearly state this is an AI-generated analysis and not a substitute for "
    "professional medical advice."
)

HISTORY_LABELS = {
    "location": "Anatomical location",
    "duration": "Duration",
    "symptoms": "Symptoms",
    "evolution": "Lesion evolution",
    "medicalHistory": "Relevant medical history",
    "notes": "Additional description",
}


def _build_analysis_prompt(data: "AnalyzeIn") -> str:
    parts: List[str] = []
    n = len(data.images)

    if n == 1:
        parts.append(
            "You are evaluating this case using a single clinical photograph. Carefully assess the "
            "visible findings, but recognize the limitations of a single image. Do not infer features "
            "that cannot be reliably seen. Generate a reasonable ranked differential diagnosis and "
            "communicate uncertainty appropriately."
        )
    else:
        parts.append(
            f"You are evaluating {n} photographs of the SAME lesion or eruption taken from different "
            "views, distances, or angles. Treat them as one clinical case. Integrate information across "
            "all images rather than diagnosing each photograph independently."
        )
        if data.viewLabels:
            labels = ", ".join(v for v in data.viewLabels if v)
            if labels:
                parts.append(f"The photographs are labelled by the user as: {labels}.")

    supplied = []
    if data.history:
        for field, label in HISTORY_LABELS.items():
            value = (getattr(data.history, field) or "").strip()
            if value:
                supplied.append(f"- {label}: {value}")

    if supplied:
        parts.append(
            "Integrate the supplied clinical history, symptoms, anatomical location, duration, "
            "evolution, medications, exposures, and other relevant information with the visual findings "
            "when generating the differential assessment.\n\nClinical history provided by the patient:\n"
            + "\n".join(supplied)
        )
    else:
        parts.append(
            "No clinical history was provided. Base your assessment on the image(s) alone and say so "
            "where relevant."
        )

    parts.append(
        "Return ONLY the JSON object described in your instructions."
    )
    return "\n\n".join(parts)


def _extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text.strip())
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        text = text[start:end + 1]
    return json.loads(text)


GEMINI_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "imageQuality": {
            "type": "object",
            "properties": {
                "score": {"type": "string", "enum": ["Excellent", "Good", "Fair", "Poor"]},
                "feedback": {"type": "string"},
            },
            "required": ["score", "feedback"],
        },
        "assessmentPossible": {"type": "boolean"},
        "moreInfoNeeded": {"type": "array", "items": {"type": "string"}},
        "mostLikelyDiagnosis": {
            "type": "object",
            "properties": {
                "conditionName": {"type": "string"},
                "confidence": {"type": "string", "enum": ["High", "Medium", "Low"]},
                "description": {"type": "string"},
                "urgency": {
                    "type": "string",
                    "enum": ["Routine", "Requires Prompt Attention", "Urgent"],
                },
                "urgencyReason": {"type": "string"},
            },
            "required": ["conditionName", "confidence", "description", "urgency", "urgencyReason"],
        },
        "differentialDiagnoses": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "conditionName": {"type": "string"},
                    "confidence": {"type": "string", "enum": ["High", "Medium", "Low"]},
                    "description": {"type": "string"},
                },
                "required": ["conditionName", "confidence", "description"],
            },
        },
        "redFlags": {"type": "array", "items": {"type": "string"}},
        "nextSteps": {"type": "array", "items": {"type": "string"}},
        "disclaimer": {"type": "string"},
    },
    "required": [
        "imageQuality",
        "assessmentPossible",
        "moreInfoNeeded",
        "mostLikelyDiagnosis",
        "differentialDiagnoses",
        "redFlags",
        "nextSteps",
        "disclaimer",
    ],
}


async def _log_analysis(principal: Principal, image_count: int, started: float, status_code: int) -> None:
    try:
        await db.analysis_logs.insert_one({
            "principal_kind": principal.kind,
            "user_id": principal.id if principal.kind == "user" else None,
            "activation_device_id": principal.id if principal.kind == "device" else None,
            "image_count": image_count,
            "latency_ms": int((time.monotonic() - started) * 1000),
            "status": status_code,
            "model": GEMINI_MODEL,
            "created_at": datetime.now(timezone.utc),
        })
    except Exception as e:  # logging must never break the request
        logger.error(f"analysis_logs write failed: {e}")


@api_router.post("/analyze")
async def analyze(data: AnalyzeIn, principal: Principal = Depends(analyze_principal)):
    started = time.monotonic()
    image_count = len(data.images)

    field = "user_id" if principal.kind == "user" else "activation_device_id"
    since = datetime.now(timezone.utc) - timedelta(hours=1)
    recent = await db.analysis_logs.count_documents({field: principal.id, "status": 200, "created_at": {"$gte": since}})
    if recent >= ANALYSES_PER_HOUR:
        raise HTTPException(
            status_code=429,
            detail=f"You have reached the limit of {ANALYSES_PER_HOUR} analyses per hour. Please try again later.",
        )

    if not GEMINI_API_KEY:
        logger.error("GEMINI_API_KEY is not set in backend/.env")
        await _log_analysis(principal, image_count, started, 500)
        raise HTTPException(status_code=500, detail="AI service configuration error.")

    body = {
        "systemInstruction": {"parts": [{"text": ANALYSIS_SYSTEM}]},
        "contents": [{
            "parts": [{"text": _build_analysis_prompt(data)}] + [
                {"inline_data": {"mime_type": img.mimeType, "data": img.data}} for img in data.images
            ],
        }],
        "generationConfig": {
            "response_mime_type": "application/json",
            "response_schema": GEMINI_RESPONSE_SCHEMA,
            "temperature": 0.4,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=GEMINI_TIMEOUT_SECONDS) as hc:
            resp = await hc.post(
                GEMINI_ENDPOINT,
                headers={"Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY},
                json=body,
            )
    except httpx.TimeoutException:
        logger.error("Gemini request timed out")
        await _log_analysis(principal, image_count, started, 504)
        raise HTTPException(status_code=504, detail="The analysis took too long. Please try again.")
    except httpx.HTTPError as e:
        logger.error(f"Gemini transport error: {e}")
        await _log_analysis(principal, image_count, started, 502)
        raise HTTPException(status_code=502, detail="The AI service is unavailable. Please try again.")

    if resp.status_code != 200:
        # Google's raw message can leak key/project details — never forward it.
        logger.error(f"Gemini HTTP {resp.status_code}: {resp.text[:500]}")
        if resp.status_code in (400, 401, 403):
            code, detail = 500, "AI service configuration error."
        elif resp.status_code == 429:
            code, detail = 429, "AI service is busy. Please try again shortly."
        else:
            code, detail = 502, "The AI service is unavailable. Please try again."
        await _log_analysis(principal, image_count, started, code)
        raise HTTPException(status_code=code, detail=detail)

    try:
        payload = resp.json()
        text = "".join(
            part.get("text", "")
            for part in payload["candidates"][0]["content"]["parts"]
        )
        result = _extract_json(text)
    except Exception:
        logger.error(f"Failed to parse Gemini response: {resp.text[:500]}")
        await _log_analysis(principal, image_count, started, 502)
        raise HTTPException(status_code=502, detail="The AI returned an invalid response. Please try again.")

    result.setdefault("assessmentPossible", True)
    result.setdefault("moreInfoNeeded", [])
    result.setdefault("redFlags", [])
    await _log_analysis(principal, image_count, started, 200)
    return result


# ---------------------------------------------------------------------------
# Device activation
# ---------------------------------------------------------------------------
def _activation_email_html(full_name: str, email: str, device_id: str) -> str:
    from html import escape
    return (
        '<table role="presentation" width="100%" style="font-family:Arial,sans-serif;color:#111814">'
        '<tr><td style="padding:24px">'
        f'<h2 style="margin:0 0 8px">New device activation request</h2>'
        f'<p style="margin:0 0 16px;color:#5C7066">A user has requested to activate {escape(EMAIL_FROM_NAME)}.</p>'
        '<table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px">'
        f'<tr><td style="padding:8px 0;color:#5C7066">Name</td><td style="padding:8px 0"><strong>{escape(full_name)}</strong></td></tr>'
        f'<tr><td style="padding:8px 0;color:#5C7066">Account email</td><td style="padding:8px 0"><strong>{escape(email)}</strong></td></tr>'
        f'<tr><td style="padding:8px 0;color:#5C7066">Device ID</td><td style="padding:8px 0;font-family:monospace"><strong>{escape(device_id)}</strong></td></tr>'
        '</table>'
        '<p style="margin:16px 0 0;font-size:13px;color:#5C7066">After payment is confirmed via GCash, generate the '
        'activation key for this Device ID using the offline activation generator tool and send it to the user.</p>'
        f'<p style="font-size:12px;color:#8E9E96;margin-top:24px">Sent by {escape(EMAIL_FROM_NAME)}. '
        'We never ask for your password or card details by email.</p>'
        '</td></tr></table>'
    )


@api_router.post("/device/request-activation")
async def request_activation(data: ActivationRequestIn, current_user: PublicUser = Depends(get_current_user)):
    device_id = data.device_id.strip().upper()

    await db.activation_requests.insert_one({
        "user_id": current_user.id,
        "full_name": current_user.full_name,
        "email": current_user.email,
        "device_id": device_id,
        "created_at": datetime.now(timezone.utc),
    })

    if EMAIL_KEY and ADMIN_EMAIL:
        subject = f"Device activation request \u2014 {current_user.full_name}"
        html = _activation_email_html(current_user.full_name, current_user.email, device_id)
        assert_safe_email(subject, html)
        payload = {
            "to": [ADMIN_EMAIL],
            "subject": subject,
            "html": html,
            "from_name": EMAIL_FROM_NAME,
        }
        try:
            async with httpx.AsyncClient(timeout=30) as hc:
                resp = await hc.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                                     headers={"X-Email-Key": EMAIL_KEY}, json=payload)
            resp.raise_for_status()
        except Exception as e:
            logger.error(f"Activation email failed: {e}")
            return {"status": "recorded", "emailed": False}

    return {"status": "sent", "emailed": bool(EMAIL_KEY and ADMIN_EMAIL)}


class DeviceActivateIn(BaseModel):
    device_id: str
    key: str


@api_router.post("/device/activate")
async def device_activate(data: DeviceActivateIn, current_user: PublicUser = Depends(get_current_user)):
    """Records a device as permanently activated so it survives reinstall/logout."""
    device_id = data.device_id.strip().upper()
    supplied = data.key.strip().upper().replace(" ", "")
    if not hmac.compare_digest(supplied, make_activation_key(device_id)):
        raise HTTPException(status_code=400, detail="Invalid activation key for this device.")

    await db.activated_devices.update_one(
        {"device_id": device_id},
        {
            "$set": {"device_id": device_id, "last_seen_at": datetime.now(timezone.utc)},
            "$setOnInsert": {
                "activated_at": datetime.now(timezone.utc),
                "activated_by_email": current_user.email,
                "activated_by_name": current_user.full_name,
            },
        },
        upsert=True,
    )
    return {"activated": True}


@api_router.get("/device/status")
async def device_status(device_id: str, current_user: PublicUser = Depends(get_current_user)):
    doc = await db.activated_devices.find_one({"device_id": device_id.strip().upper()})
    return {"activated": bool(doc)}


class ReportIn(BaseModel):
    html: str
    filename: Optional[str] = None


@api_router.post("/report/pdf")
async def report_pdf(data: ReportIn, current_user: PublicUser = Depends(get_current_user)):
    """Render the analysis report HTML into a real PDF file."""
    from xhtml2pdf import pisa

    buf = io.BytesIO()
    result = pisa.CreatePDF(io.StringIO(data.html), dest=buf)
    if result.err:
        raise HTTPException(status_code=500, detail="Could not render the PDF report.")

    name = re.sub(r"[^A-Za-z0-9._-]", "-", data.filename or "DermaLens-Report.pdf")
    if not name.lower().endswith(".pdf"):
        name = f"{name}.pdf"

    return Response(
        content=buf.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )




# ---------------------------------------------------------------------------
# Account deletion (in-app + public web page) and subscription status
# ---------------------------------------------------------------------------
def _email_hash(email: str) -> str:
    """One-way, unsalted-by-design hash so a deletion record can be matched to a
    later request about the same address without storing the address itself."""
    return hashlib.sha256(normalized_email(email).encode()).hexdigest()


async def _send_admin_email(subject: str, html: str) -> bool:
    assert_safe_email(subject, html)
    if not (EMAIL_KEY and ADMIN_EMAIL):
        return False
    try:
        async with httpx.AsyncClient(timeout=30) as hc:
            resp = await hc.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMAIL_KEY},
                json={"to": [ADMIN_EMAIL], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME},
            )
        resp.raise_for_status()
        return True
    except Exception as e:
        logger.error(f"Admin email failed: {e}")
        return False


async def _delete_user_account(user: dict, source: str) -> dict:
    """Hard-deletes the account and everything that identifies the person.

    Deleted:        users, activation_requests, subscriptions (verification snapshots)
    De-identified:  analysis_logs (user_id removed), activated_devices (name/email removed —
                    the device activation itself keeps working, it was paid for)
    Retained:       one account_deletions record = sha256(email) + timestamp, auto-expired by a
                    TTL index after DELETION_RECORD_RETENTION_DAYS (legal / fraud / billing disputes).
    Photos, scans, notes and reports never reach this server — the app removes them locally.
    """
    user_id = str(user["_id"])
    email = user["email"]
    now = datetime.now(timezone.utc)

    await db.activation_requests.delete_many({"user_id": user_id})
    await db.subscriptions.delete_many({"user_id": user_id})
    await db.activated_devices.update_many(
        {"activated_by_email": email},
        {"$unset": {"activated_by_email": "", "activated_by_name": ""}, "$set": {"activator_deleted_at": now}},
    )
    await db.analysis_logs.update_many(
        {"user_id": user_id},
        {"$set": {"user_id": None, "deleted_user": True}},
    )
    await db.users.delete_one({"_id": user["_id"]})
    await db.account_deletions.insert_one({
        "email_hash": _email_hash(email),
        "deleted_at": now,
        "source": source,
    })
    logger.info(f"Account deleted (source={source}, user_id={user_id})")
    return {"deleted": True, "deleted_at": now.isoformat()}


DELETION_ATTEMPT_WINDOW_MINUTES = 15
DELETION_ATTEMPT_LIMIT = 8


async def _throttle_deletion_attempts(email: str) -> None:
    """The public page has no login, so failed password guesses are capped per address."""
    since = datetime.now(timezone.utc) - timedelta(minutes=DELETION_ATTEMPT_WINDOW_MINUTES)
    failed = await db.deletion_attempts.count_documents({"email_hash": _email_hash(email), "created_at": {"$gte": since}})
    if failed >= DELETION_ATTEMPT_LIMIT:
        raise HTTPException(status_code=429, detail="Too many attempts. Please wait a few minutes and try again.")


async def _record_failed_deletion_attempt(email: str) -> None:
    try:
        await db.deletion_attempts.insert_one({"email_hash": _email_hash(email), "created_at": datetime.now(timezone.utc)})
    except Exception as e:
        logger.error(f"deletion_attempts write failed: {e}")


class AccountDeleteIn(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class AccountDeletionByCredentialsIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class AccountDeletionRequestIn(BaseModel):
    email: EmailStr
    note: Optional[str] = Field(default=None, max_length=500)


@api_router.post("/account/delete")
async def delete_my_account(data: AccountDeleteIn, current_user: PublicUser = Depends(get_current_user)):
    """In-app deletion. The signed-in user re-authenticates with their password."""
    user = await db.users.find_one({"_id": ObjectId(current_user.id)})
    if not user:
        raise HTTPException(status_code=404, detail="Account not found.")
    if not pwd_context.verify(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="That password is incorrect.")
    return await _delete_user_account(user, source="app")


@api_router.post("/account-deletion")
async def delete_account_by_credentials(data: AccountDeletionByCredentialsIn):
    """Web-page deletion (Google Play "Account deletion URL"): no app, no token — email + password."""
    email = normalized_email(str(data.email))
    await _throttle_deletion_attempts(email)
    user = await db.users.find_one({"email": email})
    if not user:
        await _record_failed_deletion_attempt(email)
        raise HTTPException(status_code=404, detail="No account exists for that email address.")
    if not pwd_context.verify(data.password, user["password_hash"]):
        await _record_failed_deletion_attempt(email)
        raise HTTPException(status_code=401, detail="The email or password is incorrect.")
    return await _delete_user_account(user, source="web")


@api_router.post("/account-deletion/request", status_code=202)
async def request_account_deletion(data: AccountDeletionRequestIn):
    """For people who cannot sign in. Recorded and emailed to the admin for manual processing
    (verify ownership of the address, then delete within 30 days)."""
    from html import escape

    email = normalized_email(str(data.email))
    note = (data.note or "").strip()
    exists = bool(await db.users.find_one({"email": email}, {"_id": 1}))
    await db.account_deletion_requests.insert_one({
        "email": email,
        "note": note,
        "account_exists": exists,
        "status": "open",
        "created_at": datetime.now(timezone.utc),
    })
    await _send_admin_email(
        subject=f"Account deletion request — {email}",
        html=(
            '<table role="presentation" width="100%" style="font-family:Arial,sans-serif;color:#111814"><tr><td style="padding:24px">'
            f'<h2 style="margin:0 0 8px">Account deletion request</h2>'
            f'<p style="margin:0 0 16px;color:#5C7066">Submitted from the {escape(EMAIL_FROM_NAME)} account-deletion web page.</p>'
            f'<p><strong>Email:</strong> {escape(email)}<br/><strong>Account exists:</strong> {"yes" if exists else "no"}</p>'
            + (f'<p><strong>Note:</strong> {escape(note)}</p>' if note else '')
            + '<p style="font-size:13px;color:#5C7066">Verify the requester controls this address, then delete the account '
              '(POST /api/account-deletion with their credentials, or remove the user document) within 30 days and mark the '
              'request closed in account_deletion_requests.</p></td></tr></table>'
        ),
    )
    # Always 202 — never reveal whether an account exists to an unauthenticated caller.
    return {"status": "received"}


@api_router.get("/account-deletion", response_class=HTMLResponse)
async def account_deletion_page():
    return HTMLResponse(content=render_account_deletion_page(api_base="", support_email=SUPPORT_EMAIL))


@api_router.get("/privacy-policy", response_class=HTMLResponse)
async def privacy_policy_page():
    from markdown_it import MarkdownIt

    md_path = ROOT_DIR / "static" / "privacy-policy.md"
    try:
        text = md_path.read_text(encoding="utf-8")
    except Exception:
        raise HTTPException(status_code=404, detail="Privacy policy not found.")
    deletion_url = f"{PUBLIC_BASE_URL}/api/account-deletion" if PUBLIC_BASE_URL else "/api/account-deletion"
    text = (
        text.replace("{{SUPPORT_EMAIL}}", SUPPORT_EMAIL or "the support address on our Google Play listing")
        .replace("{{DELETION_URL}}", deletion_url)
    )
    body = MarkdownIt("commonmark", {"html": False}).enable("table").render(text)
    return HTMLResponse(content=render_privacy_policy_page(body, api_base=""))


# --- Google Play subscription status (optional server-side verification) ---------------------
class SubscriptionVerifyIn(BaseModel):
    productId: str = Field(min_length=1, max_length=100)
    purchaseToken: str = Field(min_length=10, max_length=2000)


_PLAY_STATE_MAP = {
    "SUBSCRIPTION_STATE_ACTIVE": "active",
    "SUBSCRIPTION_STATE_CANCELED": "cancelled",
    "SUBSCRIPTION_STATE_IN_GRACE_PERIOD": "grace_period",
    "SUBSCRIPTION_STATE_ON_HOLD": "on_hold",
    "SUBSCRIPTION_STATE_PAUSED": "paused",
    "SUBSCRIPTION_STATE_EXPIRED": "expired",
    "SUBSCRIPTION_STATE_PENDING": "pending",
    "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED": "none",
}
# Google Play keeps the entitlement in these states (the app may keep granting access).
_PLAY_ENTITLED_STATES = {"active", "cancelled", "grace_period"}

_play_token_cache: dict = {"token": "", "expires": 0.0}


def _load_play_credentials():
    """Service-account JSON, either inline or a file path. None when not configured."""
    raw = PLAY_SERVICE_ACCOUNT_JSON.strip()
    if not raw:
        return None
    from google.oauth2 import service_account

    scopes = ["https://www.googleapis.com/auth/androidpublisher"]
    if raw.startswith("{"):
        return service_account.Credentials.from_service_account_info(json.loads(raw), scopes=scopes)
    return service_account.Credentials.from_service_account_file(raw, scopes=scopes)


def _play_access_token_sync() -> str:
    if _play_token_cache["token"] and time.time() < _play_token_cache["expires"]:
        return _play_token_cache["token"]
    from google.auth.transport.requests import Request

    creds = _load_play_credentials()
    creds.refresh(Request())
    _play_token_cache["token"] = creds.token
    _play_token_cache["expires"] = time.time() + 50 * 60
    return creds.token


def _summarize_play_subscription(product_id: str, payload: dict) -> dict:
    raw_state = payload.get("subscriptionState", "")
    state = _PLAY_STATE_MAP.get(raw_state, "unknown")
    items = payload.get("lineItems") or []
    line = next((li for li in items if li.get("productId") == product_id), items[0] if items else {})
    offer = line.get("offerDetails") or {}
    offer_id = offer.get("offerId")
    if PLAY_TRIAL_OFFER_IDS:
        is_trial = bool(offer_id) and offer_id in PLAY_TRIAL_OFFER_IDS
    else:
        # Without an explicit list, any introductory offer on a subscription is reported as a trial.
        is_trial = bool(offer_id)
    auto_renew = (line.get("autoRenewingPlan") or {}).get("autoRenewEnabled")
    return {
        "configured": True,
        "state": state,
        "entitled": state in _PLAY_ENTITLED_STATES,
        "productId": line.get("productId") or product_id,
        "basePlanId": offer.get("basePlanId"),
        "offerId": offer_id,
        "isTrial": is_trial,
        "autoRenewing": bool(auto_renew) if auto_renew is not None else None,
        "expiryTime": line.get("expiryTime"),
        "startTime": payload.get("startTime"),
        "acknowledged": payload.get("acknowledgementState") == "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
        "testPurchase": "testPurchase" in payload,
        "autoResumeTime": (payload.get("pausedStateContext") or {}).get("autoResumeTime"),
    }


@api_router.get("/billing/usage")
async def billing_usage(current_user: PublicUser = Depends(get_current_user)):
    """How many successful analyses this ACCOUNT has run, ever. The app compares it with its
    on-device counter (max of the two) so the free analysis survives uninstall/reinstall and
    cannot be re-earned by signing in again."""
    used = await db.analysis_logs.count_documents({"user_id": current_user.id, "status": 200})
    return {"analyses_used": used, "free_analyses": FREE_ANALYSES}


@api_router.post("/billing/subscription")
async def verify_subscription(data: SubscriptionVerifyIn, current_user: PublicUser = Depends(get_current_user)):
    """Looks a purchase token up in the Google Play Developer API (purchases.subscriptionsv2.get)
    so the app can show grace-period / account-hold / trial / expiry — states the on-device
    Billing Library cannot report. Google Play stays the source of truth; when no service
    account is configured the app falls back to Billing Library status only."""
    if not PLAY_SERVICE_ACCOUNT_JSON.strip():
        return {"configured": False}

    try:
        token = await run_in_threadpool(_play_access_token_sync)
    except Exception as e:
        logger.error(f"Play service-account auth failed: {e}")
        raise HTTPException(status_code=500, detail="Subscription verification is not configured correctly.")

    url = (
        f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{ANDROID_PACKAGE_NAME}"
        f"/purchases/subscriptionsv2/tokens/{data.purchaseToken}"
    )
    try:
        async with httpx.AsyncClient(timeout=20) as hc:
            resp = await hc.get(url, headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError as e:
        logger.error(f"Play API transport error: {e}")
        raise HTTPException(status_code=502, detail="Google Play could not be reached. Please try again.")

    if resp.status_code == 404 or resp.status_code == 410:
        summary = {"configured": True, "state": "none", "entitled": False, "productId": data.productId}
    elif resp.status_code != 200:
        logger.error(f"Play API HTTP {resp.status_code}: {resp.text[:300]}")
        raise HTTPException(status_code=502, detail="Google Play returned an error. Please try again.")
    else:
        summary = _summarize_play_subscription(data.productId, resp.json())

    try:
        await db.subscriptions.update_one(
            {"user_id": current_user.id, "productId": summary["productId"]},
            {"$set": {**summary, "user_id": current_user.id, "checked_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
    except Exception as e:
        logger.error(f"subscriptions write failed: {e}")
    return summary


ACTIVATION_TOOL_HTML = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>DermaLens AI \u2014 Offline Activation Generator</title>
<style>
  :root{--bg:#101412;--card:#181D1A;--fg:#E6EFEB;--muted:#8E9E96;--brand:#5C947A;--border:#2B3831}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;
       min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:20px;max-width:440px;width:100%;padding:28px}
  h1{font-size:20px;margin:0 0 4px}
  p.sub{color:var(--muted);margin:0 0 24px;font-size:14px}
  label{display:block;font-size:13px;color:var(--muted);margin:16px 0 6px}
  input{width:100%;background:#212925;border:1px solid var(--border);color:var(--fg);border-radius:12px;
        padding:14px;font-size:16px;font-family:monospace;letter-spacing:1px;text-transform:uppercase}
  button{width:100%;margin-top:20px;background:var(--brand);color:#0A140F;border:0;border-radius:12px;
         padding:15px;font-size:16px;font-weight:700;cursor:pointer}
  .out{margin-top:20px;background:#212925;border:1px dashed var(--brand);border-radius:12px;padding:18px;text-align:center;display:none}
  .out .k{font-family:monospace;font-size:22px;letter-spacing:3px;color:var(--brand);font-weight:700}
  .out small{color:var(--muted);display:block;margin-top:10px}
  .copybtn{width:auto;margin-top:14px;padding:11px 20px;font-size:14px;border-radius:99px;
           background:#2B3831;color:var(--fg);border:1px solid var(--brand);cursor:pointer;font-weight:700}
  .copybtn:hover{background:var(--brand);color:#0A140F}
  .err{color:#E05A6B;font-size:13px;margin-top:10px;display:none}
  .logsec{margin-top:28px;border-top:1px solid var(--border);padding-top:20px}
  .logsec h2{font-size:15px;margin:0 0 2px}
  .logsec .cnt{color:var(--muted);font-size:12px;margin:0 0 12px}
  .row{display:flex;gap:8px}
  .row input{flex:1;text-transform:none;font-family:inherit;letter-spacing:0;font-size:14px;padding:11px}
  .row button{margin-top:0;width:auto;padding:11px 14px;font-size:13px;background:#2B3831;color:var(--fg)}
  .log{margin-top:14px;max-height:300px;overflow:auto}
  .item{display:flex;align-items:center;gap:10px;padding:11px 12px;border:1px solid var(--border);
        border-radius:12px;margin-bottom:8px;background:#1E2521}
  .item .info{flex:1;min-width:0}
  .item .did{font-family:monospace;font-size:14px;font-weight:700;letter-spacing:1px}
  .item .kk{font-family:monospace;font-size:13px;color:var(--brand);letter-spacing:1px}
  .item .at{color:var(--muted);font-size:11px;margin-top:2px}
  .item .act{background:transparent;border:1px solid var(--border);color:var(--muted);border-radius:8px;
              padding:7px 9px;font-size:12px;cursor:pointer;width:auto;margin:0}
  .item .act:hover{color:var(--fg)}
  .empty{color:var(--muted);font-size:13px;text-align:center;padding:18px 0}
  .toast{position:fixed;left:50%;transform:translateX(-50%);bottom:24px;background:var(--brand);color:#0A140F;
         font-weight:700;font-size:13px;padding:11px 18px;border-radius:99px;opacity:0;transition:opacity .2s;pointer-events:none}
  .toast.on{opacity:1}
  input.plain{text-transform:none;font-family:inherit;letter-spacing:0;font-size:15px}
  .item .nm{font-family:inherit;font-size:14px;font-weight:700;color:var(--fg)}
  .item .did{font-family:monospace;font-size:13px;color:var(--muted);letter-spacing:1px;font-weight:400}
</style></head>
<body>
  <div class="card">
    <h1>Offline Activation Generator</h1>
    <p class="sub">Enter the customer's Device ID exactly as shown in their app, then generate the activation key. Works fully offline.</p>
    <label for="cname">Customer Name <span style="text-transform:none">(optional)</span></label>
    <input id="cname" class="plain" placeholder="e.g. Juan Dela Cruz" autocomplete="off"/>
    <label for="did">Device ID</label>
    <input id="did" placeholder="XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters"/>
    <div class="err" id="err">Please enter a valid Device ID.</div>
    <button id="gen">Generate Activation Key</button>
    <div class="out" id="out">
      <div class="k" id="key"></div>
      <button id="copyKey" class="copybtn">Copy Activation Key</button>
      <small>Send this key to the customer after payment.</small>
    </div>

    <div class="logsec">
      <h2>Issued Keys Log</h2>
      <p class="cnt" id="cnt">No keys issued yet.</p>
      <div class="row">
        <input id="q" placeholder="Search name, device ID or key" autocomplete="off"/>
        <button id="csv" title="Download CSV">CSV</button>
        <button id="clr" title="Clear the whole log">Clear</button>
      </div>
      <div class="log" id="log"></div>
    </div>
  </div>
  <div class="toast" id="toast"></div>
<script>/*__SHA256__*/</script>
<script>
  var SECRET="__SECRET__";
  var LOG_KEY="aiderma_activation_log";

  function makeKey(deviceId){
    var norm=deviceId.trim().toUpperCase();
    var h=sha256.hmac(SECRET,norm);
    var s=h.slice(0,16).toUpperCase();
    return s.match(/.{1,4}/g).join('-');
  }
  function readLog(){
    try{return JSON.parse(localStorage.getItem(LOG_KEY)||'[]');}catch(e){return [];}
  }
  function writeLog(l){
    try{localStorage.setItem(LOG_KEY,JSON.stringify(l));}catch(e){}
    renderLog();
  }
  function toast(m){
    var t=document.getElementById('toast');t.textContent=m;t.className='toast on';
    setTimeout(function(){t.className='toast';},1600);
  }
  function copy(txt,msg){
    try{navigator.clipboard.writeText(txt);toast(msg||'Copied');}
    catch(e){
      var ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);
      ta.select();try{document.execCommand('copy');toast(msg||'Copied');}catch(e2){}
      document.body.removeChild(ta);
    }
  }
  function addToLog(did,key,name){
    var l=readLog();
    var i=l.findIndex(function(e){return e.did===did;});
    var entry={did:did,key:key,name:name||'',at:new Date().toISOString()};
    if(i>-1){entry.at=l[i].at;if(!entry.name)entry.name=l[i].name||'';l.splice(i,1);}
    l.unshift(entry);
    writeLog(l);
  }
  function renameEntry(did){
    var l=readLog();
    var i=l.findIndex(function(e){return e.did===did;});
    if(i<0)return;
    var v=prompt('Customer name for '+did, l[i].name||'');
    if(v===null)return;
    l[i].name=v.trim();
    writeLog(l);
  }
  function fmt(iso){
    var d=new Date(iso);
    if(isNaN(d)) return '';
    return d.toLocaleDateString()+' '+d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  }
  function renderLog(){
    var l=readLog(), q=(document.getElementById('q').value||'').trim().toUpperCase();
    var f=l.filter(function(e){
      if(!q) return true;
      return e.did.indexOf(q)>-1 || e.key.indexOf(q)>-1 || (e.name||'').toUpperCase().indexOf(q)>-1;
    });
    document.getElementById('cnt').textContent =
      l.length===0 ? 'No keys issued yet.'
      : l.length+' key'+(l.length===1?'':'s')+' issued'+(q?(' \\u00b7 '+f.length+' matching'):'');
    var box=document.getElementById('log');
    box.innerHTML='';
    if(f.length===0){
      var e=document.createElement('div');e.className='empty';
      e.textContent = l.length ? 'No matches.' : 'Generated keys are saved here on this device.';
      box.appendChild(e);return;
    }
    f.forEach(function(en){
      var it=document.createElement('div');it.className='item';
      var info=document.createElement('div');info.className='info';
      var n=document.createElement('div');n.className='nm';n.textContent=en.name||'Unnamed customer';
      if(!en.name) n.style.color='#8E9E96';
      var d=document.createElement('div');d.className='did';d.textContent=en.did;
      var k=document.createElement('div');k.className='kk';k.textContent=en.key;
      var a=document.createElement('div');a.className='at';a.textContent=fmt(en.at);
      info.appendChild(n);info.appendChild(d);info.appendChild(k);info.appendChild(a);
      var ed=document.createElement('button');ed.className='act';ed.textContent='Name';
      ed.title='Set or edit the customer name';
      ed.onclick=function(){renameEntry(en.did);};
      var cp=document.createElement('button');cp.className='act';cp.textContent='Copy';
      cp.onclick=function(){copy(en.key,'Key copied');};
      var rm=document.createElement('button');rm.className='act';rm.textContent='\\u2715';
      rm.title='Remove from log';
      rm.onclick=function(){writeLog(readLog().filter(function(x){return x.did!==en.did;}));};
      it.appendChild(info);it.appendChild(ed);it.appendChild(cp);it.appendChild(rm);
      box.appendChild(it);
    });
  }

  var did=document.getElementById('did'),out=document.getElementById('out'),
      keyEl=document.getElementById('key'),err=document.getElementById('err');
  document.getElementById('gen').onclick=function(){
    var v=did.value.trim().toUpperCase();
    if(v.length<3){err.style.display='block';out.style.display='none';return;}
    err.style.display='none';
    var k=makeKey(v);
    keyEl.textContent=k;out.style.display='block';
    addToLog(v,k,document.getElementById('cname').value.trim());
    copy(k,'Key copied');
  };
  document.getElementById('copyKey').onclick=function(){
    var k=keyEl.textContent.trim();
    if(k) copy(k,'Key copied');
  };
  did.onkeydown=function(e){if(e.key==='Enter'){document.getElementById('gen').onclick();}};
  document.getElementById('q').oninput=renderLog;
  document.getElementById('clr').onclick=function(){
    if(readLog().length && confirm('Clear the entire issued-keys log?')) writeLog([]);
  };
  document.getElementById('csv').onclick=function(){
    var l=readLog();
    if(!l.length){toast('Log is empty');return;}
    var rows=[['Customer Name','Device ID','Activation Key','Issued At']].concat(
      l.map(function(e){return [e.name||'',e.did,e.key,e.at];}));
    var csv=rows.map(function(r){return r.map(function(c){return '"'+String(c).replace(/"/g,'""')+'"';}).join(',');}).join('\\n');
    var a=document.createElement('a');
    a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
    a.download='dermalens-activation-log.csv';
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    toast('CSV downloaded');
  };
  renderLog();
</script>
</body></html>"""


@api_router.get("/activation-tool", response_class=HTMLResponse)
async def activation_tool():
    """Offline activation key generator (single downloadable HTML file for the admin)."""
    sha_src = ""
    for sha_path in (
        ROOT_DIR / "static" / "sha256.min.js",
        ROOT_DIR.parent / "frontend" / "node_modules" / "js-sha256" / "build" / "sha256.min.js",
    ):
        try:
            sha_src = sha_path.read_text()
            break
        except Exception:
            continue
    html = ACTIVATION_TOOL_HTML.replace("/*__SHA256__*/", sha_src).replace("__SECRET__", ACTIVATION_SECRET)
    return HTMLResponse(content=html)


# ---------------------------------------------------------------------------
@api_router.get("/")
async def root():
    return {"message": "DermaLens AI API"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    # Keeps the hourly rate-limit count fast as the log grows.
    await db.analysis_logs.create_index([("user_id", 1), ("created_at", -1)])
    await db.analysis_logs.create_index([("activation_device_id", 1), ("created_at", -1)])
    # Deletion records and throttling entries expire on their own.
    await db.account_deletions.create_index(
        "deleted_at", expireAfterSeconds=DELETION_RECORD_RETENTION_DAYS * 24 * 3600
    )
    await db.deletion_attempts.create_index("created_at", expireAfterSeconds=DELETION_ATTEMPT_WINDOW_MINUTES * 60)
    await db.subscriptions.create_index([("user_id", 1), ("productId", 1)], unique=True)
    # Un-finished sign-ups and the send counter clean themselves up.
    await db.pending_signups.create_index("email", unique=True)
    await db.pending_signups.create_index("created_at", expireAfterSeconds=3600)
    await db.signup_code_sends.create_index("created_at", expireAfterSeconds=3600)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
