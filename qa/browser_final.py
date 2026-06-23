"""
브라우저 UI 최종 검증
- 회원가입 UI 폼 동작
- 커뮤니티 비로그인 차단 UI
- URL 5개 이상 다양성
- 콘솔 에러
"""
import time, json
from playwright.sync_api import sync_playwright

BASE = "https://organt-p-030.onrender.com"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(ignore_https_errors=True)
    page = ctx.new_page()

    console_errors = []
    console_all = []
    page.on("console", lambda m: [
        console_all.append(f"[{m.type}] {m.text}"),
        console_errors.append(f"[{m.type}] {m.text}") if m.type == "error" else None
    ])
    page.on("pageerror", lambda e: console_errors.append(f"[PAGEERROR] {e}"))

    def goto(path, wait=2000):
        r = page.goto(BASE + path, timeout=25000, wait_until="domcontentloaded")
        page.wait_for_timeout(wait)
        return r

    print("=== 1. 메인 페이지 로드 ===")
    r = goto("/", wait=3000)
    title = page.title()
    body = page.inner_text("body")[:300].replace("\n", " ")
    print(f"  [{r.status}] {BASE}/ | title={title}")
    print(f"  본문: {body}")

    print("\n=== URL 다양성 확인 ===")
    urls = ["/", "/#/books", "/#/community", "/#/recommendations", "/#/mood", "/#/calendar"]
    url_results = []
    for u in urls:
        try:
            r2 = page.goto(BASE + u, timeout=15000, wait_until="domcontentloaded")
            page.wait_for_timeout(1500)
            final = page.url
            t = page.title()[:40]
            h1s = [el.inner_text() for el in page.query_selector_all("h1, h2")[:2]]
            print(f"  [{r2.status}] {u} → {final} | {t} | headings={h1s[:2]}")
            url_results.append({"path": u, "status": r2.status, "title": t, "ok": r2.status < 400})
        except Exception as ex:
            print(f"  [ERR] {u}: {ex}")
            url_results.append({"path": u, "status": None, "ok": False})

    print("\n=== 회원가입 UI 폼 ===")
    goto("/#/signup", wait=2000)
    inputs = page.query_selector_all("input")
    print(f"  폼 inputs: {len(inputs)}개")
    for inp in inputs:
        attrs = {k: inp.get_attribute(k) for k in ["name", "id", "type", "placeholder"] if inp.get_attribute(k)}
        print(f"    {attrs}")
    btns = page.query_selector_all("button")
    for btn in btns[:3]:
        print(f"    button: {btn.inner_text()[:30]}")

    # 실제 회원가입 폼 제출
    ts = str(int(time.time()))[-6:]
    test_user = f"uiqa{ts}"
    test_email = f"uiqa{ts}@ui.test"
    test_pw = "UiTest9!"
    try:
        # username
        u_inp = page.query_selector("input[name='username'], input[placeholder*='사용자'], input[placeholder*='아이디']")
        if u_inp: u_inp.fill(test_user)
        # email
        e_inp = page.query_selector("input[type='email'], input[name='email'], input[placeholder*='이메일']")
        if e_inp: e_inp.fill(test_email)
        # password fields
        pw_inps = page.query_selector_all("input[type='password']")
        for pi in pw_inps: pi.fill(test_pw)
        print(f"  폼 입력 완료 (user={test_user}, email={test_email})")
        # submit
        submit_btn = page.query_selector("button[type='submit'], form button")
        if submit_btn:
            submit_btn.click()
            page.wait_for_timeout(2500)
            final_url = page.url
            body_after = page.inner_text("body")[:300].replace("\n", " ")
            print(f"  제출 후 URL: {final_url}")
            print(f"  제출 후 본문: {body_after}")
        else:
            print("  submit 버튼 못 찾음")
    except Exception as ex:
        print(f"  폼 테스트 오류: {ex}")

    print("\n=== 커뮤니티 비로그인 차단 UI ===")
    goto("/#/community", wait=2000)
    community_body = page.inner_text("body")[:500].replace("\n", " ")
    print(f"  커뮤니티 페이지 본문: {community_body}")
    # 글쓰기 버튼/링크 확인
    write_btns = page.query_selector_all("a[href*='create'], a[href*='write'], button:has-text('글쓰기'), button:has-text('작성'), a:has-text('글쓰기'), a:has-text('새 글')")
    print(f"  글쓰기 버튼/링크: {len(write_btns)}개")
    for wb in write_btns[:3]:
        print(f"    - {wb.inner_text()[:30]} | href={wb.get_attribute('href')}")

    goto("/#/community/create", wait=2000)
    create_body = page.inner_text("body")[:400].replace("\n", " ")
    create_url = page.url
    has_login_hint = any(kw in create_body for kw in ["로그인", "login", "Login", "인증", "권한"])
    print(f"  /community/create → URL={create_url}")
    print(f"  본문: {create_body}")
    print(f"  로그인 유도 문구: {has_login_hint}")

    print("\n=== 도서 목록 UI (한국어 도서 표시) ===")
    goto("/#/books", wait=3000)
    books_body = page.inner_text("body")[:800].replace("\n", " ")
    has_korean_books = any(ord(c) >= 0xAC00 for c in books_body)
    cards = page.query_selector_all(".book-card, .card, [class*='book-item'], article")
    print(f"  한글 도서 표시: {has_korean_books}")
    print(f"  카드 요소: {len(cards)}개")
    print(f"  본문 샘플: {books_body[:300]}")

    print("\n=== 콘솔 에러 요약 ===")
    critical = [e for e in console_errors if any(kw in e for kw in ["TypeError", "ReferenceError", "SyntaxError", "Uncaught", "PAGEERROR"])]
    ssl_errors = [e for e in console_errors if "SSL" in e or "certificate" in e.lower()]
    other_errors = [e for e in console_errors if e not in critical and e not in ssl_errors]
    print(f"  총 에러: {len(console_errors)}, 치명적: {len(critical)}, SSL: {len(ssl_errors)}, 기타: {len(other_errors)}")
    for e in critical[:5]:
        print(f"    {e[:120]}")
    for e in other_errors[:3]:
        print(f"    {e[:120]}")

    browser.close()

print("\n=== PASS/FAIL 최종 ===")
print(f"  URL 다양성 6개: {'PASS' if sum(1 for u in url_results if u['ok']) >= 5 else 'FAIL'}")
print(f"  콘솔 치명적 에러 없음: {'PASS' if len(critical)==0 else 'FAIL'}")
