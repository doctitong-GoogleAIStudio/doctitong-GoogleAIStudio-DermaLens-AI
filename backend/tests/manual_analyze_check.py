"""Manual check of the secured /api/analyze route (run from /app)."""
import base64
import json
import sys
import time

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8001"
EMAIL = f"analyze-test-{int(time.time())}@example.com"
PASSWORD = "secret123"
IMG = base64.b64encode(open("/tmp/t.jpg", "rb").read()).decode()


def show(label, r):
    body = r.text[:300]
    print(f"{label}: HTTP {r.status_code} {body}")
    return r


with httpx.Client(timeout=180) as c:
    r = show("signup", c.post(f"{BASE}/api/auth/signup",
                              json={"full_name": "Analyze Test", "email": EMAIL, "password": PASSWORD}))
    token = r.json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}

    show("no auth (expect 401)", c.post(f"{BASE}/api/analyze",
                                        json={"images": [{"mimeType": "image/jpeg", "data": IMG}]}))
    show("bad activation key (expect 403)",
         c.post(f"{BASE}/api/analyze", headers={"X-Activation-Key": "AAAA-BBBB-CCCC-DDDD"},
                json={"images": [{"mimeType": "image/jpeg", "data": IMG}]}))
    show("bad mime (expect 422)",
         c.post(f"{BASE}/api/analyze", headers=auth,
                json={"images": [{"mimeType": "image/gif", "data": IMG}]}))
    show("data: prefix (expect 422)",
         c.post(f"{BASE}/api/analyze", headers=auth,
                json={"images": [{"mimeType": "image/jpeg", "data": "data:image/jpeg;base64,AAAA"}]}))
    show("5 images (expect 422)",
         c.post(f"{BASE}/api/analyze", headers=auth,
                json={"images": [{"mimeType": "image/jpeg", "data": IMG}] * 5}))

    t0 = time.time()
    r = c.post(f"{BASE}/api/analyze", headers=auth,
               json={"images": [{"mimeType": "image/jpeg", "data": IMG}],
                     "history": {"location": "left forearm", "duration": "3 weeks"}})
    print(f"analyze: HTTP {r.status_code} in {time.time() - t0:.1f}s")
    if r.status_code == 200:
        d = r.json()
        print("keys:", sorted(d.keys()))
        print(json.dumps(d.get("mostLikelyDiagnosis"), indent=2)[:500])
    else:
        print(r.text[:500])
