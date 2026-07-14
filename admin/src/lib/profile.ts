import { safeUrl } from './url';

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
  location: string;
  homepageUrl: string;
  snsRaw: string;
  priceInfo: string;
  contactUrl: string;
}

export interface ProfileUpdate {
  name: string;
  bio: string;
  avatar_url: string | null;
  cover_image_url: string | null;
  location: string | null;
  homepage_url: string | null;
  sns_links: string[];
  price_info: string | null;
  contact_url: string | null;
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
    location: emptyToNull(input.location),
    homepage_url: safeUrl(input.homepageUrl),
    sns_links: parseSnsLinks(input.snsRaw),
    price_info: emptyToNull(input.priceInfo),
    contact_url: safeUrl(input.contactUrl),
  };
}
