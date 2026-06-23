/**
 * render_build.js — Render 빌드 단계에서 실행
 * 알라딘 API에서 한국 도서 200권+ 수집 후:
 *   data/books.json        (서버 인메모리 raw 형식)
 *   public/data/books.json (프론트 변환 형식)
 *   public/data/recommendations.json (TF-IDF 코사인 유사도)
 *   data/tfidf_cache.json  (TF-IDF 벡터 캐시)
 * API 실패 시 exit 0 — 배포는 계속 진행 (서버가 fallback으로 처리)
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const TTB_KEY = process.env.ALADIN_API_KEY || 'ttb11dlguswns1147001';
const MAX_RESULTS = 50;
const REQUEST_DELAY = 500; // ms

// 여러 QueryType으로 200권+ 수집
const QUERIES = [
  { QueryType: 'Bestseller',      start: 1   },
  { QueryType: 'Bestseller',      start: 51  },
  { QueryType: 'Bestseller',      start: 101 },
  { QueryType: 'Bestseller',      start: 151 },
  { QueryType: 'ItemNewAll',      start: 1   },
  { QueryType: 'ItemNewAll',      start: 51  },
  { QueryType: 'ItemNewSpecial',  start: 1   },
];

function fetchUrl(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timeout ${timeoutMs}ms`));
    });
  });
}

function buildUrl(QueryType, start) {
  const params = new URLSearchParams({
    TTBKey: TTB_KEY,
    QueryType,
    MaxResults: String(MAX_RESULTS),
    start: String(start),
    SearchTarget: 'Book',
    output: 'js',
    Version: '20131101',
    Cover: 'Big',
  });
  return `http://www.aladin.co.kr/ttb/api/ItemList.aspx?${params.toString()}`;
}

async function fetchQuery(QueryType, start) {
  const url = buildUrl(QueryType, start);
  console.log(`[aladin] ${QueryType} start=${start}`);
  try {
    const raw = await fetchUrl(url);
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) json = JSON.parse(m[0]);
      else { console.warn('  → 파싱 실패'); return []; }
    }
    if (json.errorCode) {
      console.warn(`  → API 오류 ${json.errorCode}: ${json.errorMessage}`);
      return [];
    }
    const items = json.item || [];
    console.log(`  → ${items.length}권`);
    return items;
  } catch (e) {
    console.warn(`  → 오류: ${e.message}`);
    return [];
  }
}

// TF-IDF 벡터 빌드
function buildTfidf(rawBooks) {
  const docTerms = rawBooks.map(b => {
    const text = [
      b.title || '',
      b.author || '',
      (b.categoryName || '').replace(/>/g, ' '),
      (b.description || '').slice(0, 300),
    ].join(' ');
    const tokens = text.toLowerCase()
      .split(/[^가-힣a-z0-9]+/)
      .filter(t => t.length >= 2);
    const freq = {};
    for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
    return freq;
  });
  const N = rawBooks.length;
  const df = {};
  for (const freq of docTerms)
    for (const term of Object.keys(freq))
      df[term] = (df[term] || 0) + 1;
  return docTerms.map(freq => {
    const total = Object.values(freq).reduce((a, b) => a + b, 0) || 1;
    const vec = {};
    for (const [term, count] of Object.entries(freq)) {
      const idf = Math.log((N + 1) / ((df[term] || 1) + 1)) + 1;
      vec[term] = (count / total) * idf;
    }
    return vec;
  });
}

function cosine(a, b) {
  const keys = Object.keys(a).filter(k => k in b);
  if (!keys.length) return 0;
  const dot = keys.reduce((s, k) => s + a[k] * b[k], 0);
  const na = Math.sqrt(Object.values(a).reduce((s, v) => s + v * v, 0));
  const nb = Math.sqrt(Object.values(b).reduce((s, v) => s + v * v, 0));
  return na && nb ? Math.min(dot / (na * nb), 1) : 0;
}

// 서버 인메모리용 raw 형식 (data/books.json)
function toRaw(item, QueryType) {
  return {
    isbn:               item.isbn  || '',
    isbn13:             item.isbn13 || item.isbn || '',
    title:              item.title || '',
    author:             item.author || '',
    publisher:          item.publisher || '',
    pubDate:            item.pubDate || '',
    cover:              item.cover || '',
    description:        item.description || item.fullDescription || '',
    price:              item.priceStandard || item.price || 0,
    priceSales:         item.priceSales || 0,
    categoryId:         item.categoryId || 0,
    categoryName:       item.categoryName || '',
    salesPoint:         item.salesPoint || 0,
    customerReviewRank: item.customerReviewRank || 0,
    link:               item.link || '',
    source:             'aladin',
    queryType:          QueryType,
  };
}

// 프론트용 변환 형식 (public/data/books.json)
function toFront(b) {
  const genreRaw = b.categoryName || '';
  const parts = genreRaw.split('>').map(p => p.trim()).filter(Boolean);
  const genre = parts.length > 1 ? parts.slice(1) : (parts.length ? parts : ['일반']);
  const pubYear = b.pubDate ? parseInt(b.pubDate.split('-')[0], 10) : null;
  return {
    id:             b.isbn13 || b.isbn || '',
    isbn:           b.isbn || '',
    isbn13:         b.isbn13 || '',
    title:          b.title || '',
    author:         b.author || 'Unknown',
    authors:        [b.author || 'Unknown'],
    genre,
    cover_url:      b.cover || '',
    description:    b.description || '',
    publisher:      b.publisher || '',
    pubDate:        b.pubDate || '',
    published_year: pubYear,
    average_rating: Math.round(((b.customerReviewRank || 0) / 2) * 10) / 10,
    price:          b.price || 0,
    salesPoint:     b.salesPoint || 0,
    categoryName:   genreRaw,
    link:           b.link || '',
    language:       'ko',
  };
}

async function main() {
  console.log('\n=== BookWise Render Build: 알라딘 도서 수집 ===');

  // 디렉터리 준비
  const rootDir    = path.join(__dirname, '..');
  const dataDir    = path.join(rootDir, 'data');
  const pubDataDir = path.join(rootDir, 'public', 'data');
  fs.mkdirSync(dataDir,    { recursive: true });
  fs.mkdirSync(pubDataDir, { recursive: true });

  // 기존 data/books.json 확인 — 이미 충분한 책이 있으면 스킵
  const existingPath = path.join(dataDir, 'books.json');
  if (fs.existsSync(existingPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(existingPath, 'utf-8'));
      if (Array.isArray(existing) && existing.length >= 200) {
        console.log(`[skip] data/books.json 이미 ${existing.length}권 — 재수집 불필요`);
        return;
      }
    } catch { /* pass */ }
  }

  // 알라딘 API 수집
  const rawAll = [];
  const seenIsbn   = new Set();
  const seenItemId = new Set();

  for (const { QueryType, start } of QUERIES) {
    const items = await fetchQuery(QueryType, start);
    for (const item of items) {
      const isbn   = item.isbn13 || item.isbn || '';
      const itemId = String(item.itemId || '');
      if (isbn   && seenIsbn.has(isbn))     continue;
      if (itemId && seenItemId.has(itemId)) continue;
      if (isbn)   seenIsbn.add(isbn);
      if (itemId) seenItemId.add(itemId);
      rawAll.push({ item, QueryType });
    }
    if (rawAll.length >= 400) break; // 충분하면 조기 종료
    await new Promise(r => setTimeout(r, REQUEST_DELAY));
  }

  console.log(`\n[중복 제거 후] 총 ${rawAll.length}권`);

  if (rawAll.length < 10) {
    console.warn('[warn] 수집된 도서가 너무 적습니다. API 응답을 확인하세요.');
    console.log('[build] 기존 데이터 유지하고 exit 0');
    return; // exit 0 — 배포 실패 방지
  }

  // 1) data/books.json (서버 인메모리 raw 형식)
  const rawBooks = rawAll.map(({ item, QueryType }) => toRaw(item, QueryType));
  fs.writeFileSync(existingPath, JSON.stringify(rawBooks, null, 2), 'utf-8');
  console.log(`[save] data/books.json: ${rawBooks.length}권`);

  // 2) TF-IDF 벡터 빌드
  console.log('[tfidf] 벡터 계산 중...');
  const t0 = Date.now();
  const vecs = buildTfidf(rawBooks);
  console.log(`[tfidf] ${rawBooks.length}권 벡터 완료 (${Date.now() - t0}ms)`);

  // 3) data/tfidf_cache.json
  const tfidfPath = path.join(dataDir, 'tfidf_cache.json');
  fs.writeFileSync(tfidfPath, JSON.stringify(vecs), 'utf-8');
  console.log('[save] data/tfidf_cache.json');

  // 4) public/data/books.json (프론트 변환 형식)
  const frontBooks = rawBooks.map(toFront);
  fs.writeFileSync(path.join(pubDataDir, 'books.json'), JSON.stringify(frontBooks, null, 2), 'utf-8');
  console.log(`[save] public/data/books.json: ${frontBooks.length}권`);

  // 5) public/data/recommendations.json (TF-IDF 코사인 유사도)
  console.log('[recs] 추천 생성 중...');
  const recs = {};
  const n = rawBooks.length;
  for (let i = 0; i < n; i++) {
    const b  = rawBooks[i];
    const bid = b.isbn13 || b.isbn || String(i);
    const va  = vecs[i] || {};
    const scores = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      scores.push([j, cosine(va, vecs[j] || {})]);
    }
    scores.sort((a, b) => b[1] - a[1]);
    recs[bid] = scores.slice(0, 8).map(([j, s]) => {
      const ob   = rawBooks[j];
      const oid  = ob.isbn13 || ob.isbn || String(j);
      const tier = s >= 0.6 ? 'high' : s >= 0.4 ? 'mid' : 'low';
      return {
        id:           oid,
        isbn:         ob.isbn || '',
        isbn13:       ob.isbn13 || '',
        title:        ob.title || '',
        author:       ob.author || '',
        cover:        ob.cover || '',
        categoryName: ob.categoryName || '',
        score:        Math.round(s * 10000) / 10000,
        tier,
        reason:       tier === 'high' ? '내용·문체 연관성' : tier === 'mid' ? '비슷한 주제' : '새 장르 탐험',
      };
    });
  }
  fs.writeFileSync(
    path.join(pubDataDir, 'recommendations.json'),
    JSON.stringify(recs, null, 2),
    'utf-8'
  );
  console.log(`[save] public/data/recommendations.json: ${Object.keys(recs).length}권`);

  // 6) data/bookstats.json 초기화 (없으면)
  const statsPath = path.join(dataDir, 'bookstats.json');
  if (!fs.existsSync(statsPath)) {
    fs.writeFileSync(statsPath, '{}', 'utf-8');
    console.log('[save] data/bookstats.json (초기화)');
  }

  // 7) data/calendar.json 초기화 (없으면)
  const calPath = path.join(dataDir, 'calendar.json');
  if (!fs.existsSync(calPath)) {
    fs.writeFileSync(calPath, '[]', 'utf-8');
    console.log('[save] data/calendar.json (초기화)');
  }

  console.log('\n=== Render Build 완료 ===');
}

main().catch(err => {
  console.error('[render_build] 오류:', err.message);
  console.log('[render_build] exit 0 — 배포 계속 진행');
  process.exit(0); // 빌드 실패 방지
});
