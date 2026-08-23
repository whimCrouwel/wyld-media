// 横カルーセル(.bookmark-carousel)をマウスのドラッグでも送れるようにする。
//
// overflow-x:auto だけだと、送れるのはタッチ/トラックパッドのスワイプと、
// Chrome が「横しかスクロールできない要素」に限って縦ホイールを横に読み替える
// 挙動まで。マウスで掴んで送ることはできず「スクロールできない」状態に見える。
// Swiper 等を足すほどの要件ではないので、ポインタのドラッグだけを素の DOM API で足す。
//
// pointermove/pointerup は要素ではなく window で受ける(setPointerCapture は
// 環境によって握れないことがあり、掴んだ途中でカルーセルの外にカーソルが出ると
// 送りが止まってしまうため)。
// scroll-snap-type はドラッグ中だけ外す(1pxごとにスナップが引き戻して
// 掴んだ手からカードが逃げるため)。

const DRAG_THRESHOLD = 4; // これ未満の移動はクリック(記事を開く)として扱う

function enable(el: HTMLElement) {
  let active = false;
  let dragged = false;
  let startX = 0;
  let startScroll = 0;

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.pointerType === 'touch') return; // タッチは素の慣性に任せる
    active = true;
    dragged = false;
    startX = e.clientX;
    startScroll = el.scrollLeft;
  });

  window.addEventListener('pointermove', (e) => {
    if (!active) return;
    const dx = e.clientX - startX;
    if (!dragged) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      dragged = true;
      el.classList.add('is-dragging');
      el.style.scrollSnapType = 'none';
    }
    el.scrollLeft = startScroll - dx;
    e.preventDefault();
  });

  function end() {
    if (!active) return;
    active = false;
    if (dragged) {
      el.classList.remove('is-dragging');
      el.style.scrollSnapType = '';
    }
  }
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);

  // ドラッグ直後の click はカード遷移を止める(掴んで送っただけのつもりで
  // 記事が開いてしまうのを防ぐ)。capture 段階で握りつぶす。
  el.addEventListener('click', (e) => {
    if (dragged) {
      e.preventDefault();
      e.stopPropagation();
      dragged = false;
    }
  }, true);

  // 画像はブラウザ既定のドラッグ&ドロップが先に発火して掴めなくなるので止める。
  el.addEventListener('dragstart', (e) => e.preventDefault());
}

document.querySelectorAll<HTMLElement>('.bookmark-carousel').forEach(enable);
