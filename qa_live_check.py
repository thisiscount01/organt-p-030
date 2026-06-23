import urllib.request
import urllib.error
import json

BASE = "https://organt-p-030.onrender.com"

def get(path, headers=None):
    url = BASE + path
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode()
            return r.status, body
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return e.code, body
    except Exception as ex:
        return 0, str(ex)

def post(path, data, headers=None):
    url = BASE + path
    payload = json.dumps(data).encode()
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=payload, headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode()
            return r.status, body
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return e.code, body
    except Exception as ex:
        return 0, str(ex)

results = []

# ① 한국 도서 200권 이상
print("=== ① 한국 도서 200권 이상 ===")
status, body = get("/api/books?limit=1")
print(f"  HTTP {status}")
print(f"  Body (first 400): {body[:400]}")
try:
    data = json.loads(body)
    total = data.get("total", data.get("count", "KEY_NOT_FOUND"))
    print(f"  total 값: {total}")
    if isinstance(total, int) and total >= 200:
        results.append(("① 한국도서 200권+", "PASS", f"total={total}"))
    else:
        results.append(("① 한국도서 200권+", "FAIL", f"total={total} (200 미만 또는 키 없음)"))
except Exception as ex:
    results.append(("① 한국도서 200권+", "FAIL", f"JSON 파싱 실패: {ex} / body={body[:100]}"))

# ② JWT 인증
print("\n=== ② JWT 인증 ===")

# 회원가입
print("  [회원가입]")
status, body = post("/api/auth/register", {"username":"qatester","password":"qapass1","email":"qa@test.com"})
print(f"  HTTP {status} | {body[:300]}")
if status in (200, 201):
    results.append(("② 회원가입", "PASS", f"HTTP {status}"))
elif status == 409:
    results.append(("② 회원가입", "PASS(이미존재)", f"HTTP {status} — 이전 테스트에서 생성됨"))
else:
    results.append(("② 회원가입", "FAIL", f"HTTP {status} {body[:100]}"))

# 로그인
print("  [로그인]")
status, body = post("/api/auth/login", {"username":"qatester","password":"qapass1"})
print(f"  HTTP {status} | {body[:400]}")
token = None
try:
    data = json.loads(body)
    token = data.get("token") or data.get("access_token") or data.get("accessToken")
    print(f"  token (first 60): {str(token)[:60] if token else 'NOT FOUND'}")
    print(f"  응답 keys: {list(data.keys())}")
    if token:
        results.append(("② 로그인/토큰", "PASS", f"token 발급 OK (HTTP {status})"))
    else:
        results.append(("② 로그인/토큰", "FAIL", f"HTTP {status} token 키 없음, keys={list(data.keys())}"))
except Exception as ex:
    results.append(("② 로그인/토큰", "FAIL", f"JSON 파싱 실패: {ex} / body={body[:100]}"))

# 비로그인 POST /api/posts → 401/403 기대
print("  [비로그인 포스팅]")
status, body = post("/api/posts", {"title":"t","content":"c"})
print(f"  HTTP {status} | {body[:200]}")
if status in (401, 403):
    results.append(("② 비로그인 차단", "PASS", f"HTTP {status}"))
else:
    results.append(("② 비로그인 차단", "FAIL", f"HTTP {status} (401/403 기대) | {body[:80]}"))

# 로그인 토큰으로 POST /api/posts → 201
if token:
    print("  [토큰으로 포스팅]")
    status, body = post("/api/posts", {"title":"QA테스트글","content":"QA 자동 테스트 내용"}, {"Authorization": f"Bearer {token}"})
    print(f"  HTTP {status} | {body[:300]}")
    if status == 201:
        results.append(("② 인증 포스팅", "PASS", f"HTTP {status}"))
    else:
        results.append(("② 인증 포스팅", "FAIL", f"HTTP {status} | {body[:100]}"))
else:
    results.append(("② 인증 포스팅", "SKIP", "토큰 없어 건너뜀"))

# ③ 주요 페이지 HTTP 200
print("\n=== ③ 주요 페이지 ===")
pages = ["/", "/books", "/community", "/calendar"]
for page in pages:
    status, body = get(page)
    print(f"  {page}: HTTP {status} | {len(body)} bytes")
    if status == 200:
        results.append((f"③ {page}", "PASS", f"HTTP {status}, {len(body)}bytes"))
    else:
        results.append((f"③ {page}", "FAIL", f"HTTP {status}"))

# ④ splash 포함 여부
print("\n=== ④ splash 포함 여부 ===")
status, body = get("/")
count = body.count("bw-splash")
print(f"  '/' HTTP {status}, bw-splash count: {count}")
if count > 0:
    results.append(("④ splash(bw-splash)", "PASS", f"count={count}"))
else:
    results.append(("④ splash(bw-splash)", "FAIL", "bw-splash 미발견"))
    # 대신 splash 관련 다른 클래스 확인
    for kw in ["splash", "intro", "loading", "hero"]:
        n = body.lower().count(kw)
        if n > 0:
            print(f"    대안 키워드 '{kw}' 발견: {n}회")

# 최종 보고
print("\n" + "="*60)
print("최종 QA 결과 요약")
print("="*60)
for name, verdict, detail in results:
    icon = "PASS" if "PASS" in verdict else ("SKIP" if "SKIP" in verdict else "FAIL")
    print(f"  [{icon}] {name} — {detail}")

pass_cnt = sum(1 for _,v,_ in results if "PASS" in v)
fail_cnt = sum(1 for _,v,_ in results if "FAIL" in v)
skip_cnt = sum(1 for _,v,_ in results if "SKIP" in v)
print(f"\n  PASS {pass_cnt} / FAIL {fail_cnt} / SKIP {skip_cnt} / 총 {len(results)}")
