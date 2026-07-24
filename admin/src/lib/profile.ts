import { safeUrl } from './url';
import { isRegion } from './regions';

export function parseSnsLinks(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => safeUrl(line))
    .filter((u): u is string => u !== null);
}

export interface ProfileFormInput {
  name: string;
  bio: string;
  avatarUrl: string;
  coverImageUrl: string;
  region: string;
  location: string;
  homepageUrl: string;
  snsRaw: string;
  contactUrl: string;
  serviceName: string;
  serviceDescription: string;
  serviceUrl: string;
  serviceImageUrl: string;
}

export interface ProfileUpdate {
  name: string;
  bio: string;
  avatar_url: string | null;
  cover_image_url: string | null;
  region: string | null;
  location: string | null;
  homepage_url: string | null;
  sns_links: string[];
  contact_url: string | null;
  service_name: string | null;
  service_description: string | null;
  service_url: string | null;
  service_image_url: string | null;
}

export interface ProfileFieldLabels {
  name: string;
  bio: string;
  avatar: string;
  showContactUrl: boolean;
  // ライターは料金プラン(pricing_items)を編集する専用タブを持つ。
  showPricingTab: boolean;
  showServiceTab: boolean;
  certified: boolean;
}

// ライターは個人プロフィール、プロバイダーは企業・団体プロフィールとして項目名を出し分ける。
// role が未取得(null)の場合はライター向け表記にフォールバックする。
// 主要サービスタブは認定済み(certified)の provider にしか出さない(未認定は公開されないため無意味)。
// 料金プランタブはライターにのみ表示する(providerは主要サービス側、adminは編集項目なし)。
export function getProfileFieldLabels(
  role: 'admin' | 'writer' | 'provider' | null, certified: boolean,
): ProfileFieldLabels {
  if (role === 'provider') {
    return {
      name: '会社・団体名', bio: '事業内容', avatar: 'ロゴ画像',
      showContactUrl: false, showPricingTab: false,
      showServiceTab: certified, certified,
    };
  }
  return {
    name: '名前', bio: '自己紹介', avatar: '顔写真',
    showContactUrl: true, showPricingTab: role === 'writer',
    showServiceTab: false, certified: false,
  };
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function buildProfileUpdate(input: ProfileFormInput): ProfileUpdate {
  return {
    name: input.name.trim(),
    bio: input.bio,
    avatar_url: safeUrl(input.avatarUrl),
    cover_image_url: safeUrl(input.coverImageUrl),
    // 想定外の値は送らず null にする(最終的な拒否は DB の check 制約)
    region: isRegion(input.region.trim()) ? input.region.trim() : null,
    location: emptyToNull(input.location),
    homepage_url: safeUrl(input.homepageUrl),
    sns_links: parseSnsLinks(input.snsRaw),
    contact_url: safeUrl(input.contactUrl),
    service_name: emptyToNull(input.serviceName),
    service_description: emptyToNull(input.serviceDescription),
    service_url: safeUrl(input.serviceUrl),
    service_image_url: safeUrl(input.serviceImageUrl),
  };
}
