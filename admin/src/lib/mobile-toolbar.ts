import type { Editor } from '@tiptap/core';

/**
 * モバイル(<640px)向けの本文ツールバー。
 *
 * デスクトップの BubbleMenu(選択時に浮く17個のボタン)は、狭い画面だと
 * 折り返して本文を覆い、タッチのテキスト選択とも競合して使い物にならない。
 * モバイルではツールバーを画面下部・ソフトキーボードの直上に固定し、
 * エディタにフォーカスがある間だけ横スクロール可能な1行バーとして出す
 * (Notion / Medium のモバイルエディタと同じ発想)。
 *
 * edit.astro 側では、モバイル時に BubbleMenu 拡張を外したうえでこれを呼ぶ。
 * BubbleMenu(tippy)配下のままだと変形コンテナができて position:fixed が
 * 効かないため、ここで toolbar 要素を body 直下へ移してから固定する。
 */
export function initMobileToolbarDock(editor: Editor, toolbarEl: HTMLElement): void {
  toolbarEl.classList.add('bubble-toolbar--docked');
  document.body.append(toolbarEl);
  toolbarEl.hidden = true;

  // バーの余白(ボタン以外)のタップでエディタのフォーカス=キャレット位置を
  // 奪わないようにする。ボタン自体のタップは通す(各ハンドラが
  // editor.chain().focus() でフォーカスを戻す)。
  toolbarEl.addEventListener('mousedown', (e) => {
    if (e.target === toolbarEl) e.preventDefault();
  });

  // ソフトキーボードの上端に合わせてバーを持ち上げる。visualViewport が
  // 使えない環境では CSS 既定の bottom:0 のまま(キーボード裏に隠れるが
  // フォールバックとして許容)。
  const vv = window.visualViewport;
  const reposition = () => {
    if (!vv) return;
    const overlap = window.innerHeight - (vv.height + vv.offsetTop);
    toolbarEl.style.bottom = `${Math.max(overlap, 0)}px`;
  };

  const show = () => {
    toolbarEl.hidden = false;
    reposition();
  };
  const hide = () => {
    toolbarEl.hidden = true;
  };

  editor.on('focus', show);
  editor.on('blur', () => {
    // blur 直後にツールバーのボタン click が走るケースを消さないよう少し待ち、
    // 本当にフォーカスが外れたときだけ隠す。
    setTimeout(() => {
      if (!editor.isFocused) hide();
    }, 150);
  });

  vv?.addEventListener('resize', reposition);
  vv?.addEventListener('scroll', reposition);
}
