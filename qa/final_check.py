"""
BookWise 라이브 최종 검증 — 실제 API 경로 기반
- 회원가입: POST /api/auth/register  (username, email, password)
- 로그인:  POST /api/auth/login     (email, password)
- 커뮤니티: POST /api/posts / POST /api/community (authMiddleware)
"""
import json, ssl, urllib.request, urllib.error, time

BASE = "https://organt-p-030.onrender.com"
_ssl = ssl.create_default_context()
_ssl.check_hostname = False
_ssl.verify_mode = ssl.CERT_NONE

def req(method, path, data=None, token=None):
    h = {"Accept": "application/json", "User-Agent": "QA-final"}
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
USER = f"qafinal{ts}"
EMAIL = f"qafinal{ts}@qa.test"
PW = "QaFinal9!"
token = None

print("=== 3-A. 회원가입 (/api/auth/register) ===")
s, b = req("POST", "/api/auth/register", {"username": USER, "email": EMAIL, "password": PW})
print(f"  [{s}] {str(b)[:300]}")
signup_ok = s == 201
if signup_ok:
    token = b.get("token") if isinstance(b, dict) else None
    print(f"  >>> SIGNUP OK  token={'있음' if token else '없음'}")

print("\n=== 3-B. 로그인 (/api/auth/login) ===")
s2, b2 = req("POST", "/api/auth/login", {"email": EMAIL, "password": PW})
print(f"  [{s2}] {str(b2)[:300]}")
login_ok = s2 == 200
if login_ok and not token:
    token = b2.get("token") if isinstance(b2, dict) else None
if login_ok:
    print(f"  >>> LOGIN OK  token={'있음' if token else '없음'}")

print("\n=== 3-C. /api/auth/me (토큰 검증) ===")
if token:
    s3, b3 = req("GET", "/api/auth/me", token=token)
    print(f"  [{s3}] {str(b3)[:200]}")
    me_ok = s3 == 200
    print(f"  >>> ME OK={me_ok}")
else:
    print("  토큰 없음 — 스킵")
    me_ok = False

print("\n=== 3-D. 로그아웃 (/api/auth/logout) ===")
s4, b4 = req("POST", "/api/auth/logout", {}, token=token)
print(f"  [{s4}] {str(b4)[:200]}")
logout_ok = s4 == 200

print("\n=== 4. 커뮤니티 비로그인 차단 (POST /api/posts, /api/community) ===")
for path in ["/api/posts", "/api/community"]:
    s, b = req("POST", path, {"title": "test", "content": "noauth"})
    blocked = s == 401
    print(f"  POST {path} (no auth) → [{s}] {str(b)[:100]}")
    print(f"  >>> 차단={'✓ PASS' if blocked else 'FAIL (예상: 401)'}")

print("\n=== 4-B. 로그인 후 글쓰기 (/api/posts) ===")
# 재로그인
s_re, b_re = req("POST", "/api/auth/login", {"email": EMAIL, "password": PW})
new_token = b_re.get("token") if isinstance(b_re, dict) else None
if new_token:
    sc, bc = req("POST", "/api/posts", {"title": "QA테스트 글", "content": "로그인 후 작성 테스트"}, token=new_token)
    print(f"  POST /api/posts (with auth) → [{sc}] {str(bc)[:200]}")
    print(f"  >>> 글쓰기={'✓ OK' if sc == 201 else 'FAIL'}")
else:
    print("  재로그인 실패 — 스킵")

print("\n=== 2. 도서 API 재확인 ===")
s5, b5 = req("GET", "/api/books?limit=5")
if isinstance(b5, dict):
    total = b5.get("total", b5.get("count", "?"))
    items = b5.get("items", b5.get("data", []))
    print(f"  /api/books → total={total}, items_sample={len(items)}")
    for bk in items[:3]:
        print(f"    - {bk.get('title','?')} | {bk.get('author','?')}")
else:
    print(f"  /api/books → [{s5}] {str(b5)[:200]}")

print("\n=== TF-IDF 추천 API 확인 ===")
# 첫 번째 도서 isbn으로 추천
s6, b6 = req("GET", "/api/books?limit=1")
if isinstance(b6, dict):
    items = b6.get("items", b6.get("data", []))
    if items:
        isbn = items[0].get("isbn13") or items[0].get("isbn") or items[0].get("id", "")
        sr, br = req("GET", f"/api/books/{isbn}/recommendations")
        if isinstance(br, dict):
            recs = br.get("items", [])
            print(f"  /api/books/{isbn}/recommendations → {len(recs)}개 추천")
            for r in recs[:2]:
                print(f"    score={r.get('score')}, reason={r.get('reason')}, title={r.get('title','?')[:30]}")
        else:
            print(f"  [{sr}] {str(br)[:200]}")

print("\n=== 기분 추천 API 확인 ===")
sm, bm = req("GET", "/api/books/mood/설렘")
if isinstance(bm, dict):
    print(f"  /api/books/mood/설렘 → {len(bm.get('items',[]))}개 | genres={bm.get('genres')}")
else:
    print(f"  [{sm}] {str(bm)[:200]}")

print("\n=== API /api/health ===")
sh, bh = req("GET", "/api/health")
print(f"  [{sh}] {bh}")

print("\n=== 최종 인증 요약 ===")
print(f"  회원가입: {'PASS' if signup_ok else 'FAIL'}")
print(f"  로그인:   {'PASS' if login_ok else 'FAIL'}")
print(f"  /me:      {'PASS' if me_ok else 'FAIL'}")
print(f"  로그아웃: {'PASS' if logout_ok else 'FAIL'}")
