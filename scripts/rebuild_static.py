"""
public/data/books.json 와 recommendations.json 을
data/books.json(알라딘 한국 도서) 기반으로 재생성합니다.
"""
import json, math, re, os, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC  = os.path.join(BASE, 'data', 'books.json')
DEST_BOOKS = os.path.join(BASE, 'public', 'data', 'books.json')
DEST_RECS  = os.path.join(BASE, 'public', 'data', 'recommendations.json')

print(f'[rebuild] 소스: {SRC}')
books = json.load(open(SRC, encoding='utf-8'))
print(f'[rebuild] 로드 완료: {len(books)}권')

# ── 프론트 형식으로 변환 ─────────────────────────────────────
def convert(b, i):
    isbn13 = b.get('isbn13') or b.get('isbn') or str(i+1)
    isbn   = b.get('isbn') or isbn13
    genre_raw = b.get('categoryName') or ''
    parts = [p.strip() for p in genre_raw.split('>') if p.strip()]
    genre = parts[1:] if len(parts) > 1 else parts
    if not genre:
        genre = ['일반']
    desc = (b.get('description') or '').strip()
    if not desc:
        cat = parts[-1] if parts else '일반'
        desc = (f"{b.get('author','저자 미상')}의 {cat} 도서입니다. "
                f"알라딘 판매지수 {b.get('salesPoint',0):,}점의 도서입니다.")
    pub_year = None
    if b.get('pubDate'):
        try: pub_year = int(str(b['pubDate'])[:4])
        except: pass
    avg_rating = round((b.get('customerReviewRank') or 0) / 2, 1)
    return {
        'id':            isbn13,
        'isbn':          isbn,
        'isbn13':        isbn13,
        'title':         b.get('title') or '',
        'author':        b.get('author') or 'Unknown',
        'authors':       [b.get('author') or 'Unknown'],
        'publisher':     b.get('publisher') or '',
        'pubDate':       b.get('pubDate') or '',
        'published_year': pub_year,
        'genre':         genre,
        'cover_url':     b.get('cover') or '',
        'description':   desc,
        'subjects':      genre,
        'average_rating': avg_rating,
        'price':         b.get('price') or b.get('priceStandard') or 0,
        'salesPoint':    b.get('salesPoint') or 0,
        'categoryName':  genre_raw,
        'link':          b.get('link') or '',
        'language':      'ko',
    }

converted = [convert(b, i) for i, b in enumerate(books)]
print(f'[rebuild] 변환 완료: {len(converted)}권')

# ── public/data/books.json 저장 ───────────────────────────────
os.makedirs(os.path.join(BASE, 'public', 'data'), exist_ok=True)
with open(DEST_BOOKS, 'w', encoding='utf-8') as f:
    json.dump(converted, f, ensure_ascii=False, indent=2)
print(f'[rebuild] books.json 저장 완료 → {DEST_BOOKS}')

# ── TF-IDF 벡터 빌드 ──────────────────────────────────────────
def tokenize(text):
    text = re.sub(r'[^가-힣a-z0-9]', ' ', text.lower())
    return [t for t in text.split() if len(t) >= 2]

N = len(books)
doc_terms = []
for b in books:
    text = ' '.join([
        b.get('title',''),
        b.get('author',''),
        (b.get('categoryName','') or '').replace('>', '  '),
        (b.get('description','') or '')[:400]
    ])
    freq = {}
    for t in tokenize(text):
        freq[t] = freq.get(t, 0) + 1
    doc_terms.append(freq)

df = {}
for freq in doc_terms:
    for term in freq:
        df[term] = df.get(term, 0) + 1

vecs = []
for freq in doc_terms:
    total = sum(freq.values()) or 1
    vec = {}
    for term, cnt in freq.items():
        idf = math.log((N + 1) / (df.get(term, 1) + 1)) + 1
        vec[term] = (cnt / total) * idf
    vecs.append(vec)
print(f'[rebuild] TF-IDF 벡터 빌드 완료: {len(vecs)}권')

def cosine(a, b):
    keys = set(a.keys()) & set(b.keys())
    if not keys: return 0.0
    dot = sum(a[k] * b[k] for k in keys)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return min(dot / (na * nb), 1.0) if na and nb else 0.0

def make_reason(tier, cat_a, cat_b):
    a_parts = [p.strip() for p in (cat_a or '').split('>') if len(p.strip()) > 1]
    b_parts = [p.strip() for p in (cat_b or '').split('>') if len(p.strip()) > 1]
    common = [g for g in a_parts if g in b_parts]
    if common: return f"'{', '.join(common[:2])}' 장르 독자에게 추천합니다."
    if tier == 'high': return '내용과 문체가 높은 연관성을 가진 도서입니다.'
    if tier == 'mid':  return '부분적으로 비슷한 주제를 다루는 도서입니다.'
    return '새로운 장르를 탐험해보세요.'

recs = {}
for i, cb in enumerate(converted):
    bid = cb['isbn13']
    va  = vecs[i]
    scores = sorted(
        [(j, cosine(va, vecs[j])) for j in range(N) if j != i],
        key=lambda x: -x[1]
    )
    tier_fn = lambda s: 'high' if s >= 0.6 else ('mid' if s >= 0.4 else 'low')
    recs[bid] = [
        {
            'id':           converted[j]['isbn13'],
            'isbn':         converted[j]['isbn'],
            'isbn13':       converted[j]['isbn13'],
            'title':        converted[j]['title'],
            'author':       converted[j]['author'],
            'cover':        converted[j]['cover_url'],
            'cover_url':    converted[j]['cover_url'],
            'categoryName': books[j].get('categoryName', ''),
            'score':        round(s, 4),
            'tier':         tier_fn(s),
            'reason':       make_reason(tier_fn(s),
                                        books[i].get('categoryName',''),
                                        books[j].get('categoryName','')),
        }
        for j, s in scores[:8]
    ]
    if i % 100 == 0:
        print(f'  추천 계산 중... {i}/{N}')

with open(DEST_RECS, 'w', encoding='utf-8') as f:
    json.dump(recs, f, ensure_ascii=False, separators=(',', ':'))
print(f'[rebuild] recommendations.json 저장 완료 ({len(recs)}권) → {DEST_RECS}')
print('[rebuild] 완료!')
