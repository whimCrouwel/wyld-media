// Wild Media CMS — 最小 Service Worker。
// 方針: オフライン対応はしない(キャッシュしない)。ホーム画面追加=インストール可能性の
// 要件(有効なSW+fetchハンドラの存在)だけを満たす。fetch は常にネットワークへ素通し。
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// respondWith を呼ばない = ブラウザ既定のネットワーク取得。キャッシュも介在もしない。
// (ハンドラが存在すること自体がインストール可能性の判定に使われる)
self.addEventListener('fetch', () => {});
