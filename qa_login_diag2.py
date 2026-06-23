import urllib.request
import urllib.error
import json
import time

BASE = "https://organt-p-030.onrender.com"

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

ts = str(int(time.time()))[-6:]
user = f"qatest{ts}"
email = f"qatest{ts}@bookwise.io"
pw = "Qatest1234!"  # 8자 이상, 복잡도 포함

print(f"신규 계정: username={user}, email={email}, pw={pw}")

# 1. 회원가입 (8자 이상 패스워드)
print("\n[1] 회원가입")
s, b = post("/api/auth/register", {"username": user, "password": pw, "email": email})
print(f"  HTTP {s} | {b[:400]}")

if s not in (200, 201):
    print("  => 회원가입 실패, 중단")
    exit(1)

print("  => 회원가입 PASS")

# 2. email로 로그인
print("\n[2] email로 로그인")
s, b = post("/api/auth/login", {"email": email, "password": pw})
print(f"  HTTP {s} | {b[:500]}")
token = None
try:
    d = json.loads(b)
    token = d.get("token") or d.get("access_token") or d.get("accessToken")
    print(f"  token (first 80): {str(token)[:80] if token else 'NONE'}")
    print(f"  keys: {list(d.keys())}")
except:
    pass

if not token:
    # 3. username으로 로그인 재시도
    print("\n[3] username으로 로그인 재시도")
    s, b = post("/api/auth/login", {"username": user, "password": pw})
    print(f"  HTTP {s} | {b[:500]}")
    try:
        d = json.loads(b)
        token = d.get("token") or d.get("access_token") or d.get("accessToken")
        print(f"  token: {str(token)[:80] if token else 'NONE'}")
        print(f"  keys: {list(d.keys())}")
    except:
        pass

# 4. 토큰으로 포스팅
if token:
    print("\n[4] 인증 포스팅 (Bearer token)")
    s, b = post("/api/posts",
                {"title": f"QA글{ts}", "content": "BookWise QA 자동화 검증 포스트"},
                {"Authorization": f"Bearer {token}"})
    print(f"  HTTP {s} | {b[:300]}")
    verdict = "PASS" if s == 201 else f"FAIL (HTTP {s})"
    print(f"  => 인증 포스팅 {verdict}")
else:
    print("\n[4] 토큰 없음 — FAIL")

# 5. 비로그인 포스팅
print("\n[5] 비로그인 POST /api/posts")
s, b = post("/api/posts", {"title": "무인가", "content": "차단 확인"})
print(f"  HTTP {s} | {b[:200]}")
verdict = "PASS" if s in (401, 403) else f"FAIL (HTTP {s})"
print(f"  => 비로그인 차단 {verdict}")

print("\n완료")
