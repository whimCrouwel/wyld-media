// トップページ「保存した記事」カルーセル。このブラウザで保存した公開記事を
// localStorage の記事IDから引き、カバー画像主役のカードで横並びに描画する。
// 保存が無ければセクションごと非表示。記事ページで保存が付け外しされたら
// (BOOKMARKS_CHANGED_EVENT)再描画する。
import { supabaseBrowser } from '../lib/supabase-browser';
import {
  getLocalBookmarks, fetchSavedArticles, BOOKMARKS_CHANGED_EVENT, type SavedArticle,
} from '../lib/bookmarks';

const section = document.getElementById('saved-carousel');
const list = document.getElementById('saved-carousel-list');
const countEl = document.getElementById('saved-carousel-count');

const PLACEHOLDER_ICON =
  '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" ' +
  'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/>' +
  '<path d="M21 15l-5-5L5 20"/></svg>';

function cover(a: SavedArticle): HTMLElement {
  if (!a.coverImageUrl) {
    const empty = document.createElement('span');
    empty.className = 'saved-card__cover saved-card__cover--empty';
    empty.innerHTML = PLACEHOLDER_ICON;
    return empty;
  }
  const box = document.createElement('span');
  box.className = 'saved-card__cover';
  const img = document.createElement('img');
  img.src = a.coverImageUrl;
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  // 読み込み失敗時は空白のままにせずアイコン枠に差し替える。
  img.addEventListener('error', () => {
    box.classList.add('saved-card__cover--empty');
    box.innerHTML = PLACEHOLDER_ICON;
  }, { once: true });
  box.appendChild(img);
  return box;
}

async function render(): Promise<void> {
  if (!section || !list) return;
  const ids = getLocalBookmarks(localStorage);
  if (ids.length === 0) {
    section.hidden = true;
    return;
  }

  let saved: SavedArticle[];
  try {
    saved = await fetchSavedArticles(supabaseBrowser, ids);
  } catch (err) {
    console.error('[saved-carousel] 取得に失敗', err);
    return;
  }
  if (saved.length === 0) {
    section.hidden = true;
    return;
  }

  list.innerHTML = '';
  for (const a of saved) {
    const li = document.createElement('li');
    const card = document.createElement('a');
    card.className = 'saved-card';
    card.href = `/articles/${a.slug}`;

    const title = document.createElement('span');
    title.className = 'saved-card__title';
    title.textContent = a.title;

    card.append(cover(a), title);
    li.appendChild(card);
    list.appendChild(li);
  }
  if (countEl) countEl.textContent = String(saved.length).padStart(2, '0');
  section.hidden = false;
}

if (section && list) {
  render();
  window.addEventListener(BOOKMARKS_CHANGED_EVENT, () => void render());
}
