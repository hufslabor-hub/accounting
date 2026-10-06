/**
 * 서비스 워커: 같은 주소의 파일은 "네트워크 우선"(배포하면 바로 새 버전), 오프라인이면 마지막으로 받은 파일을 보여 줍니다.
 * CDN 라이브러리(Firebase SDK·Chart.js 등)는 한 번 받으면 캐시에서 씁니다(주소에 버전이 들어 있음).
 * Firestore·로그인 같은 API 요청은 가로채지 않습니다.
 * 캐시 이름은 index.html 의 APP_BUILD 를 따라가므로 새로 배포하면 옛 캐시는 자동으로 지워집니다.
 */
const BUILD = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = 'showme-' + BUILD;
const CDN_HOSTS = ['www.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('showme-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CDN_HOSTS.includes(url.hostname)) return;

  if (sameOrigin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => {
          const hit = await caches.match(req);
          if (hit) return hit;
          if (req.mode === 'navigate') {
            const page = (await caches.match(new URL('index.html', self.location.href).href)) || (await caches.match(new URL('./', self.location.href).href));
            if (page) return page;
          }
          return Response.error();
        })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});
