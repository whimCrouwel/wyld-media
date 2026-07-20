import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const MAX_QUERY_LENGTH = 200;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function embedQuery(text: string): Promise<number[]> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')!;
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.data[0].embedding as number[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let payload: { query?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const query = (payload.query ?? '').trim().slice(0, MAX_QUERY_LENGTH);
  if (!query) return json({ error: 'query is required' }, 400);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let embedding: number[];
  try {
    embedding = await embedQuery(query);
  } catch (err) {
    console.error(err);
    return json({ error: 'embedding failed' }, 502);
  }

  const { data, error } = await admin.rpc('search_articles_hybrid', {
    query_embedding: embedding,
    query_text: query,
    match_count: 10,
  });
  if (error) return json({ error: error.message }, 500);

  const rows = (data ?? []) as {
    slug: string;
    title: string;
    excerpt_html: string;
    author_name: string;
    author_slug: string;
    region: string | null;
    score: number;
  }[];
  return json({
    results: rows.map((row) => ({
      slug: row.slug,
      title: row.title,
      excerptHtml: row.excerpt_html,
      authorName: row.author_name,
      authorSlug: row.author_slug,
      region: row.region,
      score: row.score,
    })),
  });
});
