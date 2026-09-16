"""Public, unauthenticated HTML pages served by the API.

- Account deletion page  -> GET /api/account-deletion   (Google Play Console "Account deletion URL")
- Privacy policy page    -> GET /api/privacy-policy     (Google Play Console "Privacy policy URL")

The markup lives here so server.py stays focused on the API. Placeholders:
  __API_BASE__      "" when served by the backend itself (same origin); an absolute
                    backend URL when the page is copied to static hosting (see docs/).
  __SUPPORT_EMAIL__ from SUPPORT_EMAIL in backend/.env.
"""

APP_NAME = "DermaLens AI"
DEVELOPER_NAME = "aivicventures"
PLAY_SUBSCRIPTIONS_URL = "https://play.google.com/store/account/subscriptions"

_SHARED_CSS = """
  :root{--bg:#F6F8F7;--card:#FFFFFF;--fg:#111814;--muted:#5C7066;--brand:#3B6955;--brand-soft:#E4EFE9;
        --border:#E3EBE7;--danger:#B83A4B;--danger-soft:#FBEBED;--warn:#A67C00;--warn-soft:#FFF7E0}
  @media (prefers-color-scheme:dark){
    :root{--bg:#101412;--card:#181D1A;--fg:#E6EFEB;--muted:#8E9E96;--brand:#5C947A;--brand-soft:#1F2D26;
          --border:#2B3831;--danger:#E05A6B;--danger-soft:#2A1A1D;--warn:#D9A521;--warn-soft:#2A2410}
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;
       line-height:1.55;padding:24px 16px}
  main{max-width:720px;margin:0 auto}
  header{display:flex;align-items:center;gap:14px;margin-bottom:20px}
  .logo{width:48px;height:48px;border-radius:14px;background:var(--brand);display:flex;align-items:center;
        justify-content:center;color:#fff;font-weight:800;font-size:20px;flex:none}
  h1{font-size:22px;margin:0}
  .dev{color:var(--muted);font-size:14px;margin:2px 0 0}
  h2{font-size:17px;margin:26px 0 8px}
  h3{font-size:15px;margin:18px 0 6px}
  p,li{font-size:15px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px;margin:14px 0}
  .note{border-left:4px solid var(--warn);background:var(--warn-soft);border-radius:10px;padding:12px 14px;font-size:14px}
  .danger{border-left:4px solid var(--danger);background:var(--danger-soft);border-radius:10px;padding:12px 14px;font-size:14px}
  label{display:block;font-size:13px;color:var(--muted);margin:14px 0 6px}
  input,textarea{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--fg);border-radius:12px;
        padding:13px;font-size:16px;font-family:inherit}
  textarea{min-height:80px;resize:vertical}
  button{width:100%;margin-top:16px;border:0;border-radius:12px;padding:14px;font-size:16px;font-weight:700;cursor:pointer}
  .btn-danger{background:var(--danger);color:#fff}
  .btn-secondary{background:var(--brand-soft);color:var(--brand)}
  button[disabled]{opacity:.55;cursor:default}
  .check{display:flex;gap:10px;align-items:flex-start;margin-top:14px;font-size:14px}
  .check input{width:auto;margin-top:3px}
  .msg{margin-top:14px;font-size:14px;display:none;border-radius:10px;padding:12px 14px}
  .msg.ok{display:block;background:var(--brand-soft);color:var(--brand)}
  .msg.err{display:block;background:var(--danger-soft);color:var(--danger)}
  a{color:var(--brand)}
  footer{color:var(--muted);font-size:13px;margin-top:32px;text-align:center}
  details summary{cursor:pointer;font-weight:600}
"""

ACCOUNT_DELETION_HTML = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Delete your DermaLens AI account</title>
<style>__CSS__</style></head>
<body><main>
  <header>
    <div class="logo">D</div>
    <div><h1>Delete your DermaLens AI account</h1><p class="dev">DermaLens AI &middot; Developer: aivicventures</p></div>
  </header>

  <p>Use this page to permanently delete your <strong>DermaLens AI</strong> account and the personal data
  associated with it. You do not need the app installed.</p>

  <div class="card">
    <h2 style="margin-top:0">What happens when you delete your account</h2>
    <ul>
      <li>Your account (name, email address and password) is permanently deleted from our servers.</li>
      <li>Records linking you to AI analyses are de-identified, so they can no longer be associated with you.</li>
      <li>Any device-activation requests you made are deleted; activation records are de-identified.</li>
      <li>Skin photos, scan history, notes and reports are stored <em>only on your phone</em>. Deleting your account from this
          page cannot reach your phone: uninstall the app, or delete the account from inside the app, to remove them.</li>
      <li>Backup files you created yourself stay wherever you saved them.</li>
    </ul>
    <p><strong>Retained information.</strong> We keep a minimal deletion record (a one-way hash of your email address and the
    date of deletion) and de-identified usage counts for security, fraud-prevention, billing-dispute and legal purposes.
    Full details are in our <a href="__API_BASE__/api/privacy-policy">Privacy Policy</a>.</p>
  </div>

  <div class="note"><strong>Google Play subscription.</strong> Deleting your account does <u>not</u> cancel a DermaLens AI
  subscription. Subscriptions are billed and managed by Google Play. Cancel it first in
  <a href="__PLAY_SUBSCRIPTIONS_URL__" target="_blank" rel="noopener">Google Play &rarr; Payments &amp; subscriptions &rarr; Subscriptions</a>,
  otherwise Google will keep charging you until you do.</div>

  <div class="card">
    <h2 style="margin-top:0">Delete now with your email and password</h2>
    <p>Enter the email address and password you use to sign in to DermaLens AI. Deletion is immediate and cannot be undone.</p>
    <form id="deleteForm" autocomplete="off">
      <label for="email">Email address</label>
      <input id="email" type="email" required autocomplete="username" placeholder="you@example.com"/>
      <label for="password">Password</label>
      <input id="password" type="password" required autocomplete="current-password" placeholder="Your DermaLens AI password"/>
      <label class="check"><input id="ack" type="checkbox" required/>
        <span>I understand this permanently deletes my DermaLens AI account and associated personal data, and that any
        Google Play subscription must be cancelled separately.</span></label>
      <button class="btn-danger" id="deleteBtn" type="submit" disabled>Delete My Account and Data</button>
      <div class="msg" id="deleteMsg"></div>
    </form>
  </div>

  <div class="card">
    <details>
      <summary>Can't sign in? Request deletion instead</summary>
      <p>If you no longer know your password, submit a deletion request. We will verify ownership of the email address
      and complete the deletion within 30 days. You will not receive marketing email as a result of this request.</p>
      <form id="requestForm" autocomplete="off">
        <label for="reqEmail">Email address used for the account</label>
        <input id="reqEmail" type="email" required placeholder="you@example.com"/>
        <label for="reqNote">Anything we should know (optional)</label>
        <textarea id="reqNote" maxlength="500" placeholder="e.g. I created the account in June and no longer have the phone"></textarea>
        <button class="btn-secondary" type="submit">Submit deletion request</button>
        <div class="msg" id="requestMsg"></div>
      </form>
    </details>
  </div>

  <footer>DermaLens AI is developed by aivicventures. Questions: <a href="mailto:__SUPPORT_EMAIL__">__SUPPORT_EMAIL__</a><br/>
  <a href="__API_BASE__/api/privacy-policy">Privacy Policy</a></footer>
</main>
<script>
(function(){
  var API = "__API_BASE__";
  function show(el, ok, text){ el.className = "msg " + (ok ? "ok" : "err"); el.textContent = text; }
  async function post(path, body){
    var res = await fetch(API + path, {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body)});
    var json = {}; try { json = await res.json(); } catch(e){}
    return {status: res.status, json: json};
  }
  var ack = document.getElementById("ack"), btn = document.getElementById("deleteBtn");
  ack.addEventListener("change", function(){ btn.disabled = !ack.checked; });

  document.getElementById("deleteForm").addEventListener("submit", async function(ev){
    ev.preventDefault();
    var msg = document.getElementById("deleteMsg");
    if (!ack.checked) { show(msg, false, "Please tick the confirmation box first."); return; }
    if (!confirm("Are you sure you want to permanently delete your DermaLens AI account? Your account and associated personal data will be deleted, subject to any information that must be retained for legal, security, billing, fraud-prevention, or regulatory purposes.")) return;
    btn.disabled = true; btn.textContent = "Deleting…";
    try {
      var r = await post("/api/account-deletion", {
        email: document.getElementById("email").value.trim(),
        password: document.getElementById("password").value
      });
      if (r.status === 200) {
        show(msg, true, "Your DermaLens AI account and associated personal data have been deleted. If you have a Google Play subscription, remember to cancel it in Google Play.");
        document.getElementById("password").value = "";
      } else if (r.status === 401) {
        show(msg, false, "The email or password is incorrect. If you cannot sign in, use “Request deletion instead” below.");
      } else if (r.status === 404) {
        show(msg, false, "No DermaLens AI account exists for that email address. If your scans are on your phone, uninstalling the app removes them.");
      } else {
        show(msg, false, (r.json && r.json.detail) || "Something went wrong. Please try again later.");
      }
    } catch (e) {
      show(msg, false, "Could not reach the DermaLens AI server. Check your connection and try again.");
    } finally { btn.disabled = !ack.checked; btn.textContent = "Delete My Account and Data"; }
  });

  document.getElementById("requestForm").addEventListener("submit", async function(ev){
    ev.preventDefault();
    var msg = document.getElementById("requestMsg");
    try {
      var r = await post("/api/account-deletion/request", {
        email: document.getElementById("reqEmail").value.trim(),
        note: document.getElementById("reqNote").value.trim()
      });
      if (r.status === 202) show(msg, true, "Your deletion request has been received. We will process it within 30 days.");
      else show(msg, false, (r.json && r.json.detail) || "The request could not be submitted. Please try again later.");
    } catch (e) {
      show(msg, false, "Could not reach the DermaLens AI server. Check your connection and try again.");
    }
  });
})();
</script>
</body></html>"""

PRIVACY_POLICY_SHELL = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>DermaLens AI — Privacy Policy</title>
<style>__CSS__ h1{font-size:24px} h2{margin-top:30px} table{border-collapse:collapse;width:100%;font-size:14px}
th,td{border:1px solid var(--border);padding:8px;text-align:left;vertical-align:top} th{background:var(--brand-soft)}</style></head>
<body><main>
  <header>
    <div class="logo">D</div>
    <div><h1 style="font-size:22px">Privacy Policy</h1><p class="dev">DermaLens AI &middot; Developer: aivicventures</p></div>
  </header>
  <article>__BODY__</article>
  <footer><a href="__API_BASE__/api/account-deletion">Delete your account</a> &middot;
  <a href="__PLAY_SUBSCRIPTIONS_URL__" target="_blank" rel="noopener">Manage your Google Play subscription</a></footer>
</main></body></html>"""


def render_account_deletion_page(api_base: str = "", support_email: str = "") -> str:
    return (
        ACCOUNT_DELETION_HTML.replace("__CSS__", _SHARED_CSS)
        .replace("__API_BASE__", api_base.rstrip("/"))
        .replace("__PLAY_SUBSCRIPTIONS_URL__", PLAY_SUBSCRIPTIONS_URL)
        .replace("__SUPPORT_EMAIL__", support_email or "the support address on our Google Play listing")
    )


def render_privacy_policy_page(body_html: str, api_base: str = "") -> str:
    return (
        PRIVACY_POLICY_SHELL.replace("__CSS__", _SHARED_CSS)
        .replace("__BODY__", body_html)
        .replace("__API_BASE__", api_base.rstrip("/"))
        .replace("__PLAY_SUBSCRIPTIONS_URL__", PLAY_SUBSCRIPTIONS_URL)
    )
