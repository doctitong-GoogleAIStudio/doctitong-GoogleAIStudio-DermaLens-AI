import os
import re
import io
import hmac
import hashlib
import json
import logging
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import jwt
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, Depends, HTTPException, status
from fastapi.responses import HTMLResponse, Response
from starlette.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from passlib.context import CryptContext
from bson import ObjectId

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent, TextDelta, StreamDone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "43200"))

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
GEMINI_MODEL = "gemini-3.1-pro-preview"

EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "AI Dermatologist")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "")
# Must stay in sync with ACTIVATION_SECRET in frontend/src/device.ts.
# The fallback guarantees the offline generator keeps producing valid keys even if
# the env var is not present in the deployed environment.
ACTIVATION_SECRET = os.environ.get("ACTIVATION_SECRET") or "DERM-ACT-2026-x7Qp9Lm3Vt8Bz1Ns"

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
    password: str = Field(min_length=6, max_length=128)


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


class AnalyzeIn(BaseModel):
    images: List[str] = Field(min_length=1, max_length=6)  # base64 (may include data URI prefix)


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


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@api_router.post("/auth/signup", response_model=TokenOut, status_code=201)
async def signup(data: SignupIn):
    email = normalized_email(str(data.email))
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    user = {
        "full_name": data.full_name.strip(),
        "email": email,
        "password_hash": pwd_context.hash(data.password),
        "created_at": datetime.now(timezone.utc),
    }
    result = await db.users.insert_one(user)
    user["_id"] = result.inserted_id
    pu = public_user(user)
    return TokenOut(access_token=create_access_token(pu.id), user=pu)


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


# ---------------------------------------------------------------------------
# AI Analysis
# ---------------------------------------------------------------------------
ANALYSIS_SYSTEM = (
    "You are an expert AI dermatologist assisting with preliminary, educational visual analysis "
    "of skin lesion photographs. You never claim certainty and always include a medical disclaimer.\n\n"
    "First, assess the quality of the provided image(s) for clinical analysis. Rate quality as "
    "'Excellent', 'Good', 'Fair', or 'Poor' based on lighting, focus/clarity and framing, with brief "
    "feedback. Then analyze the morphology of the lesion(s) (color, shape, border, size, texture) and "
    "identify key features based ONLY on the visual information. Do not ask for more information.\n\n"
    "Respond with a SINGLE valid JSON object and NOTHING ELSE (no markdown, no code fences). "
    "Use exactly this shape:\n"
    "{\n"
    '  "imageQuality": { "score": "Excellent|Good|Fair|Poor", "feedback": "string" },\n'
    '  "mostLikelyDiagnosis": { "conditionName": "string", "confidence": "High|Medium|Low", '
    '"description": "string", "urgency": "Routine|Requires Prompt Attention|Urgent", "urgencyReason": "string" },\n'
    '  "differentialDiagnoses": [ { "conditionName": "string", "confidence": "High|Medium|Low", "description": "string" } ],\n'
    '  "nextSteps": [ "string" ],\n'
    '  "disclaimer": "string"\n'
    "}\n"
    "The disclaimer must clearly state this is an AI-generated analysis and not a substitute for "
    "professional medical advice."
)


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


@api_router.post("/analyze")
async def analyze(data: AnalyzeIn, current_user: PublicUser = Depends(get_current_user)):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="AI service not configured.")

    image_contents = []
    for img in data.images:
        b64 = img.split(",", 1)[1] if img.strip().startswith("data:") else img
        image_contents.append(ImageContent(image_base64=b64))

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"derm-{current_user.id}-{datetime.now(timezone.utc).timestamp()}",
        system_message=ANALYSIS_SYSTEM,
    ).with_model("gemini", GEMINI_MODEL)

    prompt = ("Analyze the attached skin lesion image(s) and return the JSON described in your "
              "instructions. Return ONLY the JSON object.")
    message = UserMessage(text=prompt, file_contents=image_contents)

    try:
        buf = ""
        async for ev in chat.stream_message(message):
            if isinstance(ev, TextDelta):
                buf += ev.content
            elif isinstance(ev, StreamDone):
                break
    except Exception as e:
        logger.error(f"AI analysis error: {e}")
        raise HTTPException(status_code=502, detail="The AI service failed. Please try again.")

    try:
        result = _extract_json(buf)
    except Exception:
        logger.error(f"Failed to parse AI JSON: {buf[:500]}")
        raise HTTPException(status_code=502, detail="The AI returned an invalid response. Please try again.")

    return result


# ---------------------------------------------------------------------------
# Device activation
# ---------------------------------------------------------------------------
def _activation_email_html(full_name: str, email: str, device_id: str, key: str) -> str:
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
        f'<tr><td style="padding:8px 0;color:#5C7066">Activation key</td><td style="padding:8px 0;font-family:monospace"><strong>{escape(key)}</strong></td></tr>'
        '</table>'
        '<p style="margin:16px 0 0;font-size:13px;color:#5C7066">After payment is confirmed via GCash, send the '
        'activation key above to the user. You can also regenerate it any time using the offline activation '
        'generator tool.</p>'
        f'<p style="font-size:12px;color:#8E9E96;margin-top:24px">Sent by {escape(EMAIL_FROM_NAME)}. '
        'We never ask for your password or card details by email.</p>'
        '</td></tr></table>'
    )


@api_router.post("/device/request-activation")
async def request_activation(data: ActivationRequestIn, current_user: PublicUser = Depends(get_current_user)):
    device_id = data.device_id.strip().upper()
    key = make_activation_key(device_id)

    await db.activation_requests.insert_one({
        "user_id": current_user.id,
        "full_name": current_user.full_name,
        "email": current_user.email,
        "device_id": device_id,
        "activation_key": key,
        "created_at": datetime.now(timezone.utc),
    })

    if EMAIL_KEY and ADMIN_EMAIL:
        payload = {
            "to": [ADMIN_EMAIL],
            "subject": f"Device activation request \u2014 {current_user.full_name}",
            "html": _activation_email_html(current_user.full_name, current_user.email, device_id, key),
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

    name = re.sub(r"[^A-Za-z0-9._-]", "-", data.filename or "AiDerma-Report.pdf")
    if not name.lower().endswith(".pdf"):
        name = f"{name}.pdf"

    return Response(
        content=buf.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )




ACTIVATION_TOOL_HTML = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>AI Dermatologist \u2014 Offline Activation Generator</title>
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
    a.download='aiderma-activation-log.csv';
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
    return {"message": "AI Dermatologist API"}


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


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
