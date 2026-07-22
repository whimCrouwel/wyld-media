import { describe, it, expect } from 'vitest';
import {
  GRID_SIZE,
  createBoard,
  seedSymmetric,
  step,
  population,
  boardHash,
  historyIndicatesStable,
  isD4Symmetric,
  type LifeBoard,
} from '../src/lib/life-sim';

// D4ミラーの参照実装(本体の内部関数とは独立に、テスト側で再計算して検証する)。
// 中心は size/2 の位置(セルとセルの境目)にあるため、単純な符号反転ではなく
// flip(v) = -v-1 になる(life-sim.ts のコメント参照)。
function flip(v: number): number {
  return -v - 1;
}

function d4MirrorsOf(dx: number, dy: number): Array<[number, number]> {
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

// ウェッジ相対座標(dx,dy、0<=dy<=dx)のリストを与え、D4の8方向すべてに
// 手動でミラーして盤面にセットするテスト用ヘルパー。
function seedWedgeCells(board: LifeBoard, wedgeCells: Array<[number, number]>): void {
  const half = board.size / 2;
  for (const [dx, dy] of wedgeCells) {
    for (const [mdx, mdy] of d4MirrorsOf(dx, dy)) {
      const x = mdx + half;
      const y = mdy + half;
      if (x < 0 || x >= board.size || y < 0 || y >= board.size) continue;
      board.alive[y * board.size + x] = 1;
    }
  }
}

describe('createBoard', () => {
  it('デフォルトはGRID_SIZEのD4対応(偶数)盤面', () => {
    const board = createBoard();
    expect(board.size).toBe(GRID_SIZE);
    expect(GRID_SIZE % 2).toBe(0);
    expect(board.alive.length).toBe(GRID_SIZE * GRID_SIZE);
    expect(board.age.length).toBe(GRID_SIZE * GRID_SIZE);
    expect(board.afterglow.length).toBe(GRID_SIZE * GRID_SIZE);
  });

  it('サイズを指定できる(テストでは小さい盤面を使う)', () => {
    const board = createBoard(20);
    expect(board.size).toBe(20);
    expect(board.alive.length).toBe(400);
  });

  it('生成直後は全セルが死んでいる', () => {
    const board = createBoard(10);
    expect(population(board)).toBe(0);
    expect(Array.from(board.age)).toEqual(new Array(100).fill(0));
    expect(Array.from(board.afterglow)).toEqual(new Array(100).fill(0));
  });
});

describe('step: 静物(still life)', () => {
  it('2x2ブロックは何世代進めても生存パターンが変わらない', () => {
    const board = createBoard(10);
    const size = board.size;
    const block = [
      [4, 4],
      [5, 4],
      [4, 5],
      [5, 5],
    ];
    for (const [x, y] of block) board.alive[y * size + x] = 1;

    const aliveIndices = () =>
      Array.from(board.alive)
        .map((v, i) => (v === 1 ? i : -1))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b);

    const expected = aliveIndices();

    for (let gen = 1; gen <= 5; gen++) {
      step(board);
      expect(aliveIndices()).toEqual(expected);
      expect(population(board)).toBe(4);
      for (const [x, y] of block) {
        expect(board.age[y * size + x]).toBe(gen);
        expect(board.afterglow[y * size + x]).toBe(0);
      }
    }
  });
});

describe('step: D4対称性の保存', () => {
  it('ウェッジに播種したブリンカー状パターンは、複数世代進めてもD4対称のまま', () => {
    const board = createBoard(20);
    // ウェッジ内(0<=dy<=dx)の水平ライン。ミラーすると盤面全体に8方向展開される。
    seedWedgeCells(board, [
      [1, 0],
      [2, 0],
      [3, 0],
    ]);

    expect(population(board)).toBeGreaterThan(0);
    expect(isD4Symmetric(board)).toBe(true);

    for (let gen = 0; gen < 6; gen++) {
      step(board);
      expect(isD4Symmetric(board)).toBe(true);
    }
  });

  it('ウェッジに播種したグライダー状パターンも複数世代D4対称のまま', () => {
    const board = createBoard(24);
    // グライダーのL字型をウェッジ内に収まる座標で配置
    seedWedgeCells(board, [
      [2, 0],
      [3, 0],
      [4, 0],
      [4, 1],
      [3, 2],
    ]);

    expect(isD4Symmetric(board)).toBe(true);

    for (let gen = 0; gen < 8; gen++) {
      step(board);
      expect(isD4Symmetric(board)).toBe(true);
    }
  });
});

describe('seedSymmetric', () => {
  it('決定的なrngを注入するとD4対称な盤面を生成する', () => {
    const board = createBoard(16);
    seedSymmetric(board, { density: 0.5, radius: 3, rng: () => 0 });

    expect(population(board)).toBeGreaterThan(0);
    expect(isD4Symmetric(board)).toBe(true);
  });

  it('播種されるセルはウェッジ+半径の範囲内に限られる', () => {
    const board = createBoard(16);
    const radius = 3;
    seedSymmetric(board, { density: 0.5, radius, rng: () => 0 });

    const half = board.size / 2;
    const minCoord = half - radius - 1;
    const maxCoord = half + radius;

    for (let y = 0; y < board.size; y++) {
      for (let x = 0; x < board.size; x++) {
        if (board.alive[y * board.size + x] !== 1) continue;
        expect(x).toBeGreaterThanOrEqual(minCoord);
        expect(x).toBeLessThanOrEqual(maxCoord);
        expect(y).toBeGreaterThanOrEqual(minCoord);
        expect(y).toBeLessThanOrEqual(maxCoord);
      }
    }
  });

  it('既存の生存セル(範囲外)をクリアせず、追加するだけ', () => {
    const board = createBoard(16);
    // ウェッジ+半径の範囲から明らかに外れる角のセル
    board.alive[0] = 1; // (x=0, y=0)

    seedSymmetric(board, { density: 0.5, radius: 3, rng: () => 0 });

    expect(board.alive[0]).toBe(1);
    // 播種によって他のセルも増えているはず
    expect(population(board)).toBeGreaterThan(1);
  });

  it('density=0 相当(rngが常にdensity以上を返す)なら何も追加しない', () => {
    const board = createBoard(16);
    seedSymmetric(board, { density: 0.5, radius: 3, rng: () => 1 });
    expect(population(board)).toBe(0);
  });
});

describe('population', () => {
  it('生存セル数をそのまま数える', () => {
    const board = createBoard(5);
    board.alive[0] = 1;
    board.alive[3] = 1;
    board.alive[10] = 1;
    expect(population(board)).toBe(3);
  });

  it('空盤面は0', () => {
    expect(population(createBoard(8))).toBe(0);
  });
});

describe('boardHash', () => {
  it('同じ配置なら同じハッシュ', () => {
    const a = createBoard(8);
    const b = createBoard(8);
    a.alive[5] = 1;
    a.alive[12] = 1;
    b.alive[5] = 1;
    b.alive[12] = 1;
    expect(boardHash(a)).toBe(boardHash(b));
  });

  it('生存数が同じでも配置が違えば別のハッシュ(単なる人口カウントではない)', () => {
    const a = createBoard(8);
    const b = createBoard(8);
    a.alive[5] = 1;
    a.alive[12] = 1;
    b.alive[6] = 1;
    b.alive[12] = 1;
    expect(boardHash(a)).not.toBe(boardHash(b));
  });

  it('空盤面のハッシュは呼ぶたびに一定', () => {
    const board = createBoard(8);
    expect(boardHash(board)).toBe(boardHash(board));
  });
});

describe('historyIndicatesStable', () => {
  it('周期パターン(振動子)を検出する', () => {
    expect(historyIndicatesStable(['a', 'b', 'a', 'b'])).toBe(true);
  });

  it('静物相当(直前と同一)を検出する', () => {
    expect(historyIndicatesStable(['a', 'b', 'c', 'c'])).toBe(true);
  });

  it('厳密に変化し続けるシーケンスはfalse', () => {
    expect(historyIndicatesStable(['a', 'b', 'c', 'd'])).toBe(false);
  });

  it('履歴が足りない場合はfalse', () => {
    expect(historyIndicatesStable([])).toBe(false);
    expect(historyIndicatesStable(['a'])).toBe(false);
  });

  it('maxPeriodより古い一致は無視する', () => {
    const hashes = ['h0', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h0'];
    // hashes[0] === hashes[9] だが、間隔(9)が maxPeriod(既定8)を超えるため無視される
    expect(historyIndicatesStable(hashes)).toBe(false);
  });

  it('maxPeriod引数で窓の広さを指定できる', () => {
    const hashes = ['x', 'a', 'b', 'x'];
    expect(historyIndicatesStable(hashes, 2)).toBe(false);
    expect(historyIndicatesStable(hashes, 3)).toBe(true);
  });
});

describe('isD4Symmetric', () => {
  it('空盤面は対称とみなす', () => {
    expect(isD4Symmetric(createBoard(10))).toBe(true);
  });

  it('中心の2x2ブロックのみは対称', () => {
    const board = createBoard(10);
    const half = board.size / 2;
    for (const [dx, dy] of [
      [0, 0],
      [-1, 0],
      [0, -1],
      [-1, -1],
    ]) {
      board.alive[(dy + half) * board.size + (dx + half)] = 1;
    }
    expect(isD4Symmetric(board)).toBe(true);
  });

  it('片側だけに生存セルがあると非対称', () => {
    const board = createBoard(10);
    board.alive[0] = 1;
    expect(isD4Symmetric(board)).toBe(false);
  });
});

describe('step: 経齢(age)と残光(afterglow)', () => {
  it('孤立したセルは1世代で死に、afterglowが1.0になった後、世代ごとに減衰する', () => {
    const board = createBoard(5);
    const size = board.size;
    const x = 2;
    const y = 2;
    board.alive[y * size + x] = 1;

    step(board); // 近傍0 → 過疎で死亡
    expect(board.alive[y * size + x]).toBe(0);
    expect(board.age[y * size + x]).toBe(0);
    expect(board.afterglow[y * size + x]).toBeCloseTo(1.0, 5);

    step(board); // 死亡セルは減衰
    expect(board.afterglow[y * size + x]).toBeCloseTo(0.4, 5);

    step(board);
    expect(board.afterglow[y * size + x]).toBeCloseTo(0.16, 5);
  });

  it('一度も生存していないセルのafterglowは常に0のまま', () => {
    const board = createBoard(5);
    board.alive[2 * 5 + 2] = 1; // 中心セルだけ生存(周囲は空)
    const untouchedIdx = 0; // 角のセル

    for (let i = 0; i < 4; i++) {
      step(board);
      expect(board.afterglow[untouchedIdx]).toBe(0);
    }
  });

  it('生存し続けるセルはageが1ずつ増え、死ぬとageは0に戻る', () => {
    const board = createBoard(10);
    const size = board.size;
    // 2x2の静物ブロック(常に生存)
    for (const [x, y] of [
      [4, 4],
      [5, 4],
      [4, 5],
      [5, 5],
    ]) {
      board.alive[y * size + x] = 1;
    }
    // 孤立セル(1世代で死ぬ)
    board.alive[1 * size + 1] = 1;

    step(board);
    expect(board.age[4 * size + 4]).toBe(1);
    expect(board.age[1 * size + 1]).toBe(0); // 死んだのでリセット

    step(board);
    expect(board.age[4 * size + 4]).toBe(2);
  });
});
