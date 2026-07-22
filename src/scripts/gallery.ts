import Lenis from 'lenis';
import EmblaCarousel from 'embla-carousel';
import { setLenis } from './lenis-instance';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const grid = document.getElementById('masonry');
const columns = grid ? [...grid.querySelectorAll<HTMLElement>('.masonry-column')] : [];

// ---- Smooth inertial scrolling -------------------------------------------

let lenis: Lenis | null = null;
if (!reducedMotion) {
  lenis = new Lenis();
  // 検索モーダルが開いている間 止められるよう、実体を共有しておく
  setLenis(lenis);
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

const META_HEIGHT = 0.22; // 標本カードのメタ部ぶんの高さ(1/ratio に対する近似加算)

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
// スクロールで画面内に入った .reveal を出す監視。初期分に加えて、
// 「もっと読み込む」で継ぎ足したカードも同じ監視に載せる(下参照)。
const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        revealNow(entry.target);
        revealObserver.unobserve(entry.target);
      }
    }
  },
  { rootMargin: '0px 0px -5% 0px' },
);

function observeReveals(nodes: Iterable<Element>) {
  for (const el of nodes) {
    if (el.classList.contains('reveal') && !el.classList.contains('is-revealed')) {
      revealObserver.observe(el);
    }
  }
}

function runEntrance() {
  if (hero) revealNow(hero, reducedMotion ? 0 : HERO_DELAY);
  if (caption) revealNow(caption, reducedMotion ? 0 : CAPTION_DELAY);
  featuredCards.forEach((card, i) => revealNow(card, reducedMotion ? 0 : GRID_START + i * STAGGER));
  entrancePlan.forEach(({ card, delay }) => enterNow(card, delay));

  // 残り(スクロールで入る画面外の要素)だけを IntersectionObserver に任せる。
  // ここまでで初期表示分は reveal 済み/クラス除去済みなので自然に対象外になる。
  observeReveals(document.querySelectorAll('.reveal:not(.is-revealed)'));
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

// ---- 「もっと読み込む」でのカード継ぎ足し ----------------------------------
// 静的サイトなので、次ページの静的HTML(/2 など)を fetch して #masonry の
// カードだけ抜き出し、このページの末尾へ足す。data-index はページ内ローカルの
// 通し番号(MasonryGrid が works.indexOf で振る)なので、そのまま足すと既存分と
// 衝突して redistribute の並びが崩れる。既存の最大 index の続きへ振り直してから
// 足し、redistribute() で全カードを index 順に再配分する。

const loadMoreBtn = document.getElementById('load-more') as HTMLAnchorElement | null;

if (loadMoreBtn && grid) {
  loadMoreBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    const next = loadMoreBtn.dataset.next;
    if (!next) return;
    loadMoreBtn.setAttribute('aria-busy', 'true');

    try {
      const res = await fetch(next);
      if (!res.ok) throw new Error(`load-more fetch failed: ${res.status}`);
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const newCards = [...doc.querySelectorAll<HTMLElement>('#masonry [data-index]')];

      // 既存の最大 index の続きへ振り直す
      const base =
        [...grid.querySelectorAll<HTMLElement>('[data-index]')].reduce(
          (max, c) => Math.max(max, Number(c.dataset.index)),
          -1,
        ) + 1;
      newCards.forEach((card, i) => {
        card.dataset.index = String(base + i);
        grid.append(card); // いったん grid 直下へ。redistribute がカラムへ配分する
      });

      redistribute();
      observeReveals(newCards);

      // 次の遷移先は、取得したページ自身の「もっと読み込む」から引き継ぐ。
      // 無ければ最終ページなのでボタンごと片付ける。
      const nextNext = doc.getElementById('load-more')?.getAttribute('data-next');
      if (nextNext) {
        loadMoreBtn.dataset.next = nextNext;
        loadMoreBtn.href = nextNext;
      } else {
        loadMoreBtn.remove();
      }
    } catch (err) {
      // 失敗時は素のリンクとして次ページへ遷移(全画面)してフォールバックする
      console.error(err);
      window.location.href = next;
      return;
    } finally {
      loadMoreBtn.removeAttribute('aria-busy');
    }
  });
}
