# Admin: Atomic Design + Tailwind v4 (first pass)

**Date:** 2026-07-14
**Scope:** `admin/` (CMS) only. Public site `src/` is out of scope (worked on separately).

## Goal

Introduce a reusable, DRY component system for the CMS admin: atomic-design
`.astro` components styled with Tailwind v4, using shadcn's *neutral look* via
copied class recipes. No React, no shadcn runtime — the admin stays pure Astro +
vanilla TS. All interactive logic remains in `admin/src/lib/*.ts` unchanged.

**Standing rule (per user):** stick to DRY and atomic design *all the time*. Any
repeated markup is a signal to extract an atom/molecule. Pages compose
components; they do not hand-roll primitives.

## Decisions (locked during brainstorming)

- **No shadcn runtime / no React.** shadcn/ui is React-only; instead we copy its
  Tailwind class recipes into `.astro` components. (Option 4.)
- **Theme:** shadcn-neutral (zinc/slate grays), CSS-variable tokens, light + dark.
  Distinct from the public site's artistic 古紙 (old-paper) theme — the admin is
  "the workshop", not the magazine. UI font is a system/Inter sans, not Mincho.
- **Scope this pass:** infra + core atoms + `AdminLayout` + restyle **login** as
  proof. The other 8 pages, the tiptap editor, molecules/organisms, and a
  dark-mode toggle UI are deferred.

## Architecture

### Tailwind v4 setup (mirrors the frontend's proven setup)

- Add `@tailwindcss/vite` to `admin/astro.config.mjs` under `vite.plugins`.
- New `admin/src/styles/global.css`:
  - `@import 'tailwindcss';`
  - `@theme` block with shadcn-neutral tokens as CSS variables:
    `--background --foreground --card --card-foreground --primary
    --primary-foreground --secondary --muted --muted-foreground --accent
    --border --input --ring --destructive --destructive-foreground --radius`.
  - Light values on `:root`; dark values under `.dark`. First pass ships light;
    dark tokens are defined and ready (no toggle UI yet).
  - UI font: system sans / Inter stack.

### Small shadcn-idiom dependencies

Add to `admin/package.json`: `clsx`, `tailwind-merge`, `class-variance-authority`
(all framework-agnostic, tiny). New `admin/src/lib/cn.ts` exports `cn()`
(clsx + tailwind-merge). Components use `cva()` for variants — the exact shadcn
recipe, consumed from `.astro`.

### Folder structure (atomic design)

```
admin/src/components/
  atoms/       ← Button, Input, Label, Card, Field  (this pass)
  molecules/   ← (created empty, populated later)
  organisms/   ← (created empty, populated later)
admin/src/layouts/
  AdminLayout.astro   ← atomic "template": <html>/<head>, imports global.css
admin/src/styles/
  global.css
admin/src/lib/
  cn.ts
```

### Atoms built this pass

- **Button.astro** — `cva` variants (`default/secondary/outline/ghost/destructive`)
  + sizes (`sm/default/lg/icon`); renders `<button>` (accepts `type`, passthrough
  props via `...rest`).
- **Input.astro** — styled `<input>`, passthrough props.
- **Label.astro** — styled `<label>`.
- **Card.astro** — container with header/content via named slots.
- **Field.astro** — DRY wrapper composing Label + Input + optional error text,
  so pages never hand-roll `<p><label>…</label></p>`.

### AdminLayout.astro

Atomic "template": `<!doctype html>`, `<head>` (charset, viewport, `<title>` from
a `title` prop), imports `global.css`, renders `<slot />` in a styled `<body>`.
Replaces the per-page hand-written `<html>` boilerplate going forward.

### Proof page: login.astro

Rewrite **markup only** to compose `AdminLayout` + `Card` + `Field` + `Button`
(a centered login card). The existing `<script>` block and all
`src/lib/auth` / `supabase-browser` logic stay **byte-for-byte unchanged**. This
validates the system end-to-end with zero behavior risk.

## Testing / verification

- `cd admin && npm run build` succeeds (Tailwind compiles, Astro builds).
- `cd admin && npm test` still passes (logic untouched; `--passWithNoTests` ok).
- Manual: `cd admin && npm run dev`, load `/login` at :4322 — centered shadcn-
  neutral card renders; login flow still works against the seed account
  (`hana@seed.local`).

## Out of scope (explicit)

- The other 8 admin pages (dashboard, articles new/edit, profile, users,
  settings, set-password, index).
- The tiptap editor and its vanilla-TS DOM.
- Molecules / organisms beyond `Field`.
- Dark-mode toggle UI (tokens defined, no switch yet).
- Any change to `src/` (public site), DB, or migrations.
