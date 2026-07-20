# Admin Atomic-Design + Tailwind v4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a DRY, atomic-design `.astro` component system in `admin/` styled with Tailwind v4 and shadcn's neutral look, proven by restyling the login page.

**Architecture:** Pure Astro + vanilla TS (no React, no shadcn runtime). Tailwind v4 via the already-hoisted `@tailwindcss/vite`. shadcn-neutral tokens as CSS variables in `global.css`. Atoms/molecules are `.astro` components; a local `cn()` helper and typed variant-map objects replace clsx/tailwind-merge/cva (zero new deps). All interactive logic stays in `admin/src/lib/*.ts` unchanged.

**Tech Stack:** Astro 5, Tailwind CSS v4 (`@tailwindcss/vite`), TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-14-admin-atomic-design-tailwind-design.md`

## Global Constraints

- **All paths are under `admin/`.** Do NOT touch `src/` (public site), DB, or migrations — a separate agent owns the frontend.
- **Never run `npm install`.** `admin/` is an npm workspace sharing the root `package-lock.json` with the frontend agent. `tailwindcss` + `@tailwindcss/vite` (`^4.3.2`) are already hoisted at root and resolve without install. Adding them to `admin/package.json` is documentation only.
- **Zero new dependencies.** No clsx / tailwind-merge / class-variance-authority. Use the local `cn()` and variant-map objects defined in this plan.
- **Commit with an explicit pathspec on BOTH `add` AND `commit`:** `git add <paths>` then `git commit -m "…" -- <the same paths>`. This is mandatory: a bare `git commit` (no pathspec) commits the ENTIRE index, and in this shared working tree the index holds the frontend agent's pre-staged deletions (`src/components/SearchBox.astro`, `src/lib/supabase-browser.ts`) — a bare commit silently sweeps them in. The `-- <paths>` on `git commit` prevents that. Never `git add -A` / `git commit -a`. After committing, run `git show --stat HEAD` and confirm ONLY your task's files appear.
- **Login script is untouched.** In Task 6, the existing `<script>` block and `src/lib/auth` / `src/lib/supabase-browser` logic stay byte-for-byte identical; DOM contract preserved: inputs keep `id="email"` / `id="password"`, and a single `<p id="error">` remains.
- **Deviations from spec (intentional):** `Field` lives in `molecules/` (it composes atoms); Button uses typed variant-map objects instead of `cva`; `cn()` is a local zero-dep helper.
- **UI language:** Japanese labels already in the codebase are kept verbatim (e.g. `ログイン`, `メールアドレス`, `パスワード`). Do not invent new copy.
- Commit message trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure

```
admin/
  astro.config.mjs                    (modify: add tailwind vite plugin)
  package.json                        (modify: declare tailwind devDeps)
  src/
    styles/global.css                 (create: @import + shadcn-neutral @theme)
    lib/cn.ts                         (create: local class joiner)
    layouts/AdminLayout.astro         (create: html/head template)
    components/
      atoms/Button.astro              (create)
      atoms/Input.astro               (create)
      atoms/Label.astro               (create)
      atoms/Card.astro                (create)
      molecules/Field.astro           (create: Label + Input)
    pages/login.astro                 (modify: markup only)
  tests/cn.test.ts                    (create)
```

---

### Task 1: Tailwind v4 wiring + shadcn-neutral tokens

**Files:**
- Modify: `admin/astro.config.mjs`
- Modify: `admin/package.json`
- Create: `admin/src/styles/global.css`

**Interfaces:**
- Produces: Tailwind utilities backed by tokens — `bg-background`, `text-foreground`, `bg-card`, `text-card-foreground`, `bg-primary`, `text-primary-foreground`, `bg-secondary`, `bg-muted`, `text-muted-foreground`, `bg-accent`, `border-input`, `border`, `ring-ring`, `bg-destructive`, `text-destructive`, `rounded-lg/md/sm`, and the `dark:` variant.

- [ ] **Step 1: Add the Tailwind Vite plugin to Astro config**

Replace the full contents of `admin/astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'static',
  server: { port: 4322 },
  vite: {
    plugins: [tailwindcss()],
  },
});
```

- [ ] **Step 2: Declare the tailwind devDeps in admin/package.json (documentation only — do NOT install)**

In `admin/package.json`, add these two entries to `devDependencies` (keep the existing entries; alphabetical order within the block):

```jsonc
"@tailwindcss/vite": "^4.3.2",
"tailwindcss": "^4.3.2",
```

Do not run `npm install` — both are already hoisted at the root at a satisfying version.

- [ ] **Step 3: Create the global stylesheet with shadcn-neutral tokens**

Create `admin/src/styles/global.css`:

```css
@import 'tailwindcss';

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
}
```

- [ ] **Step 4: Verify the build compiles**

Run: `cd admin && npm run build`
Expected: build completes with no errors (Vite loads `@tailwindcss/vite`; Astro emits `dist/`). If it fails to resolve `@tailwindcss/vite`, run `npm install` once at the repo root, then rebuild.

- [ ] **Step 5: Commit**

```bash
git add admin/astro.config.mjs admin/package.json admin/src/styles/global.css
git commit -m "feat(admin): wire Tailwind v4 + shadcn-neutral tokens

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Local `cn()` class helper (+ test)

**Files:**
- Create: `admin/src/lib/cn.ts`
- Create: `admin/tests/cn.test.ts`

**Interfaces:**
- Produces: `cn(...inputs: ClassInput[]): string` where `ClassInput = string | false | null | undefined`. Joins truthy class strings with a space; drops falsy. (No Tailwind conflict-merge — components append `class` passthrough last and avoid overriding base padding.)

- [ ] **Step 1: Write the failing test**

Create `admin/tests/cn.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cn } from '../src/lib/cn';

describe('cn', () => {
  it('joins class strings with a space', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, null, undefined, 'c')).toBe('a c');
  });

  it('returns an empty string when given nothing truthy', () => {
    expect(cn(false, null, undefined)).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd admin && npx vitest run tests/cn.test.ts`
Expected: FAIL — cannot resolve `../src/lib/cn`.

- [ ] **Step 3: Implement the helper**

Create `admin/src/lib/cn.ts`:

```ts
export type ClassInput = string | false | null | undefined;

/**
 * Joins truthy class-name inputs with a single space.
 * Zero-dependency stand-in for clsx; append passthrough `class` last.
 */
export function cn(...inputs: ClassInput[]): string {
  return inputs.filter(Boolean).join(' ');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd admin && npx vitest run tests/cn.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/cn.ts admin/tests/cn.test.ts
git commit -m "feat(admin): add local cn() class helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" -- admin/src/lib/cn.ts admin/tests/cn.test.ts
```

---

### Task 3: AdminLayout template

**Files:**
- Create: `admin/src/layouts/AdminLayout.astro`

**Interfaces:**
- Consumes: `admin/src/styles/global.css` (Task 1).
- Produces: `AdminLayout` with prop `title: string`; renders `<!doctype html>` shell, imports `global.css`, exposes a default `<slot />` inside a themed `<body>`.

- [ ] **Step 1: Create the layout**

Create `admin/src/layouts/AdminLayout.astro`:

```astro
---
import '../styles/global.css';

interface Props {
  title: string;
}

const { title } = Astro.props;
---
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
  </head>
  <body class="min-h-screen bg-background text-foreground antialiased">
    <slot />
  </body>
</html>
```

- [ ] **Step 2: Verify the build still compiles**

Run: `cd admin && npm run build`
Expected: build completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add admin/src/layouts/AdminLayout.astro
git commit -m "feat(admin): add AdminLayout template

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" -- admin/src/layouts/AdminLayout.astro
```

---

### Task 4: Button atom

**Files:**
- Create: `admin/src/components/atoms/Button.astro`

**Interfaces:**
- Consumes: `cn` from `../../lib/cn` (Task 2).
- Produces: `Button` with props `variant?: 'default'|'secondary'|'outline'|'ghost'|'destructive'` (default `'default'`), `size?: 'sm'|'default'|'lg'|'icon'` (default `'default'`), `type?: 'button'|'submit'|'reset'` (default `'button'`), `class?: string`, plus passthrough (`id`, etc.). Renders `<button>` wrapping a default `<slot />`.

- [ ] **Step 1: Create the component**

Create `admin/src/components/atoms/Button.astro`:

```astro
---
import { cn } from '../../lib/cn';

type Variant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
type Size = 'sm' | 'default' | 'lg' | 'icon';

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';

const variants: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 rounded-md px-3',
  default: 'h-10 px-4 py-2',
  lg: 'h-11 rounded-md px-8',
  icon: 'h-10 w-10',
};

interface Props {
  variant?: Variant;
  size?: Size;
  type?: 'button' | 'submit' | 'reset';
  class?: string;
  id?: string;
}

const { variant = 'default', size = 'default', type = 'button', class: className, ...rest } = Astro.props;
---
<button type={type} class={cn(base, variants[variant], sizes[size], className)} {...rest}>
  <slot />
</button>
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd admin && npm run build`
Expected: build completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add admin/src/components/atoms/Button.astro
git commit -m "feat(admin): add Button atom

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" -- admin/src/components/atoms/Button.astro
```

---

### Task 5: Input, Label, Card atoms + Field molecule

**Files:**
- Create: `admin/src/components/atoms/Input.astro`
- Create: `admin/src/components/atoms/Label.astro`
- Create: `admin/src/components/atoms/Card.astro`
- Create: `admin/src/components/molecules/Field.astro`

**Interfaces:**
- Consumes: `cn` (Task 2); `Field` consumes `Label` + `Input`.
- Produces:
  - `Input` — props `type?: string` (default `'text'`), `class?: string`, passthrough (`id`, `name`, `required`, …). Renders `<input>`.
  - `Label` — props `for?: string`, `class?: string`; renders `<label>` + `<slot />`.
  - `Card` — prop `class?: string`; renders a `<div>` container + `<slot />`.
  - `Field` — props `id: string`, `label: string`, `type?: string` (default `'text'`), `required?: boolean`, `name?: string`. Renders a `<div>` with `Label`(for=id) + `Input`(id, type, name, required). No error element (page owns `#error`).

- [ ] **Step 1: Create Input atom**

Create `admin/src/components/atoms/Input.astro`:

```astro
---
import { cn } from '../../lib/cn';

interface Props {
  type?: string;
  id?: string;
  name?: string;
  required?: boolean;
  class?: string;
}

const { type = 'text', class: className, ...rest } = Astro.props;
---
<input
  type={type}
  class={cn(
    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
    className,
  )}
  {...rest}
/>
```

- [ ] **Step 2: Create Label atom**

Create `admin/src/components/atoms/Label.astro`:

```astro
---
import { cn } from '../../lib/cn';

interface Props {
  for?: string;
  class?: string;
}

const { for: htmlFor, class: className } = Astro.props;
---
<label for={htmlFor} class={cn('text-sm font-medium leading-none', className)}>
  <slot />
</label>
```

- [ ] **Step 3: Create Card atom**

Create `admin/src/components/atoms/Card.astro`:

```astro
---
import { cn } from '../../lib/cn';

interface Props {
  class?: string;
}

const { class: className } = Astro.props;
---
<div class={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)}>
  <slot />
</div>
```

- [ ] **Step 4: Create Field molecule**

Create `admin/src/components/molecules/Field.astro`:

```astro
---
import Label from '../atoms/Label.astro';
import Input from '../atoms/Input.astro';

interface Props {
  id: string;
  label: string;
  type?: string;
  required?: boolean;
  name?: string;
}

const { id, label, type = 'text', required, name } = Astro.props;
---
<div class="space-y-2">
  <Label for={id}>{label}</Label>
  <Input id={id} type={type} name={name} required={required} />
</div>
```

- [ ] **Step 5: Verify the build compiles**

Run: `cd admin && npm run build`
Expected: build completes with no errors.

- [ ] **Step 6: Commit**

```bash
git add admin/src/components/atoms/Input.astro admin/src/components/atoms/Label.astro admin/src/components/atoms/Card.astro admin/src/components/molecules/Field.astro
git commit -m "feat(admin): add Input/Label/Card atoms + Field molecule

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" -- admin/src/components/atoms/Input.astro admin/src/components/atoms/Label.astro admin/src/components/atoms/Card.astro admin/src/components/molecules/Field.astro
```

---

### Task 6: Restyle login page (proof)

**Files:**
- Modify: `admin/src/pages/login.astro`

**Interfaces:**
- Consumes: `AdminLayout` (Task 3), `Card`, `Button` (Tasks 4-5), `Field` (Task 5).
- Preserves DOM contract for the unchanged script: `#login-form`, `#email`, `#password`, `#error`.

- [ ] **Step 1: Read the current file to capture the exact `<script>` block**

Run: `cat admin/src/pages/login.astro`
Note the entire `<script> … </script>` block verbatim — it will be pasted back unchanged.

- [ ] **Step 2: Rewrite the markup, keeping the script identical**

Replace the contents of `admin/src/pages/login.astro` with the following, pasting the **exact** original `<script>…</script>` block where indicated (do not alter a single character of it):

```astro
---
import AdminLayout from '../layouts/AdminLayout.astro';
import Card from '../components/atoms/Card.astro';
import Button from '../components/atoms/Button.astro';
import Field from '../components/molecules/Field.astro';

const title = 'ログイン | Wild Media CMS';
---
<AdminLayout title={title}>
  <main class="flex min-h-screen items-center justify-center px-4">
    <Card class="w-full max-w-sm p-6">
      <h1 class="mb-6 text-2xl font-semibold tracking-tight">ログイン</h1>
      <form id="login-form" class="space-y-4">
        <Field id="email" label="メールアドレス" type="email" required />
        <Field id="password" label="パスワード" type="password" required />
        <Button type="submit" class="w-full">ログイン</Button>
      </form>
      <p id="error" role="alert" class="mt-4 text-sm text-destructive"></p>
    </Card>
  </main>

  <!-- PASTE THE ORIGINAL <script>…</script> BLOCK HERE, UNCHANGED -->
</AdminLayout>
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd admin && npm run build`
Expected: build completes with no errors.

- [ ] **Step 4: Verify the full admin test suite still passes**

Run: `cd admin && npm test`
Expected: PASS (existing `profile.test.ts` + new `cn.test.ts`; no regressions).

- [ ] **Step 5: Manual verification in the browser**

Run: `cd admin && npm run dev` (requires `supabase start` running).
Open `http://localhost:4322/login`. Expected: a centered neutral card with heading `ログイン`, two labeled fields, a full-width primary button. Log in with the seed account `hana@seed.local` / `seed-pass-1234` and confirm redirect to `/dashboard` — proving the untouched script still works.

- [ ] **Step 6: Commit**

```bash
git add admin/src/pages/login.astro
git commit -m "feat(admin): restyle login with atomic components

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" -- admin/src/pages/login.astro
```

---

## Self-Review

**Spec coverage:**
- Tailwind v4 setup → Task 1 ✓
- shadcn-neutral tokens (light + dark) → Task 1 ✓
- `cn()` helper → Task 2 (local, zero-dep — approved deviation) ✓
- Atomic folders + AdminLayout → Tasks 3-5 ✓
- Atoms Button/Input/Label/Card + Field → Tasks 4-5 (Field → molecules/, approved deviation) ✓
- Restyle login as proof, script unchanged → Task 6 ✓
- Out-of-scope items (other pages, tiptap, dark toggle, molecules beyond Field) → correctly excluded ✓

**Placeholder scan:** No TBD/TODO. The only intentional "paste here" is the verbatim original script in Task 6 Step 2, with explicit instruction to copy it unchanged (captured in Step 1). ✓

**Type consistency:** `cn(...inputs: ClassInput[])` used consistently in Tasks 4-5. `Field` props (`id`, `label`, `type`, `required`, `name`) match usage in Task 6. Button `variant`/`size` union types match their variant-map keys. `AdminLayout` `title` prop matches Task 6 usage. ✓
