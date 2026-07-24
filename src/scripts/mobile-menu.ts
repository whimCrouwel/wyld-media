// モバイルヘッダーのハンバーガーメニュー(Works/Writers を格納した小さな
// ドロップダウン)。画面を覆う大きなシートではないため、スクロールロックは
// 掛けず、外側クリック/Esc/リンク選択のいずれでも閉じる。
const toggle = document.getElementById('mobile-menu-toggle');
const menu = document.getElementById('mobile-menu');

if (toggle && menu) {
  function isOpen() {
    return document.documentElement.classList.contains('mobile-menu-open');
  }

  function setOpen(open: boolean) {
    document.documentElement.classList.toggle('mobile-menu-open', open);
    toggle!.setAttribute('aria-expanded', String(open));
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!isOpen());
  });

  document.addEventListener('click', (e) => {
    if (!isOpen()) return;
    const target = e.target as Node;
    if (menu!.contains(target) || toggle!.contains(target)) return;
    setOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) setOpen(false);
  });

  menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
}
