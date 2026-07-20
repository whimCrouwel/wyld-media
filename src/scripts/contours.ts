import * as THREE from 'three';

/*
 * トップページ背景の「等高線 / 地形図」。ゆっくり形を変えるスカラー場の等値線を
 * フラグメントシェーダで描く。古紙に墨で刷った地形図のような、静かで知的な質感。
 * カーソル付近はわずかに隆起して等高線が寄る。
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

if (host && !reduced && webglSupported()) {
  try {
    init(host);
  } catch (e) {
    console.error('[contours] init failed', e);
  }
}

const FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec2 uRes;
uniform vec2 uMouse;
varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.5);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return s;
}

void main() {
  float aspect = uRes.x / uRes.y;
  vec2 p = vUv;
  p.x *= aspect;
  p *= 3.0; // 地形の細かさ

  float t = uTime * 0.045;
  // ドメインワープでうねる地形をつくる
  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
  float v = fbm(p + q * 1.6 + t * 0.5);

  // カーソル付近をわずかに隆起させ、等高線を寄せる
  vec2 m = uMouse;
  m.x *= aspect;
  m *= 3.0;
  vec2 dm = p - m;
  v += 0.14 * exp(-dot(dm, dm) * 0.6);

  float levels = 7.0;
  float f = v * levels;
  float d = 0.5 - abs(fract(f) - 0.5); // 等値線(整数)までの距離
  float df = fwidth(f);
  // 最小幅を足して、勾配がゆるい所でも線が消えないようにする
  float line = 1.0 - smoothstep(0.0, df * 2.0 + 0.02, d);

  // 標高の低い側をほんのり濃く(地図の陰影のニュアンス)
  float shade = 0.55 + 0.25 * smoothstep(0.2, 0.8, v);

  vec3 col = vec3(0.40, 0.35, 0.25); // くすんだ墨/セピア
  gl_FragColor = vec4(col, line * shade);
}
`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

function init(root: HTMLElement) {
  let W = window.innerWidth;
  let H = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const scene = new THREE.Scene();
  const camera = new THREE.Camera();

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H);
  renderer.setClearColor(0x000000, 0);
  root.appendChild(renderer.domElement);

  const uniforms = {
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(W, H) },
    uMouse: { value: new THREE.Vector2(-1, -1) }, // 画面外に初期化
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
  material.extensions = { derivatives: true } as THREE.ShaderMaterial['extensions'];

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);

  window.addEventListener(
    'pointermove',
    (e) => {
      uniforms.uMouse.value.set(e.clientX / W, 1 - e.clientY / H);
    },
    { passive: true },
  );
  window.addEventListener('pointerleave', () => uniforms.uMouse.value.set(-1, -1));

  const clock = new THREE.Clock();
  let tAccum = 0; // 一時停止で時間が飛ばないよう手動で積算
  let running = true;

  let logged = false;
  function step() {
    if (!running) return;
    tAccum += Math.min(0.05, clock.getDelta());
    uniforms.uTime.value = tAccum;
    renderer.render(scene, camera);
    if (!logged) {
      logged = true;
      console.log('[contours] first frame rendered', {
        w: renderer.domElement.width,
        h: renderer.domElement.height,
        gl2: renderer.capabilities.isWebGL2,
      });
    }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
  console.log('[contours] init complete, loop scheduled');

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      running = false;
    } else if (!running) {
      running = true;
      clock.getDelta();
      requestAnimationFrame(step);
    }
  });

  window.addEventListener('resize', () => {
    W = window.innerWidth;
    H = window.innerHeight;
    uniforms.uRes.value.set(W, H);
    renderer.setSize(W, H);
  });
}
