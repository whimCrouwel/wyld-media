import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchMyRole, fetchMyProfile, type Role } from './admin';
import { fetchAnnouncements, formatAnnouncementDate } from './announcements';
import { initAnnouncementDialog } from './announcement-dialog';
import { toAvatarViewModel, applyAvatar } from './avatar';
import { redirectTo } from './auth';

export interface ShellChrome {
  role: Role | null;
  // true の場合、role が null なのは「非admin」ではなく取得failed(通信エラー等)。
  // 呼び出し元はこの場合リダイレクトさせない(role確認できないままの誤リダイレクト/
  // リダイレクトループを避けるため)。
  roleLookupFailed: boolean;
}

// サイドバー/ログアウト/プロフィール表示など、ログイン後の全ページ共通の「額縁」部分の配線。
// 呼び出し元は role を見て自分のページ固有のガード(admin専用ページのリダイレクト等)を行う。
export async function initShellChrome(supabase: SupabaseClient): Promise<ShellChrome> {
  document.getElementById('logout')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    redirectTo('/login');
  });

  let role: Role | null = null;
  let roleLookupFailed = false;
  try {
    role = await fetchMyRole(supabase);
    if (role === 'admin') {
      const adminNav = document.getElementById('admin-nav');
      if (adminNav) adminNav.hidden = false;
    }
  } catch (err) {
    roleLookupFailed = true;
    console.error(err);
  }

  try {
    const profile = await fetchMyProfile(supabase);
    if (profile) {
      const vm = toAvatarViewModel(profile.name, profile.avatarUrl);
      const avatarEl = document.getElementById('profile-nav-avatar');
      if (avatarEl) applyAvatar(avatarEl, vm);
      const nameEl = document.getElementById('profile-nav-name');
      if (nameEl) nameEl.textContent = profile.name;
      const navEl = document.getElementById('profile-nav');
      if (navEl) navEl.hidden = false;

      // 認定済みプロバイダーであることをサイドバーで目立たせ、
      // 「主要サービスの編集」ナビも認定済みのときだけ出す(未認定は編集しても無意味なため)。
      if (role === 'provider' && profile.certified) {
        const badgeEl = document.getElementById('certified-badge');
        if (badgeEl) badgeEl.hidden = false;
        const serviceNavEl = document.getElementById('nav-profile-service');
        if (serviceNavEl) serviceNavEl.hidden = false;
      }
      // ライターだけが料金プランタブを持つ。
      if (role === 'writer') {
        const pricingNavEl = document.getElementById('nav-profile-pricing');
        if (pricingNavEl) pricingNavEl.hidden = false;
      }
    }
  } catch (err) {
    console.error(err);
  }

  // ライター/事業者向けのお知らせ一覧。RLSが自分向け・公開済みのみ返す。
  if (role === 'writer' || role === 'provider') {
    try {
      const announcements = await fetchAnnouncements(supabase, { limit: 5 });
      if (announcements.length > 0) {
        const sectionEl = document.getElementById('announcement-section');
        const listEl = document.getElementById('announcement-list');
        const dialogEl = document.getElementById('announcement-dialog') as HTMLDialogElement | null;
        if (sectionEl && listEl && dialogEl) {
          const dialog = initAnnouncementDialog(dialogEl);
          for (const a of announcements) {
            const li = document.createElement('li');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className =
              'flex w-full flex-col gap-0.5 rounded-lg border border-sidebar-accent-foreground/25 ' +
              'bg-sidebar-accent px-3 py-2 text-left transition-colors ' +
              'hover:border-sidebar-accent-foreground/60';
            const dateLabel = formatAnnouncementDate(a.createdAt);
            const dateEl = document.createElement('span');
            dateEl.className = 'text-[11px] text-sidebar-accent-foreground/70';
            dateEl.textContent = dateLabel;
            const titleEl = document.createElement('span');
            titleEl.className = 'text-sm font-medium text-sidebar-accent-foreground';
            titleEl.textContent = a.title;
            btn.appendChild(dateEl);
            btn.appendChild(titleEl);
            btn.addEventListener('click', () => dialog.show(a.title, a.body, dateLabel));
            li.appendChild(btn);
            listEl.appendChild(li);
          }
          sectionEl.hidden = false;
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  return { role, roleLookupFailed };
}
