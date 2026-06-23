/* BookWise — Vue 3 + Vue Router 4 SPA (CDN 방식) */
const { createApp, ref, computed, onMounted, watch, provide, inject } = Vue;
const { createRouter, createWebHashHistory } = VueRouter;

// ── 공통 유틸 ─────────────────────────────────────────────────────
const TIER_LABEL = { high: "상", mid: "중", low: "하" };

// ── 장르 한글화 매핑 ──────────────────────────────────────────────
const GENRE_KO = {
  'Fiction': '소설', 'Non-Fiction': '비소설', 'Self-Help': '자기계발',
  'Science': '과학', 'History': '역사', 'Mystery': '추리/미스터리',
  'Romance': '로맨스', 'Thriller': '스릴러', 'Biography': '전기/자서전',
  'Philosophy': '철학', 'Technology': '기술/IT', 'Art': '예술', 'Children': '아동',
  '소설': '소설', '자기계발': '자기계발', '경제/경영': '경제/경영', '인문': '인문',
  '역사': '역사', '과학': '과학', '에세이': '에세이', '시': '시/시집',
  'Literature': '문학', 'Business': '경제/경영', 'Health': '건강',
  'Travel': '여행', 'Cooking': '요리', 'Religion': '종교', 'Sports': '스포츠'
};
function koGenre(g) { return GENRE_KO[g] || g; }

// ── 기분 → 장르 매핑 ─────────────────────────────────────────────
const MOOD_MAP = {
  '설렘': ['소설/시/희곡', '한국소설', '2000년대 이후 한국소설', '순정만화', '본격장르만화'],
  '우울': ['에세이', '한국에세이', '외국에세이', '인문학', '교양 인문학'],
  '열정': ['경제경영', '자기계발', '재테크/투자', '주식/펀드', '사회과학'],
  '평온': ['인문학', '교양 인문학', '서양철학', '역사', '예술/대중문화'],
  '탐구': ['과학', '컴퓨터/모바일', '역사', '사회과학', '수험서/자격증']
};
const MOOD_ICONS = { '설렘': '😊', '우울': '😔', '열정': '🔥', '평온': '😌', '탐구': '🤔' };

// ── 커버 플레이스홀더 색상 ────────────────────────────────────────
const COVER_COLORS = [
  ['#dbeafe', '#1d4ed8'], ['#fce7f3', '#be185d'], ['#dcfce7', '#15803d'],
  ['#fef3c7', '#b45309'], ['#ede9fe', '#6d28d9'], ['#fee2e2', '#dc2626'],
  ['#cffafe', '#0e7490'], ['#f3e8ff', '#7c3aed']
];
function coverColors(title) {
  const code = (title || '').charCodeAt(0) || 0;
  return COVER_COLORS[code % COVER_COLORS.length];
}

function imgError(e) {
  const img = e.target;
  img.style.display = "none";
  const fb = img.nextElementSibling;
  // setProperty(..., 'important') — Vue :style 바인딩의 인라인 재설정을 차단
  if (fb) fb.style.setProperty('display', 'flex', 'important');
}
function imgLoad(e) {
  const img = e.target;
  // 알라딘 CDN이 로드됐으나 실제 픽셀이 없는 broken 이미지 처리
  if (!img.naturalWidth || img.naturalWidth < 5) {
    img.style.display = "none";
    const fb = img.nextElementSibling;
    if (fb) fb.style.setProperty('display', 'flex', 'important');
  }
}

// ── 전역 인증 상태 ────────────────────────────────────────────────
const auth = ref({ token: localStorage.getItem('bookwise_token'), user: null });

// ── API 헬퍼 ─────────────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  // Authorization: Bearer <token> — 로그인 토큰 자동 첨부
  if (auth.value.token) headers['Authorization'] = `Bearer ${auth.value.token}`;
  return fetch(url, { ...opts, headers });
}

// ── 인증 초기화 (앱 시작 시 토큰 검증) ──────────────────────────
async function initAuth() {
  if (!auth.value.token) return;
  try {
    const res = await apiFetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      auth.value.user = data.user;
    } else {
      auth.value.token = null;
      auth.value.user = null;
      localStorage.removeItem('bookwise_token');
    }
  } catch (e) {
    console.warn('인증 확인 실패:', e.message);
  }
}

// ── 로그아웃 ─────────────────────────────────────────────────────
async function logout() {
  try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch (_) {}
  auth.value.token = null;
  auth.value.user = null;
  localStorage.removeItem('bookwise_token');
}

// ── 조회수 관리 ───────────────────────────────────────────────────
function getViews() {
  try { return JSON.parse(localStorage.getItem('bookwise_views') || '{}'); } catch { return {}; }
}
function incrementView(bookId) {
  const views = getViews();
  views[String(bookId)] = (views[String(bookId)] || 0) + 1;
  localStorage.setItem('bookwise_views', JSON.stringify(views));
}
function getTopBooks(books, n = 5) {
  const views = getViews();
  return [...books]
    .filter(b => views[String(b.id)])
    .sort((a, b) => (views[String(b.id)] || 0) - (views[String(a.id)] || 0))
    .slice(0, n);
}

// ── 독서 달력 관리 ────────────────────────────────────────────────
function getCalendar() {
  try { return JSON.parse(localStorage.getItem('bookwise_calendar') || '{}'); } catch { return {}; }
}
function saveCalendar(cal) {
  localStorage.setItem('bookwise_calendar', JSON.stringify(cal));
}

// ── debounce 유틸 ─────────────────────────────────────────────────
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ── Home (/) ──────────────────────────────────────────────────────
const Home = {
  template: `
    <div>
      <!-- 히어로 -->
      <div class="hero-section">
        <div class="container text-center">
          <h1><i class="bi bi-stars me-2"></i>당신의 다음 책을 찾아드려요</h1>
          <p class="mb-4">AI가 취향을 분석해 딱 맞는 도서를 추천합니다</p>
          <router-link to="/books" class="btn btn-warning fw-bold px-4 py-2 me-2">
            <i class="bi bi-grid me-1"></i>전체 도서 보기
          </router-link>
          <router-link to="/community" class="btn btn-outline-light px-4 py-2">
            <i class="bi bi-people me-1"></i>커뮤니티
          </router-link>
        </div>
      </div>

      <div class="container py-5">
        <!-- 서비스 특징 -->
        <div class="row g-4 mb-5">
          <div class="col-md-4" v-for="f in features" :key="f.icon">
            <div class="text-center p-4 rounded-3" style="background:var(--bw-card-bg); border:1px solid var(--bw-border);">
              <div class="fs-2 mb-2">{{ f.icon }}</div>
              <h5 class="fw-700 mb-1">{{ f.title }}</h5>
              <p class="text-muted small mb-0">{{ f.desc }}</p>
            </div>
          </div>
        </div>

        <!-- 기분 기반 추천 -->
        <h2 class="section-title mb-3">
          <i class="bi bi-emoji-smile text-warning"></i>지금 기분에 맞는 책
        </h2>
        <div class="d-flex flex-wrap gap-2 mb-3">
          <button
            v-for="(icon, mood) in moodIcons"
            :key="mood"
            @click="selectMood(mood)"
            :class="['btn btn-sm', activeMood === mood ? 'btn-primary' : 'btn-outline-secondary']"
          >{{ icon }} {{ mood }}</button>
        </div>
        <div v-if="moodLoading" class="d-flex gap-2 mb-5">
          <div v-for="i in 6" :key="i" class="flex-fill rounded-3" style="height:160px;background:linear-gradient(90deg,#e2e8f0 25%,#f1f5f9 50%,#e2e8f0 75%);background-size:200% 100%;animation:bw-skeleton-shimmer 1.5s ease-in-out infinite;"></div>
        </div>
        <div v-else-if="moodBooks.length > 0" class="row row-cols-2 row-cols-sm-3 row-cols-lg-6 g-3 mb-5">
          <div class="col" v-for="book in moodBooks" :key="book.id">
            <router-link :to="'/books/' + book.id" style="text-decoration:none;">
              <div class="book-card">
                <div class="cover-wrap">
                  <img
                    v-if="book.cover_url"
                    :src="book.cover_url"
                    :alt="book.title"
                    onerror="this.onerror=null;this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTQwIiB2aWV3Qm94PSIwIDAgMTAwIDE0MCI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxNDAiIGZpbGw9IiNlMmU4ZjAiIHJ4PSI0Ii8+PHRleHQgeD0iNTAiIHk9IjgwIiBmb250LXNpemU9IjExIiBmaWxsPSIjOTRhM2I4IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiI+Tk8gQ09WRVI8L3RleHQ+PC9zdmc+'"
                    @load="imgLoad"
                    loading="lazy"
                  />
                  <div class="cover-fallback"
                    :style="{ display: book.cover_url ? 'none' : 'flex', background: coverBg(book.title), color: coverFg(book.title) }">
                    {{ coverText(book.title) }}
                  </div>
                </div>
                <div class="card-body">
                  <div class="card-title">{{ book.title }}</div>
                  <div class="card-author">{{ book.author }}</div>
                </div>
              </div>
            </router-link>
          </div>
        </div>

        <!-- 트렌드 Top5 -->
        <div v-if="trendBooks.length > 0" class="mb-5">
          <h2 class="section-title">
            <i class="bi bi-graph-up-arrow text-danger"></i>지금 주목받는 책
          </h2>
          <div class="row g-3">
            <div class="col-12 col-md-6" v-for="(book, idx) in trendBooks" :key="book.id">
              <router-link :to="'/books/' + book.id" class="d-flex align-items-center gap-3 p-3 rounded-3 trend-item" style="text-decoration:none; background:var(--bw-card-bg); border:1px solid var(--bw-border);">
                <div class="trend-rank">{{ idx + 1 }}</div>
                <div class="cover-wrap-sm" style="width:44px;height:60px;flex-shrink:0;border-radius:6px;overflow:hidden;background:#f1f5f9;">
                  <img v-if="book.cover_url" :src="book.cover_url" :alt="book.title" onerror="this.onerror=null;this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTQwIiB2aWV3Qm94PSIwIDAgMTAwIDE0MCI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxNDAiIGZpbGw9IiNlMmU4ZjAiIHJ4PSI0Ii8+PHRleHQgeD0iNTAiIHk9IjgwIiBmb250LXNpemU9IjExIiBmaWxsPSIjOTRhM2I4IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiI+Tk8gQ09WRVI8L3RleHQ+PC9zdmc+'" @load="imgLoad" style="width:100%;height:100%;object-fit:cover;" />
                  <div v-else class="w-100 h-100 d-flex align-items-center justify-content-center"
                    :style="{ background: coverBg(book.title), color: coverFg(book.title), fontSize:'1rem', fontWeight:700 }">
                    {{ coverText(book.title) }}
                  </div>
                </div>
                <div>
                  <div class="fw-600 small" style="color:var(--bw-text);">{{ book.title }}</div>
                  <div class="text-muted" style="font-size:.78rem;">{{ book.author }}</div>
                  <div class="small text-muted"><i class="bi bi-eye me-1"></i>{{ trendViews[book.id] || 0 }}회</div>
                </div>
              </router-link>
            </div>
          </div>
        </div>

        <!-- 오늘의 추천 도서 6권 -->
        <h2 class="section-title">
          <i class="bi bi-fire text-warning"></i>오늘의 추천 도서
        </h2>

        <!-- 스켈레톤: 로딩 중 빈 화면 방지 -->
        <div v-if="loading" class="row row-cols-2 row-cols-sm-3 row-cols-lg-6 g-3 mb-5">
          <div class="col" v-for="i in 6" :key="'sk-'+i">
            <div class="book-card" style="pointer-events:none;">
              <div class="cover-wrap" style="background:linear-gradient(90deg,#e2e8f0 25%,#f1f5f9 50%,#e2e8f0 75%);background-size:200% 100%;animation:bw-skeleton-shimmer 1.5s ease-in-out infinite;"></div>
              <div class="card-body">
                <div style="height:12px;border-radius:4px;background:#e2e8f0;margin-bottom:6px;animation:bw-skeleton-shimmer 1.5s ease-in-out infinite;"></div>
                <div style="height:10px;border-radius:4px;background:#e2e8f0;width:60%;animation:bw-skeleton-shimmer 1.5s ease-in-out infinite;"></div>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="featured.length === 0" class="text-center text-muted py-4">
          도서 데이터를 불러오는 중입니다…
        </div>

        <div v-else class="row row-cols-2 row-cols-sm-3 row-cols-lg-6 g-3 mb-5">
          <div class="col" v-for="book in featured" :key="book.id">
            <router-link :to="'/books/' + book.id" style="text-decoration:none;">
              <div class="book-card">
                <div class="cover-wrap">
                  <img
                    v-if="book.cover_url"
                    :src="book.cover_url"
                    :alt="book.title"
                    onerror="this.onerror=null;this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTQwIiB2aWV3Qm94PSIwIDAgMTAwIDE0MCI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxNDAiIGZpbGw9IiNlMmU4ZjAiIHJ4PSI0Ii8+PHRleHQgeD0iNTAiIHk9IjgwIiBmb250LXNpemU9IjExIiBmaWxsPSIjOTRhM2I4IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiI+Tk8gQ09WRVI8L3RleHQ+PC9zdmc+'"
                    @load="imgLoad"
                    loading="lazy"
                  />
                  <div class="cover-fallback"
                    :style="{ display: book.cover_url ? 'none' : 'flex', background: coverBg(book.title), color: coverFg(book.title) }">
                    {{ coverText(book.title) }}
                  </div>
                </div>
                <div class="card-body">
                  <div class="card-title">{{ book.title }}</div>
                  <div class="card-author">{{ book.author }}</div>
                  <div class="d-flex flex-wrap gap-1">
                    <span
                      v-for="g in book.genre.slice(0,2)"
                      :key="g"
                      class="genre-badge"
                    >{{ koGenre(g) }}</span>
                  </div>
                </div>
              </div>
            </router-link>
          </div>
        </div>

        <!-- 통계 -->
        <div class="row g-4" v-if="!loading && stats.books">
          <div class="col-6 col-md-3" v-for="s in stats.items" :key="s.label">
            <div class="text-center p-3 rounded-3" style="background:var(--bw-card-bg); border:1px solid var(--bw-border);">
              <div class="fs-3 fw-800 mb-0" style="color:var(--bw-primary);">{{ s.value }}</div>
              <div class="small text-muted">{{ s.label }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  setup() {
    const loading = ref(true);
    const featured = ref([]);
    const stats = ref({ books: 0, items: [] });
    const activeMood = ref('');
    const moodIcons = MOOD_ICONS;
    const trendBooks = ref([]);
    const trendViews = ref({});
    const moodBooks = ref([]);       // 서버 API 결과 (computed 아님)
    const moodLoading = ref(false);

    const features = [
      { icon: "🤖", title: "AI 추천", desc: "TF-IDF 알고리즘으로 취향에 꼭 맞는 도서를 분석합니다" },
      { icon: "📚", title: "460권+ 한국 도서", desc: "알라딘 베스트셀러 기반 실제 한국 도서 데이터" },
      { icon: "💬", title: "독서 커뮤니티", desc: "같은 책을 읽은 독자들과 감상을 나눠보세요" },
    ];

    // 기분 선택 → 서버 /api/books/mood/:mood 호출 (클라이언트 전체 데이터 불필요)
    async function selectMood(mood) {
      if (activeMood.value === mood) {
        activeMood.value = '';
        moodBooks.value = [];
        return;
      }
      activeMood.value = mood;
      moodLoading.value = true;
      moodBooks.value = [];
      try {
        const res = await apiFetch(`/api/books/mood/${encodeURIComponent(mood)}`);
        if (res.ok) {
          const json = await res.json();
          moodBooks.value = (json.items || []).slice(0, 6);
        }
      } catch (e) {
        console.warn('기분 추천 실패:', e.message);
      } finally {
        moodLoading.value = false;
      }
    }

    function coverBg(title) { return coverColors(title)[0]; }
    function coverFg(title) { return coverColors(title)[1]; }
    function coverText(title) { return (title || '').slice(0, 2); }

    function loadTrend(books) {
      const views = getViews();
      trendViews.value = views;
      trendBooks.value = getTopBooks(books, 5);
    }

    onMounted(async () => {
      // 초기 로드: 30권만 + 통계는 /api/stats 병렬 호출 → 페이로드 대폭 축소
      try {
        const [booksRes, statsRes] = await Promise.all([
          apiFetch('/api/books?q=&limit=30'),
          apiFetch('/api/stats').catch(() => null),
        ]);
        const json = await booksRes.json();
        const data = json.data || [];

        // 평점 기준 상위 6권 추출
        const sorted = [...data].sort((a, b) => (b.average_rating || 0) - (a.average_rating || 0));
        const top = sorted.filter((b) => b.average_rating > 0).slice(0, 6);
        if (top.length < 6) {
          const rest = data.filter((b) => !top.find((t) => t.id === b.id));
          top.push(...rest.slice(0, 6 - top.length));
        }
        featured.value = top;
        loadTrend(data);

        // 통계: /api/stats 경량 응답 우선, 없으면 부분 데이터로 대체
        if (statsRes && statsRes.ok) {
          const s = await statsRes.json();
          stats.value = {
            books: s.total_books || data.length,
            items: [
              { value: (s.total_books || data.length) + "권", label: "수록 도서" },
              { value: (s.total_categories || 0) + "개", label: "카테고리" },
              { value: "Top-5", label: "추천 정확도" },
              { value: "TF-IDF", label: "추천 알고리즘" },
            ],
          };
        } else {
          const genres = new Set(data.flatMap((b) => b.genre));
          stats.value = {
            books: json.total || data.length,
            items: [
              { value: (json.total || data.length) + "권", label: "수록 도서" },
              { value: genres.size + "개", label: "장르" },
              { value: "Top-5", label: "추천 정확도" },
              { value: "TF-IDF", label: "추천 알고리즘" },
            ],
          };
        }
      } catch (e) {
        console.warn("도서 API 로드 실패:", e.message);
      } finally {
        loading.value = false;
      }
    });

    return { loading, featured, stats, features, imgError, imgLoad, koGenre,
      activeMood, moodIcons, moodBooks, moodLoading, selectMood,
      trendBooks, trendViews,
      coverBg, coverFg, coverText };
  },
};

// ── BookList (/books) ─────────────────────────────────────────────
const BookList = {
  template: `
    <div class="container py-4">
      <h1 class="section-title mb-3">
        <i class="bi bi-collection-fill text-primary"></i>전체 도서목록
      </h1>

      <!-- 검색 + 정렬 -->
      <div class="row g-2 mb-3">
        <div class="col-sm-8 col-md-7">
          <div class="search-wrap">
            <i class="bi bi-search"></i>
            <input
              ref="searchInput"
              v-model="displayQuery"
              type="text"
              class="form-control"
              placeholder="제목·저자 검색..."
              @compositionstart="composing = true"
              @compositionend="onCompositionEnd"
              @input="onInput"
            />
          </div>
        </div>
        <div class="col-sm-4 col-md-3">
          <select v-model="sortBy" class="form-select form-select-sm" style="height:38px;">
            <option value="default">기본순</option>
            <option value="popular">판매 인기순 🔥</option>
            <option value="rating">평점 높은순 ⭐</option>
            <option value="recent">최신 출판순 📅</option>
            <option value="alpha">가나다순 🔤</option>
          </select>
        </div>
        <div class="col-md-2 d-none d-md-flex align-items-center justify-content-end">
          <span class="text-muted small">총 <strong>{{ filtered.length }}</strong>권</span>
        </div>
      </div>
      <!-- 장르 필터 (가로 스크롤 — 모바일 UX) -->
      <div class="d-flex gap-2 mb-4 bw-genre-scroll">
        <button
          @click="activeGenre = ''"
          :class="['btn btn-sm flex-shrink-0', activeGenre === '' ? 'btn-primary' : 'btn-outline-secondary']"
        >전체</button>
        <button
          v-for="g in genres"
          :key="g"
          @click="activeGenre = g"
          :class="['btn btn-sm flex-shrink-0', activeGenre === g ? 'btn-primary' : 'btn-outline-secondary']"
        >{{ koGenre(g) }}</button>
      </div>

      <!-- 스켈레톤 로딩 (빈 화면 방지) -->
      <div v-if="loading" class="row row-cols-2 row-cols-sm-3 row-cols-md-4 row-cols-lg-5 g-3">
        <div class="col" v-for="i in 20" :key="'sk-'+i">
          <div class="book-card" style="pointer-events:none;">
            <div class="cover-wrap" style="background:linear-gradient(90deg,#e2e8f0 25%,#f1f5f9 50%,#e2e8f0 75%);background-size:200% 100%;animation:bw-skeleton-shimmer 1.5s ease-in-out infinite;"></div>
            <div class="card-body">
              <div style="height:11px;border-radius:4px;background:#e2e8f0;margin-bottom:6px;animation:bw-skeleton-shimmer 1.5s ease-in-out infinite;"></div>
              <div style="height:9px;border-radius:4px;background:#e2e8f0;width:55%;animation:bw-skeleton-shimmer 1.5s ease-in-out infinite;"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 결과 없음 -->
      <div v-else-if="filtered.length === 0" class="text-center text-muted py-5">
        <i class="bi bi-search fs-1 d-block mb-2"></i>
        검색 결과가 없습니다.
      </div>

      <!-- 도서 그리드 -->
      <div v-else class="row row-cols-2 row-cols-sm-3 row-cols-md-4 row-cols-lg-5 g-3">
        <div class="col" v-for="book in slicedBooks" :key="book.id">
          <router-link :to="'/books/' + book.id" style="text-decoration:none;">
            <div class="book-card">
              <div class="cover-wrap">
                <img
                  v-if="book.cover_url"
                  :src="book.cover_url"
                  :alt="book.title"
                  onerror="this.onerror=null;this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTQwIiB2aWV3Qm94PSIwIDAgMTAwIDE0MCI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxNDAiIGZpbGw9IiNlMmU4ZjAiIHJ4PSI0Ii8+PHRleHQgeD0iNTAiIHk9IjgwIiBmb250LXNpemU9IjExIiBmaWxsPSIjOTRhM2I4IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiI+Tk8gQ09WRVI8L3RleHQ+PC9zdmc+'"
                  @load="imgLoad"
                  loading="lazy"
                />
                <div class="cover-fallback"
                  :style="{ display: book.cover_url ? 'none' : 'flex', background: coverBg(book.title), color: coverFg(book.title) }">
                  {{ coverText(book.title) }}
                </div>
              </div>
              <div class="card-body">
                <div class="card-title">{{ book.title }}</div>
                <div class="card-author">{{ book.author }}</div>
                <div v-if="book.publisher" class="card-publisher">{{ book.publisher }}</div>
                <div v-if="book.pubDate" class="card-pubdate">{{ book.pubDate }}</div>
                <div class="d-flex flex-wrap gap-1 mt-1">
                  <span v-for="g in book.genre.slice(0,2)" :key="g" class="genre-badge">{{ koGenre(g) }}</span>
                </div>
                <div v-if="book.average_rating > 0" class="mt-1 small text-warning">
                  <i class="bi bi-star-fill"></i> {{ book.average_rating.toFixed(1) }}
                </div>
              </div>
            </div>
          </router-link>
        </div>
      </div>

      <!-- 무한 스크롤 sentinel + 더 보기 버튼 -->
      <div v-if="!loading && hasMore" class="text-center mt-4 pb-2">
        <div ref="sentinel" style="height:1px;"></div>
        <button @click="loadMore" class="btn btn-outline-primary px-5">
          <i class="bi bi-chevron-down me-1"></i>더 보기
          ({{ Math.max(0, serverTotal - visibleCount) || Math.max(0, filtered.length - visibleCount) }}권 남음)
        </button>
      </div>

      <!-- 카운트 -->
      <p v-if="!loading" class="text-muted small mt-3">
        {{ slicedBooks.length }} / {{ serverTotal || filtered.length }}권 표시 중 (로드됨 {{ books.length }}권)
      </p>
    </div>
  `,
  setup() {
    const loading = ref(true);
    const books = ref([]);
    const displayQuery = ref("");
    const query = ref("");
    const activeGenre = ref("");
    const sortBy = ref("default");
    const composing = ref(false);
    const PAGE_SIZE = 48;
    const visibleCount = ref(PAGE_SIZE);
    const sentinel = ref(null);
    let observer = null;

    const debouncedSetQuery = debounce((val) => { query.value = val; }, 300);

    function onInput(e) {
      if (!composing.value) {
        debouncedSetQuery(e.target.value);
      }
    }
    function onCompositionEnd(e) {
      composing.value = false;
      query.value = e.target.value;
    }

    function coverBg(title) { return coverColors(title)[0]; }
    function coverFg(title) { return coverColors(title)[1]; }
    function coverText(title) { return (title || '').slice(0, 2); }

    const genres = computed(() => {
      // 10권 이상 장르만, 빈도 내림차순 (전체 321개 → 약 27개로 축소)
      const count = {};
      books.value.flatMap((b) => b.genre || []).forEach((g) => { count[g] = (count[g] || 0) + 1; });
      return Object.entries(count)
        .filter(([, c]) => c >= 10)
        .sort((a, b) => b[1] - a[1])
        .map(([g]) => g);
    });

    const filtered = computed(() => {
      let list = books.value;
      if (activeGenre.value) {
        list = list.filter((b) => b.genre.includes(activeGenre.value));
      }
      const q = query.value.trim().toLowerCase();
      if (q) {
        list = list.filter(
          (b) =>
            b.title.toLowerCase().includes(q) ||
            (b.author || "").toLowerCase().includes(q)
        );
      }
      // 정렬
      const sorted = [...list];
      if (sortBy.value === 'popular') {
        sorted.sort((a, b) => (b.salesPoint || 0) - (a.salesPoint || 0));
      } else if (sortBy.value === 'rating') {
        sorted.sort((a, b) => (b.average_rating || 0) - (a.average_rating || 0));
      } else if (sortBy.value === 'recent') {
        sorted.sort((a, b) => {
          const da = a.pubDate ? new Date(a.pubDate) : new Date('1900-01-01');
          const db = b.pubDate ? new Date(b.pubDate) : new Date('1900-01-01');
          return db - da;
        });
      } else if (sortBy.value === 'alpha') {
        sorted.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ko'));
      }
      return sorted;
    });

    // 필터·정렬·검색 변경 시만 페이지 리셋 (books 추가 시 리셋 방지)
    watch([activeGenre, sortBy, query], () => { visibleCount.value = PAGE_SIZE; });

    const slicedBooks = computed(() => filtered.value.slice(0, visibleCount.value));

    const serverTotal = ref(0);   // 서버 전체 도서 수
    let serverPage = 1;            // 현재 로드된 페이지
    let fetchingMore = false;      // 동시 로드 방지 guard

    // 서버에서 한 페이지(limit=48) 가져오기
    async function fetchBooks(searchQuery, page = 1) {
      const q = (searchQuery || '').trim();
      const url = q
        ? `/api/books?q=${encodeURIComponent(q)}&limit=100&page=${page}`
        : `/api/books?q=&limit=48&page=${page}`;
      const res = await apiFetch(url);
      const json = await res.json();
      return { data: json.data || [], total: json.total || 0 };
    }

    // 검색어 변경 시 서버 재조회 (장르·정렬은 클라이언트 필터 유지)
    watch(query, async (val) => {
      try {
        const result = await fetchBooks(val, 1);
        books.value = result.data;
        serverTotal.value = result.total;
        serverPage = 1;
        visibleCount.value = PAGE_SIZE;
      } catch (e) {
        console.warn('도서 검색 실패:', e.message);
      }
    });

    // 더 보기: 로컬 books에 남은 게 있으면 visibleCount만 늘리고,
    // 모두 노출됐으면 서버에서 다음 페이지 추가 fetch
    async function loadMore() {
      if (visibleCount.value < filtered.value.length) {
        visibleCount.value = Math.min(visibleCount.value + PAGE_SIZE, filtered.value.length);
      } else if (books.value.length < serverTotal.value && !query.value.trim()) {
        if (fetchingMore) return;
        fetchingMore = true;
        try {
          serverPage++;
          const result = await fetchBooks('', serverPage);
          if (result.data.length > 0) {
            books.value = [...books.value, ...result.data];
            // filtered는 books 갱신 후 재계산됨 — 바로 filtered.length 사용 가능
            visibleCount.value = Math.min(visibleCount.value + PAGE_SIZE, filtered.value.length);
          }
        } catch (e) {
          console.warn('추가 도서 로드 실패:', e.message);
          serverPage--;
        } finally {
          fetchingMore = false;
        }
      }
    }

    // hasMore: 로컬 미표시 OR 서버에 더 있는 경우 (검색 없을 때)
    const hasMore = computed(() =>
      visibleCount.value < filtered.value.length ||
      (books.value.length < serverTotal.value && !query.value.trim())
    );

    // Intersection Observer — sentinel이 뷰포트에 들어오면 자동 로드
    function setupObserver() {
      if (!window.IntersectionObserver) return;
      observer = new IntersectionObserver(
        (entries) => { if (entries[0].isIntersecting && hasMore.value) loadMore(); },
        { rootMargin: '200px' }
      );
      if (sentinel.value) observer.observe(sentinel.value);
    }

    onMounted(async () => {
      try {
        // 첫 48권만 로드 — 체감 속도 대폭 개선 (기존 500 → 48)
        const result = await fetchBooks('', 1);
        books.value = result.data;
        serverTotal.value = result.total;
      } catch (e) {
        console.warn("도서 API 로드 실패:", e.message);
      } finally {
        loading.value = false;
        Vue.nextTick(setupObserver);
      }
    });

    return { loading, books, displayQuery, query, activeGenre, sortBy, genres, filtered,
      slicedBooks, hasMore, visibleCount, loadMore, sentinel, serverTotal,
      imgError, imgLoad, koGenre, composing, onInput, onCompositionEnd, coverBg, coverFg, coverText };
  },
};

// ── BookDetail (/books/:id) ───────────────────────────────────────
const BookDetail = {
  template: `
    <div class="container py-4">
      <router-link to="/books" class="btn btn-sm btn-outline-secondary mb-3">
        <i class="bi bi-arrow-left me-1"></i>목록으로
      </router-link>

      <div v-if="loading" class="spinner-wrap"><div class="spinner-border text-primary"></div></div>

      <div v-else-if="!book" class="text-center py-5 text-muted">
        <i class="bi bi-exclamation-circle fs-1 d-block mb-2"></i>
        도서를 찾을 수 없습니다.
      </div>

      <div v-else>
        <!-- 상단: 표지 + 기본 정보 -->
        <div class="row g-4 mb-4">
          <div class="col-md-3 col-sm-4">
            <div class="position-relative rounded-3 overflow-hidden" style="background:#f1f5f9;">
              <img
                v-if="book.cover_url"
                :src="book.cover_url"
                :alt="book.title"
                class="w-100 d-block"
                style="aspect-ratio:2/3; object-fit:cover;"
                onerror="this.onerror=null;this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTQwIiB2aWV3Qm94PSIwIDAgMTAwIDE0MCI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxNDAiIGZpbGw9IiNlMmU4ZjAiIHJ4PSI0Ii8+PHRleHQgeD0iNTAiIHk9IjgwIiBmb250LXNpemU9IjExIiBmaWxsPSIjOTRhM2I4IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiI+Tk8gQ09WRVI8L3RleHQ+PC9zdmc+'"
                @load="imgLoad"
              />
              <div v-else class="d-flex align-items-center justify-content-center fw-bold"
                :style="{ aspectRatio:'2/3', background: coverBg(book.title), color: coverFg(book.title), fontSize:'3rem' }">
                {{ coverText(book.title) }}
              </div>
            </div>
          </div>

          <div class="col-md-9 col-sm-8">
            <div class="d-flex flex-wrap gap-2 mb-2">
              <span v-for="g in book.genre" :key="g" class="genre-badge">{{ koGenre(g) }}</span>
            </div>
            <h1 class="fw-800 mb-1" style="font-size:1.6rem; line-height:1.3;">{{ book.title }}</h1>
            <p class="text-muted mb-2">{{ book.authors ? book.authors.join(', ') : book.author }}</p>

            <div class="d-flex flex-wrap gap-3 mb-3 small text-muted">
              <span v-if="book.publisher">
                <i class="bi bi-building me-1"></i>{{ book.publisher }}
              </span>
              <span v-if="book.pubDate">
                <i class="bi bi-calendar3 me-1"></i>{{ book.pubDate }}
              </span>
              <span v-else-if="book.published_year">
                <i class="bi bi-calendar3 me-1"></i>{{ book.published_year }}
              </span>
              <span v-if="book.isbn">
                <i class="bi bi-upc me-1"></i>{{ book.isbn }}
              </span>
              <span v-if="book.average_rating > 0">
                <i class="bi bi-star-fill text-warning me-1"></i>{{ book.average_rating.toFixed(1) }}
              </span>
              <span>
                <i class="bi bi-eye me-1"></i>조회 {{ viewCount }}회
              </span>
            </div>

            <p class="lh-base" style="color:var(--bw-text);">{{ book.description }}</p>

            <router-link
              to="/community"
              class="btn btn-sm btn-outline-primary mt-2"
            >
              <i class="bi bi-chat-dots me-1"></i>커뮤니티에 감상 남기기
            </router-link>
          </div>
        </div>

        <!-- 추천 도서 -->
        <div v-if="recommendations.length > 0">
          <h2 class="section-title">
            <i class="bi bi-lightning-charge-fill text-warning"></i>이 책을 읽은 분께 추천
          </h2>
          <div class="row g-3">
            <div
              class="col-12 col-md-6"
              v-for="rec in recommendations"
              :key="rec.id"
              :data-tier="rec.tier"
            >
              <router-link :to="'/books/' + rec.id" class="rec-card">
                <img
                  v-if="rec.cover_url || rec.cover"
                  :src="rec.cover_url || rec.cover"
                  :alt="rec.title"
                  onerror="this.onerror=null;this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTQwIiB2aWV3Qm94PSIwIDAgMTAwIDE0MCI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxNDAiIGZpbGw9IiNlMmU4ZjAiIHJ4PSI0Ii8+PHRleHQgeD0iNTAiIHk9IjgwIiBmb250LXNpemU9IjExIiBmaWxsPSIjOTRhM2I4IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiI+Tk8gQ09WRVI8L3RleHQ+PC9zdmc+'"
                  @load="imgLoad"
                />
                <div v-else
                  :style="{ width:'52px', height:'72px', background: coverBg(rec.title||''), color: coverFg(rec.title||''), borderRadius:'6px', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontWeight:700 }">
                  {{ coverText(rec.title || '') }}
                </div>
                <div class="rec-info">
                  <div class="d-flex align-items-center gap-2 mb-1">
                    <span class="tier-badge">{{ TIER_LABEL[rec.tier] }}</span>
                    <span class="small text-warning" :title="'매칭 ' + (rec.score * 100).toFixed(0) + '%'">{{ scoreToStars(rec.score) }}</span>
                    <span v-if="rec.categoryName" class="small text-muted">· {{ rec.categoryName.split('>').pop() }}</span>
                  </div>
                  <div class="rec-title">{{ rec.title || getBook(rec.id)?.title || '...' }}</div>
                  <div class="rec-reason">{{ rec.reason }}</div>
                </div>
              </router-link>
            </div>
          </div>
        </div>
        <div v-else class="text-muted small mt-2">추천 데이터를 준비 중입니다.</div>
      </div>
    </div>
  `,
  setup() {
    const route = VueRouter.useRoute();
    const loading = ref(true);
    const book = ref(null);
    const recommendations = ref([]);
    const allBooks = ref([]);
    const viewCount = ref(0);

    function getBook(id) {
      return allBooks.value.find((b) => b.id === String(id));
    }

    function coverBg(title) { return coverColors(title)[0]; }
    function coverFg(title) { return coverColors(title)[1]; }
    function coverText(title) { return (title || '').slice(0, 2); }

    // reason 영문 enum → 한국어 레이블 (서버 내부 레이블 → 사용자 친화 문구)
    const REASON_KO = {
      content_based:  '내용 기반 추천',
      title_match:    '제목 연관 추천',
      author_match:   '저자 연관 추천',
      category_match: '장르 기반 추천',
      genre_match:    '장르 기반 추천',
      popular:        '인기 도서',
      sales_rank:     '판매 순위 추천',
      collaborative:  '독자 취향 일치',
      emotion_based:  '감성 연관 추천',
    };

    /** score(0.0~1.0) → 별점 문자열 (예: 0.8 → "★★★★☆") */
    function scoreToStars(score) {
      const n = typeof score === 'number' ? score : parseFloat(score) || 0;
      const filled = Math.round(n * 5);   // 0~5 정수
      return '★'.repeat(filled) + '☆'.repeat(5 - filled);
    }

    async function load(id) {
      loading.value = true;
      try {
        // /api/books/:id — 단건 도서 상세
        const res = await apiFetch(`/api/books/${encodeURIComponent(id)}`);
        if (res.ok) {
          const json = await res.json();
          book.value = json;
          allBooks.value = [json]; // getBook() 호환 유지

          // ── 결함 2 fix: /api/recommend?q=<title> — 키워드 기반 AI 추천 ──
          let recs = [];
          try {
            const rRes = await apiFetch(`/api/recommend?q=${encodeURIComponent(json.title || '')}`);
            if (rRes.ok) {
              const rJson = await rRes.json();
              recs = (rJson.results || [])
                .filter(r => String(r.id) !== String(id)) // 현재 책 제외
                .map(r => ({
                  ...r,
                  cover_url: r.cover_url || r.cover,
                  // tier 파생 (score 기반)
                  tier: r.score >= 0.7 ? 'high' : r.score >= 0.4 ? 'mid' : 'low',
                  // 영문 reason → 한국어 (알 수 없는 값은 'AI 추천')
                  reason: REASON_KO[r.reason] || 'AI 추천',
                }));
            }
          } catch (_) {}

          // fallback: 임베디드 TF-IDF 추천
          if (recs.length === 0) {
            recs = (json.recommendations || []).map(r => ({
              ...r,
              cover_url: r.cover_url || r.cover,
            }));
          }
          recommendations.value = recs;
        } else {
          book.value = null;
          recommendations.value = [];
        }
        // 조회수 증가
        incrementView(id);
        const views = getViews();
        viewCount.value = views[String(id)] || 1;
      } catch (e) {
        console.warn("BookDetail 로드 실패:", e.message);
      } finally {
        loading.value = false;
      }
    }

    onMounted(() => load(route.params.id));
    watch(() => route.params.id, (id) => id && load(id));

    return { loading, book, recommendations, allBooks, getBook, TIER_LABEL, imgError, imgLoad, koGenre,
      viewCount, coverBg, coverFg, coverText, scoreToStars };
  },
};

// ── CommunityList (/community) ────────────────────────────────────
const CommunityList = {
  template: `
    <div class="container py-4">
      <div class="d-flex align-items-center justify-content-between mb-4">
        <h1 class="section-title mb-0">
          <i class="bi bi-people-fill text-primary"></i>독서 커뮤니티
        </h1>
        <button v-if="isLoggedIn" class="btn btn-primary btn-sm" @click="showForm = !showForm">
          <i class="bi bi-pencil-square me-1"></i>새 글 작성
        </button>
      </div>

      <!-- 비로그인 안내 -->
      <div v-if="!isLoggedIn" class="alert alert-info d-flex align-items-center gap-3 mb-4">
        <i class="bi bi-lock fs-5"></i>
        <span>로그인 후 글을 작성할 수 있습니다.
          <a href="#" @click.prevent="openAuthModal" class="fw-semibold">로그인</a>
        </span>
      </div>

      <!-- 글 작성 폼 (로그인 시만) -->
      <div v-if="showForm && isLoggedIn" class="card mb-4 shadow-sm">
        <div class="card-body">
          <h5 class="card-title mb-3">새 게시글</h5>
          <div class="mb-2 text-muted small">
            <i class="bi bi-person me-1"></i>작성자: <strong>{{ currentUser.username }}</strong>
          </div>
          <div class="mb-2">
            <input v-model="form.title" type="text" class="form-control" placeholder="제목 *" />
          </div>
          <div class="mb-3">
            <textarea
              v-model="form.content"
              class="form-control"
              rows="4"
              placeholder="내용 *"
            ></textarea>
          </div>
          <div class="d-flex gap-2">
            <button class="btn btn-primary btn-sm" @click="submit" :disabled="submitting">
              {{ submitting ? '등록 중…' : '등록' }}
            </button>
            <button class="btn btn-outline-secondary btn-sm" @click="showForm = false">취소</button>
          </div>
          <div v-if="formError" class="text-danger small mt-2">{{ formError }}</div>
        </div>
      </div>

      <!-- 로딩 -->
      <div v-if="loading" class="spinner-wrap"><div class="spinner-border text-primary"></div></div>

      <!-- 빈 목록 -->
      <div v-else-if="posts.length === 0" class="text-center py-5 text-muted">
        <i class="bi bi-chat-square-text fs-1 d-block mb-2"></i>
        아직 게시글이 없습니다. 첫 글을 작성해보세요!
      </div>

      <!-- 목록 -->
      <div v-else class="d-flex flex-column gap-3">
        <router-link
          v-for="p in posts"
          :key="p.id"
          :to="'/community/' + p.id"
          class="post-card"
        >
          <div class="post-title">{{ p.title }}</div>
          <div class="post-meta">
            <i class="bi bi-person me-1"></i>{{ p.author || '익명' }}
            <span class="ms-3"><i class="bi bi-clock me-1"></i>{{ fmtDate(p.created_at) }}</span>
          </div>
          <p class="small text-muted mt-2 mb-0 lh-base" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
            {{ p.content }}
          </p>
        </router-link>
      </div>
    </div>
  `,
  setup() {
    const loading = ref(true);
    const posts = ref([]);
    const showForm = ref(false);
    const submitting = ref(false);
    const formError = ref("");
    const form = ref({ title: "", content: "" });

    const isLoggedIn = computed(() => !!auth.value.user);
    const currentUser = computed(() => auth.value.user || {});

    function openAuthModal() {
      const modal = document.getElementById('authModal');
      if (modal && window.bootstrap) {
        const m = new window.bootstrap.Modal(modal);
        m.show();
      }
    }

    function fmtDate(iso) {
      if (!iso) return "";
      const d = new Date(iso);
      return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
    }

    async function loadPosts() {
      loading.value = true;
      try {
        const res = await apiFetch("/api/posts");
        const data = await res.json();
        posts.value = data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      } catch (e) {
        console.warn("posts 로드 실패:", e.message);
      } finally {
        loading.value = false;
      }
    }

    async function submit() {
      formError.value = "";
      if (!form.value.title.trim() || !form.value.content.trim()) {
        formError.value = "제목과 내용을 입력해주세요.";
        return;
      }
      submitting.value = true;
      try {
        const payload = {
          title: form.value.title,
          content: form.value.content,
          author: currentUser.value.username || '익명'
        };
        const res = await apiFetch("/api/posts", {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('등록 실패');
        const data = await res.json();
        posts.value.unshift(data);
        form.value = { title: "", content: "" };
        showForm.value = false;
      } catch (e) {
        formError.value = "등록에 실패했습니다. 다시 시도해주세요.";
      } finally {
        submitting.value = false;
      }
    }

    onMounted(loadPosts);

    return { loading, posts, showForm, form, submitting, formError, submit, fmtDate,
      isLoggedIn, currentUser, openAuthModal };
  },
};

// ── CommunityDetail (/community/:id) ─────────────────────────────
const CommunityDetail = {
  template: `
    <div class="container py-4" style="max-width:760px;">
      <router-link to="/community" class="btn btn-sm btn-outline-secondary mb-3">
        <i class="bi bi-arrow-left me-1"></i>목록으로
      </router-link>

      <div v-if="loading" class="spinner-wrap"><div class="spinner-border text-primary"></div></div>

      <div v-else-if="!post" class="text-center py-5 text-muted">
        <i class="bi bi-exclamation-circle fs-1 d-block mb-2"></i>
        게시글을 찾을 수 없습니다.
      </div>

      <div v-else>
        <!-- 읽기 모드 -->
        <div v-if="!editing">
          <h1 class="fw-700 mb-1" style="font-size:1.5rem;">{{ post.title }}</h1>
          <div class="text-muted small mb-4">
            <i class="bi bi-person me-1"></i>{{ post.author || '익명' }}
            <span class="ms-3"><i class="bi bi-clock me-1"></i>{{ fmtDate(post.created_at) }}</span>
            <span v-if="post.updated_at !== post.created_at" class="ms-2 text-muted">(수정됨)</span>
          </div>
          <div class="lh-lg mb-4 p-4 rounded-3" style="background:var(--bw-card-bg);border:1px solid var(--bw-border);">
            {{ post.content }}
          </div>
          <div v-if="isOwner" class="d-flex gap-2">
            <button class="btn btn-outline-primary btn-sm" @click="startEdit">
              <i class="bi bi-pencil me-1"></i>수정
            </button>
            <button class="btn btn-outline-danger btn-sm" @click="deletePost" :disabled="deleting">
              <i class="bi bi-trash me-1"></i>{{ deleting ? '삭제 중…' : '삭제' }}
            </button>
          </div>
          <div v-else-if="isLoggedIn" class="small text-muted">
            <i class="bi bi-lock me-1"></i>본인이 작성한 글만 수정·삭제할 수 있습니다.
          </div>
        </div>

        <!-- 수정 모드 -->
        <div v-else>
          <h2 class="mb-3 fw-700">게시글 수정</h2>
          <div class="mb-2 text-muted small">
            <i class="bi bi-person me-1"></i>작성자: <strong>{{ editForm.author }}</strong>
          </div>
          <div class="mb-2">
            <input v-model="editForm.title" type="text" class="form-control" placeholder="제목" />
          </div>
          <div class="mb-3">
            <textarea v-model="editForm.content" class="form-control" rows="6"></textarea>
          </div>
          <div class="d-flex gap-2">
            <button class="btn btn-primary btn-sm" @click="saveEdit" :disabled="saving">
              {{ saving ? '저장 중…' : '저장' }}
            </button>
            <button class="btn btn-outline-secondary btn-sm" @click="editing = false">취소</button>
          </div>
          <div v-if="editError" class="text-danger small mt-2">{{ editError }}</div>
        </div>
      </div>
    </div>
  `,
  setup() {
    const route = VueRouter.useRoute();
    const router = VueRouter.useRouter();
    const loading = ref(true);
    const post = ref(null);
    const editing = ref(false);
    const deleting = ref(false);
    const saving = ref(false);
    const editError = ref("");
    const editForm = ref({ title: "", content: "", author: "" });

    const isLoggedIn = computed(() => !!auth.value.user);
    const currentUser = computed(() => auth.value.user || {});
    const isOwner = computed(() => {
      if (!auth.value.user || !post.value) return false;
      // authorId 기준 우선, 없으면 username 비교
      if (post.value.authorId && auth.value.user.id) {
        return String(post.value.authorId) === String(auth.value.user.id);
      }
      return post.value.author === auth.value.user.username;
    });

    function fmtDate(iso) {
      if (!iso) return "";
      const d = new Date(iso);
      return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
    }

    function startEdit() {
      editForm.value = { title: post.value.title, content: post.value.content, author: post.value.author };
      editing.value = true;
      editError.value = "";
    }

    async function saveEdit() {
      editError.value = "";
      if (!editForm.value.title.trim() || !editForm.value.content.trim()) {
        editError.value = "제목과 내용은 필수입니다.";
        return;
      }
      saving.value = true;
      try {
        const res = await apiFetch(`/api/posts/${route.params.id}`, {
          method: 'PUT',
          body: JSON.stringify(editForm.value)
        });
        const data = await res.json();
        post.value = data;
        editing.value = false;
      } catch (e) {
        editError.value = "저장에 실패했습니다.";
      } finally {
        saving.value = false;
      }
    }

    async function deletePost() {
      if (!confirm("정말 삭제하시겠습니까?")) return;
      deleting.value = true;
      try {
        await apiFetch(`/api/posts/${route.params.id}`, { method: 'DELETE' });
        router.push("/community");
      } catch (e) {
        alert("삭제에 실패했습니다.");
      } finally {
        deleting.value = false;
      }
    }

    onMounted(async () => {
      try {
        const res = await apiFetch(`/api/posts/${route.params.id}`);
        post.value = await res.json();
      } catch (e) {
        post.value = null;
      } finally {
        loading.value = false;
      }
    });

    return { loading, post, editing, deleting, saving, editError, editForm, fmtDate,
      startEdit, saveEdit, deletePost, isLoggedIn, currentUser, isOwner };
  },
};

// ── ReadingCalendar (/calendar) ───────────────────────────────────
const ReadingCalendar = {
  template: `
    <div class="container py-4" style="max-width:800px;">
      <h1 class="section-title mb-4">
        <i class="bi bi-calendar3 text-primary"></i>독서 달력
      </h1>

      <!-- 달력 헤더 -->
      <div class="d-flex align-items-center justify-content-between mb-3">
        <button class="btn btn-sm btn-outline-secondary" @click="prevMonth">
          <i class="bi bi-chevron-left"></i>
        </button>
        <h2 class="mb-0 fw-700" style="font-size:1.2rem;">{{ year }}년 {{ month + 1 }}월</h2>
        <button class="btn btn-sm btn-outline-secondary" @click="nextMonth">
          <i class="bi bi-chevron-right"></i>
        </button>
      </div>

      <!-- 요일 헤더 -->
      <div class="cal-grid mb-1">
        <div v-for="d in weekDays" :key="d" class="cal-dow">{{ d }}</div>
      </div>

      <!-- 날짜 셀 -->
      <div class="cal-grid">
        <div
          v-for="cell in cells"
          :key="cell.key"
          :class="['cal-cell', cell.curMonth ? '' : 'cal-other', cell.isToday ? 'cal-today' : '', selectedDate === cell.dateStr ? 'cal-selected' : '']"
          @click="cell.curMonth && selectDate(cell.dateStr)"
        >
          <span class="cal-day-num">{{ cell.day }}</span>
          <span v-if="cell.curMonth && calendarData[cell.dateStr] && calendarData[cell.dateStr].length > 0" class="cal-dot"></span>
        </div>
      </div>

      <!-- 선택한 날짜 기록 -->
      <div v-if="selectedDate" class="mt-4 p-4 rounded-3" style="background:var(--bw-card-bg); border:1px solid var(--bw-border);">
        <h5 class="fw-700 mb-3">{{ selectedDate }} 독서 기록</h5>

        <!-- 로그인 안내 -->
        <div v-if="!isLoggedIn" class="alert alert-info py-2 small mb-3">
          <i class="bi bi-cloud-slash me-1"></i>로그인하면 기록이 서버에 저장돼 어디서든 확인할 수 있습니다. 현재는 이 기기에만 저장됩니다.
        </div>

        <!-- 기존 기록 -->
        <div v-if="dayBooks.length > 0" class="mb-3">
          <div v-for="(b, idx) in dayBooks" :key="idx" class="d-flex align-items-center gap-2 mb-2">
            <i class="bi bi-book-fill text-primary"></i>
            <span class="flex-grow-1">{{ b.title || b }}</span>
            <span v-if="b.status" :class="['badge', b.status==='done'?'bg-success':b.status==='reading'?'bg-primary':'bg-secondary']" style="font-size:.7rem;">
              {{ statusLabel(b.status) }}
            </span>
            <button class="btn btn-sm btn-outline-danger py-0 px-2" @click="removeBook(idx)" :disabled="removing">
              <i class="bi bi-x"></i>
            </button>
          </div>
        </div>
        <div v-else class="text-muted small mb-3">이 날 읽은 책이 없습니다.</div>

        <!-- 독서 상태 선택 -->
        <div class="mb-2">
          <select class="form-select form-select-sm w-auto d-inline-block" v-model="selectedStatus">
            <option value="done">✅ 완독</option>
            <option value="reading">📖 읽는 중</option>
            <option value="want">🔖 읽고 싶음</option>
          </select>
        </div>

        <!-- 책 추가 (직접 입력) -->
        <div class="d-flex gap-2">
          <input
            v-model="newBookTitle"
            type="text"
            class="form-control form-control-sm"
            placeholder="책 제목 직접 입력..."
            @keyup.enter="addBook"
          />
          <button class="btn btn-sm btn-primary" @click="addBook">추가</button>
        </div>

        <!-- 도서목록에서 선택 (API 동기화) -->
        <div v-if="allBooks.length > 0" class="mt-2">
          <select class="form-select form-select-sm" v-model="selectedBookFromList" @change="addFromList">
            <option :value="null">— 도서 목록에서 선택 (로그인 시 서버 저장) —</option>
            <option v-for="b in allBooks.slice(0, 200)" :key="b.id" :value="b">{{ b.title }}</option>
          </select>
        </div>
      </div>
    </div>
  `,
  setup() {
    const today = new Date();
    const year = ref(today.getFullYear());
    const month = ref(today.getMonth());
    const selectedDate = ref('');
    const newBookTitle = ref('');
    const selectedBookFromList = ref(null);
    const selectedStatus = ref('done');
    const removing = ref(false);
    const allBooks = ref([]);
    const isLoggedIn = computed(() => !!auth.value.user);

    // calendarData: { dateStr: [{title, isbn, status, serverId}] }
    // localStorage 기존 데이터(문자열) 호환 정규화
    function normalizeEntry(e) {
      if (typeof e === 'string') return { title: e, isbn: null, status: 'done', serverId: null };
      return { title: e.title || e.bookTitle || '', isbn: e.isbn || null, status: e.status || 'done', serverId: e.serverId || null };
    }
    function loadLocalCalendar() {
      try {
        const raw = JSON.parse(localStorage.getItem('bookwise_calendar') || '{}');
        const out = {};
        for (const [date, entries] of Object.entries(raw)) {
          out[date] = (Array.isArray(entries) ? entries : []).map(normalizeEntry);
        }
        return out;
      } catch { return {}; }
    }
    const calendarData = ref(loadLocalCalendar());

    function saveLocal() {
      localStorage.setItem('bookwise_calendar', JSON.stringify(calendarData.value));
    }
    function statusLabel(s) {
      return s === 'done' ? '완독' : s === 'reading' ? '읽는 중' : '읽고 싶음';
    }

    const weekDays = ['일', '월', '화', '수', '목', '금', '토'];
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

    const cells = computed(() => {
      const y = year.value, m = month.value;
      const first = new Date(y, m, 1);
      const last = new Date(y, m + 1, 0);
      const startDow = first.getDay();
      const result = [];
      // 이전달 채우기
      for (let i = startDow - 1; i >= 0; i--) {
        const d = new Date(y, m, -i);
        result.push({ day: d.getDate(), curMonth: false, dateStr: '', key: 'prev-' + i, isToday: false });
      }
      // 현재달
      for (let d = 1; d <= last.getDate(); d++) {
        const ds = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        result.push({ day: d, curMonth: true, dateStr: ds, key: ds, isToday: ds === todayStr });
      }
      // 다음달 채우기
      const remaining = 42 - result.length;
      for (let d = 1; d <= remaining; d++) {
        result.push({ day: d, curMonth: false, dateStr: '', key: 'next-' + d, isToday: false });
      }
      return result;
    });

    const dayBooks = computed(() => {
      if (!selectedDate.value) return [];
      return calendarData.value[selectedDate.value] || [];
    });

    function prevMonth() {
      if (month.value === 0) { month.value = 11; year.value--; }
      else month.value--;
    }
    function nextMonth() {
      if (month.value === 11) { month.value = 0; year.value++; }
      else month.value++;
    }
    function selectDate(ds) {
      selectedDate.value = ds;
      newBookTitle.value = '';
      selectedBookFromList.value = null;
    }

    function addEntryToLocal(entry) {
      const cal = { ...calendarData.value };
      if (!cal[selectedDate.value]) cal[selectedDate.value] = [];
      const exists = cal[selectedDate.value].some(e => (e.title || e) === entry.title);
      if (!exists) cal[selectedDate.value] = [...cal[selectedDate.value], entry];
      calendarData.value = cal;
      saveLocal();
    }

    // 직접 입력 추가 (isbn 없음 → localStorage만)
    function addBook() {
      const title = newBookTitle.value.trim();
      if (!title) return;
      addEntryToLocal({ title, isbn: null, status: selectedStatus.value, serverId: null });
      newBookTitle.value = '';
    }

    // 도서 목록 선택 추가 (isbn 있음 → 로그인 시 API 저장)
    async function addFromList() {
      const bookObj = selectedBookFromList.value;
      if (!bookObj) return;
      const isbn = bookObj.isbn13 || bookObj.isbn || bookObj.id || null;
      const title = bookObj.title;
      const entry = { title, isbn, status: selectedStatus.value, serverId: null };

      if (isLoggedIn.value && isbn) {
        try {
          const res = await apiFetch('/api/calendar', {
            method: 'POST',
            body: JSON.stringify({ isbn, bookTitle: title, date: selectedDate.value, status: selectedStatus.value })
          });
          if (res.ok) {
            const data = await res.json();
            entry.serverId = data.id; // 서버 ID 저장 → 삭제 시 사용
          }
        } catch (e) {
          console.warn('캘린더 API 저장 실패:', e.message);
        }
      }
      addEntryToLocal(entry);
      selectedBookFromList.value = null;
    }

    // 삭제 (서버 항목이면 DELETE API도 호출)
    async function removeBook(idx) {
      const entry = (calendarData.value[selectedDate.value] || [])[idx];
      if (!entry) return;
      if (entry.serverId && isLoggedIn.value) {
        removing.value = true;
        try {
          await apiFetch(`/api/calendar/${entry.serverId}`, { method: 'DELETE' });
        } catch (e) {
          console.warn('캘린더 API 삭제 실패:', e.message);
        } finally {
          removing.value = false;
        }
      }
      const cal = { ...calendarData.value };
      cal[selectedDate.value] = cal[selectedDate.value].filter((_, i) => i !== idx);
      calendarData.value = cal;
      saveLocal();
    }

    onMounted(async () => {
      // 도서 목록 로드: 100권으로 제한 (달력 드롭다운용, 대용량 fetch 불필요)
      try {
        const res = await apiFetch('/api/books?q=&limit=100');
        const json = await res.json();
        allBooks.value = json.data || [];
      } catch (_) {}

      // 서버 달력 동기화 (로그인 시)
      if (isLoggedIn.value) {
        try {
          const res = await apiFetch('/api/calendar');
          const json = await res.json();
          const serverEntries = json.data || json.items || [];
          const cal = { ...calendarData.value };
          for (const e of serverEntries) {
            if (!e.date) continue;
            if (!cal[e.date]) cal[e.date] = [];
            // 중복 방지: 같은 isbn 또는 serverId가 이미 있으면 스킵
            const dup = cal[e.date].some(x => x.serverId === e.id || (x.isbn && x.isbn === e.isbn));
            if (!dup) {
              cal[e.date].push({ title: e.bookTitle || e.isbn, isbn: e.isbn, status: e.status, serverId: e.id });
            } else {
              // serverId 없는 로컬 항목에 서버 ID 보강
              const local = cal[e.date].find(x => x.isbn && x.isbn === e.isbn && !x.serverId);
              if (local) local.serverId = e.id;
            }
          }
          calendarData.value = cal;
          saveLocal();
        } catch (e) {
          console.warn('캘린더 서버 동기화 실패:', e.message);
        }
      }
    });

    return { year, month, cells, weekDays, selectedDate, dayBooks, calendarData,
      newBookTitle, selectedBookFromList, selectedStatus, removing, allBooks, isLoggedIn,
      prevMonth, nextMonth, selectDate, addBook, addFromList, removeBook, statusLabel };
  }
};


// ── 추천 페이지 (독자 유형 분석 + 기분 기반 추천) ────────────────
const RecommendationsView = {
  template: `
    <div class="page-container" style="max-width:900px;margin:0 auto;padding:2rem 1rem;">
      <h2 class="fw-700 mb-1" style="font-size:1.6rem;">📚 나의 독자 유형 분석</h2>
      <p class="text-muted mb-4" style="font-size:.95rem;">좋아하는 장르를 선택하면 당신만의 독자 유형과 맞춤 도서를 추천해드립니다.</p>

      <!-- 장르 선택 -->
      <div class="card border-0 shadow-sm mb-4" style="border-radius:16px;">
        <div class="card-body p-4">
          <p class="fw-600 mb-3" style="font-size:1rem;">관심 장르를 선택하세요 <span class="text-muted">(복수 선택 가능)</span></p>
          <div class="d-flex flex-wrap gap-2 mb-4">
            <button v-for="g in genreOptions" :key="g.key"
              class="btn btn-sm fw-500"
              :class="selectedGenres.includes(g.key) ? 'btn-primary' : 'btn-outline-secondary'"
              style="border-radius:20px;padding:.35rem .9rem;font-size:.9rem;"
              @click="toggleGenre(g.key)">
              {{ g.emoji }} {{ g.label }}
            </button>
          </div>
          <button class="btn btn-primary px-4 py-2 fw-600"
            :disabled="!selectedGenres.length || loading"
            style="border-radius:24px;"
            @click="analyze">
            <span v-if="loading"><span class="spinner-border spinner-border-sm me-2"></span>분석 중...</span>
            <span v-else>🔍 독자 유형 분석하기</span>
          </button>
          <p v-if="!selectedGenres.length" class="text-muted mt-2 mb-0" style="font-size:.85rem;">장르를 1개 이상 선택해주세요</p>
        </div>
      </div>

      <!-- 결과 위젯 -->
      <transition name="fade">
      <div v-if="result" class="mb-5">
        <div class="card border-0 shadow" style="border-radius:20px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;">
          <div class="card-body p-4">
            <div class="d-flex align-items-center gap-3 mb-2">
              <span style="font-size:3rem;line-height:1;">{{ result.emoji }}</span>
              <div>
                <h3 class="fw-700 mb-0" style="font-size:1.6rem;">{{ result.type }}</h3>
                <p class="mb-0 opacity-90" style="font-size:.95rem;">{{ result.desc }}</p>
              </div>
            </div>
            <div class="mt-2">
              <span v-for="g in result.inputGenres" :key="g"
                class="badge me-1" style="background:rgba(255,255,255,.25);font-size:.8rem;">{{ g }}</span>
            </div>
          </div>
        </div>

        <!-- 추천 도서 -->
        <h5 class="fw-700 mt-4 mb-3">📖 {{ result.type }} 추천 도서</h5>
        <div class="row row-cols-2 row-cols-sm-3 row-cols-md-5 g-3">
          <div class="col" v-for="book in result.books" :key="book.isbn">
            <router-link :to="'/books/' + book.isbn" style="text-decoration:none;">
              <div class="card border-0 h-100" style="border-radius:12px;overflow:hidden;transition:transform .2s;" @mouseenter="e=>e.currentTarget.style.transform='translateY(-4px)'" @mouseleave="e=>e.currentTarget.style.transform=''">
                <img :src="book.cover || 'https://via.placeholder.com/120x170?text=No+Cover'" class="card-img-top" style="height:160px;object-fit:cover;" @error="e=>e.target.src='https://via.placeholder.com/120x170?text=No+Cover'" />
                <div class="card-body p-2">
                  <p class="mb-0 fw-600" style="font-size:.8rem;line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">{{ book.title }}</p>
                  <p class="text-muted mb-0 mt-1" style="font-size:.75rem;">{{ (book.author||'').split('(')[0].trim().slice(0,10) }}</p>
                </div>
              </div>
            </router-link>
          </div>
        </div>
      </div>
      </transition>

      <!-- 장르 분포 인사이트 -->
      <div v-if="result" class="card border-0 shadow-sm mb-5" style="border-radius:16px;">
        <div class="card-body p-4">
          <h6 class="fw-700 mb-3">📊 BookWise 장르 분포 (상위 10개)</h6>
          <div v-for="([genre, count], i) in topGenres" :key="genre" class="mb-2">
            <div class="d-flex justify-content-between mb-1" style="font-size:.85rem;">
              <span>{{ genre }}</span><span class="text-muted">{{ count }}권</span>
            </div>
            <div class="progress" style="height:8px;border-radius:4px;">
              <div class="progress-bar"
                :style="'width:' + Math.round(count/maxGenreCount*100) + '%;background:' + genreColor(i)"
                style="border-radius:4px;"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 기분별 빠른 추천 -->
      <div class="mb-4">
        <h5 class="fw-700 mb-3">💭 기분으로 찾는 오늘의 책</h5>
        <div class="d-flex flex-wrap gap-2">
          <button v-for="m in moodOptions" :key="m.key"
            class="btn btn-sm"
            :class="selectedMood === m.key ? 'btn-warning' : 'btn-outline-secondary'"
            style="border-radius:20px;"
            @click="loadMood(m.key)">
            {{ m.emoji }} {{ m.label }}
          </button>
        </div>
        <div v-if="moodLoading" class="text-center py-4"><div class="spinner-border text-primary"></div></div>
        <div v-if="moodBooks.length" class="mt-3">
          <div class="row row-cols-2 row-cols-sm-3 row-cols-md-4 g-3">
            <div class="col" v-for="book in moodBooks" :key="book.isbn||book.id">
              <router-link :to="'/books/' + (book.isbn||book.id)" style="text-decoration:none;">
                <div class="card border-0 shadow-sm h-100" style="border-radius:12px;overflow:hidden;">
                  <img :src="book.cover||book.cover_url||'https://via.placeholder.com/120x170'" class="card-img-top" style="height:140px;object-fit:cover;" @error="e=>e.target.src='https://via.placeholder.com/120x170'" />
                  <div class="card-body p-2">
                    <p class="mb-0 fw-600" style="font-size:.8rem;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">{{ book.title }}</p>
                  </div>
                </div>
              </router-link>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  setup() {
    const { ref, computed } = Vue;
    const genreOptions = [
      { key: '판타지', label: '판타지', emoji: '🏰' },
      { key: 'SF',    label: 'SF',     emoji: '🚀' },
      { key: '로맨스', label: '로맨스',  emoji: '💕' },
      { key: '소설',   label: '소설',   emoji: '📖' },
      { key: '에세이', label: '에세이',  emoji: '✍️' },
      { key: '인문학', label: '인문학',  emoji: '🔬' },
      { key: '경제경영', label: '경제경영', emoji: '💼' },
      { key: '자기계발', label: '자기계발', emoji: '🌱' },
      { key: '역사',   label: '역사',   emoji: '🏛️' },
      { key: '과학',   label: '과학',   emoji: '⚗️' },
      { key: '어린이', label: '어린이',  emoji: '🎈' },
      { key: '만화',   label: '만화',   emoji: '🎨' },
    ];
    const moodOptions = [
      { key: 'happy',     label: '설렘',    emoji: '✨' },
      { key: 'sad',       label: '위로',    emoji: '🌧' },
      { key: 'excited',   label: '흥미진진', emoji: '⚡' },
      { key: 'calm',      label: '차분함',   emoji: '🍃' },
      { key: 'motivated', label: '동기부여', emoji: '🔥' },
      { key: 'curious',   label: '호기심',   emoji: '🔭' },
    ];
    const PALETTE = ['#667eea','#f093fb','#4facfe','#43e97b','#fa709a','#ffecd2','#a18cd1','#f5576c','#96fbc4','#ffeaa7'];

    const selectedGenres = ref([]);
    const loading         = ref(false);
    const result          = ref(null);
    const selectedMood    = ref('');
    const moodLoading     = ref(false);
    const moodBooks       = ref([]);

    const topGenres = computed(() => {
      if (!result.value) return [];
      return Object.entries(result.value.genreDistribution || {});
    });
    const maxGenreCount = computed(() => {
      if (!topGenres.value.length) return 1;
      return Math.max(...topGenres.value.map(([,v]) => v));
    });

    function genreColor(i) { return PALETTE[i % PALETTE.length]; }

    function toggleGenre(key) {
      const idx = selectedGenres.value.indexOf(key);
      if (idx === -1) selectedGenres.value.push(key);
      else selectedGenres.value.splice(idx, 1);
    }

    async function analyze() {
      if (!selectedGenres.value.length) return;
      loading.value = true; result.value = null;
      try {
        const g = selectedGenres.value.map(encodeURIComponent).join(',');
        const res = await fetch(`/api/recommendations/reader-type?genres=${g}&count=10`);
        result.value = await res.json();
      } catch (e) {
        console.error(e);
      } finally {
        loading.value = false;
      }
    }

    async function loadMood(mood) {
      selectedMood.value = mood; moodLoading.value = true; moodBooks.value = [];
      try {
        const res = await fetch(`/api/books/mood/${mood}`);
        const data = await res.json();
        moodBooks.value = (data.items || []).slice(0, 8);
      } catch (e) {
        console.error(e);
      } finally {
        moodLoading.value = false;
      }
    }

    return { genreOptions, moodOptions, selectedGenres, loading, result, topGenres, maxGenreCount, genreColor, toggleGenre, analyze, selectedMood, moodLoading, moodBooks, loadMood };
  }
};

// ── NotFound ──────────────────────────────────────────────────────
const NotFound = {
  template: `
    <div class="not-found">
      <div class="code">404</div>
      <h2 class="fw-700 mb-2">페이지를 찾을 수 없습니다</h2>
      <p class="text-muted mb-4">요청하신 페이지가 존재하지 않거나 이동되었습니다.</p>
      <router-link to="/" class="btn btn-primary">홈으로 돌아가기</router-link>
    </div>
  `,
};

// ── 라우터 ────────────────────────────────────────────────────────
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: Home },
    { path: "/books", component: BookList },
    { path: "/books/:id", component: BookDetail },
    { path: "/community", component: CommunityList },
    { path: "/community/:id", component: CommunityDetail },
    { path: "/calendar", component: ReadingCalendar },
    { path: "/recommendations", component: RecommendationsView },
    { path: "/:pathMatch(.*)*", component: NotFound },
  ],
  scrollBehavior() {
    return { top: 0 };
  },
});

// ── 루트 앱 컴포넌트 (인증 상태 + 모달) ──────────────────────────
const RootApp = {
  template: `
    <div>
      <!-- 네비게이션 -->
      <nav class="navbar navbar-expand-md navbar-bw sticky-top">
        <div class="container">
          <router-link class="navbar-brand" to="/">
            <i class="bi bi-book-half me-1"></i>BookWise
          </router-link>
          <button
            class="navbar-toggler border-0 text-white"
            type="button"
            data-bs-toggle="collapse"
            data-bs-target="#navMenu"
          >
            <i class="bi bi-list fs-4"></i>
          </button>
          <div class="collapse navbar-collapse" id="navMenu">
            <ul class="navbar-nav ms-auto gap-1 align-items-center">
              <li class="nav-item">
                <router-link class="nav-link px-3" to="/">홈</router-link>
              </li>
              <li class="nav-item">
                <router-link class="nav-link px-3" to="/books">도서목록</router-link>
              </li>
              <li class="nav-item">
                <router-link class="nav-link px-3" to="/community">커뮤니티</router-link>
              </li>
              <li class="nav-item">
                <router-link class="nav-link px-3" to="/recommendations">🎯 추천</router-link>
              </li>
              <li class="nav-item">
                <router-link class="nav-link px-3" to="/calendar">📅 독서달력</router-link>
              </li>
              <!-- 비로그인 -->
              <li class="nav-item" v-if="!authUser">
                <button class="btn btn-sm btn-outline-light ms-2" @click="openModal('login')">로그인</button>
              </li>
              <li class="nav-item" v-if="!authUser">
                <button class="btn btn-sm btn-warning ms-1" @click="openModal('register')">회원가입</button>
              </li>
              <!-- 로그인 -->
              <li class="nav-item d-flex align-items-center ms-2" v-if="authUser">
                <span class="text-white small me-2">안녕하세요, <strong>{{ authUser.username }}</strong>님</span>
                <button class="btn btn-sm btn-outline-light" @click="doLogout">로그아웃</button>
              </li>
            </ul>
          </div>
        </div>
      </nav>

      <!-- 라우터 뷰 -->
      <router-view></router-view>

      <!-- 푸터 -->
      <footer class="py-4 mt-5" style="border-top:1px solid var(--bw-border); background:var(--bw-card-bg);">
        <div class="container text-center" style="color:var(--bw-text-muted); font-size:.85rem;">
          © 2026 BookWise — AI 기반 도서 추천 서비스
        </div>
      </footer>

      <!-- 인증 모달 -->
      <div class="modal fade" id="authModal" tabindex="-1" aria-labelledby="authModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-auth">
          <div class="modal-content">
            <div class="modal-header border-0 pb-0">
              <ul class="nav nav-tabs border-0" style="gap:.25rem;">
                <li class="nav-item">
                  <button :class="['nav-link', activeTab==='login' ? 'active' : '']" @click="activeTab='login'">로그인</button>
                </li>
                <li class="nav-item">
                  <button :class="['nav-link', activeTab==='register' ? 'active' : '']" @click="activeTab='register'">회원가입</button>
                </li>
              </ul>
              <button type="button" class="btn-close ms-auto" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body pt-3">
              <!-- 로그인 탭 -->
              <div v-if="activeTab === 'login'">
                <h5 class="fw-700 mb-3">BookWise 로그인</h5>
                <div class="mb-3">
                  <label class="form-label small fw-semibold">이메일</label>
                  <input v-model="loginForm.email" type="email" :class="['form-control', loginTouched.email ? (isValidEmail(loginForm.email) ? 'is-valid' : 'is-invalid') : '']" placeholder="이메일 주소" @keyup.enter="doLogin" @blur="loginTouched.email = true" />
                  <div class="invalid-feedback">올바른 이메일 형식을 입력해주세요.</div>
                </div>
                <div class="mb-3">
                  <label class="form-label small fw-semibold">비밀번호</label>
                  <input v-model="loginForm.password" type="password" :class="['form-control', loginTouched.password ? (loginForm.password ? 'is-valid' : 'is-invalid') : '']" placeholder="비밀번호 입력" @keyup.enter="doLogin" @blur="loginTouched.password = true" />
                  <div class="invalid-feedback">비밀번호를 입력해주세요.</div>
                </div>
                <div v-if="loginError" class="alert alert-danger py-2 small">{{ loginError }}</div>
                <button class="btn btn-primary w-100" @click="doLogin" :disabled="loginLoading">
                  {{ loginLoading ? '로그인 중…' : '로그인' }}
                </button>
                <p class="text-center text-muted small mt-3 mb-0">
                  계정이 없으신가요? <a href="#" @click.prevent="activeTab='register'">회원가입</a>
                </p>
              </div>
              <!-- 회원가입 탭 -->
              <div v-if="activeTab === 'register'">
                <h5 class="fw-700 mb-3">BookWise 회원가입</h5>
                <div class="mb-3">
                  <label class="form-label small fw-semibold">사용자 이름</label>
                  <input v-model="registerForm.username" type="text" :class="['form-control', regTouched.username ? (registerForm.username.trim() ? 'is-valid' : 'is-invalid') : '']" placeholder="사용자 이름" @blur="regTouched.username = true" />
                  <div class="invalid-feedback">사용자 이름을 입력해주세요.</div>
                </div>
                <div class="mb-3">
                  <label class="form-label small fw-semibold">이메일</label>
                  <input v-model="registerForm.email" type="email" :class="['form-control', regTouched.email ? (isValidEmail(registerForm.email) ? 'is-valid' : 'is-invalid') : '']" placeholder="이메일 입력" @blur="regTouched.email = true" />
                  <div class="invalid-feedback">올바른 이메일 형식을 입력해주세요.</div>
                </div>
                <div class="mb-3">
                  <label class="form-label small fw-semibold">비밀번호</label>
                  <input v-model="registerForm.password" type="password" :class="['form-control', regTouched.password ? (registerForm.password.length >= 6 ? 'is-valid' : 'is-invalid') : '']" placeholder="비밀번호 (6자 이상)" @blur="regTouched.password = true" />
                  <div class="invalid-feedback">비밀번호는 6자 이상이어야 합니다.</div>
                  <div v-if="registerForm.password" class="mt-2">
                    <div class="d-flex gap-1 mb-1">
                      <div v-for="i in 5" :key="i" class="flex-fill rounded" style="height:4px;transition:background .2s;" :style="{background: i<=pwdStrength ? (pwdStrength<=1?'#ef4444':pwdStrength<=2?'#f97316':pwdStrength<=3?'#eab308':'#22c55e') : '#e2e8f0'}"></div>
                    </div>
                    <div class="small" :style="{color: pwdStrength<=1?'#ef4444':pwdStrength<=2?'#f97316':pwdStrength<=3?'#eab308':'#22c55e'}">
                      {{ pwdStrength<=1?'매우 약함':pwdStrength<=2?'약함':pwdStrength<=3?'보통':pwdStrength<=4?'강함':'매우 강함' }}
                    </div>
                  </div>
                </div>
                <div class="mb-3">
                  <label class="form-label small fw-semibold">비밀번호 확인</label>
                  <input v-model="registerForm.passwordConfirm" type="password" :class="['form-control', regTouched.confirm ? (registerForm.passwordConfirm && registerForm.passwordConfirm===registerForm.password ? 'is-valid' : 'is-invalid') : '']" placeholder="비밀번호 재입력" @keyup.enter="doRegister" @blur="regTouched.confirm = true" />
                  <div class="invalid-feedback">비밀번호가 일치하지 않습니다.</div>
                  <div class="valid-feedback">비밀번호가 일치합니다.</div>
                </div>
                <div v-if="registerError" class="alert alert-danger py-2 small">{{ registerError }}</div>
                <div v-if="registerSuccess" class="alert alert-success py-2 small">{{ registerSuccess }}</div>
                <button class="btn btn-primary w-100" @click="doRegister" :disabled="registerLoading">
                  {{ registerLoading ? '가입 중…' : '가입하기' }}
                </button>
                <p class="text-center text-muted small mt-3 mb-0">
                  이미 계정이 있으신가요? <a href="#" @click.prevent="activeTab='login'">로그인</a>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  setup() {
    const authUser = computed(() => auth.value.user);
    const activeTab = ref('login');

    const loginForm = ref({ email: '', password: '' });
    const loginError = ref('');
    const loginLoading = ref(false);
    const loginTouched = ref({ email: false, password: false });

    const registerForm = ref({ username: '', email: '', password: '', passwordConfirm: '' });
    const registerError = ref('');
    const registerSuccess = ref('');
    const registerLoading = ref(false);
    const regTouched = ref({ username: false, email: false, password: false, confirm: false });

    function isValidEmail(email) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    const pwdStrength = computed(() => {
      const p = registerForm.value.password;
      if (!p) return 0;
      let s = 0;
      if (p.length >= 6) s++;
      if (p.length >= 10) s++;
      if (/[A-Z]/.test(p)) s++;
      if (/[0-9]/.test(p)) s++;
      if (/[^A-Za-z0-9]/.test(p)) s++;
      return s;
    });

    function getModal() {
      const el = document.getElementById('authModal');
      if (el && window.bootstrap) return window.bootstrap.Modal.getOrCreateInstance(el);
      return null;
    }

    function openModal(tab) {
      activeTab.value = tab || 'login';
      loginError.value = '';
      registerError.value = '';
      registerSuccess.value = '';
      loginForm.value = { email: '', password: '' };
      registerForm.value = { username: '', email: '', password: '', passwordConfirm: '' };
      loginTouched.value = { email: false, password: false };
      regTouched.value = { username: false, email: false, password: false, confirm: false };
      const m = getModal();
      if (m) m.show();
    }

    // 외부에서 모달 열 수 있도록 전역 함수 등록
    window.__bwOpenAuthModal = openModal;

    async function doLogin() {
      loginError.value = '';
      if (!loginForm.value.email || !loginForm.value.password) {
        loginError.value = '이메일과 비밀번호를 입력해주세요.';
        return;
      }
      loginLoading.value = true;
      try {
        const res = await apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: loginForm.value.email, password: loginForm.value.password })
        });
        const data = await res.json();
        if (!res.ok) {
          loginError.value = data.error || '이메일 또는 비밀번호가 올바르지 않습니다.';
          return;
        }
        auth.value.token = data.token;
        auth.value.user = data.user;
        localStorage.setItem('bookwise_token', data.token);
        const m = getModal();
        if (m) m.hide();
      } catch (e) {
        loginError.value = '로그인 중 오류가 발생했습니다.';
      } finally {
        loginLoading.value = false;
      }
    }

    async function doRegister() {
      registerError.value = '';
      registerSuccess.value = '';
      const { username, email, password, passwordConfirm } = registerForm.value;
      if (!username || !email || !password) {
        registerError.value = '모든 필드를 입력해주세요.';
        return;
      }
      if (password !== passwordConfirm) {
        registerError.value = '비밀번호가 일치하지 않습니다.';
        return;
      }
      if (password.length < 6) {
        registerError.value = '비밀번호는 6자 이상이어야 합니다.';
        return;
      }
      registerLoading.value = true;
      try {
        const res = await apiFetch('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ username, email, password })
        });
        const data = await res.json();
        if (!res.ok) {
          registerError.value = data.error || '회원가입에 실패했습니다.';
          return;
        }
        registerSuccess.value = '가입 완료! 로그인해주세요.';
        setTimeout(() => {
          activeTab.value = 'login';
          loginForm.value.email = email;
          registerSuccess.value = '';
        }, 1200);
      } catch (e) {
        registerError.value = '회원가입 중 오류가 발생했습니다.';
      } finally {
        registerLoading.value = false;
      }
    }

    async function doLogout() {
      await logout();
    }

    return { authUser, activeTab, loginForm, loginError, loginLoading, loginTouched,
      registerForm, registerError, registerSuccess, registerLoading, regTouched,
      isValidEmail, pwdStrength,
      openModal, doLogin, doRegister, doLogout };
  }
};

// ── cold-start health poll ────────────────────────────────────────
// Render 무료 서버 cold-start: Vue 마운트 전 서버가 응답할 때까지 대기
async function healthPoll() {
  const MAX = 60; // 최대 60초
  const statusEl = document.querySelector('#bw-splash [data-bw-status]');
  for (let i = 0; i < MAX; i++) {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (res.ok) return true;
    } catch (_) { /* 서버 아직 기동 전 */ }
    if (statusEl) statusEl.textContent = `서버를 깨우는 중… (${i + 1}초 경과)`;
    await new Promise(r => setTimeout(r, 1000));
  }
  return false; // 타임아웃 — 어쨌든 마운트 진행
}

function hideSplash() {
  const splash = document.getElementById('bw-splash');
  if (!splash) return;
  splash.style.transition = 'opacity 0.4s ease';
  splash.style.opacity = '0';
  setTimeout(() => { splash.style.display = 'none'; }, 420);
}

// ── 앱 마운트 ─────────────────────────────────────────────────────
healthPoll()
  .then(() => initAuth())
  .then(() => {
    createApp(RootApp)
      .use(router)
      .mount('#app');
    hideSplash();
  });
