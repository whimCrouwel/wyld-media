import type Lenis from 'lenis';

// Lenis(慣性スクロール)の実体は gallery.ts が作る。モーダルを開いている間は
// 止めないと、ホイールが背後のページを動かしてしまう(Lenis は window で
// ホイールを乗っ取るので、dialog を開いただけでは止まらない)。
//
// ここが実体を持たず参照だけ預かるのは、Lenis を使うページとモーダルを出す
// ページが一致しないため。マソンリーの無いページでは実体が無く null になる。
let instance: Lenis | null = null;

export function setLenis(l: Lenis): void {
  instance = l;
}

export function getLenis(): Lenis | null {
  return instance;
}
