/**
 * BookWise — Express 서버
 * - public/ 정적 서빙
 * - 커뮤니티 게시글 CRUD API (인메모리)
 * - 시작 시 SQLite DB → books.json / recommendations.json 자동 생성
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);  // 정수 강제 — string+"1" 버그 방지
const JWT_SECRET = process.env.JWT_SECRET || "bookwise-secret-key-2026";
if (!process.env.JWT_SECRET) {
  console.warn('[security] JWT_SECRET not set in .env — using default fallback. Set a strong random secret in production.');
}

// ── 미들웨어 ────────────────────────────────────────────────────────
app.use(cors());
app.use(require('compression')());   // gzip 압축 (응답 크기 절감)
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── 정적 JSON 생성 (시작 시 1회) ───────────────────────────────────
function generateStaticData() {
  const dataDir = path.join(__dirname, "public", "data");
  const booksPath = path.join(dataDir, "books.json");
  const recsPath = path.join(dataDir, "recommendations.json");

  fs.mkdirSync(dataDir, { recursive: true });

  // 이미 유효한 데이터가 있으면 스킵 (빈 파일이면 재생성)
  if (fs.existsSync(booksPath) && fs.existsSync(recsPath)) {
    try {
      const books = JSON.parse(fs.readFileSync(booksPath, 'utf-8'));
      const recs = JSON.parse(fs.readFileSync(recsPath, 'utf-8'));
      if (Array.isArray(books) && books.length > 0 && Object.keys(recs).length > 0) {
        console.log('[data] books.json & recommendations.json already exist with data, skipping generation.');
        return;
      }
      console.log('[data] Static files exist but are empty — regenerating.');
    } catch (e) {
      console.warn('[data] Failed to parse static files, regenerating:', e.message);
    }
  }

  // 알라딘 data/books.json이 있으면 SQLite보다 우선 사용
  const aladinSrc = path.join(__dirname, 'data', 'books.json');
  if (fs.existsSync(aladinSrc)) {
    try {
      const ab = JSON.parse(fs.readFileSync(aladinSrc, 'utf-8'));
      if (Array.isArray(ab) && ab.length > 0) {
        console.log('[data] data/books.json 존재 — Aladin 데이터로 정적 파일 생성 (SQLite 우선순위 낮춤)');
        generateAladinStaticData(booksPath, recsPath);
        return;
      }
    } catch (e) {
      console.warn('[data] data/books.json 파싱 실패, SQLite fallback:', e.message);
    }
  }

  // better-sqlite3가 있으면 DB에서 생성, 없으면 더미 데이터
  let Database;
  try {
    Database = require("better-sqlite3");
  } catch (e) {
    console.warn("[data] better-sqlite3 not available, using fallback data.");
    generateFallbackData(booksPath, recsPath);
    return;
  }

  const dbPath = path.join(__dirname, "db.sqlite3");
  if (!fs.existsSync(dbPath)) {
    console.warn("[data] db.sqlite3 not found, using fallback data.");
    generateFallbackData(booksPath, recsPath);
    return;
  }

  try {
    const db = new Database(dbPath, { readonly: true });

    // 저자 맵
    const authorRows = db.prepare(`
      SELECT ba.book_id, a.name
      FROM books_book_authors ba
      JOIN books_author a ON ba.author_id = a.id
    `).all();
    const authorMap = {};
    for (const { book_id, name } of authorRows) {
      if (!authorMap[book_id]) authorMap[book_id] = [];
      authorMap[book_id].push(name);
    }

    // 장르 맵
    const genreRows = db.prepare(`
      SELECT bg.book_id, g.name
      FROM books_book_genres bg
      JOIN books_genre g ON bg.genre_id = g.id
    `).all();
    const genreMap = {};
    for (const { book_id, name } of genreRows) {
      if (!genreMap[book_id]) genreMap[book_id] = [];
      genreMap[book_id].push(name);
    }

    // 책 목록
    const books = db.prepare("SELECT * FROM books_book").all();
    console.log(`[data] Loaded ${books.length} books from SQLite`);

    // books.json
    const booksData = books.map((b) => {
      const aa = authorMap[b.id] || [];
      const gg = genreMap[b.id] || [];
      const isbn = b.isbn || "";
      let cover = b.cover_url || "";
      if (!cover && isbn) {
        cover = `https://covers.openlibrary.org/b/isbn/${isbn.replace(/-/g, "")}-M.jpg`;
      }
      const desc =
        b.description ||
        `${aa[0] || "저자 미상"}의 ${gg.slice(0, 2).join(", ") || "일반"} 도서입니다. ` +
        `'${b.title}'은(는) 독자들에게 풍부한 통찰을 선사합니다.`;
      return {
        id: String(b.id),
        title: b.title || "",
        author: aa[0] || "Unknown",
        authors: aa,
        genre: gg,
        isbn,
        cover_url: cover,
        description: desc,
        subjects: gg,
        published_year: b.published_year || null,
        average_rating: Math.round((b.average_rating || 0) * 100) / 100,
      };
    });

    fs.writeFileSync(booksPath, JSON.stringify(booksData, null, 2), "utf-8");
    console.log(`[data] books.json written (${booksData.length} books)`);

    // TF-IDF 벡터 및 코사인 유사도
    function cosine(a, b) {
      const common = Object.keys(a).filter((k) => k in b);
      if (!common.length) return 0;
      const dot = common.reduce((s, k) => s + a[k] * b[k], 0);
      const na = Math.sqrt(Object.values(a).reduce((s, v) => s + v * v, 0));
      const nb = Math.sqrt(Object.values(b).reduce((s, v) => s + v * v, 0));
      return na && nb ? Math.min(dot / (na * nb), 1) : 0;
    }

    function scoreTier(s) {
      return s >= 0.6 ? "high" : s >= 0.4 ? "mid" : "low";
    }

    function makeReason(t, ga, gb) {
      const match = ga.filter((g) => gb.includes(g));
      if (match.length) return `'${match.slice(0, 2).join(", ")}' 장르 독자에게 추천합니다.`;
      if (t === "high") return "내용과 문체가 높은 연관성을 가진 도서입니다.";
      if (t === "mid") return "부분적으로 비슷한 주제를 다루는 도서입니다.";
      return "새로운 장르를 탐험해보세요.";
    }

    const vecs = {};
    for (const b of books) {
      try {
        vecs[b.id] =
          b.tfidf_vector_json && b.tfidf_vector_json !== "{}"
            ? JSON.parse(b.tfidf_vector_json)
            : {};
      } catch {
        vecs[b.id] = {};
      }
    }

    const recs = {};
    for (const b of books) {
      const va = vecs[b.id];
      const ga = genreMap[b.id] || [];
      const scores = books
        .filter((o) => o.id !== b.id)
        .map((o) => [o.id, cosine(va, vecs[o.id])])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      recs[String(b.id)] = scores.map(([oid, s]) => {
        const t = scoreTier(s);
        return {
          id: String(oid),
          score: Math.round(s * 10000) / 10000,
          tier: t,
          reason: makeReason(t, ga, genreMap[oid] || []),
        };
      });
    }

    fs.writeFileSync(recsPath, JSON.stringify(recs, null, 2), "utf-8");
    console.log(`[data] recommendations.json written (${Object.keys(recs).length} books)`);

    db.close();
  } catch (err) {
    console.error('[data] Error generating from DB:', err.message);
    // Aladin 인메모리 데이터로 정적 파일 생성 재시도
    if (typeof aladinBooks !== 'undefined' && Array.isArray(aladinBooks) && aladinBooks.length > 0) {
      console.log('[data] Falling back to Aladin in-memory data for static generation.');
      generateAladinStaticData(booksPath, recsPath);
    } else {
      generateFallbackData(booksPath, recsPath);
    }
  }
}

// ── Aladin 인메모리 데이터 → public/data/ 정적 파일 생성 ──────────────
function generateAladinStaticData(booksPath, recsPath) {
  try {
    // books.json: 프론트가 쓰는 형식으로 변환
    const booksData = aladinBooks.map((b, i) => {
      const id = b.isbn13 || b.isbn || String(i);
      const genreArr = b.categoryName ? b.categoryName.split('>').map(s => s.trim()).filter(Boolean) : [];
      return {
        id,
        title: b.title || '',
        author: b.author || 'Unknown',
        authors: [b.author || 'Unknown'],
        genre: genreArr,
        isbn: b.isbn || '',
        isbn13: b.isbn13 || '',
        cover_url: b.cover || '',
        description: b.description || '',
        subjects: genreArr,
        published_year: b.pubDate ? parseInt(b.pubDate.split('-')[0], 10) : null,
        average_rating: (b.customerReviewRank || 0) / 2,
        salesPoint: b.salesPoint || 0,
        categoryName: b.categoryName || '',
        publisher: b.publisher || '',
        link: b.link || '',
      };
    });

    fs.writeFileSync(booksPath, JSON.stringify(booksData, null, 2), 'utf-8');
    console.log('[data] public/data/books.json written (' + booksData.length + ' books) from Aladin');

    // recommendations.json: TF-IDF 코사인 유사도 (이미 _tfidfVec 빌드됨)
    function scoreTier(s) { return s >= 0.6 ? 'high' : s >= 0.4 ? 'mid' : 'low'; }
    function makeReason(tier, catA, catB) {
      const aArr = (catA || '').split('>').map(s => s.trim());
      const bArr = (catB || '').split('>').map(s => s.trim());
      const match = aArr.filter(g => bArr.includes(g) && g.length > 0);
      if (match.length) return "'" + match.slice(0, 2).join(', ') + "' 장르 독자에게 추천합니다.";
      if (tier === 'high') return '내용과 문체가 높은 연관성을 가진 도서입니다.';
      if (tier === 'mid') return '부분적으로 비슷한 주제를 다루는 도서입니다.';
      return '새로운 장르를 탐험해보세요.';
    }

    const recs = {};
    const n = aladinBooks.length;
    for (let i = 0; i < n; i++) {
      const b = aladinBooks[i];
      const bid = b.isbn13 || b.isbn || String(i);
      const va = _tfidfVec[i] || {};
      const scores = [];
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const s = _cosine(va, _tfidfVec[j] || {});
        scores.push([j, s]);
      }
      scores.sort((a, b) => b[1] - a[1]);
      recs[bid] = scores.slice(0, 8).map(([j, s]) => {
        const ob = aladinBooks[j];
        const oid = ob.isbn13 || ob.isbn || String(j);
        const t = scoreTier(s);
        return {
          id: oid,
          isbn: ob.isbn || '',
          isbn13: ob.isbn13 || '',
          title: ob.title || '',
          author: ob.author || '',
          cover: ob.cover || '',
          categoryName: ob.categoryName || '',
          score: Math.round(s * 10000) / 10000,
          tier: t,
          reason: makeReason(t, b.categoryName, ob.categoryName),
        };
      });
    }

    fs.writeFileSync(recsPath, JSON.stringify(recs, null, 2), 'utf-8');
    console.log('[data] public/data/recommendations.json written (' + Object.keys(recs).length + ' books) from Aladin TF-IDF');
  } catch (e) {
    console.error('[data] generateAladinStaticData failed:', e.message);
    generateFallbackData(booksPath, recsPath);
  }
}

// ── 폴백: 데이터 없을 때 빈 파일 ───────────────────────────────────
function generateFallbackData(booksPath, recsPath) {
  if (!fs.existsSync(booksPath)) fs.writeFileSync(booksPath, "[]", "utf-8");
  if (!fs.existsSync(recsPath)) fs.writeFileSync(recsPath, "{}", "utf-8");
  console.log("[data] Fallback empty data written.");
}

// ── JSON 파일 영속 저장소 ─────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');

const CALENDAR_FILE  = path.join(DATA_DIR, 'calendar.json');
const BOOKSTATS_FILE = path.join(DATA_DIR, 'bookstats.json');
const ALADIN_BOOKS_FILE = path.join(DATA_DIR, 'books.json');

let calendarEntries = loadJSON(CALENDAR_FILE, []);
let nextCalId = calendarEntries.length ? Math.max(...calendarEntries.map(c=>c.id))+1 : 1;
let bookStats = loadJSON(BOOKSTATS_FILE, {});

// 알라딘 한국 도서 로드
let aladinBooks = loadJSON(ALADIN_BOOKS_FILE, []);
console.log('[books] ' + aladinBooks.length + '권 한국 도서 로드됨');
function bIsbn(b){ return b.isbn13||b.isbn||''; }

// ── 한국어 TF-IDF 토크나이저 (조사·접미사 제거 + stop words) ──────
const _KO_PARTICLES = ['에서의','로부터','에서도','에서는','에게서','에서만','까지도','이라는','이라고','이며서','이면서','에서','부터','까지','에게','한테','로서','으로','이라','이며','이고','처럼','보다','만큼','이나','이든','이면','이란','이를','이가','에는','에도','에만','은','는','이','가','을','를','의','에','로','와','과','도','만','서'];
const _KO_STOPWORDS = new Set(['하다','이다','있다','없다','되다','하는','하고','해서','하여','하지','됩니다','입니다','합니다','있습니다','없습니다','것이','수가','수도','수를','수는','것은','것을','것도','것만','것이','것들','것과','것','들','및','등','또한','그리고','그러나','하지만','따라서','그러므로','즉','또','더','매우','아주','정말','너무','조금','많이','자주','항상','이','그','저','어떤','모든','이런','그런','저런','이것','그것','저것','여기','거기','어디','나','우리','당신','여러분','누구','무엇','언제','왜','어떻게','바로','통해','통한','위한','위해','대한','대해','관한','관해','아닌','아니라','않은','않는','않고','때문','이후','이전','사이','안에','속에','위에','아래','이상','이하','만큼','정도','가장','다시','먼저','계속','새로운','새','모든','각','각각','전체','부분','경우','때','곳','사람','사람들']);
const _KO_SHORT = new Set(['하','을','를','은','는','이','가','의','에','로','서','와','과','도','만','나','네','내','그','저','이','한']);

function _koTokenize(text) {
  const raw = text.toLowerCase().split(/[^가-힣a-z0-9]+/).filter(t => t.length >= 2);
  const result = [];
  for (let tok of raw) {
    if (/[가-힣]/.test(tok)) {
      for (const p of _KO_PARTICLES) {
        if (tok.endsWith(p) && tok.length - p.length >= 2) { tok = tok.slice(0, tok.length - p.length); break; }
      }
      if (tok.length < 2) continue;
      if (_KO_STOPWORDS.has(tok) || _KO_SHORT.has(tok)) continue;
    }
    result.push(tok);
  }
  return result;
}

// TF-IDF 추천 엔진
const TFIDF_VERSION = 'v2-ko-mmr';
let _tfidfVec = [];
(function(){
  const TFIDF_CACHE = path.join(__dirname, 'data', 'tfidf_cache.json');
  if (fs.existsSync(TFIDF_CACHE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(TFIDF_CACHE, 'utf-8'));
      if (cached && cached.version === TFIDF_VERSION && Array.isArray(cached.vecs) && cached.vecs.length === aladinBooks.length) {
        _tfidfVec = cached.vecs;
        console.log('[tfidf] cache loaded (' + _tfidfVec.length + ' books, ' + TFIDF_VERSION + ') — skip rebuild');
        return;
      }
      if (Array.isArray(cached)) {
        console.log('[tfidf] old v1 cache detected — rebuilding with Korean tokenizer v2');
      }
        } catch (e) { console.warn('[tfidf] cache parse fail, rebuilding:', e.message); }
  }
  const t0 = Date.now();
  const docTerms = aladinBooks.map(b=>{
    const text=[b.title||'',b.author||'',(b.categoryName||'').replace(/>/g,' '),(b.description||'').slice(0,500)].join(' ');
    const tokens = _koTokenize(text);
    const freq={};for(const t of tokens)freq[t]=(freq[t]||0)+1;return freq;
  });
  const N=aladinBooks.length,df={};
  for(const freq of docTerms)for(const term of Object.keys(freq))df[term]=(df[term]||0)+1;
  _tfidfVec=docTerms.map(freq=>{
    const total=Object.values(freq).reduce((a,b)=>a+b,0)||1,vec={};
    for(const [term,count] of Object.entries(freq)){const idf=Math.log((N+1)/((df[term]||1)+1))+1;vec[term]=(count/total)*idf;}
    return vec;
  });
  console.log('[tfidf] built ' + aladinBooks.length + ' vectors in ' + (Date.now()-t0) + 'ms');
  try { fs.writeFileSync(TFIDF_CACHE, JSON.stringify({ version: TFIDF_VERSION, vecs: _tfidfVec }), 'utf-8'); console.log('[tfidf] cache saved: data/tfidf_cache.json (' + TFIDF_VERSION + ')'); }
  catch(e) { console.warn('[tfidf] cache save fail:', e.message); }
})();
function _cosine(a,b){const keys=Object.keys(a).filter(k=>k in b);if(!keys.length)return 0;const dot=keys.reduce((s,k)=>s+a[k]*b[k],0),na=Math.sqrt(Object.values(a).reduce((s,v)=>s+v*v,0)),nb=Math.sqrt(Object.values(b).reduce((s,v)=>s+v*v,0));return na&&nb?Math.min(dot/(na*nb),1):0;}
// ── MMR (Maximal Marginal Relevance) 다양성 추천 ─────────────────
// λ = 0.7: 70% relevance + 30% diversity
// 제약: 같은 저자 최대 1권, 같은 1레벨 장르 최대 2권
function _mmrSelect(queryIdx, k, lambda) {
  k = k || 8; lambda = (lambda !== undefined) ? lambda : 0.7;
  const qVec = _tfidfVec[queryIdx] || {};
  const N = aladinBooks.length;

  const candidates = [];
  for (let j = 0; j < N; j++) {
    if (j === queryIdx) continue;
    const sim = _cosine(qVec, _tfidfVec[j] || {});
    candidates.push({ idx: j, simQ: sim });
  }
  candidates.sort((a, b) => b.simQ - a.simQ);

  const selected = [];
  const remaining = candidates.slice();
  const authorCount = {};
  const genreCount  = {};

  while (selected.length < k && remaining.length > 0) {
    let bestScore = -Infinity, bestI = -1;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const ob   = aladinBooks[cand.idx];
      const g1   = (ob.categoryName || '').split('>')[1] || '';
      const auth = (ob.author || '').split(/[,/（(]/)[0].trim();
      if ((authorCount[auth] || 0) >= 1) continue;
      if ((genreCount[g1]   || 0) >= 2) continue;
      let maxSimToSel = 0;
      for (const sel of selected) {
        const s = _cosine(_tfidfVec[cand.idx] || {}, _tfidfVec[sel.idx] || {});
        if (s > maxSimToSel) maxSimToSel = s;
      }
      const mmrScore = lambda * cand.simQ - (1 - lambda) * maxSimToSel;
      if (mmrScore > bestScore) { bestScore = mmrScore; bestI = i; }
    }
    if (bestI === -1) {
      // 제약 충족 후보 없음 → 제약 완화: 최고 relevance 선택
      for (let i = 0; i < remaining.length; i++) {
        if (!selected.some(s => s.idx === remaining[i].idx)) { bestI = i; break; }
      }
      if (bestI === -1) break;
    }
    const chosen = remaining.splice(bestI, 1)[0];
    const ob   = aladinBooks[chosen.idx];
    const g1   = (ob.categoryName || '').split('>')[1] || '';
    const auth = (ob.author || '').split(/[,/（(]/)[0].trim();
    genreCount[g1]    = (genreCount[g1]    || 0) + 1;
    authorCount[auth] = (authorCount[auth] || 0) + 1;
    selected.push({ ...chosen, mmrScore: Math.round(bestScore * 10000) / 10000 });
  }
  return selected;
}

// ── 독자 유형 정의 ──────────────────────────────────────────────
const _READER_TYPES = [
  { type: '모험가형',  emoji: '🗺️',  desc: '새로운 세계와 이야기를 탐험하는 독자',          genreKeys: ['판타지','SF','무협','모험'] },
  { type: '감성파형',  emoji: '💝',  desc: '감동과 감성으로 이야기에 빠져드는 독자',          genreKeys: ['로맨스','로맨스판타지','멜로','시','에세이'] },
  { type: '성장형',    emoji: '🚀',  desc: '스스로를 발전시키고 성공을 이루려는 독자',        genreKeys: ['자기계발','경제경영','재테크','비즈니스','마케팅','리더십'] },
  { type: '사색가형',  emoji: '📖',  desc: '깊은 이야기와 문학적 사유를 즐기는 독자',        genreKeys: ['소설','문학','현대소설','세계문학','고전','단편'] },
  { type: '지식인형',  emoji: '🔬',  desc: '역사와 인문학으로 세상을 이해하는 독자',          genreKeys: ['역사','인문','철학','심리학','사회학','교양'] },
  { type: '전문가형',  emoji: '💻',  desc: '전문 지식과 학문적 깊이를 추구하는 독자',        genreKeys: ['과학','기술','IT','수학','공학','의학','컴퓨터'] },
  { type: '관찰자형',  emoji: '🌏',  desc: '사회와 세상을 날카롭게 관찰하는 독자',            genreKeys: ['사회','정치','경제','시사','환경','문화'] },
  { type: '균형파형',  emoji: '⚖️',  desc: '다양한 장르를 넘나들며 폭넓은 시각을 가진 독자', genreKeys: [] },
];

function loadJSON(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return fallback; }
}
function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

let users = loadJSON(USERS_FILE, []);
let nextUserId = users.length ? Math.max(...users.map(u => u.id)) + 1 : 1;

// JWT 미들웨어 (선택적)
function authMiddleware(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }
  const token = authHeader.split(" ")[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: "유효하지 않은 토큰입니다." });
  }
}

// POST /api/auth/register
app.post("/api/auth/register", async (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password) {
    return res.status(400).json({ error: "username, email, password 모두 필요합니다." });
  }
  // username: 2~20자, 영문·한글·숫자·밑줄만 허용
  const usernameStr = String(username).trim();
  if (usernameStr.length < 2 || usernameStr.length > 20) {
    return res.status(400).json({ error: "사용자명은 2자 이상 20자 이하여야 합니다." });
  }
  if (!/^[가-힣a-zA-Z0-9_]+$/.test(usernameStr)) {
    return res.status(400).json({ error: "사용자명은 한글·영문·숫자·밑줄(_)만 사용할 수 있습니다." });
  }
  // email: RFC 5322 간략 형식 검증
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    return res.status(400).json({ error: "올바른 이메일 형식이 아닙니다." });
  }
  if (users.find((u) => u.email === email)) {
    return res.status(409).json({ error: "이미 사용 중인 이메일입니다." });
  }
  if (users.find((u) => u.username === usernameStr)) {
    return res.status(409).json({ error: "이미 사용 중인 사용자명입니다." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "비밀번호는 8자 이상이어야 합니다." });
  }
  const hash = await bcrypt.hash(password, 10);
  const user = { id: nextUserId++, username: usernameStr, email: String(email), passwordHash: hash };
  users.push(user);
  saveJSON(USERS_FILE, users);
  const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
  res.status(201).json({ message: "회원가입 완료", user: { id: user.id, username: user.username, email: user.email }, token });
});

// POST /api/auth/login
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = users.find((u) => u.email === email);
  if (!user) return res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." });
  const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
});

// GET /api/auth/me
app.get("/api/auth/me", authMiddleware, (req, res) => {
  const user = users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
  res.json({ user: { id: user.id, username: user.username, email: user.email } });
});

// POST /api/auth/logout
app.post("/api/auth/logout", (req, res) => {
  res.json({ message: "로그아웃 되었습니다." });
});

// ── 커뮤니티 JSON 영속 저장소 ───────────────────────────────────────
let posts = loadJSON(POSTS_FILE, []);
let nextId = posts.length ? Math.max(...posts.map(p => p.id)) + 1 : 1;

function now() {
  return new Date().toISOString();
}

// ── 커뮤니티 API ────────────────────────────────────────────────────

// GET /api/posts — 목록
app.get("/api/posts", (req, res) => {
  res.json(posts);
});

// POST /api/posts — 생성 (로그인 필수)
app.post("/api/posts", authMiddleware, (req, res) => {
  const { title, content } = req.body || {};
  if (!title || !content) {
    return res.status(400).json({ error: "title과 content가 필요합니다." });
  }
  const post = {
    id: nextId++,
    title: String(title),
    content: String(content),
    author: req.user.username,
    authorId: req.user.id,
    created_at: now(),
    updated_at: now(),
  };
  posts.push(post);
  saveJSON(POSTS_FILE, posts);
  res.status(201).json(post);
});

// GET /api/posts/:id — 단건
app.get("/api/posts/:id", (req, res) => {
  const post = posts.find((p) => p.id === Number(req.params.id));
  if (!post) return res.status(404).json({ error: "게시글을 찾을 수 없습니다." });
  res.json(post);
});

// PUT /api/posts/:id — 수정 (작성자만)
app.put("/api/posts/:id", authMiddleware, (req, res) => {
  const idx = posts.findIndex((p) => p.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  if (posts[idx].authorId && posts[idx].authorId !== req.user.id)
    return res.status(403).json({ error: "수정 권한이 없습니다." });
  const { title, content } = req.body || {};
  posts[idx] = {
    ...posts[idx],
    title: title !== undefined ? String(title) : posts[idx].title,
    content: content !== undefined ? String(content) : posts[idx].content,
    updated_at: now(),
  };
  saveJSON(POSTS_FILE, posts);
  res.json(posts[idx]);
});

// DELETE /api/posts/:id — 삭제 (작성자만)
app.delete("/api/posts/:id", authMiddleware, (req, res) => {
  const idx = posts.findIndex((p) => p.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  if (posts[idx].authorId && posts[idx].authorId !== req.user.id)
    return res.status(403).json({ error: "삭제 권한이 없습니다." });
  posts.splice(idx, 1);
  saveJSON(POSTS_FILE, posts);
  res.status(204).send();
});

// ── /api/community alias (/api/posts와 동일 미들웨어 체인) ──────────────

// GET /api/community — 게시글 목록
app.get("/api/community", (req, res) => {
  res.json(posts);
});

// POST /api/community — 게시글 생성 (로그인 필수 — authMiddleware 적용)
app.post("/api/community", authMiddleware, (req, res) => {
  const { title, content } = req.body || {};
  if (!title || !content) {
    return res.status(400).json({ error: "title과 content가 필요합니다." });
  }
  const post = {
    id: nextId++,
    title: String(title),
    content: String(content),
    author: req.user.username,
    authorId: req.user.id,
    created_at: now(),
    updated_at: now(),
  };
  posts.push(post);
  saveJSON(POSTS_FILE, posts);
  res.status(201).json(post);
});

// GET /api/community/:id — 단건
app.get("/api/community/:id", (req, res) => {
  const post = posts.find((p) => p.id === Number(req.params.id));
  if (!post) return res.status(404).json({ error: "게시글을 찾을 수 없습니다." });
  res.json(post);
});

// 405: 잘못된 메서드
app.all("/api/posts", (req, res) => {
  res.status(405).json({ error: "Method Not Allowed" });
});
app.all("/api/posts/:id", (req, res) => {
  res.status(405).json({ error: "Method Not Allowed" });
});


// ── 알라딘 도서 검색 프록시 (F1302 외부 API 활용) ─────────────────
const https = require('https');

function aladinFetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

// GET /api/books/search?q=검색어 — 알라딘 실시간 검색
app.get('/api/books/search', async (req, res) => {
  let q = req.query.q || '';
  try { q = decodeURIComponent(q); } catch (_) {}
  q = q.trim();
  if (!q) return res.status(400).json({ error: 'q 파라미터가 필요합니다.' });
  const ALADIN_KEY = process.env.ALADIN_API_KEY;
  const url = `https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?TTBKey=${ALADIN_KEY}&Query=${encodeURIComponent(q)}&QueryType=Title&MaxResults=20&start=1&SearchTarget=Book&output=js&Version=20131101&Cover=Big`;
  try {
    const raw = await aladinFetch(url);
    let json;
    try { json = JSON.parse(raw); } catch(e) { const m = raw.match(/\{[\s\S]*\}/); json = m ? JSON.parse(m[0]) : null; }
    if (!json || json.errorCode) return res.status(502).json({ error: '알라딘 API 오류', detail: json?.errorMessage });
    const items = (json.item || []).map(item => {
      const parts = (item.categoryName || '').split('>').slice(1).filter(Boolean);
      return {
        id: String(item.itemId),
        title: item.title || '',
        author: item.author || '',
        authors: item.author ? [item.author] : [],
        genre: parts.length ? parts : ['일반'],
        isbn: item.isbn13 || item.isbn || '',
        cover_url: item.cover || '',
        description: item.description || '',
        publisher: item.publisher || '',
        pubDate: item.pubDate || '',
        language: 'ko',
        average_rating: Math.round((parseFloat(item.customerReviewRank || 0) / 2) * 100) / 100,
        aladin_url: item.link || '',
        price: item.priceStandard || 0
      };
    });
    res.json({ query: q, total: json.totalResults || items.length, items });
  } catch (err) {
    res.status(500).json({ error: '검색 중 오류 발생', detail: err.message });
  }
});

// GET /api/books/trending — 판매지수 + 뷰카운트 기반 인기 도서 TOP 20
app.get('/api/books/trending', (req, res) => {
  try {
    const sorted = [...convertedBooks]
      .map(b => {
        const views = (bookStats[b.isbn13] || bookStats[b.isbn] || {}).viewCount || 0;
        return { ...b, _score: (b.salesPoint || 0) / 1000 + views * 10 };
      })
      .sort((a, b) => b._score - a._score)
      .slice(0, 20)
      .map(({ _score, ...b }) => b);
    res.json({ items: sorted });
  } catch (err) {
    res.status(500).json({ error: '트렌드 로드 실패', detail: err.message });
  }
});

// GET /api/books/mood/:mood — 기분 기반 추천
const MOOD_GENRES = {
  설렘:['소설/시/희곡','만화/라이트노벨','에세이'],
  행복:['소설/시/희곡','만화/라이트노벨','에세이','어린이'],
  기쁨:['소설/시/희곡','만화/라이트노벨','에세이','어린이'],
  우울:['에세이','인문학','소설/시/희곡'],
  슬픔:['에세이','인문학','소설/시/희곡'],
  열정:['자기계발','경제경영'],
  평온:['인문학','역사','종교/역학','에세이'],
  탐구:['과학','컴퓨터/모바일','역사','인문학'],
  두려움:['자기계발','에세이','인문학'],
  불안:['자기계발','에세이','건강/취미'],
  화남:['에세이','자기계발','인문학'],
  happy:['소설/시/희곡','만화/라이트노벨','에세이','어린이'],
  sad:['에세이','인문학','소설/시/희곡'],
  stressed:['자기계발','에세이','건강/취미'],
  motivated:['자기계발','경제경영'],
  curious:['과학','역사','인문학','컴퓨터/모바일'],
  romantic:['소설/시/희곡','만화/라이트노벨'],
  thrilling:['소설/시/희곡','만화/라이트노벨'],
};
const MOOD_LABEL = {
  설렘:'설레는', 행복:'행복한', 기쁨:'기분 좋은', 우울:'위로가 되는', 슬픔:'위안이 되는',
  열정:'열정을 불어넣는', 평온:'마음을 평온하게 하는', 탐구:'지적 호기심을 채우는',
  두려움:'용기를 주는', 불안:'마음을 안정시키는', 화남:'마음을 진정시키는',
  happy:'기분 좋은', sad:'위안이 되는', stressed:'스트레스 해소에 좋은',
  motivated:'동기부여가 되는', curious:'탐구심을 자극하는', romantic:'낭만적인', thrilling:'스릴 넘치는',
};

app.get('/api/books/mood/:mood', (req, res) => {
  try {
    const mood = req.params.mood;
    const genres = MOOD_GENRES[mood] || [];
    const moodLabel = MOOD_LABEL[mood] || '추천하는';

    // convertedBooks 기준으로 score + reason 계산
    const scored = convertedBooks.map((b) => {
      const catName = b.categoryName || '';
      let matchScore = 0;
      let matchedGenre = null;
      for (let gi = 0; gi < genres.length; gi++) {
        if (catName.includes(genres[gi])) {
          // 앞쪽 장르일수록 해당 기분에 더 잘 맞음
          matchScore = (genres.length - gi) / genres.length;
          matchedGenre = genres[gi];
          break;
        }
      }
      const salesNorm = Math.min((b.salesPoint || 0) / 500000, 0.25);
      const score = Math.round(Math.min(matchScore * 0.75 + salesNorm + 0.05, 1.0) * 100) / 100;
      const reason = matchedGenre
        ? `${moodLabel} 기분에 어울리는 '${matchedGenre}' 장르 도서입니다.`
        : `${moodLabel} 기분에 추천하는 도서입니다.`;
      return { b, score, reason, matched: matchScore > 0 };
    });

    const filtered = genres.length ? scored.filter(x => x.matched) : scored;
    const finalPool = filtered.length >= 8 ? filtered : scored;

    const result = finalPool
      .sort((a, b) => b.score - a.score || (b.b.salesPoint || 0) - (a.b.salesPoint || 0))
      .slice(0, 8)
      .map(({ b, score, reason }) => ({ ...b, score, reason }));

    res.json({ mood, genres, items: result });
  } catch (err) {
    res.status(500).json({ error: '기분 추천 실패' });
  }
});

// POST /api/mood-recommend — 기분 기반 추천 래퍼 (GET /api/books/mood/:mood 내부 재사용)
app.post('/api/mood-recommend', (req, res) => {
  try {
    const mood = (req.body && req.body.mood) ? String(req.body.mood).trim() : '';
    if (!mood) return res.status(400).json({ error: 'mood 파라미터가 필요합니다.' });
    const genres = MOOD_GENRES[mood] || [];
    const moodLabel = MOOD_LABEL[mood] || '추천하는';

    const scored = convertedBooks.map((b) => {
      const catName = b.categoryName || '';
      let matchScore = 0;
      let matchedGenre = null;
      for (let gi = 0; gi < genres.length; gi++) {
        if (catName.includes(genres[gi])) {
          matchScore = (genres.length - gi) / genres.length;
          matchedGenre = genres[gi];
          break;
        }
      }
      const salesNorm = Math.min((b.salesPoint || 0) / 500000, 0.25);
      const score = Math.round(Math.min(matchScore * 0.75 + salesNorm + 0.05, 1.0) * 100) / 100;
      const reason = matchedGenre
        ? `${moodLabel} 기분에 어울리는 '${matchedGenre}' 장르 도서입니다.`
        : `${moodLabel} 기분에 추천하는 도서입니다.`;
      return { b, score, reason, matched: matchScore > 0 };
    });

    const filtered = genres.length ? scored.filter(x => x.matched) : scored;
    const finalPool = filtered.length >= 8 ? filtered : scored;

    const result = finalPool
      .sort((a, b) => b.score - a.score || (b.b.salesPoint || 0) - (a.b.salesPoint || 0))
      .slice(0, 8)
      .map(({ b, score, reason }) => ({ ...b, score, reason }));

    res.json({ mood, genres, items: result });
  } catch (err) {
    res.status(500).json({ error: '기분 추천 실패', detail: err.message });
  }
});

// ── 알라딘 인메모리 → 프론트 형식 변환 헬퍼 ─────────────────────────
function toFrontBook(b, i) {
  const isbn13 = b.isbn13 || b.isbn || String(i + 1);
  const isbn   = b.isbn || isbn13;
  const genreRaw = b.categoryName || '';
  const parts  = genreRaw.split('>').map(p => p.trim()).filter(Boolean);
  const genre  = parts.length > 1 ? parts.slice(1) : (parts.length ? parts : ['일반']);
  let desc = (b.description || '').trim();
  if (!desc) {
    const cat = parts[parts.length - 1] || '일반';
    desc = `${b.author || '저자 미상'}의 ${cat} 도서입니다. 알라딘 판매지수 ${(b.salesPoint || 0).toLocaleString()}점의 도서입니다.`;
  }
  let pubYear = null;
  if (b.pubDate) { try { pubYear = parseInt(String(b.pubDate).slice(0, 4), 10); } catch {} }
  return {
    id:            isbn13,
    isbn,
    isbn13,
    title:         b.title || '',
    author:        b.author || 'Unknown',
    authors:       [b.author || 'Unknown'],
    publisher:     b.publisher || '',
    pubDate:       b.pubDate || '',
    published_year: pubYear,
    genre,
    cover_url:     b.cover || '',
    description:   desc,
    subjects:      genre,
    average_rating: Math.round(((b.customerReviewRank || 0) / 2) * 10) / 10,
    price:         b.price || b.priceStandard || 0,
    salesPoint:    b.salesPoint || 0,
    categoryName:  genreRaw,
    link:          b.link || '',
    language:      'ko',
  };
}
const convertedBooks = aladinBooks.map((b, i) => toFrontBook(b, i));

// GET /api/books — 전체 도서 목록 (필터·검색·페이지네이션)
app.get('/api/books', (req, res) => {
  try {
    // per_page는 limit의 별칭 — 기본값 20
    const { mood, genre, page = 1, limit, per_page } = req.query;
    // raw 비ASCII(한국어 등) 쿼리가 insecureHTTPParser 경유로 들어올 때 이중 방어
    let q = req.query.q || '';
    try { q = decodeURIComponent(q); } catch (_) { /* 이미 디코딩된 경우 그대로 */ }
    q = q.trim();
    let result = [...convertedBooks];

    // 검색어 필터
    if (q) {
      const kw = q.toLowerCase();
      result = result.filter(b =>
        (b.title || '').toLowerCase().includes(kw) ||
        (b.author || '').toLowerCase().includes(kw) ||
        (b.description || '').toLowerCase().includes(kw)
      );
    }
    // 기분/감정 태그 필터
    if (mood) {
      const moodGenres = MOOD_GENRES[mood] || [];
      if (moodGenres.length) {
        result = result.filter(b => moodGenres.some(g => (b.categoryName || '').includes(g)));
        if (result.length < 8) result = convertedBooks; // 너무 적으면 전체
      }
    }
    // 장르 필터
    if (genre) {
      result = result.filter(b => (b.categoryName || '').includes(genre) ||
        b.genre.some(g => g.includes(genre)));
    }

    const total = result.length;
    const p = Math.max(1, parseInt(page, 10));
    const lim = Math.min(200, Math.max(1, parseInt(per_page || limit || '20', 10)));
    const items = result.slice((p - 1) * lim, p * lim);
    res.json({ total, page: p, limit: lim, per_page: lim, data: items, items });
  } catch (err) {
    res.status(500).json({ error: '도서 목록 로드 실패', detail: err.message });
  }
});

// GET /api/books/:isbn/recommendations — 개별 도서 TF-IDF 추천 (score·reason 포함)
app.get('/api/books/:isbn/recommendations', (req, res) => {
  try {
    const { isbn } = req.params;
    const idx = convertedBooks.findIndex(b => b.isbn13 === isbn || b.isbn === isbn || b.id === isbn);
    if (idx === -1) {
      // isbn 못 찾으면 판매지수 기준 인기 도서 반환
      const fallback = [...convertedBooks]
        .sort((a, b) => (b.salesPoint || 0) - (a.salesPoint || 0))
        .slice(0, 8)
        .map(b => ({ ...b, score: 0.5, reason: 'collaborative' }));
      return res.json({ isbn, type: 'popular', items: fallback });
    }
    const tb = aladinBooks[idx];

    // MMR 다양성 추천 (같은 저자 최대 1권, 같은 장르 최대 2권)
    const mmrItems = _mmrSelect(idx, 8, 0.7);
    const results = mmrItems.map(({ idx: j, simQ, mmrScore }) => {
      const b  = convertedBooks[j];
      const ob = aladinBooks[j];
      const tC1 = (tb.categoryName || '').split('>')[1] || '';
      const tC2 = (tb.categoryName || '').split('>')[2] || '';
      const c1 = (ob.categoryName || '').split('>')[1] || '';
      const c2 = (ob.categoryName || '').split('>')[2] || '';
      let reason;
      if (c2 && c2 === tC2) reason = 'genre_match';
      else if (c1 && c1 === tC1) reason = 'collaborative';
      else if (simQ > 0.2) reason = 'content_based';
      else reason = 'content_based';
      const score = Math.round(Math.min(simQ, 1.0) * 10000) / 10000;
      return { ...b, score, reason };
    });

    res.json({ isbn, sourceTitle: tb.title, type: 'content_based', algorithm: 'TF-IDF MMR + Korean Tokenizer v2', items: results });
  } catch (err) {
    res.status(500).json({ error: '추천 로드 실패', detail: err.message });
  }
});

// GET /api/books/:id — 단건 도서 상세 (isbn13 또는 isbn)
app.get('/api/books/:id', (req, res) => {
  const { id } = req.params;
  const book = convertedBooks.find(b => b.isbn13 === id || b.isbn === id || b.id === id);
  if (!book) return res.status(404).json({ error: '도서를 찾을 수 없습니다.' });

  // 추천 도서 (인메모리 TF-IDF)
  const idx = convertedBooks.indexOf(book);
  const va = _tfidfVec[idx] || {};
  const recs = aladinBooks
    .map((_, j) => ({ j, s: j === idx ? -1 : _cosine(va, _tfidfVec[j] || {}) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 6)
    .map(({ j, s }) => {
      const ob = convertedBooks[j];
      const tier = s >= 0.6 ? 'high' : s >= 0.4 ? 'mid' : 'low';
      return { ...ob, score: Math.round(s * 10000) / 10000, tier, reason: tier === 'high' ? '내용·문체 연관성' : tier === 'mid' ? '비슷한 주제' : '새 장르 탐험' };
    });

  res.json({ ...book, recommendations: recs });
});

// GET /api/stats — 사이트 통계 요약
app.get('/api/stats', (req, res) => {
  try {
    const cats=new Set(aladinBooks.map(b=>(b.categoryName||'').split('>')[1]).filter(Boolean));res.json({total_books:aladinBooks.length,total_categories:cats.size,total_posts:posts.length,total_users:users.length,algorithm:'TF-IDF + Genre Collaborative Filtering',data_source:'Aladin Open API (한국 도서)'});
  } catch (err) {
    res.status(500).json({ error: '통계 로드 실패' });
  }
});


// ── AI 추천 API (TF-IDF + 협업필터) ─────────────────────────────────
app.get('/api/recommendations', (req,res) => {
  const bookId=(req.query.bookId||'').trim();
  if(!bookId){
    // bookId 누락 시 판매지수 기준 인기 도서 fallback (popular 분기)
    const fallback=[...aladinBooks].sort((a,b)=>(b.salesPoint||0)-(a.salesPoint||0)).slice(0,8).map(b=>({id:bIsbn(b),isbn:bIsbn(b),title:b.title,author:b.author,cover:b.cover,categoryName:b.categoryName,salesPoint:b.salesPoint,score:0.5,reason:'collaborative'}));
    return res.json({type:'popular',items:fallback});
  }
  const idx=aladinBooks.findIndex(b=>b.isbn13===bookId||b.isbn===bookId);
  if(idx===-1){
    const fallback=[...aladinBooks].sort((a,b)=>(b.salesPoint||0)-(a.salesPoint||0)).slice(0,8).map(b=>({id:bIsbn(b),isbn:bIsbn(b),title:b.title,author:b.author,cover:b.cover,categoryName:b.categoryName,salesPoint:b.salesPoint,score:0.5,reason:'collaborative'}));
    return res.json({bookId,type:'popular',items:fallback});
  }
  const tb=aladinBooks[idx];
  const mmrItems = _mmrSelect(idx, 8, 0.7);
  const tC1=(tb.categoryName||'').split('>')[1]||'',tC2=(tb.categoryName||'').split('>')[2]||'';
  const scored=mmrItems.map(({idx:i,simQ})=>{
    const b=aladinBooks[i];
    const c1=(b.categoryName||'').split('>')[1]||'',c2=(b.categoryName||'').split('>')[2]||'';
    const reason=c2&&c2===tC2?'genre_match':c1&&c1===tC1?'collaborative':simQ>0.2?'content_based':'emotion_based';
    return {id:bIsbn(b),isbn:bIsbn(b),title:b.title,author:b.author,cover:b.cover,categoryName:b.categoryName,salesPoint:b.salesPoint,score:Math.round(simQ*10000)/10000,reason};
  });
  res.json({bookId,sourceTitle:tb.title,type:'content_based',algorithm:'TF-IDF MMR + Korean Tokenizer v2',items:scored});
});

// ── 키워드 기반 도서 추천 API (/api/recommend?q=<keyword>) ───────────────
app.get('/api/recommend', (req,res) => {
  let q = req.query.q || '';
  try { q = decodeURIComponent(q); } catch (_) {}
  q = q.trim();
  if(!q) return res.status(400).json({error:'q 파라미터가 필요합니다.'});
  const lq=q.toLowerCase();
  const scored=aladinBooks.map(b=>{
    const inTitle=(b.title||'').toLowerCase().includes(lq);
    const inCat=(b.categoryName||'').toLowerCase().includes(lq);
    const inDesc=(b.description||'').toLowerCase().includes(lq);
    const inAuthor=(b.author||'').toLowerCase().includes(lq);
    if(!inTitle&&!inCat&&!inDesc&&!inAuthor) return null;
    const score=(inTitle?0.6:0)+(inCat?0.3:0)+(inDesc?0.2:0)+(inAuthor?0.1:0);
    const reason=inTitle?'content_based':inCat?'genre_match':'content_based';
    return {id:bIsbn(b),isbn:bIsbn(b),title:b.title,author:b.author,cover:b.cover,categoryName:b.categoryName,salesPoint:b.salesPoint,score:Math.round(score*10000)/10000,reason};
  }).filter(Boolean).sort((a,b)=>b.score-a.score||((b.salesPoint||0)-(a.salesPoint||0))).slice(0,10);
  res.json({q,total:scored.length,results:scored});
});

app.get('/api/recommendations/personal', (req,res) => {
  const userId=parseInt(req.query.userId)||0;
  const userCal=calendarEntries.filter(c=>c.userId===userId);
  if(!userCal.length){
    return res.json({userId,type:'popular',readCount:0,items:[...aladinBooks].sort((a,b)=>(b.salesPoint||0)-(a.salesPoint||0)).slice(0,10).map(b=>({id:bIsbn(b),isbn:bIsbn(b),title:b.title,author:b.author,cover:b.cover,categoryName:b.categoryName,score:0.8,reason:'collaborative'}))});
  }
  const readIsbns=new Set(userCal.map(c=>c.isbn));
  const catCounts={};
  aladinBooks.filter(b=>readIsbns.has(bIsbn(b))).forEach(b=>{const cat=(b.categoryName||'').split('>')[1]||'기타';catCounts[cat]=(catCounts[cat]||0)+1;});
  const topCat=Object.entries(catCounts).sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
  const items=aladinBooks.filter(b=>!readIsbns.has(bIsbn(b))).filter(b=>topCat?(b.categoryName||'').includes(topCat):true).sort((a,b)=>(b.salesPoint||0)-(a.salesPoint||0)).slice(0,10).map(b=>({id:bIsbn(b),isbn:bIsbn(b),title:b.title,author:b.author,cover:b.cover,categoryName:b.categoryName,score:0.75,reason:'genre_match'}));
  res.json({userId,type:'personalized',topCategory:topCat,readCount:userCal.length,items});
});

// GET /api/recommendations/reader-type?genres=판타지,SF&count=5
// 선호 장르 → 독자 유형 라벨 + 맞춤 추천
app.get('/api/recommendations/reader-type', (req, res) => {
  try {
    const rawGenres = (req.query.genres || '')
      .split(',')
      .map(g => { try { return decodeURIComponent(g.trim()); } catch(_) { return g.trim(); } })
      .filter(Boolean);
    const count = Math.min(Math.max(parseInt(req.query.count) || 5, 1), 20);

    if (!rawGenres.length) {
      return res.status(400).json({ error: 'genres 파라미터가 필요합니다. 예: ?genres=판타지,SF' });
    }

    // 책 장르 분포 계산
    const genreDistrib = {};
    for (const b of aladinBooks) {
      const g1 = (b.categoryName || '').split('>')[1] || '기타';
      genreDistrib[g1] = (genreDistrib[g1] || 0) + 1;
    }

    // 독자 유형 매칭: 입력 장르와 genreKeys 교집합 점수
    let bestType = null, bestScore = -1;
    for (const rt of _READER_TYPES) {
      if (!rt.genreKeys.length) continue;
      let score = 0;
      for (const inputG of rawGenres) {
        for (const key of rt.genreKeys) {
          if (inputG.includes(key) || key.includes(inputG)) {
            score += (genreDistrib[inputG] || 0) > 0 ? 2 : 1;
          }
        }
      }
      if (score > bestScore) { bestScore = score; bestType = rt; }
    }
    if (!bestType || bestScore === 0) bestType = _READER_TYPES[_READER_TYPES.length - 1]; // 균형파형 fallback

    // 입력 장르 도서 수집
    const matchedBooks = aladinBooks
      .filter(b => rawGenres.some(g => (b.categoryName || '').includes(g)))
      .sort((a, b) => (b.salesPoint || 0) - (a.salesPoint || 0))
      .slice(0, count)
      .map(b => ({ id: bIsbn(b), isbn: bIsbn(b), title: b.title, author: b.author, cover: b.cover, categoryName: b.categoryName, salesPoint: b.salesPoint }));

    // 부족 시 bestType 장르 도서로 보충
    if (matchedBooks.length < count) {
      const seen = new Set(matchedBooks.map(b => b.isbn));
      const fill = aladinBooks
        .filter(b => {
          if (seen.has(bIsbn(b))) return false;
          return bestType.genreKeys.some(k => (b.categoryName || '').includes(k));
        })
        .sort((a, b) => (b.salesPoint || 0) - (a.salesPoint || 0))
        .slice(0, count - matchedBooks.length)
        .map(b => ({ id: bIsbn(b), isbn: bIsbn(b), title: b.title, author: b.author, cover: b.cover, categoryName: b.categoryName, salesPoint: b.salesPoint }));
      matchedBooks.push(...fill);
    }

    res.json({
      type:  bestType.type,
      emoji: bestType.emoji,
      desc:  bestType.desc,
      inputGenres: rawGenres,
      genreDistribution: Object.fromEntries(
        Object.entries(genreDistrib).sort((a, b) => b[1] - a[1]).slice(0, 10)
      ),
      books: matchedBooks
    });
  } catch (err) {
    res.status(500).json({ error: '독자 유형 분석 실패', detail: err.message });
  }
});

// ── 독서 달력 API ─────────────────────────────────────────────────────
app.post('/api/calendar', authMiddleware, (req,res) => {
  const {isbn,bookTitle,date,status}=req.body||{};
  if(!isbn||!date||!status) return res.status(400).json({error:'isbn, date, status 모두 필요합니다.'});
  const VALID=['reading','done','want'];
  if(!VALID.includes(status)) return res.status(400).json({error:'status는 reading|done|want 중 하나여야 합니다.'});
  const entry={id:nextCalId++,userId:req.user.id,username:req.user.username,isbn:String(isbn),bookTitle:bookTitle||'',date:String(date),status:String(status),created_at:new Date().toISOString()};
  calendarEntries.push(entry);saveJSON(CALENDAR_FILE,calendarEntries);
  res.status(201).json(entry);
});
app.get('/api/calendar', authMiddleware, (req,res) => {
  const mine=calendarEntries.filter(c=>c.userId===req.user.id);
  res.json({items:mine,total:mine.length});
});
app.delete('/api/calendar/:id', authMiddleware, (req,res) => {
  const id=parseInt(req.params.id);
  const idx=calendarEntries.findIndex(c=>c.id===id);
  if(idx===-1) return res.status(404).json({error:'기록을 찾을 수 없습니다.'});
  if(calendarEntries[idx].userId!==req.user.id) return res.status(403).json({error:'삭제 권한이 없습니다.'});
  calendarEntries.splice(idx,1);saveJSON(CALENDAR_FILE,calendarEntries);
  res.status(204).send();
});

// ── 트렌드 히트맵 API ─────────────────────────────────────────────────
app.post('/api/books/:isbn/view', (req,res) => {
  const isbn=req.params.isbn;
  if(!bookStats[isbn]) bookStats[isbn]={viewCount:0,lastViewed:null};
  bookStats[isbn].viewCount+=1;bookStats[isbn].lastViewed=new Date().toISOString();
  saveJSON(BOOKSTATS_FILE,bookStats);
  res.json({isbn,viewCount:bookStats[isbn].viewCount});
});
app.get('/api/trending/realtime', (req,res) => {
  const catMap={};
  for(const b of aladinBooks){
    const cat2=(b.categoryName||'').split('>')[1]||'기타';
    if(!catMap[cat2]) catMap[cat2]={category:cat2,totalViews:0,totalSalesPoint:0,bookCount:0,books:[]};
    const isbn=bIsbn(b),views=(bookStats[isbn]||{}).viewCount||0;
    catMap[cat2].totalViews+=views;catMap[cat2].totalSalesPoint+=b.salesPoint||0;catMap[cat2].bookCount+=1;
    catMap[cat2].books.push({isbn,title:b.title,author:b.author,cover:b.cover,salesPoint:b.salesPoint||0,viewCount:views});
  }
  const categories=Object.values(catMap).map(cat=>{
    cat.topBooks=cat.books.sort((a,b)=>(b.viewCount*10+b.salesPoint/1000)-(a.viewCount*10+a.salesPoint/1000)).slice(0,3);
    delete cat.books;cat.score=cat.totalViews*10+cat.totalSalesPoint/1000;return cat;
  }).sort((a,b)=>b.score-a.score);
  res.json({updated_at:new Date().toISOString(),total_categories:categories.length,categories:categories.slice(0,15)});
});

// ── Health check ──────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', books: aladinBooks.length, timestamp: new Date().toISOString() });
});

// ── Ping (Render 콜드스타트 완화용) ────────────────────────────────────
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ── SPA Fallback ─────────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── 시작 ─────────────────────────────────────────────────────────────
// raw 한국어(비 ASCII) URL 완전 지원:
//   Node.js HTTP 파서(llhttp)는 raw non-ASCII URL을 400으로 거부하므로,
//   TCP 레벨 프록시에서 request-line의 non-ASCII를 percent-encode 후 내부 HTTP 서버로 전달
const http = require('http');
const net  = require('net');

const INTERNAL_PORT = PORT + 1; // 내부 전용, 127.0.0.1 에만 바인딩

function encodeRawRequestLine(line) {
  // GET /path?q=소설 HTTP/1.1 → GET /path?q=%EC%86%8C%EC%84%A4 HTTP/1.1
  // binary 디코딩 후 non-ASCII 바이트를 %HH 형식으로 치환
  return line.replace(/[^\x20-\x7E]+/g, m =>
    [...Buffer.from(m, 'binary')]
      .map(b => b < 128 ? String.fromCharCode(b) : '%' + b.toString(16).toUpperCase().padStart(2, '0'))
      .join('')
  );
}

generateStaticData();

// 정적 파일이 여전히 비어 있으면(better-sqlite3 경로도 실패한 경우) Aladin으로 재생성
(function ensureStaticPopulated() {
  const dataDir = require('path').join(__dirname, 'public', 'data');
  const booksPath = require('path').join(dataDir, 'books.json');
  const recsPath = require('path').join(dataDir, 'recommendations.json');
  try {
    const bks = JSON.parse(require('fs').readFileSync(booksPath, 'utf-8'));
    const rcs = JSON.parse(require('fs').readFileSync(recsPath, 'utf-8'));
    if ((!Array.isArray(bks) || bks.length === 0) || Object.keys(rcs).length === 0) {
      console.log('[data] Static files still empty after generateStaticData — forcing Aladin generation.');
      generateAladinStaticData(booksPath, recsPath);
    }
  } catch (e) {
    console.log('[data] ensureStaticPopulated error:', e.message);
  }
})();

// 내부 Express HTTP 서버 (127.0.0.1 전용)
const httpServer = http.createServer(app);
httpServer.listen(INTERNAL_PORT, '127.0.0.1');

// 외부 TCP 프록시 서버 (raw non-ASCII URL → percent-encode → 내부 전달)
net.createServer((fromClient) => {
  const toInternal = net.connect(INTERNAL_PORT, '127.0.0.1');
  let lineFixed = false;
  let pending = Buffer.alloc(0);

  fromClient.on('data', (chunk) => {
    if (lineFixed) {
      toInternal.write(chunk);
      return;
    }
    pending = Buffer.concat([pending, chunk]);
    const crlf = pending.indexOf(Buffer.from('\r\n'));
    if (crlf === -1) return; // 첫 번째 CRLF가 올 때까지 대기

    const rawLine  = pending.slice(0, crlf).toString('binary');
    const fixedLine = encodeRawRequestLine(rawLine);
    lineFixed = true;
    toInternal.write(Buffer.concat([Buffer.from(fixedLine, 'binary'), pending.slice(crlf)]));
    pending = Buffer.alloc(0);
  });

  toInternal.pipe(fromClient);
  fromClient.on('error', () => toInternal.destroy());
  toInternal.on('error', () => fromClient.destroy());

}).listen(PORT, () => {
  console.log(`BookWise server running on http://localhost:${PORT}`);

  // ── Render 슬립 방지: 14분마다 자기 핑 (production only) ────────────
  if (process.env.NODE_ENV === 'production') {
    const SELF_URL = 'https://organt-p-030.onrender.com/api/ping';
    setInterval(() => {
      fetch(SELF_URL)
        .then(r => r.json())
        .then(body => console.log('[keepalive] ping ok:', body.ts))
        .catch(e  => console.warn('[keepalive] ping fail:', e.message));
    }, 14 * 60 * 1000); // 14분 — Render sleep(15분)보다 짧게
    console.log('[keepalive] self-wake enabled →', SELF_URL);
  }
});
