"""BookWise API 통합 검증 스크립트"""
import urllib.request, json, sys

BASE = "http://localhost:3000"

def get(path):
    try:
        with urllib.request.urlopen(BASE + path, timeout=8) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"__error__": str(e)}

def post(path, data=None, headers=None):
    body = json.dumps(data or {}).encode()
    h = {"Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(BASE + path, data=body, headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"__status__": e.code, **json.loads(e.read())}

results = []

# 1. /api/books
d = get("/api/books")
results.append(f"1. /api/books → total={d.get('total','ERR')}, lang={d.get('items',[{}])[0].get('language','?')}")

# 2. /api/books?q=소설
d = get("/api/books?q=%EC%86%8C%EC%84%A4")
results.append(f"2. /api/books?q=소설 → total={d.get('total','ERR')}")

# 3. /api/books?mood=설렘
d = get("/api/books?mood=%EC%84%A4%EB%A0%98")
results.append(f"3. /api/books?mood=설렘 → total={d.get('total','ERR')}")

# 4. /api/books/:id (단건)
first_id = get("/api/books").get("items",[{}])[0].get("isbn13","")
d = get(f"/api/books/{first_id}")
results.append(f"4. /api/books/{first_id[:16]}... → title={d.get('title','ERR')[:20]}, recs={len(d.get('recommendations',[]))}")

# 5. /api/books/trending
d = get("/api/books/trending")
results.append(f"5. /api/books/trending → items={len(d.get('items',[]))}")

# 6. /api/books/mood/열정
d = get("/api/books/mood/%EC%97%B4%EC%A0%95")
results.append(f"6. /api/books/mood/열정 → mood={d.get('mood','ERR')}, items={len(d.get('items',[]))}")

# 7. /api/books/search?q=파친코
d = get("/api/books/search?q=%ED%8C%8C%EC%B9%9C%EC%BD%94")
results.append(f"7. /api/books/search?q=파친코 → total={d.get('total',d.get('__error__','ERR'))}, items={len(d.get('items',[]))}")

# 8. JWT: register
d = post("/api/auth/register", {"username":"e2etest","email":"e2e@bookwise.kr","password":"pass1234"})
results.append(f"8. register → {d.get('message', d.get('error','ERR'))}")

# 9. JWT: login
d = post("/api/auth/login", {"email":"e2e@bookwise.kr","password":"pass1234"})
token = d.get("token","")
results.append(f"9. login → token_len={len(token)}, user={d.get('user',{}).get('username','ERR')}")

# 10. /api/auth/me
if token:
    req = urllib.request.Request(BASE + "/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            d = json.loads(r.read())
            results.append(f"10. /api/auth/me → {d.get('user',{}).get('username','ERR')}")
    except Exception as e:
        results.append(f"10. /api/auth/me → ERR: {e}")
else:
    results.append("10. /api/auth/me → 토큰 없음")

# 11. 비로그인 POST /api/posts → 401
d = post("/api/posts", {"title":"x","content":"x"})
results.append(f"11. POST /api/posts (비로그인) → status={d.get('__status__','200?')}, err={d.get('error','none')}")

# 12. 로그인 후 POST /api/posts → 201
if token:
    body = json.dumps({"title":"검증 테스트글","content":"JWT 인증 확인"}).encode()
    req = urllib.request.Request(BASE + "/api/posts", data=body,
        headers={"Content-Type":"application/json","Authorization":f"Bearer {token}"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            d = json.loads(r.read())
            results.append(f"12. POST /api/posts (로그인) → id={d.get('id')}, author={d.get('author')}")
    except urllib.error.HTTPError as e:
        results.append(f"12. POST /api/posts → HTTP {e.code}")

# 13. /api/auth/logout
d = post("/api/auth/logout")
results.append(f"13. logout → {d.get('message','ERR')}")

# 14. /api/recommendations?bookId=
d = get(f"/api/recommendations?bookId={first_id}")
results.append(f"14. /api/recommendations?bookId → type={d.get('type','ERR')}, items={len(d.get('items',[]))}")

# 15. /api/trending/realtime
d = get("/api/trending/realtime")
results.append(f"15. /api/trending/realtime → categories={d.get('total_categories','ERR')}")

# 16. GET /api/calendar (인증)
if token:
    req = urllib.request.Request(BASE + "/api/calendar", headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            d = json.loads(r.read())
            results.append(f"16. GET /api/calendar → total={d.get('total','ERR')}")
    except Exception as e:
        results.append(f"16. GET /api/calendar → ERR: {e}")

# 17. POST /api/calendar
if token:
    body = json.dumps({"isbn":first_id,"bookTitle":"테스트","date":"2026-06-23","status":"done"}).encode()
    req = urllib.request.Request(BASE + "/api/calendar", data=body,
        headers={"Content-Type":"application/json","Authorization":f"Bearer {token}"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            d = json.loads(r.read())
            results.append(f"17. POST /api/calendar → id={d.get('id')}, status={d.get('status')}")
    except urllib.error.HTTPError as e:
        results.append(f"17. POST /api/calendar → HTTP {e.code}")

# 18. /api/stats
d = get("/api/stats")
results.append(f"18. /api/stats → books={d.get('total_books')}, algo={d.get('algorithm','ERR')[:30]}")

print("\n".join(results))
