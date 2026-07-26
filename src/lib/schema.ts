export interface Crumb {
  name: string;
  url: string;
}

interface ArticleSchemaInput {
  title: string;
  description: string;
  url: string;
  coverUrl: string | null;
  publishedISO: string;
  updatedISO: string | null;
  authorName: string;
  authorUrl: string;
  siteName: string;
  siteUrl: string;
}

export function articleSchema(input: ArticleSchemaInput): Record<string, unknown> {
  const s: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.title,
    description: input.description,
    datePublished: input.publishedISO,
    dateModified: input.updatedISO ?? input.publishedISO,
    inLanguage: 'ja',
    author: { '@type': 'Person', name: input.authorName, url: input.authorUrl },
    publisher: { '@type': 'Organization', name: input.siteName, url: input.siteUrl },
    mainEntityOfPage: input.url,
  };
  if (input.coverUrl) s.image = input.coverUrl;
  return s;
}

interface PersonSchemaInput {
  name: string;
  url: string;
  bio: string;
  avatarUrl: string | null;
  snsLinks: string[];
}

export function personSchema(input: PersonSchemaInput): Record<string, unknown> {
  const s: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: input.name,
    url: input.url,
  };
  if (input.bio) s.description = input.bio;
  if (input.avatarUrl) s.image = input.avatarUrl;
  if (input.snsLinks.length > 0) s.sameAs = input.snsLinks;
  return s;
}

interface OrganizationSchemaInput {
  name: string;
  url: string;
  description?: string;
  logoUrl?: string;
  sameAs?: string[];
}

export function organizationSchema(input: OrganizationSchemaInput): Record<string, unknown> {
  const s: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: input.name,
    url: input.url,
  };
  if (input.description) s.description = input.description;
  if (input.logoUrl) s.logo = input.logoUrl;
  if (input.sameAs && input.sameAs.length > 0) s.sameAs = input.sameAs;
  return s;
}

interface WebSiteSchemaInput {
  name: string;
  url: string;
  inLanguage: string;
}

export function webSiteSchema(input: WebSiteSchemaInput): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: input.name,
    url: input.url,
    inLanguage: input.inLanguage,
  };
}

export function breadcrumbListSchema(
  crumbs: Crumb[],
  siteUrl: string,
): Record<string, unknown> {
  const itemListElement = crumbs.map((crumb, idx) => ({
    '@type': 'ListItem',
    position: idx + 1,
    name: crumb.name,
    item: new URL(crumb.url, siteUrl).href,
  }));
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement,
  };
}

interface ArticleCrumbsInput {
  title: string;
  slug: string;
}

interface WriterCrumbsInput {
  name: string;
  slug: string;
}

interface ProviderCrumbsInput {
  name: string;
  slug: string;
}

interface AreaCrumbsInput {
  region: string;
  areaSlug: string;
}

export const buildCrumbs = {
  article: (input: ArticleCrumbsInput): Crumb[] => [
    { name: 'Home', url: '/' },
    { name: 'Works', url: '/' },
    { name: input.title, url: `/articles/${input.slug}` },
  ],
  writer: (input: WriterCrumbsInput): Crumb[] => [
    { name: 'Home', url: '/' },
    { name: 'Writers', url: '/writers' },
    { name: input.name, url: `/writers/${input.slug}` },
  ],
  provider: (input: ProviderCrumbsInput): Crumb[] => [
    { name: 'Home', url: '/' },
    { name: 'Providers', url: '/providers' },
    { name: input.name, url: `/providers/${input.slug}` },
  ],
  area: (input: AreaCrumbsInput): Crumb[] => [
    { name: 'Home', url: '/' },
    { name: 'Works', url: '/' },
    { name: input.region, url: `/areas/${input.areaSlug}` },
  ],
};
