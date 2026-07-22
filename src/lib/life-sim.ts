// トップページ背景「対称ライフゲーム」のシミュレーション本体(DOM非依存)。
// 描画(WebGL/three.js)側からは createBoard/seedSymmetric/step/population/
// boardHash/historyIndicatesStable/isD4Symmetric のみを使う。
// 対称性は「D4対称な初期盤面」だけで保証する設計のため、step() 自体には
// ミラーリング等の特別扱いを一切入れない(design doc参照)。

export const GRID_SIZE = 144; // 偶数。D4の中心が格子の中心(セルとセルの間)に来るように

const AFTERGLOW_DECAY = 0.4;

export interface LifeBoard {
  size: number;
  alive: Uint8Array;
  age: Uint16Array;
  afterglow: Float32Array;
}

export function createBoard(size: number = GRID_SIZE): LifeBoard {
  const cells = size * size;
  return {
    size,
    alive: new Uint8Array(cells),
    age: new Uint16Array(cells),
    afterglow: new Float32Array(cells),
  };
}

// 中心相対座標(dx = x - size/2)の、中心を挟んだ反対側の値。
// 中心はセルとセルの間(境界)にあるため、単純な符号反転(-dx)ではなく
// -dx-1 になる(dx=-1 <-> dx=0 が center を挟んで隣り合う)。
function flip(v: number): number {
  return -v - 1;
}

// 中心相対座標 (dx, dy) を D4 の8つの対称位置(重複あり得る)に展開する。
function d4Mirrors(dx: number, dy: number): Array<[number, number]> {
  return [
    [dx, dy],
    [flip(dx), dy],
    [dx, flip(dy)],
    [flip(dx), flip(dy)],
    [dy, dx],
    [flip(dy), dx],
    [dy, flip(dx)],
    [flip(dy), flip(dx)],
  ];
}

export function seedSymmetric(
  board: LifeBoard,
  opts?: { density?: number; radius?: number; rng?: () => number }
): void {
  const density = opts?.density ?? 0.35;
  const radius = opts?.radius ?? Math.max(1, Math.round(board.size / 6));
  const rng = opts?.rng ?? Math.random;

  const { size, alive } = board;
  const half = size / 2;

  // 基本ウェッジ: 中心相対座標で 0 <= dy <= dx、かつ半径以内
  for (let dx = 0; dx <= radius; dx++) {
    for (let dy = 0; dy <= dx; dy++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      if (rng() >= density) continue;

      for (const [mdx, mdy] of d4Mirrors(dx, dy)) {
        const x = mdx + half;
        const y = mdy + half;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        alive[y * size + x] = 1;
      }
    }
  }
}

export function step(board: LifeBoard): void {
  const { size, alive, age, afterglow } = board;
  const next = new Uint8Array(alive.length);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
          neighbors += alive[ny * size + nx];
        }
      }

      const wasAlive = alive[idx] === 1;
      const willBeAlive = wasAlive ? neighbors === 2 || neighbors === 3 : neighbors === 3;
      next[idx] = willBeAlive ? 1 : 0;

      if (willBeAlive) {
        age[idx] = wasAlive ? age[idx] + 1 : 1;
        afterglow[idx] = 0;
      } else {
        age[idx] = 0;
        afterglow[idx] = wasAlive ? 1.0 : afterglow[idx] * AFTERGLOW_DECAY;
      }
    }
  }

  board.alive = next;
}

export function population(board: LifeBoard): number {
  let count = 0;
  for (let i = 0; i < board.alive.length; i++) count += board.alive[i];
  return count;
}

export function boardHash(board: LifeBoard): string {
  // FNV-1a風の単純ハッシュ。順序依存(同じ生存数でも配置が違えば別ハッシュになる)。
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  const { alive } = board;
  for (let i = 0; i < alive.length; i++) {
    if (alive[i] === 0) continue;
    h1 ^= i;
    h1 = Math.imul(h1, 0x01000193);
    h2 = (h2 ^ (i + 1)) >>> 0;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}-${alive.length}`;
}

export function historyIndicatesStable(hashes: string[], maxPeriod: number = 8): boolean {
  if (hashes.length < 2) return false;
  const latest = hashes[hashes.length - 1];
  const start = Math.max(0, hashes.length - 1 - maxPeriod);
  for (let i = start; i < hashes.length - 1; i++) {
    if (hashes[i] === latest) return true;
  }
  return false;
}

export function isD4Symmetric(board: LifeBoard): boolean {
  const { size, alive } = board;
  const half = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (alive[y * size + x] !== 1) continue;

      const dx = x - half;
      const dy = y - half;

      for (const [mdx, mdy] of d4Mirrors(dx, dy)) {
        const mx = mdx + half;
        const my = mdy + half;
        if (mx < 0 || mx >= size || my < 0 || my >= size) return false;
        if (alive[my * size + mx] !== 1) return false;
      }
    }
  }
  return true;
}
