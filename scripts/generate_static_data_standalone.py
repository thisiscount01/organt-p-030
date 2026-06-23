"""
books.json + recommendations.json 정적 파일 생성 (Django 불필요 — 순수 sqlite3).
실행: python3 scripts/generate_static_data_standalone.py
"""
import os
import sys
import json
import math
import sqlite3

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB   = os.path.join(BASE, "db.sqlite3")
OUT  = os.path.join(BASE, "public", "data")
os.makedirs(OUT, exist_ok=True)

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
cur  = conn.cursor()

# ── 1. 테이블명 확인 ──────────────────────────────────────────────────
cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [r[0] for r in cur.fetchall()]
print("tables:", tables)

# 예상 테이블명 (Django app_label + model_name)
BOOK_TABLE   = "books_book"
AUTHOR_TABLE = "books_author"
GENRE_TABLE  = "books_genre"
BOOK_AUTHOR  = "books_book_authors"   # ManyToMany
BOOK_GENRE   = "books_book_genres"    # ManyToMany

for t in [BOOK_TABLE, AUTHOR_TABLE, GENRE_TABLE, BOOK_AUTHOR, BOOK_GENRE]:
    if t not in tables:
        print(f"WARNING: 테이블 '{t}' 없음 — 실제 테이블 목록 확인 필요")

# ── 2. 전체 책 로드 ───────────────────────────────────────────────────
cur.execute(f"SELECT * FROM {BOOK_TABLE}")
books_raw = cur.fetchall()
print(f"books: {len(books_raw)}")

# ── 3. 저자 / 장르 매핑 ───────────────────────────────────────────────
cur.execute(f"SELECT ba.book_id, a.name FROM {BOOK_AUTHOR} ba JOIN {AUTHOR_TABLE} a ON ba.author_id = a.id")
author_map: dict[int, list[str]] = {}
for book_id, name in cur.fetchall():
    author_map.setdefault(book_id, []).append(name)

cur.execute(f"SELECT bg.book_id, g.name FROM {BOOK_GENRE} bg JOIN {GENRE_TABLE} g ON bg.genre_id = g.id")
genre_map: dict[int, list[str]] = {}
for book_id, name in cur.fetchall():
    genre_map.setdefault(book_id, []).append(name)

# ── 4. TF-IDF 벡터 파싱 ──────────────────────────────────────────────
cols = [description[0] for description in cur.description] if books_raw else []
# books_raw 컬럼 재확인
cur.execute(f"PRAGMA table_info({BOOK_TABLE})")
col_info = {row[1]: row[0] for row in cur.fetchall()}  # name -> cid

def get_col(row, name, default=None):
    try:
        return row[name]
    except (IndexError, KeyError):
        return default

vecs: dict[int, dict] = {}
for b in books_raw:
    raw = get_col(b, "tfidf_vector_json", "{}")
    try:
        vecs[b["id"]] = json.loads(raw) if raw and raw != "{}" else {}
    except Exception:
        vecs[b["id"]] = {}

# ── 5. 코사인 유사도 ─────────────────────────────────────────────────
def cosine(a: dict, b: dict) -> float:
    common = set(a) & set(b)
    if not common:
        return 0.0
    dot = sum(a[t] * b[t] for t in common)
    na  = math.sqrt(sum(v**2 for v in a.values()))
    nb  = math.sqrt(sum(v**2 for v in b.values()))
    return min(dot / (na * nb), 1.0) if na and nb else 0.0

def tier(s: float) -> str:
    return "high" if s >= 0.6 else ("mid" if s >= 0.4 else "low")

def reason(t: str, ga: list, gb: list) -> str:
    m = set(ga) & set(gb)
    if m:
        return f"'{', '.join(sorted(m)[:2])}' 장르 독자에게 추천합니다."
    return {
        "high": "내용과 문체가 높은 연관성을 가진 도서입니다.",
        "mid":  "부분적으로 비슷한 주제를 다루는 도서입니다.",
    }.get(t, "새로운 장르를 탐험해보세요.")

def auto_desc(title: str, authors: list, genres: list) -> str:
    a = authors[0] if authors else "저자 미상"
    g = ", ".join(genres[:3]) if genres else "일반"
    return f"{a}의 {g} 도서입니다. '{title}'은(는) 독자들에게 풍부한 통찰을 선사합니다."

# ── 6. books.json ─────────────────────────────────────────────────────
rows = []
for b in books_raw:
    bid  = b["id"]
    aa   = author_map.get(bid, [])
    gg   = genre_map.get(bid, [])
    isbn = get_col(b, "isbn") or ""
    cover = get_col(b, "cover_url") or ""
    if not cover and isbn:
        cover = f"https://covers.openlibrary.org/b/isbn/{isbn.replace('-','')}-M.jpg"
    rows.append({
        "id":             str(bid),
        "title":          get_col(b, "title", ""),
        "author":         aa[0] if aa else "Unknown",
        "authors":        aa,
        "genre":          gg,
        "isbn":           isbn,
        "cover_url":      cover,
        "description":    get_col(b, "description") or auto_desc(get_col(b, "title", ""), aa, gg),
        "subjects":       gg,
        "published_year": get_col(b, "published_year"),
        "average_rating": round(get_col(b, "average_rating") or 0.0, 2),
    })

books_json_path = os.path.join(OUT, "books.json")
with open(books_json_path, "w", encoding="utf-8") as f:
    json.dump(rows, f, ensure_ascii=False, indent=2)
print(f"books.json: {len(rows)} books → {books_json_path}")

# ── 7. recommendations.json ───────────────────────────────────────────
book_ids = [b["id"] for b in books_raw]
recs: dict[str, list] = {}
for b in books_raw:
    bid = b["id"]
    va  = vecs[bid]
    ga  = genre_map.get(bid, [])
    scores = sorted(
        [(oid, cosine(va, vecs[oid])) for oid in book_ids if oid != bid],
        key=lambda x: x[1], reverse=True
    )[:5]
    recs[str(bid)] = [{
        "id":     str(oid),
        "score":  round(s, 4),
        "tier":   tier(s),
        "reason": reason(tier(s), ga, genre_map.get(oid, [])),
    } for oid, s in scores]

recs_json_path = os.path.join(OUT, "recommendations.json")
with open(recs_json_path, "w", encoding="utf-8") as f:
    json.dump(recs, f, ensure_ascii=False, indent=2)
print(f"recommendations.json: {len(recs)} books → {recs_json_path}")

conn.close()
print("done")
