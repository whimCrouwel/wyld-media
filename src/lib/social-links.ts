// URL のホスト名から主要 SNS を判定する。写真・記事プラットフォームのプロフィール
// リンク(profiles.sns_links、生の URL の配列)をアイコンボタンにするか、
// 未登録のものは従来通りの文字列リンクのままにするかを振り分けるために使う。
export type SocialPlatform =
  | 'x'
  | 'instagram'
  | 'note'
  | 'facebook'
  | 'youtube'
  | 'tiktok'
  | 'threads'
  | 'linkedin';

interface SocialMatch {
  platform: SocialPlatform;
  label: string;
}

const HOST_MAP: Record<string, SocialMatch> = {
  'x.com': { platform: 'x', label: 'X' },
  'twitter.com': { platform: 'x', label: 'X' },
  'instagram.com': { platform: 'instagram', label: 'Instagram' },
  'note.com': { platform: 'note', label: 'note' },
  'facebook.com': { platform: 'facebook', label: 'Facebook' },
  'fb.com': { platform: 'facebook', label: 'Facebook' },
  'youtube.com': { platform: 'youtube', label: 'YouTube' },
  'youtu.be': { platform: 'youtube', label: 'YouTube' },
  'tiktok.com': { platform: 'tiktok', label: 'TikTok' },
  'threads.net': { platform: 'threads', label: 'Threads' },
  'linkedin.com': { platform: 'linkedin', label: 'LinkedIn' },
};

export function detectSocialPlatform(url: string): SocialMatch | null {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return HOST_MAP[hostname] ?? null;
  } catch {
    return null;
  }
}
