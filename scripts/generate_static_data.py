"""
books.json + recommendations.json 정적 파일 생성.
TF-IDF 코사인 유사도 top-5 추천 계산.
실행: python scripts/generate_static_data.py
"""
import os, sys, json, math

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django
django.setup()

from books.models import Book

OUT = os.path.join(BASE, "public", "data")
os.makedirs(OUT, exist_ok=True)


def cosine(a, b):
    common = set(a) & set(b)
    if not common:
        return 0.0
    dot = sum(a[t] * b[t] for t in common)
    na = math.sqrt(sum(v**2 for v in a.values()))
    nb = math.sqrt(sum(v**2 for v in b.values()))
    return min(dot / (na * nb), 1.0) if na and nb else 0.0


def tier(s):
    return "high" if s >= 0.6 else ("mid" if s >= 0.4 else "low")


def reason(t, ga, gb):
    m = set(ga) & set(gb)
    if m:
        return f"'{', '.join(sorted(m)[:2])}' 장르 독자에게 추천합니다."
    return {"high": "내용과 문체가 높은 연관성을 가진 도서입니다.",
            "mid": "부분적으로 비슷한 주제를 다루는 도서입니다."}.get(t, "새로운 장르를 탐험해보세요.")


def auto_desc(title, authors, genres):
    a = authors[0] if authors else "저자 미상"
    g = ", ".join(genres[:3]) if genres else "일반"
    return f"{a}의 {g} 도서입니다. '{title}'은(는) 독자들에게 풍부한 통찰을 선사합니다."


books = list(Book.objects.prefetch_related("authors", "genres").all())
print(f"books: {len(books)}")

# books.json
rows = []
for b in books:
    gg = [g.name for g in b.genres.all()]
    aa = [a.name for a in b.authors.all()]
    cover = b.cover_url or (f"https://covers.openlibrary.org/b/isbn/{b.isbn.replace('-','')}-M.jpg" if b.isbn else "")
    rows.append({
        "id": str(b.id),
        "title": b.title,
        "author": aa[0] if aa else "Unknown",
        "authors": aa,
        "genre": gg,
        "isbn": b.isbn or "",
        "cover_url": cover,
        "description": b.description or auto_desc(b.title, aa, gg),
        "subjects": gg,
        "published_year": b.published_year,
        "average_rating": round(b.average_rating or 0.0, 2),
    })

with open(os.path.join(OUT, "books.json"), "w", encoding="utf-8") as f:
    json.dump(rows, f, ensure_ascii=False, indent=2)
print(f"books.json: {len(rows)} books")

# TF-IDF vectors
vecs = {}
for b in books:
    try:
        vecs[b.id] = json.loads(b.tfidf_vector_json) if b.tfidf_vector_json and b.tfidf_vector_json != "{}" else {}
    except Exception:
        vecs[b.id] = {}

genres_map = {b.id: [g.name for g in b.genres.all()] for b in books}

# recommendations.json
recs = {}
for b in books:
    va = vecs[b.id]
    ga = genres_map[b.id]
    scores = sorted(
        [(o, cosine(va, vecs[o.id])) for o in books if o.id != b.id],
        key=lambda x: x[1], reverse=True
    )[:5]
    recs[str(b.id)] = [{
        "id": str(o.id),
        "score": round(s, 4),
        "tier": tier(s),
        "reason": reason(tier(s), ga, genres_map[o.id]),
    } for o, s in scores]

with open(os.path.join(OUT, "recommendations.json"), "w", encoding="utf-8") as f:
    json.dump(recs, f, ensure_ascii=False, indent=2)
print(f"recommendations.json: {len(recs)} books")
print("done")
