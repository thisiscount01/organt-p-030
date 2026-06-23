import urllib.request, urllib.error, json, random

BASE = "http://localhost:3000"

def req(method, path, body=None, headers=None):
    url = BASE + path
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    data = json.dumps(body).encode() if body else None
    rq = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(rq) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except:
            return e.code, {}
    except Exception as ex:
        return 0, {"error": str(ex)}

results = {}

# ① Books count
s, d = req("GET", "/api/books")
total = d.get("total", len(d.get("books", []))) if isinstance(d, dict) else 0
results["①"] = ("PASS" if total >= 200 else "FAIL", f"도서 {total}권")

# ② JWT register + login
rid = random.randint(10000, 99999)
email = f"qa{rid}@bw.com"
s_reg, d_reg = req("POST", "/api/auth/register", {"username": f"qa{rid}", "password": "test1234", "email": email})
s_login, d_login = req("POST", "/api/auth/login", {"email": email, "password": "test1234"})
token = d_login.get("token", "")
results["②"] = ("PASS" if token else "FAIL", f"토큰: {token[:30]}..." if token else "토큰 없음")

# ③ 비로그인 커뮤니티 글쓰기 → 401
s3, _ = req("POST", "/api/community", {"title": "t", "content": "c"})
results["③"] = ("PASS" if s3 == 401 else "FAIL", f"HTTP {s3}")

# ④ 로그인 후 글쓰기 → id+title 반환
if token:
    s4, d4 = req("POST", "/api/community", {"title": "인증글", "content": "로그인후작성"},
                 {"Authorization": f"Bearer {token}"})
    got_id = d4.get("id") or d4.get("post", {}).get("id")
    got_title = d4.get("title") or d4.get("post", {}).get("title")
    results["④"] = ("PASS" if got_id and got_title else "FAIL",
                    f"status={s4} id={got_id} title={got_title}")
else:
    results["④"] = ("FAIL", "토큰 없어 스킵")

# ⑤ MMR 추천 — 저자 중복 최대 2명
s5, bk = req("GET", "/api/books")
# /api/books 응답 구조: data 또는 items 키에 책 목록
books = bk.get("data", bk.get("items", bk.get("books", []))) if isinstance(bk, dict) else []
isbn = ""
for b in books:
    candidate = b.get("isbn13", b.get("isbn", ""))
    if candidate:
        isbn = candidate
        break
s5r, rec = req("GET", f"/api/books/{isbn}/recommendations")
items = rec.get("items", rec.get("recommendations", [])) if isinstance(rec, dict) else []
authors = [b.get("author", "") for b in items]
max_same = max((authors.count(a) for a in set(authors)), default=0)
rtype = rec.get("type", "") if isinstance(rec, dict) else ""
results["⑤"] = ("PASS" if len(items) >= 6 and max_same <= 2 else "FAIL",
                 f"count={len(items)} max_same_author={max_same} type={rtype} isbn={isbn}")

# ⑥ 독자 유형 API
s6, d6 = req("GET", "/api/recommendations/reader-type?genres=%ED%8C%90%ED%83%80%EC%A7%80,SF&count=5")
rt = d6.get("type", "") if isinstance(d6, dict) else ""
bks6 = d6.get("books", []) if isinstance(d6, dict) else []
results["⑥"] = ("PASS" if rt and len(bks6) >= 3 else "FAIL", f"type={rt} books={len(bks6)}")

# ⑦ 독서 달력 — 비로그인 401
s7, _ = req("GET", "/api/calendar")
results["⑦"] = ("PASS" if s7 == 401 else "FAIL", f"HTTP {s7}")

# ⑧ 트렌드 히트맵
s8, d8 = req("GET", "/api/trending/realtime")
results["⑧"] = ("PASS" if isinstance(d8, dict) and d8 else "FAIL",
                 f"keys={list(d8.keys())[:5] if isinstance(d8, dict) else 'not dict'}")

# ⑨ 기분 기반 추천 — 응답 키: items
s9, d9 = req("GET", "/api/books/mood/%ED%96%89%EB%B3%B5")
items9 = d9.get("items", d9.get("books", [])) if isinstance(d9, dict) else (d9 if isinstance(d9, list) else [])
results["⑨"] = ("PASS" if len(items9) >= 3 else "FAIL", f"MOOD RECS: {len(items9)}")

# ⑩ 라우트 5개 이상 — app.js grep (script will check separately)
results["⑩"] = ("SKIP", "grep으로 별도 확인")

# ⑪ .env 존재 — script will check separately
results["⑪"] = ("SKIP", "ls로 별도 확인")

print("\n======= QA 검증 결과 =======")
for k, (status, detail) in sorted(results.items()):
    icon = "PASS" if status == "PASS" else ("SKIP" if status == "SKIP" else "FAIL")
    print(f"[{icon}] {k}: {detail}")

passes = sum(1 for k, (s, d) in results.items() if s == "PASS")
total_checked = sum(1 for k, (s, d) in results.items() if s != "SKIP")
print(f"\n합계: {passes}/{total_checked} PASS (SKIP 제외)")
