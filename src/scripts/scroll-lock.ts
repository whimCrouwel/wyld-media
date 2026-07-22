// モーダル/ドロワーを開いている間、背後のページを動かさないための共有ロック。
// 検索モーダルとナビゲーションドロワーが同時に開きうる(ドロワー内の検索ボタン)
// ため、参照カウントで多重ロックを吸収する。最初の lock でだけ固定し、最後の
// unlock でだけ復帰する。
//
// dialog を開いただけでは止まらない理由が2つある:
//   1. Lenis が window でホイールを乗っ取っている(gallery.ts)
//   2. dialog の外側(バックドロップ上)のホイールは素の文書スクロールに流れる
//
// html に overflow:hidden を掛ける手もあるが、スクロール領域が潰れて位置が
// 0 に飛び、背景がモーダル越しに先頭までジャンプして見える。body を
// position:fixed にして今の位置ぶん上へずらすと、見た目を保ったまま固定できる。
import { getLenis } from './lenis-instance';

let lockCount = 0;
let savedScrollY = 0;

export function lockPageScroll() {
  if (lockCount++ > 0) return; // 既にロック中なら二重に固定しない
  // 位置は Lenis を止める前に、Lenis 自身の値から読む。停止後に window.scrollY を
  // 読むと、Lenis が RAF で書き戻した後の値(多くは 0)を拾ってしまう。
  const lenis = getLenis();
  savedScrollY = Math.round(lenis?.scroll ?? window.scrollY);
  lenis?.stop();
  // スクロールバーぶんの幅を埋め戻さないと、消えた瞬間に背景が横へ飛ぶ
  // (macOS の overlay scrollbar では 0 になり、何も起きない)。
  const gap = window.innerWidth - document.documentElement.clientWidth;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${savedScrollY}px`;
  document.body.style.width = '100%';
  if (gap > 0) document.body.style.paddingRight = `${gap}px`;
}

export function unlockPageScroll() {
  if (lockCount === 0) return;
  if (--lockCount > 0) return; // まだ他のモーダルが開いているので固定を保つ
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  document.body.style.paddingRight = '';
  window.scrollTo(0, savedScrollY);
  const lenis = getLenis();
  lenis?.start();
  // Lenis は内部に自前の位置を持つので、再開前に合わせないと
  // 次のホイールで元いた場所へ飛び戻る。
  lenis?.scrollTo(savedScrollY, { immediate: true });
}
