import Lenis from 'lenis';
import EmblaCarousel from 'embla-carousel';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const grid = document.getElementById('masonry');
const columns = grid ? [...grid.querySelectorAll<HTMLElement>('.masonry-column')] : [];

// ---- Smooth inertial scrolling -------------------------------------------

let lenis: Lenis | null = null;
if (!reducedMotion) {
  lenis = new Lenis();
  const raf = (time: number) => {
    lenis!.raf(time);
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
}

// ---- Masonry redistribution (2 / 1 columns below desktop) -----------------

function targetColumnCount(): number {
  if (window.matchMedia('(min-width: 1024px)').matches) return 3;
  if (window.matchMedia('(min-width: 640px)').matches) return 2;
  return 1;
}

const META_HEIGHT = 0.12; // メタ行ぶんの高さ(1/ratio に対する近似加算)

function redistribute() {
  if (!grid || columns.length === 0) return;
  const count = targetColumnCount();

  const cards = [...grid.querySelectorAll<HTMLElement>('[data-index]')].sort(
    (a, b) => Number(a.dataset.index) - Number(b.dataset.index),
  );

  const heights = new Array(count).fill(0);
  const buckets: HTMLElement[][] = Array.from({ length: count }, () => []);
  for (const card of cards) {
    const ratio = Number(card.dataset.ratio) || 4 / 3;
    const shortest = heights.indexOf(Math.min(...heights));
    buckets[shortest].push(card);
    heights[shortest] += 1 / ratio + META_HEIGHT;
  }

  columns.forEach((column, i) => {
    if (i < count) {
      column.style.display = '';
      column.append(...buckets[i]);
    } else {
      column.style.display = 'none';
    }
  });
}

let lastCount = 3;
window.addEventListener('resize', () => {
  const count = targetColumnCount();
  if (count !== lastCount) {
    lastCount = count;
    redistribute();
  }
});
lastCount = targetColumnCount();
if (lastCount !== 3) redistribute();

// ---- Entrance sequence: hero first, then the grid settles into place ------

const HERO_DELAY = 100;
const CAPTION_DELAY = 300;
const GRID_START = 500;
const STAGGER = 80;
const ENTRANCE_BASE = 150; // グリッド登場の基準遅延(ヒーローを少し先行させる)

function revealNow(el: Element, delay = 0) {
  const node = el as HTMLElement;
  node.style.transitionDelay = delay ? `${delay}ms` : '';
  node.classList.add('is-revealed');
  if (delay) {
    node.addEventListener('transitionend', () => (node.style.transitionDelay = ''), {
      once: true,
    });
  }
}

// 初回スプラッシュ用。控えめな .reveal を外し、下から大きくせり上がる
// .card-enter へ差し替えてから次フレームで起動する。終了後はクラスを外して
// 通常状態(定位置・等倍)へ戻す。
function enterNow(el: Element, delay = 0) {
  const node = el as HTMLElement;
  node.classList.remove('reveal', 'is-revealed');
  node.classList.add('card-enter');
  if (delay) node.style.setProperty('--enter-delay', `${delay}ms`);
  requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('card-in')));
  node.addEventListener(
    'animationend',
    () => {
      node.classList.remove('card-enter', 'card-in');
      node.style.removeProperty('--enter-delay');
      node.style.removeProperty('will-change');
    },
    { once: true },
  );
}

const hero = document.getElementById('hero-statement');
const caption = document.getElementById('hero-caption');
const featuredCards = [...document.querySelectorAll<HTMLElement>('[data-featured-card]')];

// 初期表示圏内のカードは登場カスケード対象として控えておき(まだ隠したまま)、
// それ以外は IntersectionObserver がビューポート進入時に reveal する。
const viewportBottom = window.innerHeight * 1.1;
const entrancePlan: Array<{ card: HTMLElement; delay: number }> = [];

columns.forEach((column, columnIndex) => {
  if (column.style.display === 'none') return;
  [...column.children].forEach((card, rowIndex) => {
    if ((card as HTMLElement).getBoundingClientRect().top < viewportBottom) {
      const delay = reducedMotion ? 0 : ENTRANCE_BASE + columnIndex * STAGGER + rowIndex * STAGGER * 2;
      entrancePlan.push({ card: card as HTMLElement, delay });
    }
  });
});

// ヒーロー→Featured→グリッドの登場。スプラッシュがある場合は、粒子が消え切る
// 'splash:done' を合図に走らせる(それまで何も reveal させないことで、スプラッシュ
// 裏でアニメが空回りして静止して見えるのを防ぐ)。無ければ即実行。
function runEntrance() {
  if (hero) revealNow(hero, reducedMotion ? 0 : HERO_DELAY);
  if (caption) revealNow(caption, reducedMotion ? 0 : CAPTION_DELAY);
  featuredCards.forEach((card, i) => revealNow(card, reducedMotion ? 0 : GRID_START + i * STAGGER));
  entrancePlan.forEach(({ card, delay }) => enterNow(card, delay));

  // 残り(スクロールで入る画面外の要素)だけを IntersectionObserver に任せる。
  // ここまでで初期表示分は reveal 済み/クラス除去済みなので自然に対象外になる。
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          revealNow(entry.target);
          observer.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -5% 0px' },
  );
  document.querySelectorAll('.reveal:not(.is-revealed)').forEach((el) => observer.observe(el));
}

const splashEl = document.getElementById('splash');
if (splashEl && !reducedMotion) {
  window.addEventListener('splash:done', runEntrance, { once: true });
} else {
  runEntrance();
}

// ---- Featured strip (Embla carousel) ---------------------------------------

const strip = document.getElementById('featured-strip');
if (strip) {
  EmblaCarousel(strip, { align: 'start', containScroll: 'trimSnaps' });
}
