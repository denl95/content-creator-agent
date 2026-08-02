# Ukrainian Localisation — Design Spec

**Date:** 2026-08-02
**Goal:** Serve the dashboard in Ukrainian as well as English, so a Ukrainian prospect sees a Ukrainian product rather than an English shell wrapped around Ukrainian output.

---

## 1. Context

The pipeline already produces Ukrainian content end to end: `Brief.language` reaches all three prompts, an ingested brand carries its own detected language, and a live run against `eonyx.net/uk` returned a fully Ukrainian draft with Ukrainian editor feedback.

The interface around it is entirely English. Nav reads *Dashboard / New run / Brands / Drafts*; the approval card says *Content plan — approve?*; a failed run shows *Your session expired*. For an agency selling to Ukrainian B2B companies, the demo therefore shows a Ukrainian deliverable inside an English product.

There is no i18n infrastructure of any kind: no library, no locale files, and every string is a literal in a component. The API compounds it — `src/server.ts` returns English prose in its `error` field, and `web/lib/errors.ts` passes that string straight to the screen, so roughly a dozen backend messages are user-facing copy.

## 2. Goals and non-goals

**In scope**

- Ukrainian and English, chosen by URL prefix (`/uk/...`, `/en/...`)
- Every string the dashboard renders: nav, forms, tables, cards, empty states, errors
- Locale-aware date and currency formatting
- API errors carried as stable codes and translated in the dashboard
- Ukrainian as the default locale

**Explicitly out of scope**

- **Brand and draft content.** That is user data in whatever language its brand uses; translating it would be nonsense.
- **A third locale.** The design admits one, but nothing here is built for many.
- **Translating the CLI**, `scripts/*`, or log output. Operator-facing, English.
- **`/spike`.** A diagnostic page already slated for removal.
- **Machine translation.** The Ukrainian copy is written by hand — this is a brand's own product surface.

## 3. Decisions taken during design

| Question | Decision | Reasoning |
|---|---|---|
| What does "add Ukrainian" mean? | Localise the dashboard UI, keep English | Generation already handles Ukrainian; the shell is what undercuts the demo |
| API error strings | Server returns codes; the dashboard translates | Keeps all copy in one place and leaves the API language-agnostic and curl-able |
| Locale selection | URL prefix, `/uk` and `/en` | Matches how eonyx.net itself is structured, so the convention is coherent rather than arbitrary |
| Mechanism | Hand-rolled typed dictionary | ~43 literal strings across 11 files; a library's plural and format machinery is not yet earned, and adding a second middleware is the documented failure mode here |
| Default locale | `uk` | The audience the demo is built for |

## 4. Route structure

The existing `(dashboard)` route group moves *inside* the locale segment. That preserves the one property it exists for: the login screen renders bare while every dashboard page gets the nav shell.

```
app/
  [locale]/
    layout.tsx                  root layout — <html lang={locale}>, theme script, MessagesProvider
    (dashboard)/
      layout.tsx                nav shell        ← was app/(dashboard)/layout.tsx
      page.tsx                  dashboard
      run/page.tsx
      brands/page.tsx
      brands/new/page.tsx
      brands/[id]/page.tsx
      drafts/page.tsx
      drafts/[id]/page.tsx
    login/page.tsx              bare             ← was app/login/page.tsx
```

`params` is a Promise in Next 16, so every page reads `const { locale } = await params`.

**`app/layout.tsx` is deleted, and `app/[locale]/layout.tsx` becomes the root layout.** This is forced rather than stylistic: `<html lang>` must reflect the active locale, and a root layout cannot read a child segment's params. Moving `<html>` and `<body>` into the locale layout is the only place both facts hold. It keeps everything `app/layout.tsx` owns today — the global stylesheet and the blocking theme script that must run before first paint — and gains `lang={locale}` and the messages provider.

That leaves nothing outside `[locale]`, which is what makes it a valid root. `/` therefore has no page at all: the redirect to `/uk` happens in the proxy (§5), not in a route. Handling it as a page would reintroduce a route outside `[locale]` and force a second root layout back into existence.

## 5. Locale detection folds into the existing proxy

No second middleware. `web/proxy.ts` gains one branch **before** the auth check:

1. Path already begins `/uk` or `/en` → fall through to the existing auth logic.
2. Otherwise → redirect to `/{locale}{path}`, choosing locale from the `locale` cookie, then `Accept-Language`, then `uk`.

The matcher stops encoding the login exemption as a negative lookahead. It excludes only `api`, `_next/static`, `_next/image` and `favicon.ico`; the proxy then skips the auth check when the path matches `^/(uk|en)/login$`.

That is deliberate. `web/AGENTS.md` records that this matcher is required rather than optional and that getting it wrong once blocked the login page's own CSS. A readable early return is easier to keep correct than a longer lookahead, and the redirect branch must not fire for `/api/*` — which the matcher, not the branch, guarantees.

Switching locale is a link to the same path under the other prefix, written by a small `LocaleToggle` beside the existing `ThemeToggle`. It also sets the `locale` cookie so an unprefixed entry point (a bookmark to `/`) honours the last choice.

## 6. The dictionary

```
web/i18n/
  messages/en.ts     source of truth — its type defines the shape
  messages/uk.ts     typed as `typeof en`
  index.ts           Locale, LOCALES, DEFAULT_LOCALE, isLocale(), getMessages()
  provider.tsx       MessagesProvider + useT() for Client Components
```

`en.ts` is a nested object of plain strings. `uk.ts` is declared `const uk: typeof en = { ... }`, which makes a missing or misspelled key a **typecheck failure** rather than a blank space discovered in a demo. This is the entire reason for hand-rolling: a runtime catalogue lookup cannot give that guarantee.

Server Components take `locale` from `params` and call `getMessages(locale)` directly. The four Client Components that render copy — `BriefForm`, `PlanApproval`, `BrandReview`, and the `run` and `brands/new` pages — read it through `useT()`, backed by a context the locale layout provides. Passing messages down as props was rejected: the run page alone would thread them through three levels.

Interpolation is a single helper, `t('key', { count: 3 })`, doing `{name}` replacement. No pluralisation engine: the few counted strings are handled by writing both forms explicitly, because Ukrainian has three plural forms and a naive `n === 1` rule would be wrong in a way English does not reveal.

`web/lib/format.ts` currently hardcodes English formatting. `formatDate` and `formatUsd` take the locale and pass it to `Intl.DateTimeFormat` / `Intl.NumberFormat`.

## 7. API errors become codes

Roughly a dozen sites in `src/server.ts` change shape:

```ts
// before
return c.json({ error: 'brand not found' }, 404);
// after
return c.json({ error: 'brand_not_found', message: 'brand not found' }, 404);
```

`error` is the stable machine code the dashboard translates. `message` stays so the API remains self-explanatory to anyone reading it with `curl` — this project treats a curl-able API as a feature, and returning only `brand_not_found` would degrade that.

`web/lib/errors.ts` maps code → translated string, falling back to `message`, then to a generic. An unrecognised code therefore degrades to readable English rather than to nothing, which matters because the code list will drift as endpoints are added.

Zod validation failures are exempt: they already return structured `issues` rather than prose, and are developer-facing rather than user-facing.

## 8. Risks

| Risk | Mitigation |
|---|---|
| The proxy matcher blocks static assets again | Matcher excludes `_next/*` explicitly; the login exemption moves out of the regex into a readable check; a test asserts `/uk/login` is reachable unauthenticated |
| Every page file moves, colliding with four open PRs | Build on the stack tip (#9), not `main`. Landing this before the stack merges would conflict on all 11 files |
| A missing Ukrainian key ships as blank | `uk.ts` is typed `typeof en`, so it cannot compile with a key missing |
| Ukrainian plural forms silently wrong | No plural engine; counted strings are written out per form, and there are only a handful |
| Ukrainian copy reads like a translation | The strings are the brand's own product surface — written, then read by a native speaker before merge. This is the one step no amount of typing catches |

## 9. Testing

**Unit** (`tests/unit/`, CI-gated): `isLocale()` accepts `uk`/`en` and rejects anything else; the proxy's locale-resolution helper picks cookie over `Accept-Language` over the default; `errorMessage()` maps a known code, falls back to `message` for an unknown one, and to the generic when neither is present. The server tests assert the new `{ error, message }` shape on a representative 404 and 409.

**Typecheck** carries the coverage that matters most: `cd web && bun run build` fails if `uk.ts` and `en.ts` diverge.

**Manual**: walk every screen in both locales, including a failed run and an expired session, since those paths are the ones that fall back to English if the code mapping is incomplete.

## 10. Success criteria

- Every dashboard screen renders fully in Ukrainian at `/uk/*` and fully in English at `/en/*`, with no English fragments left in the Ukrainian views.
- A failed run, an expired session and a rejected brief all show Ukrainian messages.
- Dates and costs format per locale.
- `/` redirects to `/uk`; `/uk/login` is reachable unauthenticated and styled.
- Removing a key from `uk.ts` fails `cd web && bun run build`.
- `bun run typecheck`, `bunx biome ci .`, `bun run test:unit` and the web build all pass.

## 11. Implementation order

One plan, but sequenced so each step is separately verifiable:

1. **Dictionary and helpers** — `web/i18n/*`, both message files, `useT()`, locale-aware `format.ts`. No routing change; nothing consumes it yet.
2. **Route move and proxy** — pages under `[locale]/`, `/` redirect, locale detection in the proxy, `LocaleToggle`. Screens still render English literals.
3. **Replace the literals** — screen by screen, the mechanical bulk of the work.
4. **API error codes** — `src/server.ts` sites plus the mapping in `web/lib/errors.ts`.
