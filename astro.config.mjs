import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// The public production URL. Update this AND public/robots.txt when the domain changes.
// See docs/DOMAIN-CHANGE.md.
const SITE = process.env.PUBLIC_SITE_URL ?? 'https://zine.wyld-crd.org';

export default defineConfig({
  site: SITE,
  output: 'static',
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
