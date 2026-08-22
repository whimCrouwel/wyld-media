// 左サイドバーの「保存した記事」/「読者に人気」で使うサムネイル要素を作る。
// カバー画像があれば <img>、無ければ画像アイコン入りのプレースホルダ枠を返す
// (空の灰色箱は読み込み失敗に見えるため、意図的なプレースホルダに見せる)。
const PLACEHOLDER_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
  'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/>' +
  '<path d="M21 15l-5-5L5 20"/></svg>';

function emptyThumb(): HTMLSpanElement {
  const ph = document.createElement('span');
  ph.className = 'bookmark-thumb bookmark-thumb--empty';
  ph.setAttribute('aria-hidden', 'true');
  ph.innerHTML = PLACEHOLDER_ICON;
  return ph;
}

export function makeThumb(coverImageUrl: string | null): HTMLElement {
  if (!coverImageUrl) return emptyThumb();

  const img = document.createElement('img');
  img.className = 'bookmark-thumb';
  img.src = coverImageUrl;
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  // カバーURLはあるが読み込みに失敗した(404・ネットワーク・ブロック等)場合は、
  // 空白のまま残さずアイコン枠に差し替える(「サムネイルが出ない」を防ぐ)。
  img.addEventListener('error', () => img.replaceWith(emptyThumb()), { once: true });
  return img;
}
