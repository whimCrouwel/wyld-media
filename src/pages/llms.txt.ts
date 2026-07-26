import type { APIRoute } from 'astro';
import { supabaseServer } from '../lib/supabase-server';
import { fetchPublishedArticles } from '../lib/content';

// Generates dist/llms.txt at build time (this route is prerendered like any
// other page under `output: 'static'`). Format follows the llms.txt
// convention: H1 site name, blockquote description, then an `## Articles`
// section with one markdown link per published (non-held) article.
//
// This started life as an `astro:build:done` Astro integration
// (`src/integrations/llms-txt.ts`), per the original plan. That approach
// doesn't work in this project's Astro 5.18 / Vite 6.4 / Node 23 combo:
// Astro loads `astro.config.mjs` through a short-lived Vite SSR module
// runner that's closed immediately after the config module graph is
// evaluated, before any integration hook fires. Any `import()` issued from
// inside a hook throws "Vite module runner has been closed." A static
// top-level import in the integration file avoids that crash but runs
// inside that same throwaway config-loading Vite instance, which doesn't
// load `.env` — so `import.meta.env.PUBLIC_SUPABASE_URL` /
// `SUPABASE_SERVICE_ROLE_KEY` in `supabase-server.ts` are undefined there
// and the module throws at import time. A page route runs inside Astro's
// real build pipeline (the same one every other `src/pages/**` file uses),
// where `import.meta.env` is populated correctly — same code path
// `fetchPublishedArticles`/`supabaseServer` already take on every other
// page, just emitting `text/plain` instead of HTML.
export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  const { featured, normal } = await fetchPublishedArticles(supabaseServer);
  const all = [...featured, ...normal];

  const lines: string[] = [];
  lines.push('# Wild Media');
  lines.push('');
  lines.push(
    '> 自然と暮らす、環境のメディア。森・山・海・街から、書き手それぞれの視点で綴る記事を毎週公開。',
  );
  lines.push('');
  lines.push('## Articles');
  lines.push('');
  for (const a of all) {
    const url = new URL(`/articles/${a.slug}`, site).href;
    const desc = a.description.replace(/\s+/g, ' ').trim();
    lines.push(`- [${a.title}](${url})${desc ? `: ${desc}` : ''}`);
  }
  lines.push('');

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
