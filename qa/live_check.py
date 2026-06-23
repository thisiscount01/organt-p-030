"""
BookWise Live QA — https://organt-p-030.onrender.com
항목: 1.초기로드 2.한국도서 3.로그인/가입 4.커뮤니티차단 5.콘솔에러 6.fixture확인
"""
import sys, time, json, os, urllib.request, urllib.error, ssl
from playwright.sync_api import sync_playwright

# SSL 검증 비활성화 (환경 인증서 미설치)
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE

def api_get(url, token=None):
    headers = {"Accept": "application/json", "User-Agent": "QA-bot/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    return urllib.request.urlopen(req, timeout=25, context=_ssl_ctx)

def api_post(url, payload_dict, token=None):
    headers = {"Content-Type": "application/json", "User-Agent": "QA-bot/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    payload = json.dumps(payload_dict).encode()
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    return urllib.request.urlopen(req, timeout=20, context=_ssl_ctx)

BASE_URL = "https://organt-p-030.onrender.com"
WS_ROOT = "/home/user/organt_workspace/p-030-13-pjt"
results = {}

def log(msg):
    print(msg, flush=True)

# ────────────────────────────────────────────────────────
# 6. 로컬 Fixture 파일 확인 (네트워크 불필요)
# ────────────────────────────────────────────────────────
log("=== 6. Fixture 파일 확인 ===")
fixture_files = []
for root, dirs, files in os.walk(WS_ROOT):
    dirs[:] = [d for d in dirs if d not in ["node_modules", "__pycache__", ".git"]]
    for f in files:
        if any(kw in f.lower() for kw in ["fixture", "books", "book"]):
            fp = os.path.join(root, f)
            fixture_files.append(fp)

for fp in fixture_files:
    size = os.path.getsize(fp)
    cnt = "?"
    if fp.endswith(".json"):
        try:
            with open(fp) as ff:
                d = json.load(ff)
            cnt = len(d) if isinstance(d, list) else f"dict({len(d)}keys)"
        except Exception as e:
            cnt = f"파싱오류({e})"
    log(f"  {fp.replace(WS_ROOT, '.')}  [{size//1024}KB, records={cnt}]")
results["6_fixture"] = {"file_count": len(fixture_files), "paths": [fp.replace(WS_ROOT, '.') for fp in fixture_files]}

# data/books.json 상세
try:
    with open(os.path.join(WS_ROOT, "data/books.json")) as f:
        all_books = json.load(f)
    korean_cnt = len(all_books)
    sample = [b.get("title","?") for b in all_books[:3]]
    log(f"  data/books.json 총 {korean_cnt}권 | 샘플: {sample}")
    results["6_fixture"]["data_books_count"] = korean_cnt
except Exception as e:
    log(f"  data/books.json 읽기 실패: {e}")


# ────────────────────────────────────────────────────────
# Playwright 브라우저 검증
# ────────────────────────────────────────────────────────
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(ignore_https_errors=True)
    page = ctx.new_page()

    console_errors = []
    page.on("console", lambda msg: console_errors.append(f"[{msg.type.upper()}] {msg.text}") if msg.type in ("error", "warning") else None)
    page.on("pageerror", lambda err: console_errors.append(f"[PAGEERROR] {err}"))

    # ── 1. 초기 로드 (Render cold-start 감안 90초) ──
    log("\n=== 1. 초기 로드 ===")
    t0 = time.time()
    try:
        page.goto(BASE_URL, timeout=90000, wait_until="domcontentloaded")
        page.wait_for_timeout(4000)   # JS 렌더링 대기
        elapsed = round(time.time() - t0, 1)
        title = page.title()
        final_url = page.url
        body_snippet = page.inner_text("body")[:300].replace("\n", " ")
        log(f"  로드 시간: {elapsed}s")
        log(f"  제목: {title} | URL: {final_url}")
        log(f"  본문 앞부분: {body_snippet}")
        results["1_load"] = {"pass": True, "elapsed_s": elapsed, "title": title, "url": final_url}
    except Exception as e:
        elapsed = round(time.time() - t0, 1)
        log(f"  FAIL ({elapsed}s): {e}")
        results["1_load"] = {"pass": False, "elapsed_s": elapsed, "error": str(e)}
        browser.close()
        print("\n[최종결과]", json.dumps(results, ensure_ascii=False, indent=2))
        sys.exit(1)

    # ── 2. 한국 도서 표시 확인 ──
    log("\n=== 2. 한국 도서 ===")
    try:
        # API로 총권수 확인
        korean_count_api = None
        for api_path in ["/api/v1/books/?page_size=1", "/api/books/?limit=1", "/api/books/"]:
            try:
                resp = api_get(BASE_URL + api_path)
                data = json.loads(resp.read())
                # DRF PageNumberPagination
                count = data.get("count", data.get("total", None))
                if count is not None:
                    korean_count_api = int(count)
                    log(f"  API {api_path} → count={korean_count_api}")
                    break
                elif isinstance(data, list):
                    log(f"  API {api_path} → list len={len(data)}")
                    korean_count_api = len(data)
                    break
                else:
                    log(f"  API {api_path} → keys={list(data.keys())[:8]}")
            except urllib.error.HTTPError as he:
                log(f"  API {api_path} → HTTP {he.code}")
            except Exception as ex:
                log(f"  API {api_path} → {ex}")

        # 브라우저에서 도서 목록 페이지 렌더링 확인
        for books_path in ["/", "/books", "/books/"]:
            try:
                r = page.goto(BASE_URL + books_path, timeout=20000, wait_until="domcontentloaded")
                page.wait_for_timeout(3000)
                # 다양한 카드 셀렉터 시도
                selectors = [".book-card", ".book-item", "[class*='book']", ".card", "article", ".col-md-3", ".col-sm-6"]
                card_counts = {}
                for sel in selectors:
                    cnt = len(page.query_selector_all(sel))
                    if cnt > 0:
                        card_counts[sel] = cnt
                text_sample = page.inner_text("body")[:500].replace("\n", " ")
                has_korean = any(ord(c) >= 0xAC00 for c in text_sample)
                log(f"  {books_path} → status={r.status}, 카드={card_counts}, 한글있음={has_korean}")
                if r.status < 400:
                    break
            except Exception as ex:
                log(f"  {books_path} → {ex}")

        pass_flag = korean_count_api >= 200 if korean_count_api is not None else None
        results["2_korean_books"] = {
            "pass": pass_flag,
            "api_count": korean_count_api,
            "local_fixture_count": results["6_fixture"].get("data_books_count"),
        }
    except Exception as e:
        log(f"  FAIL: {e}")
        results["2_korean_books"] = {"pass": False, "error": str(e)}

    # ── 3. 회원가입 → 로그인 → 로그아웃 ──
    log("\n=== 3. 로그인/회원가입 ===")
    try:
        ts = str(int(time.time()))[-6:]
        TEST_USER = f"qabot{ts}"
        TEST_EMAIL = f"qabot{ts}@qa.test"
        TEST_PW = "QaTest9!x"

        # 회원가입 UI 페이지 존재 여부
        signup_ui = False
        for sp in ["/accounts/signup/", "/signup/", "/register/"]:
            try:
                r = page.goto(BASE_URL + sp, timeout=15000, wait_until="domcontentloaded")
                page.wait_for_timeout(1500)
                if r.status < 400:
                    body = page.inner_text("body")
                    if any(kw in body for kw in ["회원가입", "signup", "register", "Register", "username", "email"]):
                        log(f"  회원가입 UI: {sp} (status={r.status}) ✓")
                        signup_ui = True
                        break
                    else:
                        log(f"  {sp} → status={r.status} 있으나 폼 없음")
            except Exception as ex:
                log(f"  {sp} → {ex}")

        # API 회원가입
        signup_ok = False
        signup_error = ""
        for asp in [
            "/api/v1/accounts/signup/",
            "/api/v1/accounts/register/",
            "/api/accounts/signup/",
            "/auth/registration/",
        ]:
            try:
                resp = api_post(BASE_URL + asp, {
                    "username": TEST_USER, "email": TEST_EMAIL,
                    "password1": TEST_PW, "password2": TEST_PW
                })
                data = json.loads(resp.read())
                log(f"  회원가입 API {asp} → OK keys={list(data.keys())}")
                signup_ok = True
                break
            except urllib.error.HTTPError as he:
                body = he.read().decode(errors='replace')
                log(f"  회원가입 {asp} → HTTP {he.code}: {body[:200]}")
                signup_error = f"HTTP {he.code}"
            except Exception as ex:
                log(f"  회원가입 {asp} → {ex}")

        # API 로그인
        access_token = None
        login_ok = False
        for lp in [
            "/api/v1/accounts/login/",
            "/api/accounts/login/",
            "/auth/login/",
        ]:
            try:
                resp = api_post(BASE_URL + lp, {"username": TEST_USER, "password": TEST_PW})
                data = json.loads(resp.read())
                access_token = data.get("access", data.get("token", data.get("key")))
                login_ok = True
                log(f"  로그인 {lp} → OK, access_token={'있음' if access_token else '없음(키='+ str(list(data.keys()))+')'}")
                break
            except urllib.error.HTTPError as he:
                body = he.read().decode(errors='replace')
                log(f"  로그인 {lp} → HTTP {he.code}: {body[:200]}")
                # email 필드로 재시도
                if he.code == 400 and "email" in body.lower():
                    try:
                        resp = api_post(BASE_URL + lp, {"email": TEST_EMAIL, "password": TEST_PW})
                        data = json.loads(resp.read())
                        access_token = data.get("access", data.get("token", data.get("key")))
                        login_ok = True
                        log(f"  로그인(email 필드) {lp} → OK")
                        break
                    except Exception as ex2:
                        log(f"  로그인(email 재시도) → {ex2}")
            except Exception as ex:
                log(f"  로그인 {lp} → {ex}")

        # 로그아웃 API
        logout_ok = False
        if login_ok and access_token:
            for logoutp in ["/api/v1/accounts/logout/", "/api/accounts/logout/", "/auth/logout/"]:
                try:
                    resp = api_post(BASE_URL + logoutp, {}, token=access_token)
                    log(f"  로그아웃 {logoutp} → HTTP {resp.status}")
                    logout_ok = True
                    break
                except urllib.error.HTTPError as he:
                    log(f"  로그아웃 {logoutp} → HTTP {he.code}")
                except Exception as ex:
                    log(f"  로그아웃 {logoutp} → {ex}")

        results["3_auth"] = {
            "pass": signup_ok and login_ok,
            "signup_ui": signup_ui,
            "signup_api": signup_ok,
            "login_api": login_ok,
            "token_received": bool(access_token),
            "logout_api": logout_ok,
        }
    except Exception as e:
        log(f"  FAIL: {e}")
        results["3_auth"] = {"pass": False, "error": str(e)}

    # ── 4. 커뮤니티 비로그인 차단 ──
    log("\n=== 4. 커뮤니티 비로그인 차단 ===")
    try:
        # UI: 커뮤니티 글쓰기 페이지 접근 시 리다이렉트/차단 확인
        for cp in ["/community/create/", "/community/new/", "/community/"]:
            try:
                r = page.goto(BASE_URL + cp, timeout=15000, wait_until="domcontentloaded")
                page.wait_for_timeout(1500)
                final_url = page.url
                body = page.inner_text("body")
                redirected = final_url != (BASE_URL + cp)
                has_login_hint = any(kw in body for kw in ["로그인", "login", "Login", "sign in", "인증", "권한"])
                log(f"  UI {cp} → status={r.status}, redirected={redirected}({final_url}), login_hint={has_login_hint}")
            except Exception as ex:
                log(f"  UI {cp} → {ex}")

        # API: 비인증 POST
        block_status = None
        for api_cp in ["/api/v1/community/posts/", "/api/community/posts/", "/api/v1/community/"]:
            try:
                try:
                    resp = api_post(BASE_URL + api_cp, {"title": "비로그인테스트", "content": "차단확인"})
                    body = json.loads(resp.read())
                    log(f"  API POST {api_cp} → 200 OK (차단 미작동!): {str(body)[:100]}")
                    block_status = "not_blocked"
                    break
                except urllib.error.HTTPError as he:
                    log(f"  API POST {api_cp} → HTTP {he.code} (차단{'✓' if he.code in [401,403] else '?'})")
                    block_status = f"HTTP_{he.code}"
                    if he.code in [401, 403]:
                        break
            except Exception as ex:
                log(f"  API POST {api_cp} → {ex}")

        blocked = block_status and block_status.startswith("HTTP_4")
        results["4_community_block"] = {
            "pass": blocked,
            "api_response": block_status,
        }
    except Exception as e:
        log(f"  FAIL: {e}")
        results["4_community_block"] = {"pass": False, "error": str(e)}

    # ── 5. 콘솔 에러 (메인 재방문) ──
    log("\n=== 5. 콘솔 에러 ===")
    try:
        page.goto(BASE_URL, timeout=30000, wait_until="domcontentloaded")
        page.wait_for_timeout(4000)
        critical = [e for e in console_errors if any(kw in e for kw in ["TypeError", "ReferenceError", "SyntaxError", "Uncaught", "PAGEERROR"])]
        log(f"  전체 에러/경고: {len(console_errors)}개, 치명적: {len(critical)}개")
        for err in console_errors[:15]:
            log(f"    {err[:140]}")
        results["5_console_errors"] = {
            "pass": len(critical) == 0,
            "total_errors": len(console_errors),
            "critical_count": len(critical),
            "samples": [e[:100] for e in critical[:5]],
        }
    except Exception as e:
        log(f"  FAIL: {e}")
        results["5_console_errors"] = {"pass": False, "error": str(e)}

    browser.close()

# ── 최종 요약 ──
log("\n" + "="*60)
log("최종 결과 JSON:")
log(json.dumps(results, ensure_ascii=False, indent=2))

# PASS/FAIL 표
log("\n--- PASS/FAIL 표 ---")
checks = [
    ("1. 초기 로드",        results.get("1_load", {}).get("pass")),
    ("2. 한국 도서 200+",   results.get("2_korean_books", {}).get("pass")),
    ("3. 로그인/회원가입",  results.get("3_auth", {}).get("pass")),
    ("4. 비로그인 차단",    results.get("4_community_block", {}).get("pass")),
    ("5. 콘솔 에러 없음",   results.get("5_console_errors", {}).get("pass")),
    ("6. Fixture 파일",     results.get("6_fixture", {}).get("file_count", 0) > 0),
]
for name, flag in checks:
    mark = "PASS" if flag else ("WARN" if flag is None else "FAIL")
    log(f"  {mark}  {name}")
