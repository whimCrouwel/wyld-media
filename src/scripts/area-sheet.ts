// モバイル版 AREA ナビ(下からせり上がるシート)の開閉。
// デスクトップの常設サイドバー開閉(nav-drawer.ts の drawer-closed)とは別の
// html クラス(area-sheet-open)で制御し、互いに干渉しない。
import { lockPageScroll, unlockPageScroll } from './scroll-lock';

const openBtn = document.getElementById('area-sheet-open');
const backdrop = document.getElementById('area-sheet-backdrop');

if (openBtn && backdrop) {
  function isOpen() {
    return document.documentElement.classList.contains('area-sheet-open');
  }

  function setOpen(open: boolean) {
    document.documentElement.classList.toggle('area-sheet-open', open);
    openBtn!.setAttribute('aria-expanded', String(open));
    if (open) lockPageScroll();
    else unlockPageScroll();
  }

  openBtn.addEventListener('click', () => setOpen(!isOpen()));
  backdrop.addEventListener('click', () => setOpen(false));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) setOpen(false);
  });

  // 地図タイル/フットの項目をタップしたら(絞り込み反映後)シートを閉じる。
  document.getElementById('nav-drawer')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.area-tile, .chip')) setOpen(false);
  });
}
