// 全ページ共通の点グリッド背景。カーソル位置に応じて周辺のドットだけ差し色で
// 明るく浮かび上がらせる「スポットライト」を付ける。実際の見た目(グリッド柄・
// マスク)は BgGrid.astro の CSS が持ち、ここは --mx/--my(viewport基準px)を
// 書き込むだけ。タッチ端末(pointer:coarseのみ)/reduced-motionではリスナーを
// 張らず、静的なグリッドのまま。

const host = document.getElementById('bg-grid');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(pointer: fine)').matches;

if (host && !reduced && finePointer) {
  let raf = 0;
  let pendingX = 0;
  let pendingY = 0;

  function apply() {
    raf = 0;
    host!.style.setProperty('--mx', `${pendingX}px`);
    host!.style.setProperty('--my', `${pendingY}px`);
  }

  window.addEventListener('mousemove', (e) => {
    pendingX = e.clientX;
    pendingY = e.clientY;
    host!.classList.add('is-active');
    if (!raf) raf = requestAnimationFrame(apply);
  });

  document.addEventListener('mouseout', (e) => {
    if (e.relatedTarget === null) host!.classList.remove('is-active');
  });
}
