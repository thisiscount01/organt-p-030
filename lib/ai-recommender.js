/**
 * lib/ai-recommender.js — AI 추천 엔진 모듈 (AI 엔지니어 소유)
 *
 * 제공 기능:
 *   - tokenizeKo(text)       : 한국어 개선 토크나이저 v2 (조사·불용어 제거 + 바이그램)
 *   - buildTfidfVecs(books)  : TF-IDF 벡터 일괄 생성
 *   - cosine(a, b)           : 코사인 유사도
 *   - mmrRecommend(...)      : MMR (λ=0.7) 기반 다양성 추천
 *   - classifyReaderType(...)  : 선호 장르 → 독자 유형 분류
 *
 * server.js 통합 방법:
 *   const aiRec = require('./lib/ai-recommender');
 *   const vecs = aiRec.buildTfidfVecs(aladinBooks);
 *   const items = aiRec.mmrRecommend(idx, vecs, aladinBooks, { k: 8, lambda: 0.7 });
 */

'use strict';

// ── 한국어 개선 토크나이저 v2 ──────────────────────────────────────────
const KO_STOP = new Set([
  // 조사
  '이','가','을','를','은','는','의','에','와','과','도','로','으로','에서','에게',
  '한테','부터','까지','라고','이라고','하고','이고','이며','이랑','랑','이나','나',
  '처럼','같이','만큼','보다','만','뿐','조차','마저','이든','든','께','께서',
  // 용언·보조어
  '이다','있다','없다','하다','되다','것','수','때','후','전','안','속','위','아래',
  // 지시대명사·부사
  '그','저','그것','이것','저것','그런','이런','저런','같은','다른','새로운','어떤','모든',
  '그리고','그러나','하지만','그래서','따라서','또한','또','혹은','또는','만약',
  '더','매우','아주','너무','정말','참','꽤','가장','제일',
  '있는','없는','되는','하는',
  // 출판 잡음어
  '지은이','옮긴이','엮은이','지음','글씀','씀','번역','출판사','저자','글','국내도서',
]);

const KO_SINGLE_PTCL = new Set(['은','는','이','가','을','를','의','에','와','과','도','로','만']);
const KO_DOUBLE_SFX  = ['으로','에서','에게','한테','부터','까지','라고','하고','이고','이며','이랑','이나','처럼','같이'];

function _stripParticle(token) {
  if (token.length > 3) {
    const l2 = token.slice(-2);
    if (KO_DOUBLE_SFX.includes(l2)) return token.slice(0, -2);
  }
  if (token.length > 2) {
    const l1 = token[token.length - 1];
    if (KO_SINGLE_PTCL.has(l1)) return token.slice(0, -1);
  }
  return token;
}

/**
 * 한국어 개선 토크나이저
 * - 조사·불용어 제거
 * - 한국어 4자 이상 어절에 대한 문자 바이그램 추가 (형태소 근사)
 * @param {string} text
 * @returns {string[]}
 */
function tokenizeKo(text) {
  const raw = text.toLowerCase().split(/[^가-힣a-z0-9]+/).filter(t => t.length >= 2);
  const out = new Set();
  for (const tok of raw) {
    if (KO_STOP.has(tok)) continue;
    const s = _stripParticle(tok);
    if (s.length >= 2 && !KO_STOP.has(s)) out.add(s);
    // 한국어 4자 이상: 캐릭터 바이그램 추가 (형태소 근사)
    if (/^[가-힣]+$/.test(tok) && tok.length >= 4) {
      for (let i = 0; i < tok.length - 1; i++) {
        const bg = tok.slice(i, i + 2);
        if (!KO_STOP.has(bg)) out.add(bg);
      }
    }
  }
  return [...out];
}

// ── 코사인 유사도 ──────────────────────────────────────────────────────
function cosine(a, b) {
  const keys = Object.keys(a).filter(k => k in b);
  if (!keys.length) return 0;
  const dot = keys.reduce((s, k) => s + a[k] * b[k], 0);
  const na  = Math.sqrt(Object.values(a).reduce((s, v) => s + v * v, 0));
  const nb  = Math.sqrt(Object.values(b).reduce((s, v) => s + v * v, 0));
  return na && nb ? Math.min(dot / (na * nb), 1) : 0;
}

// ── TF-IDF 벡터 일괄 생성 ────────────────────────────────────────────
/**
 * @param {Array<{title,author,categoryName,description}>} books 알라딘 도서 배열
 * @returns {Array<Object>} TF-IDF 벡터 배열 (books 순서와 1:1 대응)
 */
function buildTfidfVecs(books) {
  const docTerms = books.map(b => {
    const text = [
      b.title        || '',
      b.author       || '',
      (b.categoryName || '').replace(/>/g, ' '),
      b.description  || '',       // 전체 설명 사용 (기존 300자 제한 제거)
    ].join(' ');
    const tokens = tokenizeKo(text);
    const freq = {};
    for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
    return freq;
  });

  const N = books.length;
  const df = {};
  for (const freq of docTerms) {
    for (const term of Object.keys(freq)) df[term] = (df[term] || 0) + 1;
  }

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

// ── MMR 다양성 추천 ──────────────────────────────────────────────────
/**
 * Maximal Marginal Relevance 기반 추천
 * 다양성 제약: 같은 장르(level-1) 최대 2권, 같은 저자 최대 1권
 *
 * @param {number}   targetIdx   대상 도서 인덱스 (books 배열 내)
 * @param {Array}    vecs        TF-IDF 벡터 배열 (buildTfidfVecs 결과)
 * @param {Array}    books       알라딘 도서 배열 (categoryName, author 필드 포함)
 * @param {Object}   [opts]
 * @param {number}   [opts.k=8]        반환 추천 수
 * @param {number}   [opts.lambda=0.7] 연관성 가중치 (1-lambda = 다양성)
 * @returns {Array<{j, score, reason}>} 선택된 추천 (j = books 배열 인덱스)
 */
function mmrRecommend(targetIdx, vecs, books, opts = {}) {
  const { k = 8, lambda = 0.7 } = opts;
  const tv = vecs[targetIdx] || {};
  const tb = books[targetIdx] || {};
  const tC1 = (tb.categoryName || '').split('>')[1] || '';
  const tC2 = (tb.categoryName || '').split('>')[2] || '';

  // 후보 리스트: 관련성 점수 + 장르 보너스 사전 계산
  const candidates = [];
  for (let j = 0; j < books.length; j++) {
    if (j === targetIdx) continue;
    const ob   = books[j];
    const sim  = cosine(tv, vecs[j] || {});
    const c1   = (ob.categoryName || '').split('>')[1] || '';
    const c2   = (ob.categoryName || '').split('>')[2] || '';
    const bonus = (c2 === tC2 && tC2) ? 0.15 : (c1 === tC1 && tC1) ? 0.08 : 0;
    const rel   = Math.min(sim + bonus, 1.0);
    let reason;
    if (c2 === tC2 && tC2)         reason = 'genre_match';
    else if (c1 === tC1 && tC1)    reason = 'collaborative';
    else if (sim > 0.25)           reason = 'content_based';
    else                           reason = 'content_based';
    candidates.push({ j, rel, reason });
  }

  // MMR 선택 루프
  const selected  = [];
  const remaining = [...candidates];
  const genreCnt  = {};  // c1 → count
  const authorSeen = new Set();

  const pickBest = (pool) => {
    let bestMMR = -Infinity, bestIdx = -1;
    for (let ri = 0; ri < pool.length; ri++) {
      const { j, rel } = pool[ri];
      let maxRed = 0;
      for (const sel of selected) {
        const red = cosine(vecs[j] || {}, vecs[sel.j] || {});
        if (red > maxRed) maxRed = red;
      }
      const mmr = lambda * rel - (1 - lambda) * maxRed;
      if (mmr > bestMMR) { bestMMR = mmr; bestIdx = ri; }
    }
    return bestIdx;
  };

  while (selected.length < k && remaining.length > 0) {
    // 1차: 다양성 제약 준수 풀에서 MMR 최적화
    const diversePool = remaining.filter(({ j }) => {
      const ob  = books[j];
      const c1  = (ob.categoryName || '').split('>')[1] || '';
      const au  = (ob.author || '').split(/[\s,]/)[0];
      const genreOk  = (genreCnt[c1] || 0) < 2;
      const authorOk = !au || !authorSeen.has(au);
      return genreOk && authorOk;
    });

    const pool = diversePool.length > 0 ? diversePool : remaining; // 제약 불충족 시 릴랙스
    const bestRiInPool = pickBest(pool);
    if (bestRiInPool === -1) break;

    const chosen = pool[bestRiInPool];
    // remaining에서 제거
    const remIdx = remaining.findIndex(c => c.j === chosen.j);
    if (remIdx !== -1) remaining.splice(remIdx, 1);

    const ob = books[chosen.j];
    const c1 = (ob.categoryName || '').split('>')[1] || '';
    const au = (ob.author || '').split(/[\s,]/)[0];
    genreCnt[c1] = (genreCnt[c1] || 0) + 1;
    if (au) authorSeen.add(au);
    selected.push(chosen);
  }

  return selected.map(({ j, rel, reason }) => ({
    j,
    score : Math.round(rel * 10000) / 10000,
    reason,
  }));
}

// ── 독자 유형 분류 ──────────────────────────────────────────────────
const READER_TYPES = [
  {
    type:     '모험가형',
    emoji:    '🗺️',
    desc:     '새로운 세계를 탐험하는 독자',
    detail:   '현실을 넘어 미지의 세계와 강렬한 서사에 매료됩니다. 예측 불가한 전개와 상상력이 풍부한 설정을 즐깁니다.',
    keywords: ['판타지','SF','스릴러','무협','만화','라이트노벨','공상과학','소년만화','순정만화','미스터리'],
  },
  {
    type:     '낭만가형',
    emoji:    '🌹',
    desc:     '감성과 공감으로 세상을 보는 독자',
    detail:   '인간의 감정과 섬세한 관계를 탐구합니다. 아름다운 문장 속에서 깊은 공감을 찾습니다.',
    keywords: ['로맨스','에세이','시','한국소설','소설','드라마','감성'],
  },
  {
    type:     '탐구자형',
    emoji:    '🔬',
    desc:     '세상의 이치를 파악하려는 독자',
    detail:   '사실과 원리를 깊이 파고드는 것을 즐깁니다. 역사, 과학, 철학을 통해 세계를 이해합니다.',
    keywords: ['과학','역사','인문학','철학','물리','수학','생물','우주','컴퓨터','기술','사회과학'],
  },
  {
    type:     '전략가형',
    emoji:    '♟️',
    desc:     '성공을 향해 전략적으로 접근하는 독자',
    detail:   '목표 달성을 위한 실용적 지식을 추구합니다. 경제, 경영, 자기계발에 강한 관심을 보입니다.',
    keywords: ['경제경영','자기계발','재테크','투자','성공','경영','마케팅','리더십','창업','비즈니스'],
  },
  {
    type:     '치유자형',
    emoji:    '🌿',
    desc:     '내면의 성장과 회복을 추구하는 독자',
    detail:   '자기 자신을 돌보고 내면을 치유하는 여정에 있습니다. 심리와 건강, 마음에 관심이 많습니다.',
    keywords: ['에세이','건강','심리','명상','힐링','종교','철학','치유','마음','건강/취미'],
  },
  {
    type:     '창조자형',
    emoji:    '🎨',
    desc:     '창작과 표현으로 자신을 드러내는 독자',
    detail:   '예술적 감각과 창의적 표현을 소중히 여깁니다. 사진, 음악, 디자인, 글쓰기로 세상과 소통합니다.',
    keywords: ['예술','음악','사진','그림','디자인','글쓰기','창작','문학','시나리오','공예'],
  },
];

/**
 * 선호 장르 → 독자 유형 분류 + 맞춤 도서 추천
 *
 * @param {string[]} selectedGenres  사용자가 선택한 장르 키워드 배열
 * @param {Array}    books            알라딘 도서 배열 (toFrontBook 변환 후)
 * @param {number}   [count=8]        반환 도서 수
 * @returns {{ type, emoji, desc, detail, selectedGenres, allTypes, books }}
 */
function classifyReaderType(selectedGenres, books, count = 8) {
  // 각 독자 유형별 점수 계산 (선택한 장르와 키워드 교집합)
  const typeScores = READER_TYPES.map(rt => {
    let score = 0;
    for (const g of selectedGenres) {
      for (const kw of rt.keywords) {
        if (g.includes(kw) || kw.includes(g)) score += 1;
      }
    }
    return { ...rt, score };
  });

  typeScores.sort((a, b) => b.score - a.score);
  const top = typeScores[0];

  // 맞춤 도서: 독자 유형 키워드 매칭 + 판매지수 정렬
  const matched = books
    .filter(b => top.keywords.some(kw => (b.categoryName || '').includes(kw)))
    .map(b => ({
      ...b,
      score : Math.round(Math.min(
        ((b.salesPoint || 0) / 500000) * 0.6 + ((b.average_rating || 0) / 5) * 0.4,
        1.0,
      ) * 100) / 100,
      reason: 'genre_match',
    }))
    .sort((a, b) => b.score - a.score || (b.salesPoint || 0) - (a.salesPoint || 0))
    .slice(0, count);

  // 매칭 도서가 3권 미만이면 판매지수 기반 인기 도서로 보완
  const result = matched.length >= 3 ? matched :
    [...books]
      .sort((a, b) => (b.salesPoint || 0) - (a.salesPoint || 0))
      .slice(0, count)
      .map(b => ({ ...b, score: 0.5, reason: 'collaborative' }));

  return {
    type:          top.type,
    emoji:         top.emoji,
    desc:          top.desc,
    detail:        top.detail,
    selectedGenres,
    allTypes:      typeScores.map(({ score: _s, keywords: _k, ...t }) => t),
    books:         result,
  };
}

module.exports = { tokenizeKo, buildTfidfVecs, cosine, mmrRecommend, classifyReaderType, READER_TYPES };
