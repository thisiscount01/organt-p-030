import urllib.request, urllib.parse, json, time

BASE = "http://localhost:3001"
TS = str(int(time.time()))

def post(path, data, headers={}):
    body = json.dumps(data).encode()
    req = urllib.request.Request(BASE+path, body, {"Content-Type":"application/json", **headers})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except:
            return e.code, {}

def get(path, headers={}):
    req = urllib.request.Request(BASE+path, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except:
            return e.code, {}

results = {}

# ① books.json 권수 확인
with open("data/books.json") as f:
    books_data = json.load(f)
total = len(books_data)
korean = [b for b in books_data if any('가' <= c <= '힣' for c in str(b.get('title','')))]
results['①'] = f"{'PASS' if total >= 200 else 'FAIL'} — 총 {total}권, 한국어 제목 {len(korean)}권"

# ② 회원가입
email = f"qa_{TS}@test.com"
code, body = post("/api/auth/register", {"username":f"qa_{TS}","email":email,"password":"Test1234!"})
reg_ok = code == 201
results['②_회원가입'] = f"{'PASS' if reg_ok else 'FAIL'} — HTTP {code}: {body.get('message','')}"

# ② 로그인
code, body = post("/api/auth/login", {"email":email,"password":"Test1234!"})
token = body.get("token","")
login_ok = code == 200 and bool(token)
results['②_로그인'] = f"{'PASS' if login_ok else 'FAIL'} — HTTP {code}: token={'있음('+str(len(token))+'자)' if token else '없음'}"

# ② 로그아웃
code2, body2 = post("/api/auth/logout", {}, {"Authorization": f"Bearer {token}"})
results['②_로그아웃'] = f"{'PASS' if code2 in (200,204) else 'FAIL'} — HTTP {code2}"

# ③ 비로그인 커뮤니티 글쓰기 차단
code, body = post("/api/community", {"title":"스팸","content":"테스트"})
results['③'] = f"{'PASS' if code in (401,403) else 'FAIL'} — HTTP {code} (기대: 401/403)"

# ④ AI 추천
code, body = get("/api/recommend?q=%EC%86%8C%EC%84%A4")
has_r = "results" in body
cnt = len(body.get("results",[]))
results['④'] = f"{'PASS' if code==200 and has_r else 'FAIL'} — HTTP {code}, results={'있음('+str(cnt)+'건)' if has_r else '없음'}"

# ⑤ 도서 목록 + 한국어 제목
code, body = get("/api/books?limit=5")
blist = body.get("data", body.get("items", body.get("books", body if isinstance(body, list) else [])))
kr_titles = [b.get("title","") for b in blist if any('가'<=c<='힣' for c in str(b.get("title","")))]
sample = kr_titles[0] if kr_titles else "없음"
results['⑤'] = f"{'PASS' if code==200 and kr_titles else 'FAIL'} — HTTP {code}, {len(blist)}권, 한국어제목:{len(kr_titles)}건 (샘플: {sample})"

# ⑥ 감정/기분 추천
code6a, b6a = get("/api/books/mood/%ED%96%89%EB%B3%B5")
mood_cnt = len(b6a.get("books", b6a.get("data", b6a if isinstance(b6a,list) else [])))
results['⑥_mood'] = f"{'PASS' if code6a==200 else 'FAIL'} — HTTP {code6a}, {mood_cnt}권 반환"

# ⑥ 독서 달력
code6b, b6b = get("/api/calendar", {"Authorization":f"Bearer {token}"})
results['⑥_calendar'] = f"{'PASS' if code6b in (200,) else 'FAIL'} — HTTP {code6b}"

# ⑥ 실시간 트렌드
code6c, b6c = get("/api/trending/realtime")
results['⑥_trending'] = f"{'PASS' if code6c==200 else 'FAIL'} — HTTP {code6c}"

import subprocess, os

def grep(pattern, filepath):
    try:
        r = subprocess.run(["grep", "-c", pattern, filepath], capture_output=True, text=True)
        return int(r.stdout.strip()) if r.returncode == 0 else 0
    except:
        return 0

# ⑦ 프론트엔드 grep 검증
appjs = "public/app.js"
stylecss = "public/style.css"

onerror_cnt  = grep("onerror", appjs) + grep("@error", appjs)
blur_cnt     = grep("blur", appjs)
filter_cnt   = grep("filter\|category", appjs)
mobile_cnt   = grep("max-width\|@media", stylecss)

results['⑦_onerror']  = f"{'PASS' if onerror_cnt>0 else 'FAIL'} — onerror/@error 패턴 {onerror_cnt}건"
results['⑦_blur']     = f"{'PASS' if blur_cnt>0 else 'FAIL'} — blur 이벤트 {blur_cnt}건"
results['⑦_filter']   = f"{'PASS' if filter_cnt>0 else 'FAIL'} — 카테고리/필터 {filter_cnt}건"
results['⑦_mobile']   = f"{'PASS' if mobile_cnt>0 else 'FAIL'} — 모바일CSS(@media/max-width) {mobile_cnt}건"

# ⑧ .env ALADIN_KEY 관리 여부
env_exists = os.path.exists(".env")
env_has_key = False
if env_exists:
    with open(".env") as f:
        env_has_key = "ALADIN" in f.read()
# server.js 에서 process.env.ALADIN 참조 여부
srv_ref = grep("ALADIN", "server.js")
results['⑧_env_file'] = f"{'PASS' if env_exists and env_has_key else 'FAIL'} — .env 존재:{env_exists}, ALADIN_KEY 포함:{env_has_key}"
results['⑧_srv_ref']  = f"{'PASS' if srv_ref>0 else 'FAIL'} — server.js 내 ALADIN 환경변수 참조 {srv_ref}건"

# 결과 출력
print("=== BookWise P-030 검증 결과 ===")
for k, v in results.items():
    print(f"  {k}: {v}")
