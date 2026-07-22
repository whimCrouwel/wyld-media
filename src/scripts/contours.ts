import * as THREE from 'three';
import {
  GRID_SIZE,
  createBoard,
  seedSymmetric,
  step as stepBoard,
  population,
  boardHash,
  historyIndicatesStable,
  type LifeBoard,
} from '../lib/life-sim';

/*
 * 全ページ共通背景の「対称ライフゲーム(開花)」。D4対称(90°回転4種+鏡映4種)な
 * 初期盤面からコンウェイのライフゲームを進め、各セルを角丸正方形(スーパー楕円)の
 * 細かいモザイクタイルとして描く。経齢と死亡後の残光を生育配色(若葉の黄緑→深緑→
 * 黄昏の紫紺→透明)でグラデーションさせる。世代の進行はゆっくり。
 * 盤面が安定/振動した・人口が減った・一定時間経ったのいずれかで、中心付近に
 * 新しい対称シードを重ねて播種し直し(全消去はしない)、繰り返し「開花」させる。
 * カーソルとの連動はなし(静かな背景要素として自律的に動くのみ)。
 *
 * 全面固定・コンテンツ背後・pointer-events:none。reduced-motion では動かさず、
 * タブ非表示中は一時停止。WebGL 非対応なら何もしない(古紙の地のまま)。
 */

const host = document.getElementById('bg-contours');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function webglSupported(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uBoard;
uniform vec2 uRes;
uniform float uGridSize;
varying vec2 vUv;

// R = alive(0/1), G = age(0..1, uPeakAgeで正規化済み), B = afterglow(0..1)
vec4 sampleCell(vec2 uv) {
  return texture2D(uBoard, uv);
}

void main() {
  float aspect = uRes.x / uRes.y;
  vec2 p = vUv - 0.5;
  p.x *= aspect;

  // 盤面(0..1)を画面中央に「contain」配置する。zoomが大きいほど中心付近を
  // 拡大表示する(=盤面の大部分を占める空白を切り捨て、生存クラスタを大きく見せる)。
  float zoom = 2.2;
  vec2 uv = p / zoom + 0.5;

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // セル中心をそのままサンプルし(ブレンドしない)、セルごとに角丸の正方形タイル
  // (モザイク)としてくっきり描く。輪郭のみ1〜2テクセル分だけアンチエイリアスする。
  vec2 cellCoord = uv * uGridSize;
  vec2 cellId = floor(cellCoord);
  vec2 cellLocal = fract(cellCoord) - 0.5; // セル内ローカル座標(-0.5..0.5)
  vec2 texel = (cellId + 0.5) / uGridSize;
  vec4 cell = sampleCell(texel);

  float alive = cell.r;
  float ageN = clamp(cell.g, 0.0, 1.0); // 0=誕生直後 .. 1=経齢のピーク
  float afterglow = cell.b;

  // 角丸正方形(スーパー楕円)。指数を上げるほど角ばり、下げるほど円に近づく
  float sq = 4.0;
  float d = pow(pow(abs(cellLocal.x), sq) + pow(abs(cellLocal.y), sq), 1.0 / sq);
  float dotR = 0.41; // タイルの大きさ(隣接タイルの間にわずかな目地が残る)
  float edge = fwidth(d) + 1.0 / uGridSize;
  float shape = 1.0 - smoothstep(dotR - edge, dotR + edge, d);

  // 若葉の淡い黄緑 → 定着した深緑 → ピークで黄昏の紫紺(緑の生育から夜へ)
  float sproutToLeaf = smoothstep(0.0, 0.35, ageN);
  float leafToPetal = smoothstep(0.6, 1.0, ageN);

  vec3 sprout = vec3(0.788, 0.851, 0.627); // #c9d9a0
  vec3 leaf = vec3(0.435, 0.580, 0.388); // #6f9463
  vec3 petal = vec3(0.239, 0.216, 0.388); // #3d3763

  vec3 aliveColor = mix(sprout, leaf, sproutToLeaf);
  aliveColor = mix(aliveColor, petal, leafToPetal);

  // 死亡セルは残光としてピーク色(黄昏紫)から --color-meta 方向へフェードしながら透明化
  vec3 meta = vec3(0.553, 0.506, 0.406); // #8d8168 相当
  vec3 deadColor = mix(meta, petal, afterglow);

  vec3 col = mix(deadColor, aliveColor, alive);
  float coverage = max(alive, afterglow) * shape;

  float alphaScale = mix(0.22, 0.34, leafToPetal);
  float alpha = coverage * alphaScale;

  gl_FragColor = vec4(col, alpha);
}
`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// シェーダはフルスクリーンの単一パスなので、負荷の大半はピクセル数に比例する。
// 描画バッファを縮小して CSS で引き伸ばすと、GPU負荷が RENDER_SCALE^2 で下がる上に
// わずかなぼかしがかかって輪郭がより滑らかに見える(狙い通りの副作用)。
const RENDER_SCALE = 0.7;
const FRAME_INTERVAL = 1 / 30; // 常時アニメーションが必要な要素ではないので 30fps に制限

const GEN_INTERVAL = 0.35; // 世代の進行間隔(約350ms)。描画のRAFループとは独立
const PEAK_AGE = 40; // これ以上の経齢で「花びら」色に達したとみなす(タイル塗り替え用の正規化上限)
const STABLE_HISTORY_CAP = 12; // ローリングハッシュの保持数
const RESEED_POPULATION_FLOOR = GRID_SIZE; // 人口がこれを下回ったら再播種
const RESEED_MAX_INTERVAL = 40; // 秒。これだけ経ったら無条件で再播種

function init(root: HTMLElement) {
  let W = window.innerWidth;
  let H = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

  const scene = new THREE.Scene();
  const camera = new THREE.Camera();

  // 全面べた塗りの1パスシェーダにMSAAは効果が薄く、コストだけがかかるため無効化
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.setPixelRatio(dpr);

  function setRendererSize(w: number, h: number) {
    // 第3引数 false で内部描画解像度だけ落とし、CSSサイズは画面いっぱいのまま保つ
    renderer.setSize(w * RENDER_SCALE, h * RENDER_SCALE, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
  }
  setRendererSize(W, H);
  renderer.setClearColor(0x000000, 0);
  root.appendChild(renderer.domElement);

  // --- ライフゲーム盤面のセットアップ ---
  const board: LifeBoard = createBoard(GRID_SIZE);
  seedSymmetric(board);
  let hashHistory: string[] = [];
  let sinceReseed = 0;

  const boardPixels = new Uint8Array(GRID_SIZE * GRID_SIZE * 4);
  const boardTexture = new THREE.DataTexture(
    boardPixels,
    GRID_SIZE,
    GRID_SIZE,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  boardTexture.magFilter = THREE.NearestFilter;
  boardTexture.needsUpdate = true;

  function packBoardTexture() {
    const { alive, age, afterglow } = board;
    for (let i = 0; i < alive.length; i++) {
      const o = i * 4;
      boardPixels[o] = alive[i] ? 255 : 0;
      const ageN = Math.min(255, Math.round((age[i] / PEAK_AGE) * 255));
      boardPixels[o + 1] = ageN;
      boardPixels[o + 2] = Math.round(Math.max(0, Math.min(1, afterglow[i])) * 255);
      boardPixels[o + 3] = 255;
    }
    boardTexture.needsUpdate = true;
  }
  packBoardTexture();

  function tickGeneration() {
    stepBoard(board);
    packBoardTexture();

    const hash = boardHash(board);
    hashHistory.push(hash);
    if (hashHistory.length > STABLE_HISTORY_CAP) hashHistory.shift();

    const stagnant = historyIndicatesStable(hashHistory);
    const sparse = population(board) < RESEED_POPULATION_FLOOR;
    const timedOut = sinceReseed >= RESEED_MAX_INTERVAL;

    if (stagnant || sparse || timedOut) {
      seedSymmetric(board);
      hashHistory = [];
      sinceReseed = 0;
    }
  }

  const uniforms = {
    uBoard: { value: boardTexture },
    uRes: { value: new THREE.Vector2(W, H) },
    uGridSize: { value: GRID_SIZE },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide, // クリップ座標直書きだと裏面になりカリングされるため両面に
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);

  const clock = new THREE.Clock();
  let sinceLastRender = 0; // FRAME_INTERVAL に達するまで描画を間引く
  let sinceLastGen = 0; // GEN_INTERVAL に達するまで世代を進めない(描画とは独立)
  let running = true;

  let logged = false;
  function frame() {
    if (!running) return;
    const delta = Math.min(0.05, clock.getDelta());
    sinceLastRender += delta;
    sinceLastGen += delta;
    sinceReseed += delta;

    if (sinceLastGen >= GEN_INTERVAL) {
      sinceLastGen = 0;
      tickGeneration();
    }

    if (sinceLastRender >= FRAME_INTERVAL) {
      sinceLastRender = 0;
      renderer.render(scene, camera);
      if (!logged) {
        logged = true;
        console.log('[life-bloom] first frame rendered', {
          w: renderer.domElement.width,
          h: renderer.domElement.height,
          gl2: renderer.capabilities.isWebGL2,
        });
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  console.log('[life-bloom] init complete, loop scheduled');

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      running = false;
    } else if (!running) {
      running = true;
      clock.getDelta();
      requestAnimationFrame(frame);
    }
  });

  window.addEventListener('resize', () => {
    W = window.innerWidth;
    H = window.innerHeight;
    uniforms.uRes.value.set(W, H);
    setRendererSize(W, H);
  });
}

if (host && !reduced && webglSupported()) {
  try {
    init(host);
  } catch (e) {
    console.error('[life-bloom] init failed', e);
  }
}
