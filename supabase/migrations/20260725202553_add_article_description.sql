-- Adds an optional per-article description used for <meta name="description">
-- and OG/Twitter descriptions. Nullable; the site renders a body-derived
-- fallback when this column is null or empty. See src/lib/description.ts.
alter table articles
  add column description text;

comment on column articles.description is
  'Optional short summary for SEO/OG meta. Falls back to a body-derived excerpt when null/empty.';
