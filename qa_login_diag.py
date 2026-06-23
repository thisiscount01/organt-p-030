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

ts = str(int(time.time()))[-5:]
user = f"qa{ts}"
email = f"qa{ts}@test.com"
pw = "qapass1"

print(f"신규 계정 사용: username={user}, email={email}, pw={pw}")

# 1. 신규 회원가입
print("\n[1] 신규 회원가입")
s, b = post("/api/auth/register", {"username": user, "password": pw, "email": email})
print(f"  HTTP {s} | {b}")

# 2. email로 로그인 시도
print("\n[2] email로 로그인")
s, b = post("/api/auth/login", {"email": email, "password": pw})
print(f"  HTTP {s} | {b[:400]}")
token = None
try:
    d = json.loads(b)
    token = d.get("token") or d.get("access_token") or d.get("accessToken")
    print(f"  token: {str(token)[:80] if token else 'NONE'}")
    print(f"  keys: {list(d.keys())}")
except:
    pass

# 3. username으로 로그인 시도
if not token:
    print("\n[3] username으로 로그인")
    s, b = post("/api/auth/login", {"username": user, "password": pw})
    print(f"  HTTP {s} | {b[:400]}")
    try:
        d = json.loads(b)
        token = d.get("token") or d.get("access_token") or d.get("accessToken")
        print(f"  token: {str(token)[:80] if token else 'NONE'}")
        print(f"  keys: {list(d.keys())}")
    except:
        pass

# 4. 토큰으로 포스팅
if token:
    print("\n[4] 토큰으로 POST /api/posts")
    s, b = post("/api/posts", {"title": f"QA글{ts}", "content": "QA 검증용 포스트"}, {"Authorization": f"Bearer {token}"})
    print(f"  HTTP {s} | {b[:300]}")
    if s == 201:
        print("  => 인증 포스팅 PASS")
    else:
        print(f"  => 인증 포스팅 FAIL (HTTP {s})")
else:
    print("\n[4] 토큰 없음 — 포스팅 건너뜀")

# 5. 비로그인 포스팅 재확인
print("\n[5] 비로그인 POST /api/posts (401/403 기대)")
s, b = post("/api/posts", {"title": "무인가글", "content": "차단되어야 함"})
print(f"  HTTP {s} | {b[:200]}")
