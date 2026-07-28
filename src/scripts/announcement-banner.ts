// サイドバーのお知らせバナー。公開中の end_user 向けお知らせを1件取得して常に表示し、
// クリックでポップアップに全文を表示する(閉じる操作は無し — 公開中は出続ける)。
import { supabaseBrowser } from '../lib/supabase-browser';
import { lockPageScroll, unlockPageScroll } from './scroll-lock';
import { fetchLatestEndUserAnnouncement } from '../lib/announcements';

const banner = document.getElementById('announcement-banner');
const openBtn = document.getElementById('announcement-banner-open');
const titleEl = document.getElementById('announcement-banner-title');
const modal = document.getElementById('announcement-modal') as HTMLDialogElement | null;
const modalTitleEl = document.getElementById('announcement-modal-title');
const modalBodyEl = document.getElementById('announcement-modal-body');

if (banner && openBtn && titleEl && modal && modalTitleEl && modalBodyEl) {
  (async () => {
    try {
      const announcement = await fetchLatestEndUserAnnouncement(supabaseBrowser);
      if (!announcement) return;

      titleEl.textContent = announcement.title;
      banner.hidden = false;

      openBtn.addEventListener('click', () => {
        modalTitleEl.textContent = announcement.title;
        modalBodyEl.textContent = announcement.body;
        lockPageScroll();
        modal.showModal();
      });
    } catch (err) {
      console.error(err);
    }
  })();

  new MutationObserver(() => {
    if (!modal.open) unlockPageScroll();
  }).observe(modal, { attributes: true, attributeFilter: ['open'] });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.close();
  });

  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      modal.close();
    }
  });
}
