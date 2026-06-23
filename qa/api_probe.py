"""API 엔드포인트 상세 진단 — signup/login/community 경로 탐색"""
import json, ssl, urllib.request, urllib.error

BASE = "https://organt-p-030.onrender.com"

_ssl = ssl.create_default_context()
_ssl.check_hostname = False
_ssl.verify_mode = ssl.CERT_NONE

def get(path, token=None):
    h = {"Accept": "application/json", "User-Agent": "QA-probe"}
    if token: h["Authorization"] = f"Bearer {token}"
    try:
        resp = urllib.request.urlopen(
            urllib.request.Request(BASE+path, headers=h), timeout=20, context=_ssl)
        return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors='replace')
        return e.code, body
    except Exception as ex:
        return None, str(ex)

def post(path, data, token=None):
    h = {"Content-Type": "application/json", "User-Agent": "QA-probe"}
    if token: h["Authorization"] = f"Bearer {token}"
    try:
        resp = urllib.request.urlopen(
            urllib.request.Request(BASE+path, data=json.dumps(data).encode(), headers=h, method="POST"),
            timeout=20, context=_ssl)
        return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors='replace')
        return e.code, body[:400]
    except Exception as ex:
        return None, str(ex)

def p(label, status, body):
    body_s = str(body)[:300] if body else ""
    print(f"  [{status}] {label}: {body_s}")

print("=== API 구조 탐색 ===")
for path in ["/api/", "/api/v1/", "/api/v1/accounts/", "/api/v1/books/",
             "/api/v1/community/", "/api/v1/community/posts/"]:
    s, b = get(path)
    p(path, s, b)

print("\n=== 계정 API ===")
import time
ts = str(int(time.time()))[-6:]
USER = f"qascan{ts}"
EMAIL = f"qascan{ts}@q.test"
PW = "Scan99!abc"

for path in ["/api/v1/accounts/signup/", "/api/v1/accounts/register/",
             "/auth/registration/", "/accounts/api/signup/"]:
    s, b = post(path, {"username": USER, "email": EMAIL, "password1": PW, "password2": PW})
    p(f"POST {path}", s, b)

print("\n=== 로그인 API ===")
for path in ["/api/v1/accounts/login/", "/api/v1/accounts/token/",
             "/auth/login/", "/api/token/"]:
    s, b = post(path, {"username": USER, "password": PW})
    p(f"POST {path}", s, b)

print("\n=== 커뮤니티 차단 세부 ===")
for path in ["/api/v1/community/posts/", "/api/v1/community/articles/",
             "/api/v1/posts/", "/community/api/posts/"]:
    # GET
    sg, bg = get(path)
    p(f"GET  {path}", sg, bg)
    # POST 비인증
    sp, bp = post(path, {"title": "test", "content": "test"})
    p(f"POST {path} (no auth)", sp, bp)

print("\n=== URL 존재 여부 스캔 ===")
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(ignore_https_errors=True)
    page = ctx.new_page()
    for path in ["/", "/books", "/books/1", "/community", "/community/create",
                 "/recommendations", "/profile", "/mood", "/calendar", "/login", "/signup"]:
        try:
            r = page.goto(BASE+path, timeout=12000, wait_until="domcontentloaded")
            page.wait_for_timeout(1000)
            final = page.url
            t = page.title()[:40]
            print(f"  [{r.status}] {path} → {final} | {t}")
        except Exception as ex:
            print(f"  [ERR] {path}: {ex}")
    browser.close()
