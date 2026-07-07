export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? trimmed : null;
  } catch {
    return null;
  }
}

export function parseSnsLinks(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => safeUrl(line))
    .filter((u): u is string => u !== null);
}

export interface ProfileFormInput {
  name: string;
  bio: string;
  homepageUrl: string;
  snsRaw: string;
  priceInfo: string;
  contactUrl: string;
}

export interface ProfileUpdate {
  name: string;
  bio: string;
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
    homepage_url: safeUrl(input.homepageUrl),
    sns_links: parseSnsLinks(input.snsRaw),
    price_info: emptyToNull(input.priceInfo),
    contact_url: safeUrl(input.contactUrl),
  };
}
