"""인증 API 경로만 빠르게 확인 (브라우저 없음)"""
import json, ssl, urllib.request, urllib.error, time

BASE = "https://organt-p-030.onrender.com"
_ssl = ssl.create_default_context()
_ssl.check_hostname = False
_ssl.verify_mode = ssl.CERT_NONE

def req(method, path, data=None, token=None):
    h = {"Accept": "application/json", "User-Agent": "QA"}
    if data: h["Content-Type"] = "application/json"
    if token: h["Authorization"] = f"Bearer {token}"
    try:
        r = urllib.request.urlopen(
            urllib.request.Request(BASE+path, data=json.dumps(data).encode() if data else None,
                                   headers=h, method=method),
            timeout=30, context=_ssl)
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

ts = str(int(time.time()))[-6:]
USER, EMAIL, PW = f"qap{ts}", f"qap{ts}@q.test", "Qap99!xyz"

print("=== API 루트 ===")
s, b = req("GET", "/api/v1/")
print(f"  /api/v1/ [{s}]: {str(b)[:200]}")
s, b = req("GET", "/api/v1/books/?page_size=2")
print(f"  /api/v1/books/ [{s}]: count={b.get('count') if isinstance(b,dict) else '?'}")

print("\n=== 회원가입 ===")
for p in ["/api/v1/accounts/signup/", "/api/v1/auth/signup/", "/api/auth/signup/"]:
    s, b = req("POST", p, {"username": USER, "email": EMAIL, "password1": PW, "password2": PW})
    print(f"  [{s}] {p}: {str(b)[:250]}")
    if s and 200 <= s < 300:
        print("  >>> SIGNUP OK")
        break

print("\n=== 로그인 ===")
token = None
for p in ["/api/v1/accounts/login/", "/api/v1/auth/login/", "/api/v1/token/"]:
    s, b = req("POST", p, {"username": USER, "password": PW})
    print(f"  [{s}] {p}: {str(b)[:250]}")
    if s and 200 <= s < 300 and isinstance(b, dict):
        token = b.get("access") or b.get("token") or b.get("key")
        print(f"  >>> LOGIN OK  token={'있음' if token else '없음'}")
        break

print("\n=== 커뮤니티 차단 ===")
for p in ["/api/v1/community/posts/", "/api/v1/posts/", "/api/community/posts/"]:
    sg, bg = req("GET", p)
    sp, bp = req("POST", p, {"title": "t", "content": "c"})
    print(f"  GET [{sg}] {p}: {str(bg)[:100]}")
    print(f"  POST(no-auth) [{sp}] {p}: {str(bp)[:100]}")
    if sg and sg < 400:
        print("  >>> 커뮤니티 경로 확인됨")
        break
