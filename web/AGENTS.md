<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# The EONYX dashboard

Frontend only. The LangGraph pipeline, SQLite and SSE all live in the Hono API at the repo root (`../src/`); this app never talks to a database directly.

## The `/api/*` rule

Every backend call goes through `/api/*`. `next.config.ts` rewrites `/api/:path*` → `${API_ORIGIN}/:path*`.

**Never add a rewrite for bare `/drafts` or `/runs`.** Those are page routes — a rewrite would shadow them and the drafts screens would silently stop rendering. Server Components fetch via `lib/api.ts` (which forwards the auth cookie); Client Components fetch `/api/...` directly.

## Next 16 specifics that bit us

- The `middleware.ts` convention is **deprecated** — this app uses `proxy.ts`, exporting a function named `proxy`. Its runtime is always `nodejs`, which is what lets it `fetch` the Hono server.
- `proxy.ts`'s `matcher` is **required, not optional**. Without it the proxy runs on `_next/static` too and blocks the login page's own CSS.
- `params` in dynamic routes is a `Promise` — `const { id } = await params`.

## Theming

`app/globals.css` holds the EONYX design tokens, imported from the EONYX Design System project on claude.ai/design (not hand-authored — re-read them with the `DesignSync` tool rather than inventing values). `:root` is the dark register, `html.light` the light one, and shadcn's semantic variables are re-pointed at EONYX tokens so components inherit the brand without edits.

Two traps live here:

- **`--brand` must stay defined.** `spend-chart.tsx` and `channel-chart.tsx` pass `var(--brand)` into SVG `fill`/`stroke`. An undefined CSS variable makes SVG fall back to **black** — invisible on the dark canvas, and it passes build, typecheck and lint. This shipped once already.
- **`--accent` collides.** EONYX names it the cyan interactive colour; shadcn uses it for hover surfaces and its components depend on that. Cyan lives on `--brand`; leave `--accent` to shadcn.

Theme class is set before first paint by a script in `app/layout.tsx` reading `localStorage.theme`, defaulting to dark. shadcn components use `dark:` variants, so the `dark` class must actually be present — a `prefers-color-scheme` media query alone would not switch them.

## Tooling

This directory is **excluded from the root Biome and root `tsc`** and has its own ESLint/tsconfig. Typecheck it with `bun run build` from here, not `bun run typecheck` at the root.
