// モバイルの「Saved」タブから開くシート(BookmarkSheet.astro)の制御。
//
// 「保存した記事」「読者に人気」のセクションは NavDrawer.astro に1つだけ書かれて
// いる。ここではそれを複製せず、画面幅に応じて DOM ごとシート ↔ サイドバーへ
// 移動させる。こうすることで ID が重複せず、bookmark-saved.ts /
// bookmark-ranking.ts の描画・イベント購読はどちらの場所にいてもそのまま動く。
//
// 開閉の html クラスは area-sheet-open(地図シート)とは別にして干渉させない。
import { lockPageScroll, unlockPageScroll } from './scroll-lock';

const sheet = document.getElementById('bookmark-sheet');
const sheetBody = document.getElementById('bookmark-sheet-body');
const backdrop = document.getElementById('bookmark-sheet-backdrop');
const openBtn = document.getElementById('bookmark-sheet-open');
const empty = document.getElementById('bookmark-sheet-empty');
const drawerBody = document.querySelector<HTMLElement>('.nav-drawer-body');
const saved = document.getElementById('bookmark-saved');
const ranking = document.getElementById('bookmark-ranking');

if (sheet && sheetBody && backdrop && openBtn && drawerBody && saved && ranking) {
  const mobile = window.matchMedia('(max-width: 767px)');

  function isOpen() {
    return document.documentElement.classList.contains('bookmark-sheet-open');
  }

  function setOpen(open: boolean) {
    document.documentElement.classList.toggle('bookmark-sheet-open', open);
    openBtn!.setAttribute('aria-expanded', String(open));
    sheet!.setAttribute('aria-hidden', String(!open));
    if (open) lockPageScroll();
    else unlockPageScroll();
  }

  // 両セクションとも非表示(保存ゼロ・ランキング未生成)なら案内文を出す。
  function syncEmpty() {
    if (!empty) return;
    empty.hidden = !(saved!.hidden && ranking!.hidden);
  }

  // モバイルではシートへ、デスクトップではサイドバーへ。順序は Saved → Popular。
  function place() {
    const host = mobile.matches ? sheetBody! : drawerBody!;
    if (saved!.parentElement !== host) host.appendChild(saved!);
    if (ranking!.parentElement !== host) host.appendChild(ranking!);
    if (!mobile.matches && isOpen()) setOpen(false);
  }

  place();
  syncEmpty();
  // change だけでは拾えない環境(ウィンドウのリサイズでメディアクエリの change が
  // 飛ばないブラウザ/自動化環境)があるので resize も見る。place() は移動先が
  // 現在地と同じなら何もしないので、多重に呼ばれても無害。
  mobile.addEventListener('change', place);
  window.addEventListener('resize', place);

  openBtn.addEventListener('click', () => setOpen(!isOpen()));
  backdrop.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) setOpen(false);
  });

  // 記事カードをタップしたら遷移するので、閉じてから離脱させる(戻ったときに
  // シートが開きっぱなしにならないように)。
  sheet.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a')) setOpen(false);
  });

  // セクションの表示/非表示は bookmark-saved.ts / bookmark-ranking.ts が非同期に
  // 切り替える。hidden 属性の変化を見て案内文を追従させる。
  const observer = new MutationObserver(syncEmpty);
  observer.observe(saved, { attributes: true, attributeFilter: ['hidden'] });
  observer.observe(ranking, { attributes: true, attributeFilter: ['hidden'] });
}
