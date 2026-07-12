// 許可ホストは DB トリガーと同期させること(権威は DB 側)。
// supabase/migrations/20260712090200_body_embed_rules.sql の
// allowed_embed_hosts と同じ6つのホスト名。
const PROVIDER_HOSTS: Record<'youtube' | 'twitter' | 'vimeo', string[]> = {
  youtube: ['www.youtube.com', 'youtu.be'],
  twitter: ['twitter.com', 'x.com'],
  vimeo: ['player.vimeo.com', 'vimeo.com'],
};

export function detectEmbedProvider(url: string): 'youtube' | 'twitter' | 'vimeo' | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [provider, hosts] of Object.entries(PROVIDER_HOSTS)) {
    if (hosts.includes(host)) return provider as 'youtube' | 'twitter' | 'vimeo';
  }
  return null;
}
