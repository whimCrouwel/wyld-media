// サイドバーのお知らせバナー。公開中の end_user 向けお知らせを1件取得して表示し、
// クリックでポップアップに全文を表示する。× で閉じたら同じお知らせは再表示しない。
import { supabaseBrowser } from '../lib/supabase-browser';
import { lockPageScroll, unlockPageScroll } from './scroll-lock';
import {
  fetchLatestEndUserAnnouncement, shouldShowAnnouncement,
  getDismissedAnnouncementId, setDismissedAnnouncementId,
} from '../lib/announcements';

const banner = document.getElementById('announcement-banner');
const openBtn = document.getElementById('announcement-banner-open');
const dismissBtn = document.getElementById('announcement-banner-dismiss');
const titleEl = document.getElementById('announcement-banner-title');
const modal = document.getElementById('announcement-modal') as HTMLDialogElement | null;
const modalTitleEl = document.getElementById('announcement-modal-title');
const modalBodyEl = document.getElementById('announcement-modal-body');

if (banner && openBtn && dismissBtn && titleEl && modal && modalTitleEl && modalBodyEl) {
  (async () => {
    try {
      const announcement = await fetchLatestEndUserAnnouncement(supabaseBrowser);
      if (!announcement) return;
      if (!shouldShowAnnouncement(announcement.id, getDismissedAnnouncementId())) return;

      titleEl.textContent = announcement.title;
      banner.hidden = false;

      openBtn.addEventListener('click', () => {
        modalTitleEl.textContent = announcement.title;
        modalBodyEl.textContent = announcement.body;
        lockPageScroll();
        modal.showModal();
      });

      dismissBtn.addEventListener('click', () => {
        setDismissedAnnouncementId(announcement.id);
        banner.hidden = true;
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
