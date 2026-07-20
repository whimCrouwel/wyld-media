// 検索モーダル。開閉と、ハイブリッド検索 Edge Function の呼び出し。
import { supabaseBrowser } from '../lib/supabase-browser';

const modal = document.getElementById('search-modal') as HTMLDialogElement | null;
const openBtn = document.getElementById('search-open');
const input = document.getElementById('search-input') as HTMLInputElement | null;
const resultsEl = document.getElementById('search-results') as HTMLUListElement | null;
const statusEl = document.getElementById('search-status');

// supabase/functions/search-articles/index.ts のレスポンス形式に合わせる。
// excerptHtml は DB 側の pgroonga_highlight_html() が記事本文(信頼できる
// ライター入力)からエスケープ済みで生成しているので、そのまま innerHTML に
// 差し込んでよい。一方 title はユーザー入力を経由しないが、念のため常に
// エスケープしてから差し込む。
interface SearchResult {
  slug: string;
  title: string;
  excerptHtml: string;
  score: number;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

if (modal && openBtn && input && resultsEl && statusEl) {
  openBtn.addEventListener('click', () => {
    modal.showModal();
    input.focus();
  });

  // バックドロップのクリックで閉じる(dialog 自身の領域外を押したとき)
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.close();
  });

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let abortController: AbortController | undefined;

  function render(results: SearchResult[]) {
    if (results.length === 0) {
      resultsEl!.hidden = true;
      statusEl!.textContent = '見つかりませんでした。';
      return;
    }
    resultsEl!.innerHTML = results
      .map(
        (r) => `
      <li>
        <a href="/articles/${encodeURIComponent(r.slug)}">${escapeHtml(r.title)}</a>
        <p>${r.excerptHtml}</p>
      </li>`,
      )
      .join('');
    resultsEl!.hidden = false;
    statusEl!.textContent = '';
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(debounceTimer);
    abortController?.abort();

    if (!q) {
      resultsEl.hidden = true;
      statusEl.textContent = '';
      return;
    }

    debounceTimer = setTimeout(async () => {
      abortController = new AbortController();
      statusEl.textContent = '検索中…';
      try {
        const { data, error } = await supabaseBrowser.functions.invoke('search-articles', {
          body: { query: q },
          signal: abortController.signal,
        });
        if (error) throw error;
        render((data?.results ?? []) as SearchResult[]);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        statusEl.textContent = '検索に失敗しました。';
        console.error(err);
      }
    }, 250);
  });
}
