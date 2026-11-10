// 오프라인 실행용 서비스워커 — 앱 파일만 캐시(교회 자료는 캐시하지 않음, IndexedDB에 암호화 보관)
const VERSION = 'boaz-v1.0';
const FILES = [
  './', 'index.html', 'styles.css', 'app.js', 'ui.js', 'store.js', 'config.js', 'views-input.js', 'views-manage.js', 'manifest.webmanifest',
  'core/util.js', 'core/accounts.js', 'core/parse.js', 'core/ledger.js', 'core/reports.js', 'core/render.js', 'core/bridge.js', 'core/crypto.js', 'core/zip.js', 'core/region.js', 'core/md.js', 'views-help.js',
  'docs/01-빠른시작.md', 'docs/02-쉬운사용설명서.md', 'docs/03-재정담당자-학습가이드.md', 'docs/04-영수증-가이드-한국-미국.md', 'docs/05-교회-내부-운영규칙.md', 'docs/06-AI-활용-가이드.md', 'docs/08-한눈요약카드.md', 'docs/09-자주묻는질문.md',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// 네트워크 우선(업데이트 즉시 반영) → 실패 시 캐시(오프라인)
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
