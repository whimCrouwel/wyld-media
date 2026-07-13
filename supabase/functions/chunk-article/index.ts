import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { chunkBlocks, type ChunkNode } from '../_shared/chunking.ts';

const EMBEDDING_MODEL = 'text-embedding-3-small';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')!;
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return (data.data as { embedding: number[] }[]).map((d) => d.embedding);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: callerData } = await admin.auth.getUser(jwt);
  if (!callerData?.user) return json({ error: 'unauthorized' }, 401);

  let payload: { articleId?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const articleId = payload.articleId;
  if (!articleId) return json({ error: 'articleId is required' }, 400);

  const { data: article, error: articleError } = await admin
    .from('articles')
    .select('id, author_id, body')
    .eq('id', articleId)
    .maybeSingle();
  if (articleError) return json({ error: articleError.message }, 500);
  if (!article) return json({ error: 'not found' }, 404);

  const { data: callerProfile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', callerData.user.id)
    .single();
  const isOwner = article.author_id === callerData.user.id;
  const isAdmin = callerProfile?.role === 'admin';
  if (!isOwner && !isAdmin) return json({ error: 'forbidden' }, 403);

  const chunks = chunkBlocks((article.body as ChunkNode[]) ?? []);

  if (chunks.length === 0) {
    const { error: deleteError } = await admin
      .from('post_chunks').delete().eq('article_id', articleId);
    if (deleteError) return json({ error: deleteError.message }, 500);
    return json({ ok: true, chunkCount: 0 });
  }

  let embeddings: number[][];
  try {
    embeddings = await embedTexts(chunks.map((c) => c.content));
  } catch (err) {
    console.error(err);
    return json({ error: 'embedding failed' }, 502);
  }

  const rows = chunks.map((chunk, index) => ({
    article_id: articleId,
    chunk_index: index,
    heading_path: chunk.headingPath,
    content: chunk.content,
    token_count: chunk.tokenCount,
    embedding: embeddings[index],
  }));

  const { error: upsertError } = await admin
    .from('post_chunks')
    .upsert(rows, { onConflict: 'article_id,chunk_index' });
  if (upsertError) return json({ error: upsertError.message }, 500);

  const { error: pruneError } = await admin
    .from('post_chunks')
    .delete()
    .eq('article_id', articleId)
    .gte('chunk_index', chunks.length);
  if (pruneError) return json({ error: pruneError.message }, 500);

  return json({ ok: true, chunkCount: chunks.length });
});
