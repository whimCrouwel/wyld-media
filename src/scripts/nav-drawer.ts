// 常設サイドバー(検索+地域)の開閉。デフォルトで開いており、モーダルでは
// なくレイアウトの一部(#page-shift の flex 兄弟)なので、開閉してもフォーカス
// トラップやスクロールロックは行わない。閉じると width が rail 幅まで縮み、
// トグルボタンだけが残る(NavDrawer.astro の CSS 側で見た目を制御)。
const drawer = document.getElementById('nav-drawer');
const toggleBtn = document.getElementById('nav-toggle');

if (drawer && toggleBtn) {
  function isOpen() {
    return !document.documentElement.classList.contains('drawer-closed');
  }

  function setOpen(open: boolean) {
    document.documentElement.classList.toggle('drawer-closed', !open);
    toggleBtn!.setAttribute('aria-expanded', String(open));
    toggleBtn!.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
  }

  toggleBtn.addEventListener('click', () => setOpen(!isOpen()));
}
