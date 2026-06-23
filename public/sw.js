/* BookWise Service Worker — Cache-First shell */
const CACHE_NAME = 'bookwise-shell-v1';

// precache 대상 (shell 리소스)
const SHELL_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/style/tokens.css',
  '/app.js',
  '/vendor/bootstrap.min.css',
  '/vendor/bootstrap.bundle.min.js',
  '/vendor/bootstrap-icons.min.css',
  '/vendor/vue.global.prod.js',
  '/vendor/vue-router.global.prod.js',
  '/vendor/axios.min.js',
];

// install: shell 리소스 precache
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(SHELL_URLS.map((url) => new Request(url, { cache: 'reload' })))
        .catch(() => {
          // 일부 리소스가 없어도 설치 실패하지 않도록
          return Promise.allSettled(
            SHELL_URLS.map((url) => cache.add(url).catch(() => null))
          );
        })
    )
  );
});

// activate: 이전 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// fetch: 전략 분기
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // /api/* /data/* 는 항상 network (fresh data 보장)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/data/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // shell 리소스: Cache-First
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      // 캐시 miss → network 후 캐시 갱신
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        // 완전 오프라인 fallback: index.html 반환
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
