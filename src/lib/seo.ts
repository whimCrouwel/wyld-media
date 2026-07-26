export function toIsoDate(input: string | Date | null | undefined): string | null {
  if (input == null || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function absoluteUrl(pathname: string, site: string | URL): string {
  const base = site instanceof URL ? site : new URL(site);
  // new URL(pathname, base) handles leading-slash join correctly.
  return new URL(pathname, base).href;
}
