import * as THREE from 'three';

/*
 * 起動スプラッシュ。数千の粒子が渦を巻いて回転する地球(陸地の形)に結像し、
 * しばらく回ってから外へ弾けて散り、その裏でギャラリーが立ち上がる。
 *
 * 陸地判定: /earth-mask.jpg(正距円筒図法・陸が明るく海が暗い)をキャンバスに
 * 描いてピクセルの明暗をサンプリング。球面へ均等散布した候補のうち、緯度経度が
 * 陸に当たるものだけを粒子として残す。画像が読めない時は無地の球体にフォールバック。
 *
 * 段取り(gallery.ts と協調):
 *   - #splash オーバーレイの上で走り、弾け始めに 'splash:done' を発火 →
 *     gallery.ts がヒーロー→グリッドの登場を開始(散る粒子と重なる)。
 *   - reduced-motion / WebGL非対応 / 要素なし は即 'splash:done' で素通し。
 */

const HOST_ID = 'splash';
const MASK_SRC = '/earth-mask.jpg';
// 起動アニメは1セッションに一度だけ。sessionStorage はタブを閉じるまで残るので、
// 同一タブ内のリロードや戻る/進む・ページ間遷移では二度目以降を出さない。
// 静的MPAなので毎ナビゲーションでこのスクリプトは再実行される点に注意。
const SEEN_KEY = 'wm:splash-seen';
function alreadySeen(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false; // プライベートモード等で使えない時は毎回出す(従来どおり)
  }
}
function markSeen() {
  try {
    sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* 保存できなくても致命的ではない */
  }
}

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let signalled = false;
function signalDone() {
  if (signalled) return;
  signalled = true;
  window.dispatchEvent(new CustomEvent('splash:done'));
}

function webglSupported(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (c.getContext('webgl2') || c.getContext('webgl'))
    );
  } catch {
    return false;
  }
}

// SEO・AI クローラ対策で #splash は初期 HTML に存在しない。
// ガード判定を先に済ませ、実際に演出する時だけ ensureSplashDom() で注入する
// (無駄な DOM 生成・script.js 読み込み後の一瞬のチラつきを避ける)。
function ensureSplashDom(): HTMLElement {
  let el = document.getElementById(HOST_ID);
  if (el) return el;
  el = document.createElement('div');
  el.id = HOST_ID;
  el.setAttribute('aria-hidden', 'true');
  const span = document.createElement('span');
  span.className = 'splash-word';
  span.textContent = 'Wild Media';
  el.appendChild(span);
  document.body.appendChild(el);
  return el;
}

if (reduced || alreadySeen() || !webglSupported()) {
  signalDone();
} else {
  // 実際に走らせる時点で「見た」ことにする。途中でリロードしても再生しない。
  markSeen();
  const el = ensureSplashDom();
  // 万一途中で落ちてもグリッドが出るよう保険をかける
  window.setTimeout(signalDone, 6000);
  loadLandMask(MASK_SRC)
    .then((mask) => start(el, mask))
    .catch(() => start(el, null)); // 画像が読めなければ無地の球体
}

function start(el: HTMLElement, mask: LandMask | null) {
  try {
    runSplash(el, mask);
  } catch {
    el.remove();
    signalDone();
  }
}

// --- land mask -------------------------------------------------------------

interface LandMask {
  data: Uint8ClampedArray;
  w: number;
  h: number;
  threshold: number;
}

function loadLandMask(src: string): Promise<LandMask> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return reject(new Error('no 2d ctx'));
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, w, h).data;
      // 海(暗)と陸(明)を分ける閾値を平均輝度から適応的に決める
      let sum = 0;
      let cnt = 0;
      for (let p = 0; p < data.length; p += 4 * 37) {
        sum += 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
        cnt++;
      }
      const mean = sum / Math.max(1, cnt);
      resolve({ data, w, h, threshold: Math.max(16, mean * 1.7) });
    };
    img.onerror = () => reject(new Error('mask load failed'));
    img.src = src;
  });
}

// --- easing / helpers ------------------------------------------------------

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeInCubic = (t: number) => t * t * t;
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function rotateY(x: number, z: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
}

// 球面へ均等散布(フィボナッチ球)し、mask があれば陸地に当たる点だけ残す。
function sphereTargets(mask: LandMask | null, want: number): Array<[number, number, number]> {
  const candidates = mask ? Math.max(want * 6, 40000) : want;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const land: Array<[number, number, number]> = [];
  for (let i = 0; i < candidates; i++) {
    const y = 1 - (i / (candidates - 1)) * 2; // 1 → -1
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * golden;
    const x = Math.cos(th) * r;
    const z = Math.sin(th) * r;
    if (mask) {
      // 単位ベクトル → 緯度経度 → 正距円筒のピクセル
      const lon = Math.atan2(z, x); // -PI..PI
      const lat = Math.asin(y); // -PI/2..PI/2
      const u = (lon + Math.PI) / (2 * Math.PI);
      const v = (Math.PI / 2 - lat) / Math.PI; // 上端=北極
      const px = Math.min(mask.w - 1, Math.max(0, (u * mask.w) | 0));
      const py = Math.min(mask.h - 1, Math.max(0, (v * mask.h) | 0));
      const idx = (py * mask.w + px) * 4;
      const lum = 0.299 * mask.data[idx] + 0.587 * mask.data[idx + 1] + 0.114 * mask.data[idx + 2];
      if (lum < mask.threshold) continue; // 海はスキップ
    }
    land.push([x, y, z]);
  }
  // 目標数まで均等に間引く(候補はもともと空間的に散らばっている)
  if (land.length <= want) return land;
  const out: Array<[number, number, number]> = [];
  const step = land.length / want;
  for (let i = 0; i < want; i++) out.push(land[(i * step) | 0]);
  return out;
}

// --- main ------------------------------------------------------------------

function runSplash(root: HTMLElement, mask: LandMask | null) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const R = Math.min(W, H) * 0.32; // 地球の半径(ピクセル基準)
  const targets = sphereTargets(mask, 8000);
  const N = targets.length;
  if (N === 0) throw new Error('no land points');

  const ux = new Float32Array(N);
  const uy = new Float32Array(N);
  const uz = new Float32Array(N);
  const startRad = new Float32Array(N);
  const swirl = new Float32Array(N);
  const delay = new Float32Array(N);

  for (let i = 0; i < N; i++) {
    ux[i] = targets[i][0];
    uy[i] = targets[i][1];
    uz[i] = targets[i][2];
    startRad[i] = R * (3 + Math.random() * 2.5);
    swirl[i] = (Math.PI * 1.2 + Math.random() * Math.PI * 2) * (Math.random() < 0.5 ? 1 : -1);
    delay[i] = Math.random() * 0.3;
  }

  const positions = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const [sx, sz] = rotateY(ux[i], uz[i], swirl[i]);
    positions[i * 3] = sx * startRad[i];
    positions[i * 3 + 1] = uy[i] * startRad[i];
    positions[i * 3 + 2] = sz * startRad[i];
  }

  // 回転する地球を立体的に見せるため透視投影
  const scene = new THREE.Scene();
  const dist = 700;
  const fov = (2 * Math.atan(H / 2 / dist) * 180) / Math.PI; // z=0 面がほぼ等倍
  const camera = new THREE.PerspectiveCamera(fov, W / H, 1, 5000);
  camera.position.z = dist;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H);
  renderer.setClearColor(0x000000, 0);
  root.appendChild(renderer.domElement);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0x35301f, // 墨色。古紙の地に映える
    size: 2.4,
    sizeAttenuation: true, // 手前の粒ほど大きく = 立体感
    transparent: true,
    opacity: 1,
    depthTest: false,
  });
  const points = new THREE.Points(geometry, material);
  points.rotation.z = 0.35; // 地軸のような傾き
  scene.add(points);

  // タイムライン
  const GATHER = 1.0; // 結像
  const HOLD_END = 1.4; // 回転して見せる
  const BURST = 0.7; // 弾けて散る
  const END = HOLD_END + BURST;
  const SPIN = 0.7; // 自転速度 (rad/s)
  const burstDist = R * 6;

  const clock = new THREE.Clock();
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;

  function frame() {
    const t = clock.getElapsedTime();
    const arr = posAttr.array as Float32Array;

    points.rotation.y = t * SPIN; // 常時自転

    if (t < HOLD_END) {
      // 渦 → 球面へ収束(半径と巻き角を補間するとスパイラルになる)
      for (let i = 0; i < N; i++) {
        const p = easeOutExpo(clamp01((t - delay[i]) / (GATHER - 0.3)));
        const rad = lerp(startRad[i], R, p);
        const ang = swirl[i] * (1 - p);
        const [x, z] = rotateY(ux[i], uz[i], ang);
        arr[i * 3] = x * rad;
        arr[i * 3 + 1] = uy[i] * rad;
        arr[i * 3 + 2] = z * rad;
      }
      material.opacity = clamp01(t / 0.4);
    } else {
      // 弾けて散る + オーバーレイごとフェード
      const bt = clamp01((t - HOLD_END) / BURST);
      const e = easeInCubic(bt);
      const rad = R + burstDist * e;
      for (let i = 0; i < N; i++) {
        arr[i * 3] = ux[i] * rad;
        arr[i * 3 + 1] = uy[i] * rad;
        arr[i * 3 + 2] = uz[i] * rad;
      }
      material.opacity = 1 - e;
      root.style.opacity = String(1 - easeInCubic(clamp01((t - HOLD_END - 0.15) / (BURST - 0.15))));
    }

    posAttr.needsUpdate = true;
    renderer.render(scene, camera);

    if (t < END) {
      requestAnimationFrame(frame);
    } else {
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      root.remove();
      signalDone(); // スプラッシュが消え切ってからギャラリー登場を始める
    }
  }

  requestAnimationFrame(frame);
}
