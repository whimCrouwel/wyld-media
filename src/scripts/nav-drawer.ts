// 常設サイドバー(検索+地域)の開閉。デフォルトで開いており、モーダルでは
// なくレイアウトの一部(#page-shift の flex 兄弟)なので、開閉してもフォーカス
// トラップやスクロールロックは行わない。閉じると width が rail 幅まで縮み、
// トグルボタンだけが残る(NavDrawer.astro の CSS 側で見た目を制御)。
// 開閉状態は localStorage に保存し、ページ遷移(Astro は MPA なので都度フル
// リロード)をまたいで復元する。初期状態の反映自体は Base.astro の <head>
// 内インラインスクリプトが描画前に行う(ちらつき防止)ので、ここでは
// トグルボタンの aria 属性をその実際の状態に同期するだけでよい。
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
    localStorage.setItem('nav-drawer-closed', open ? '0' : '1');
  }

  // <head> のインラインスクリプトが drawer-closed クラスを付けた状態で
  // 読み込まれている場合があるため、初期表示のトグルボタン aria を実際の
  // 状態に合わせる(クラス自体は書き換えない)。
  setOpen(isOpen());

  toggleBtn.addEventListener('click', () => setOpen(!isOpen()));
}
