/* 福岡家族旅行 2026 — service worker
 *
 * 改版重點（舊版是 cache-first，會把舊行程永遠鎖在裝置上）：
 *   1. 網頁本體改成 network-first：有網路一定拿最新版，沒網路才用快取
 *   2. 快取名稱帶版本號，activate 時會清掉所有舊快取
 *   3. 之後更新行程，把下面的 VERSION 加 1 就會強制所有裝置重新拿
 */

const VERSION    = 'v2';
const CACHE_NAME = 'fukuoka-2026-' + VERSION;
const CORE_FILES = ['./', './index.html', './manifest.json'];

// ── 安裝：預先存好核心檔案 ─────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_FILES))
      .catch(() => {})            // 有檔案抓不到也別讓整個安裝失敗
  );
  self.skipWaiting();             // 不等舊分頁關閉，直接接手
});

// ── 啟動：清掉所有舊版快取 ─────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

// ── 攔截請求 ──────────────────────────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url   = new URL(req.url);
  const isNav = req.mode === 'navigate'
             || req.destination === 'document'
             || url.pathname.endsWith('/')
             || url.pathname.endsWith('/index.html');

  // 網頁本體 → network-first：先連網，失敗才回頭用快取
  if (isNav) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(url.href, { cache: 'no-store' });
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put('./index.html', fresh.clone());
        }
        return fresh;
      } catch (e) {
        const cached = await caches.match('./index.html', { ignoreSearch: true });
        return cached || new Response(
          '<meta charset="utf-8"><p style="font-family:sans-serif;padding:2em">' +
          '目前沒有網路，而且這台裝置還沒存過行程表。<br>連上網路後再開一次就會存起來。</p>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // 其他資源（字型、圖片…）→ 先給快取，同時背景更新
  event.respondWith((async () => {
    const cache   = await caches.open(CACHE_NAME);
    const cached  = await cache.match(req);
    const network = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
