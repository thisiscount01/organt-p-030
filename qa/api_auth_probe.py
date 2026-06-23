"""인증·커뮤니티 API 경로 집중 진단"""
import json, ssl, urllib.request, urllib.error, time

BASE = "https://organt-p-030.onrender.com"
_ssl = ssl.create_default_context()
_ssl.check_hostname = False
_ssl.verify_mode = ssl.CERT_NONE

def req(method, path, data=None, token=None):
    h = {"Accept": "application/json, text/plain, */*", "User-Agent": "QA-probe"}
    if data: h["Content-Type"] = "application/json"
    if token: h["Authorization"] = f"Bearer {token}"
    try:
        r = urllib.request.urlopen(
            urllib.request.Request(BASE+path, data=json.dumps(data).encode() if data else None, headers=h, method=method),
            timeout=25, context=_ssl)
        body = r.read().decode(errors='replace')
        try: body = json.loads(body)
        except: pass
        return r.status, body
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors='replace')
        try: body = json.loads(body)
        except: pass
        return e.code, body
    except Exception as ex:
        return None, str(ex)

print("=== 1. API 루트 구조 ===")
for p in ["/api/", "/api/v1/", "/api/v1/books/?page_size=3"]:
    s, b = req("GET", p)
    print(f"  [{s}] {p}: {str(b)[:200]}")

print("\n=== 2. 계정 엔드포인트 탐색 ===")
ts = str(int(time.time()))[-6:]
USER, EMAIL, PW = f"qap{ts}", f"qap{ts}@q.test", "Qap99!xyz"

signup_paths = [
    "/api/v1/accounts/signup/",
    "/api/v1/auth/signup/",
    "/api/auth/signup/",
    "/api/v1/accounts/register/",
]
for p in signup_paths:
    s, b = req("POST", p, {"username": USER, "email": EMAIL, "password1": PW, "password2": PW})
    print(f"  [{s}] POST {p}: {str(b)[:300]}")
    if s and 200 <= s < 300:
        print(f"  >>> 회원가입 성공! 경로={p}")
        break

print("\n=== 3. 로그인 엔드포인트 ===")
login_paths = [
    "/api/v1/accounts/login/",
    "/api/v1/auth/login/",
    "/api/auth/login/",
    "/api/v1/token/",
    "/api/token/",
]
for p in login_paths:
    s, b = req("POST", p, {"username": USER, "password": PW})
    print(f"  [{s}] POST {p}: {str(b)[:300]}")
    if s and 200 <= s < 300:
        token = b.get("access") if isinstance(b, dict) else None
        print(f"  >>> 로그인 성공! token={'있음' if token else '없음'}, keys={list(b.keys()) if isinstance(b, dict) else '?'}")
        break

print("\n=== 4. 커뮤니티 API 경로 ===")
comm_paths = [
    "/api/v1/community/posts/",
    "/api/v1/posts/",
    "/api/posts/",
    "/api/v1/community/",
    "/api/community/",
    "/api/community/posts/",
]
for p in comm_paths:
    sg, bg = req("GET", p)
    sp, bp = req("POST", p, {"title": "t", "content": "c"})
    print(f"  GET [{sg}] {p}: {str(bg)[:100]}")
    print(f"  POST(no-auth) [{sp}] {p}: {str(bp)[:100]}")
    if sg and sg < 400:
        print(f"  >>> 커뮤니티 GET 동작 경로 발견!")
        break

print("\n=== 5. 회원가입 UI 폼 필드 확인 ===")
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(ignore_https_errors=True)
    page = ctx.new_page()

    page.goto(BASE + "/#/signup", timeout=20000, wait_until="domcontentloaded")
    page.wait_for_timeout(3000)

    inputs = page.query_selector_all("input")
    print(f"  #/signup 폼 inputs: {len(inputs)}개")
    for inp in inputs:
        name = inp.get_attribute("name") or inp.get_attribute("id") or inp.get_attribute("placeholder") or "?"
        t = inp.get_attribute("type") or "text"
        print(f"    input name={name} type={t}")

    # 실제 폼 제출 시도 (UI)
    try:
        page.fill("input[type='text'], input[name='username']", USER)
    except: pass
    try:
        page.fill("input[name='email'], input[type='email']", EMAIL)
    except: pass
    try:
        for pw_inp in page.query_selector_all("input[type='password']"):
            pw_inp.fill(PW)
    except: pass

    screenshot_path = "/home/user/organt_workspace/p-030-13-pjt/qa/signup_form.png"
    page.screenshot(path=screenshot_path)
    print(f"  스크린샷 저장: {screenshot_path}")

    # 버튼 클릭
    try:
        btn = page.query_selector("button[type='submit'], button:has-text('가입'), button:has-text('회원가입'), button:has-text('Sign')")
        if btn:
            btn.click()
            page.wait_for_timeout(2000)
            final_url = page.url
            body = page.inner_text("body")[:400]
            print(f"  회원가입 버튼 클릭 후 URL: {final_url}")
            print(f"  본문: {body.replace(chr(10),' ')[:300]}")
    except Exception as ex:
        print(f"  버튼 클릭 오류: {ex}")

    browser.close()
