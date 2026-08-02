# Ukrainian Localisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve every dashboard screen in Ukrainian at `/uk/*` and English at `/en/*`, with no English fragments left in the Ukrainian views.

**Architecture:** A typed message object per locale, accessed by property rather than by string key, so a missing translation is a compile error. Locale comes from the URL prefix; detection and redirect fold into the existing auth proxy rather than adding a second middleware. API errors travel as stable codes and are translated in the dashboard.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), React 19, TypeScript 6, Bun, Biome.

## Global Constraints

- **Messages are accessed as properties, never as string keys.** `m.nav.brands`, not `t('nav.brands')`. This is the whole reason for hand-rolling: property access gives autocomplete and makes a typo a typecheck failure, which a runtime key lookup cannot.
- **`uk.ts` is declared `typeof en`.** `en.ts` is the source of truth for the shape. A key missing from Ukrainian must fail `cd web && bun run build`.
- **No pluralisation engine.** Ukrainian has three plural forms where English has two, so a naive `n === 1` rule is wrong in a way English testing never reveals. Counted strings are written out per form.
- **`app/layout.tsx` is deleted**; `app/[locale]/layout.tsx` becomes the root layout. `<html lang>` must reflect the locale and a root layout cannot read a child segment's params.
- **`/` has no page.** The redirect to `/uk` happens in the proxy. A page would reintroduce a route outside `[locale]` and force a second root layout back.
- **The proxy matcher must keep excluding `api`, `_next/static`, `_next/image`, `favicon.ico`.** `web/AGENTS.md` records that getting this wrong blocked the login page's own CSS. The login *auth* exemption moves out of the regex into a readable check.
- `web/` is excluded from root Biome and root `tsc` — build it with `cd web && bun run build`.
- Runtime is **Bun**: `bun`, `bun test`, `bunx`. Never `node`, `npm`, `npx`.
- Brand and draft **content** is never translated — it is user data in its own language.
- Commits: Conventional Commits. Do **not** add a Claude co-author trailer.

---

### Task 1: The message catalogue and locale-aware formatters

**Files:**
- Create: `web/i18n/index.ts`, `web/i18n/messages/en.ts`, `web/i18n/messages/uk.ts`, `web/i18n/provider.tsx`
- Modify: `web/lib/format.ts`
- Test: `tests/unit/i18n.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LOCALES`, `type Locale = 'uk' | 'en'`, `DEFAULT_LOCALE`, `isLocale(v): v is Locale`, `getMessages(locale): Messages`, `type Messages`; `<MessagesProvider locale messages>` and `useMessages(): Messages`; `formatDate(iso, locale)`, `formatUsd(value, locale)`, `formatClock(ts, locale)`, `formatPercent(ratio)`, `formatElapsed(ms)`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/i18n.test.ts`. It lives in the root suite because the root runner is what CI executes; it imports from `web/` directly.

```ts
import { describe, expect, test } from 'bun:test';
import { DEFAULT_LOCALE, getMessages, isLocale, LOCALES } from '../../web/i18n/index';
import en from '../../web/i18n/messages/en';
import uk from '../../web/i18n/messages/uk';

/** Every leaf path in a message object, so the two locales can be compared. */
function paths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    paths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('locales', () => {
  test('isLocale accepts the supported tags and nothing else', () => {
    expect(isLocale('uk')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('de')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale('UK')).toBe(false); // the URL segment is lowercase
  });

  test('Ukrainian is the default, and both locales are listed', () => {
    expect(DEFAULT_LOCALE).toBe('uk');
    expect([...LOCALES].sort()).toEqual(['en', 'uk']);
  });

  test('getMessages returns the matching catalogue', () => {
    expect(getMessages('en').nav.brands).toBe(en.nav.brands);
    expect(getMessages('uk').nav.brands).toBe(uk.nav.brands);
  });
});

describe('catalogue shape', () => {
  test('the two locales have exactly the same keys', () => {
    // `typeof en` catches this at build time; this asserts it at test time too,
    // so a failure names the offending key instead of a type error 40 lines long.
    expect(paths(uk).sort()).toEqual(paths(en).sort());
  });

  test('no Ukrainian string was left as its English source', () => {
    const shared = paths(en).filter((path) => {
      const read = (o: unknown) =>
        path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], o);
      return typeof read(en) === 'string' && read(en) === read(uk);
    });
    // Only genuinely locale-neutral strings may match — brand and product names.
    expect(shared).toEqual(['app.name']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/unit/i18n.test.ts`
Expected: FAIL — `Cannot find module '../../web/i18n/index'`.

- [ ] **Step 3: Write the English catalogue**

Create `web/i18n/messages/en.ts`. Values are plain strings, except the few that interpolate, which are functions — that keeps them type-checked without a key-path parser.

```ts
/**
 * Source of truth for the message shape. `uk.ts` is declared `typeof en`, so
 * anything added here must be added there before the build passes.
 *
 * Interpolating strings are functions rather than templates with placeholders:
 * the argument types are then checked at the call site, and there is no
 * key-path parser to write.
 */
const en = {
  app: { name: 'EONYX' },

  nav: {
    dashboard: 'Dashboard',
    newRun: 'New run',
    brands: 'Brands',
    drafts: 'Drafts',
    home: 'EONYX — home',
    theme: 'Toggle theme',
    language: 'Language',
  },

  common: {
    approve: 'Approve',
    requestChanges: 'Request changes',
    cancel: 'Cancel',
    none: 'None',
    loading: 'Loading…',
    words: 'Words',
    cost: 'Cost',
    channel: 'Channel',
    brand: 'Brand',
    language: 'Language',
    created: 'Created',
    status: 'Status',
    verdict: 'Verdict',
    topic: 'Topic',
    tone: 'Tone',
    audience: 'Audience',
    wordCount: 'Word count',
    iterations: 'Iterations',
    scores: 'Scores',
    name: 'Name',
  },

  dashboard: {
    title: 'Dashboard',
    newRun: 'New run →',
    drafts: 'Drafts',
    approved: 'Approved',
    approvedHint: (n: { approved: number; total: number }) => `${n.approved} of ${n.total}`,
    totalSpend: 'Total spend',
    avgIterations: 'Avg iterations',
    spendOverTime: 'Spend over time',
    draftsPerChannel: 'Drafts per channel',
    recentDrafts: 'Recent drafts',
    empty: 'Nothing yet.',
    emptyCta: 'Generate your first draft →',
  },

  run: {
    title: 'New run',
    generate: 'Generate',
    running: 'Running…',
    planTitle: 'Content plan — approve?',
    keywords: 'Keywords:',
    tone: 'Tone:',
    audience: 'Audience:',
    feedbackPlaceholder: 'Feedback (required to request changes)',
    conflictsTitle: 'Brief overrides brand guide',
    conflictsNote: "Approving keeps the brief's values.",
    conflictLine: (c: { brief: string; corpus: string }) =>
      `brief: ${c.brief} · brand guide: ${c.corpus}`,
    done: 'Done',
    openDraft: 'Open the finished draft →',
    result: (r: { cost: string; tokens: number }) => `${r.cost} · ${r.tokens} tokens`,
    editorLine: (e: { verdict: string; tone: number; accuracy: number; structure: number }) =>
      `editor: ${e.verdict} · tone ${e.tone} · accuracy ${e.accuracy} · structure ${e.structure}`,
    brandsUnavailable: 'Could not load brands. Every run needs one — check you are signed in, or',
    brandsUnavailableCta: 'ingest a brand',
    noBrands: 'No brands available',
    reconnect: 'Reconnect',
    reconnecting: 'Reconnecting…',
  },

  brands: {
    title: 'Brands',
    newBrand: 'New brand',
    empty: 'No brands yet.',
    emptyCta: 'Ingest one from a website →',
    default: 'default',
    ingesting: 'Ingesting…',
    ingest: 'Ingest brand',
    websiteUrl: 'Website URL',
    websiteHint:
      'The path scopes the crawl: /uk stays inside that section, so a bilingual site does not produce a mixed-language corpus.',
    feed: 'RSS or Atom feed (optional)',
    pasted: 'Pasted posts (optional)',
    pastedHint:
      'Separate posts with a line of three dashes. Real published copy is far better voice evidence than a landing page.',
    needSource: 'Give at least one source: a website, a feed, or pasted posts.',
    reviewTitle: (b: { name: string }) => `${b.name} — approve this brand?`,
    reviewMeta: (b: { language: string; exemplars: number }) =>
      `${b.language} · ${b.exemplars} exemplars`,
    mission: 'Mission',
    voice: 'Voice — one per line',
    forbidden: 'Forbidden phrases — one per line',
    exemplarNote:
      'Exemplars are accepted or re-distilled as a set — a hand-edited exemplar stops being evidence of how the brand actually writes.',
    distilAgain: 'Distil again',
    feedbackPlaceholder: 'Feedback (required to distil again)',
    overview: 'Brand overview',
    styleGuide: 'Style guide',
    exemplars: (n: { count: number }) => `Exemplars (${n.count})`,
    noExemplars: 'None recorded.',
    provenance: 'Provenance',
    provenanceOne: 'source page kept for reference and deliberately not embedded.',
    provenanceMany: 'source pages kept for reference and deliberately not embedded.',
  },

  drafts: {
    title: 'Drafts',
    empty: 'No drafts yet.',
    emptyCta: 'Generate one →',
    content: 'Content',
    editorIssues: 'Editor issues',
    scoresHint: 'tone / accuracy / structure',
    openNotion: 'Open in Notion →',
    publish: 'Publish to Notion',
    publishing: 'Publishing…',
  },

  login: {
    title: 'Sign in',
    password: 'Password',
    submit: 'Sign in',
    failed: 'Wrong password.',
  },

  errors: {
    generic: 'Something went wrong.',
    sessionExpired: 'Your session expired. Sign in again to continue.',
    unauthorized: 'You are not signed in.',
    passwordRequired: 'A password is required.',
    invalidPassword: 'Wrong password.',
    brandNotFound: 'That brand no longer exists.',
    brandInactive: 'That brand is unknown or not active yet.',
    brandHasNoSources: 'This brand has no stored sources to re-ingest.',
    brandPasteOnly:
      'This brand has only pasted sources recorded before their text was stored — create it again.',
    brandIsDefault: 'You cannot delete the default brand. Make another brand default first.',
    draftNotFound: 'That draft no longer exists.',
    runNotFound: 'That run no longer exists.',
    runNotAwaiting: 'This run is no longer waiting for approval.',
    notionNotConfigured: 'Notion is not configured on the server.',
    publishFailed: 'Publishing to Notion failed.',
  },
} as const;

export default en;
export type Messages = typeof en;
```

- [ ] **Step 4: Write the Ukrainian catalogue**

Create `web/i18n/messages/uk.ts`. The `typeof en` annotation is what makes a missing key a build failure.

```ts
import type { Messages } from './en';

const uk: Messages = {
  app: { name: 'EONYX' },

  nav: {
    dashboard: 'Панель',
    newRun: 'Новий запуск',
    brands: 'Бренди',
    drafts: 'Чернетки',
    home: 'EONYX — головна',
    theme: 'Змінити тему',
    language: 'Мова',
  },

  common: {
    approve: 'Затвердити',
    requestChanges: 'Надіслати правки',
    cancel: 'Скасувати',
    none: 'Немає',
    loading: 'Завантаження…',
    words: 'Слів',
    cost: 'Вартість',
    channel: 'Канал',
    brand: 'Бренд',
    language: 'Мова',
    created: 'Створено',
    status: 'Статус',
    verdict: 'Вердикт',
    topic: 'Тема',
    tone: 'Тон',
    audience: 'Аудиторія',
    wordCount: 'Кількість слів',
    iterations: 'Ітерацій',
    scores: 'Оцінки',
    name: 'Назва',
  },

  dashboard: {
    title: 'Панель',
    newRun: 'Новий запуск →',
    drafts: 'Чернетки',
    approved: 'Затверджено',
    approvedHint: (n) => `${n.approved} з ${n.total}`,
    totalSpend: 'Загальні витрати',
    avgIterations: 'Середньо ітерацій',
    spendOverTime: 'Витрати за час',
    draftsPerChannel: 'Чернетки за каналами',
    recentDrafts: 'Останні чернетки',
    empty: 'Поки нічого немає.',
    emptyCta: 'Створити першу чернетку →',
  },

  run: {
    title: 'Новий запуск',
    generate: 'Згенерувати',
    running: 'Виконується…',
    planTitle: 'Контент-план — затвердити?',
    keywords: 'Ключові слова:',
    tone: 'Тон:',
    audience: 'Аудиторія:',
    feedbackPlaceholder: 'Коментар (обов’язковий, щоб надіслати правки)',
    conflictsTitle: 'Бриф має перевагу над гайдом бренду',
    conflictsNote: 'Затвердження залишає значення з брифу.',
    conflictLine: (c) => `бриф: ${c.brief} · гайд бренду: ${c.corpus}`,
    done: 'Готово',
    openDraft: 'Відкрити готову чернетку →',
    result: (r) => `${r.cost} · ${r.tokens} токенів`,
    editorLine: (e) =>
      `редактор: ${e.verdict} · тон ${e.tone} · точність ${e.accuracy} · структура ${e.structure}`,
    brandsUnavailable:
      'Не вдалося завантажити бренди. Кожен запуск потребує бренду — перевірте, чи ви увійшли, або',
    brandsUnavailableCta: 'додайте бренд',
    noBrands: 'Немає доступних брендів',
    reconnect: 'Перепідключитися',
    reconnecting: 'Перепідключення…',
  },

  brands: {
    title: 'Бренди',
    newBrand: 'Новий бренд',
    empty: 'Брендів ще немає.',
    emptyCta: 'Додати бренд із сайту →',
    default: 'за замовчуванням',
    ingesting: 'Опрацювання…',
    ingest: 'Додати бренд',
    websiteUrl: 'URL сайту',
    websiteHint:
      'Шлях обмежує обхід: /uk залишається в межах цього розділу, тож двомовний сайт не дасть змішаного корпусу.',
    feed: 'RSS або Atom стрічка (необов’язково)',
    pasted: 'Вставлені пости (необов’язково)',
    pastedHint:
      'Розділяйте пости рядком із трьох дефісів. Реальні опубліковані тексти — значно кращий доказ голосу, ніж лендинг.',
    needSource: 'Вкажіть хоча б одне джерело: сайт, стрічку або вставлені пости.',
    reviewTitle: (b) => `${b.name} — затвердити цей бренд?`,
    reviewMeta: (b) => `${b.language} · ${b.exemplars} зразків`,
    mission: 'Місія',
    voice: 'Голос — по одному в рядку',
    forbidden: 'Заборонені фрази — по одній у рядку',
    exemplarNote:
      'Зразки приймаються або перегенеровуються цілим набором — відредагований вручну зразок перестає бути доказом того, як бренд насправді пише.',
    distilAgain: 'Перегенерувати',
    feedbackPlaceholder: 'Коментар (обов’язковий для перегенерації)',
    overview: 'Огляд бренду',
    styleGuide: 'Гайд зі стилю',
    exemplars: (n) => `Зразки (${n.count})`,
    noExemplars: 'Не збережено.',
    provenance: 'Джерела',
    provenanceOne: 'сторінка збережена для довідки й свідомо не індексується.',
    provenanceMany: 'сторінок збережено для довідки й свідомо не індексуються.',
  },

  drafts: {
    title: 'Чернетки',
    empty: 'Чернеток ще немає.',
    emptyCta: 'Створити чернетку →',
    content: 'Текст',
    editorIssues: 'Зауваження редактора',
    scoresHint: 'тон / точність / структура',
    openNotion: 'Відкрити в Notion →',
    publish: 'Опублікувати в Notion',
    publishing: 'Публікація…',
  },

  login: {
    title: 'Вхід',
    password: 'Пароль',
    submit: 'Увійти',
    failed: 'Невірний пароль.',
  },

  errors: {
    generic: 'Щось пішло не так.',
    sessionExpired: 'Сесія завершилася. Увійдіть знову, щоб продовжити.',
    unauthorized: 'Ви не увійшли в систему.',
    passwordRequired: 'Потрібен пароль.',
    invalidPassword: 'Невірний пароль.',
    brandNotFound: 'Такого бренду більше не існує.',
    brandInactive: 'Бренд невідомий або ще не активний.',
    brandHasNoSources: 'У цього бренду немає збережених джерел для повторного опрацювання.',
    brandPasteOnly:
      'У цього бренду є лише вставлені джерела, збережені до того, як почав зберігатися їхній текст — створіть бренд заново.',
    brandIsDefault: 'Не можна видалити бренд за замовчуванням. Спершу зробіть іншим.',
    draftNotFound: 'Такої чернетки більше не існує.',
    runNotFound: 'Такого запуску більше не існує.',
    runNotAwaiting: 'Цей запуск більше не очікує на затвердження.',
    notionNotConfigured: 'Notion не налаштовано на сервері.',
    publishFailed: 'Не вдалося опублікувати в Notion.',
  },
};

export default uk;
```

- [ ] **Step 5: Write the locale module and provider**

Create `web/i18n/index.ts`:

```ts
import en, { type Messages } from './messages/en';
import uk from './messages/uk';

export const LOCALES = ['uk', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Ukrainian: the audience this dashboard is demonstrated to. */
export const DEFAULT_LOCALE: Locale = 'uk';

const CATALOGUES: Record<Locale, Messages> = { uk, en };

/** Lowercase only — the URL segment is the source, and `/UK` is not a route. */
export function isLocale(value: string | undefined | null): value is Locale {
  return value === 'uk' || value === 'en';
}

export function getMessages(locale: Locale): Messages {
  return CATALOGUES[locale];
}

export type { Messages };
```

Create `web/i18n/provider.tsx`:

```tsx
'use client';

import { createContext, useContext } from 'react';
import type { Locale, Messages } from './index';

const MessagesContext = createContext<{ locale: Locale; messages: Messages } | null>(null);

/**
 * Client Components read messages from context rather than props. The run
 * screen alone would otherwise thread them through three levels, and every
 * intermediate component would grow a prop it does not use.
 */
export function MessagesProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Messages;
  children: React.ReactNode;
}) {
  return (
    <MessagesContext.Provider value={{ locale, messages }}>{children}</MessagesContext.Provider>
  );
}

export function useMessages(): Messages {
  const value = useContext(MessagesContext);
  if (!value) throw new Error('useMessages must be used inside MessagesProvider');
  return value.messages;
}

export function useLocale(): Locale {
  const value = useContext(MessagesContext);
  if (!value) throw new Error('useLocale must be used inside MessagesProvider');
  return value.locale;
}
```

- [ ] **Step 6: Make the formatters locale-aware**

Rewrite `web/lib/format.ts`. Every function that renders a date, time or amount takes the locale; `formatPercent` and `formatElapsed` are locale-neutral and keep their signatures.

```ts
import type { Locale } from '@/i18n/index';

/** BCP-47 tags for Intl. 'en' alone would give US date order. */
const INTL_LOCALE: Record<Locale, string> = { uk: 'uk-UA', en: 'en-GB' };

export function formatUsd(value: number | null | undefined, locale: Locale): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

export function formatDate(iso: string, locale: Locale): string {
  // SQLite stores 'YYYY-MM-DD HH:MM:SS' in UTC; make it explicit before parsing.
  const parsed = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString(INTL_LOCALE[locale], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** Elapsed duration as mm:ss. Digits only, so no locale applies. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Built once per locale: the activity log formats every visible row on each
// render, and a fresh options bag per call misses the engine's fast path.
const CLOCKS = new Map<Locale, Intl.DateTimeFormat>();

/** Wall-clock time of day, for streaming log rows. */
export function formatClock(ts: number, locale: Locale): string {
  let clock = CLOCKS.get(locale);
  if (!clock) {
    clock = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    CLOCKS.set(locale, clock);
  }
  return clock.format(ts);
}
```

- [ ] **Step 7: Run the tests**

Run: `bun test tests/unit/i18n.test.ts`
Expected: PASS — 5 cases. The "no Ukrainian string was left as its English source" case is the one that catches a half-finished translation.

- [ ] **Step 8: Commit**

The web build will not pass yet — callers still pass one argument to `formatDate`. That is fixed in Task 3; this task is committed on the root gates only.

```bash
bun run typecheck && bunx biome ci . && bun run test:unit
git add web/i18n web/lib/format.ts tests/unit/i18n.test.ts
git commit -m "feat: add the Ukrainian and English message catalogues

Messages are read as properties rather than by string key, so a typo is a
typecheck failure and editors autocomplete the tree. uk.ts is declared
Messages, which makes a missing translation fail the build rather than
render blank in a demo.

Interpolating strings are functions, not templates with placeholders: their
arguments are then checked at each call site with no key-path parser. There
is no pluralisation engine — Ukrainian has three plural forms where English
has two, so the counted strings are written out per form.

Formatters take the locale: uk-UA and en-GB rather than a hardcoded en-GB."
```

---

### Task 2: Route move and locale detection

**Files:**
- Delete: `web/app/layout.tsx`
- Move: `web/app/(dashboard)/**` → `web/app/[locale]/(dashboard)/**`; `web/app/login/page.tsx` → `web/app/[locale]/login/page.tsx`
- Create: `web/app/[locale]/layout.tsx`, `web/components/locale-toggle.tsx`
- Modify: `web/proxy.ts`, `web/components/nav.tsx`
- Test: `tests/unit/localeRouting.test.ts`

**Interfaces:**
- Consumes: `LOCALES`, `Locale`, `DEFAULT_LOCALE`, `isLocale`, `getMessages`, `MessagesProvider` (Task 1).
- Produces: `resolveLocale(cookie, acceptLanguage): Locale` exported from `web/i18n/index.ts`; every page receives `params: Promise<{ locale: Locale }>`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/localeRouting.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { resolveLocale } from '../../web/i18n/index';

describe('resolveLocale', () => {
  test('a valid cookie wins outright', () => {
    expect(resolveLocale('en', 'uk-UA,uk;q=0.9')).toBe('en');
    expect(resolveLocale('uk', 'en-GB,en;q=0.9')).toBe('uk');
  });

  test('an unsupported cookie is ignored rather than trusted', () => {
    expect(resolveLocale('de', 'en-GB,en;q=0.9')).toBe('en');
  });

  test('falls back to Accept-Language when there is no cookie', () => {
    expect(resolveLocale(undefined, 'en-GB,en;q=0.9')).toBe('en');
    expect(resolveLocale(undefined, 'uk-UA,uk;q=0.9,en;q=0.8')).toBe('uk');
  });

  test('takes the first supported tag, not merely the first tag', () => {
    expect(resolveLocale(undefined, 'de-DE,de;q=0.9,en;q=0.8')).toBe('en');
  });

  test('defaults to Ukrainian when nothing matches', () => {
    expect(resolveLocale(undefined, 'de-DE,fr;q=0.8')).toBe('uk');
    expect(resolveLocale(undefined, '')).toBe('uk');
    expect(resolveLocale(undefined, null)).toBe('uk');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/unit/localeRouting.test.ts`
Expected: FAIL — `resolveLocale` is not exported.

- [ ] **Step 3: Add `resolveLocale`**

Append to `web/i18n/index.ts`:

```ts
/**
 * Cookie first, then Accept-Language, then Ukrainian. Kept here rather than in
 * proxy.ts so it is testable without constructing a NextRequest.
 */
export function resolveLocale(
  cookie: string | undefined | null,
  acceptLanguage: string | undefined | null,
): Locale {
  if (isLocale(cookie)) return cookie;
  for (const part of (acceptLanguage ?? '').split(',')) {
    const tag = part.split(';')[0]?.trim().slice(0, 2).toLowerCase();
    if (isLocale(tag)) return tag;
  }
  return DEFAULT_LOCALE;
}
```

- [ ] **Step 4: Rewrite the proxy**

Replace `web/proxy.ts`:

```ts
import { type NextRequest, NextResponse } from 'next/server';
import { isLocale, resolveLocale } from './i18n/index';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3000';

/** `/uk/login` and `/en/login` are the only pages reachable unauthenticated. */
const LOGIN_PATH = /^\/(uk|en)\/login$/;

/**
 * Next 16 renamed the `middleware` convention to `proxy` (nodejs runtime only).
 *
 * Two jobs, in order. First locale: a path without a locale prefix is redirected
 * to one, which is also how `/` reaches `/uk` — there is no page at `/`, because
 * a route outside `[locale]` would force a second root layout to exist.
 *
 * Then auth, which has a single source of truth: the Hono server decides whether
 * the cookie is valid. It answers 200 unconditionally when DEMO_PASSWORD is
 * unset, so local development is unaffected and the HMAC logic is never
 * duplicated here.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const first = pathname.split('/')[1];

  if (!isLocale(first)) {
    const locale = resolveLocale(
      request.cookies.get('locale')?.value,
      request.headers.get('accept-language'),
    );
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
    return NextResponse.redirect(url);
  }

  // The login exemption lives here rather than in the matcher. It used to be a
  // negative lookahead, and AGENTS.md records that getting that regex wrong
  // blocked the login page's own CSS; a readable check is easier to keep right.
  if (LOGIN_PATH.test(pathname)) return NextResponse.next();

  const check = await fetch(`${API_ORIGIN}/auth/check`, {
    headers: { cookie: request.headers.get('cookie') ?? '' },
    cache: 'no-store',
  }).catch(() => null);

  if (check?.ok) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/${first}/login`;
  return NextResponse.redirect(url);
}

export const config = {
  // Static assets and the API must never reach this. Without the exclusions it
  // runs on _next/static too, which blocks CSS and JS from loading at all.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 5: Move the routes**

```bash
cd web
mkdir -p "app/[locale]"
git mv "app/(dashboard)" "app/[locale]/(dashboard)"
mkdir -p "app/[locale]/login"
git mv app/login/page.tsx "app/[locale]/login/page.tsx"
rmdir app/login
```

- [ ] **Step 6: Make `app/[locale]/layout.tsx` the root layout**

Create it with the whole contents of the deleted `app/layout.tsx` — fonts, metadata and the blocking theme script — plus the locale. Then `git rm web/app/layout.tsx`.

```tsx
import type { Metadata } from 'next';
import { JetBrains_Mono, Montserrat } from 'next/font/google';
import { notFound } from 'next/navigation';
import { getMessages, isLocale, LOCALES } from '@/i18n/index';
import { MessagesProvider } from '@/i18n/provider';
import '../globals.css';

// EONYX brand faces: Montserrat (geometric display/UI) + JetBrains Mono
// (primary technical face — labels, kickers, data). Both are exact per the
// brand book, not substitutions.
const montserrat = Montserrat({
  variable: '--font-montserrat',
  subsets: ['latin', 'cyrillic'],
  weight: ['300', '400', '500', '600', '700', '900'],
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '700'],
});

export const metadata: Metadata = {
  title: 'EONYX — AI Content Pipeline',
  description: 'Plan, write, edit and publish on-brand content with a human in the loop.',
};

/** Both locales are known at build time, so both shells prerender. */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

// Applies the stored theme before first paint so there is no flash. EONYX is
// dark-first, so dark is the default when nothing has been chosen.
const THEME_SCRIPT = `try{var t=localStorage.getItem('theme')==='light'?'light':'dark';document.documentElement.classList.add(t)}catch(e){document.documentElement.classList.add('dark')}`;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // params is a Promise in Next 16.
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <html
      lang={locale}
      className={`${montserrat.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static string, must run before paint */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body
        className="flex min-h-full flex-col bg-background text-foreground"
        style={{ fontFamily: 'var(--font-montserrat), system-ui, sans-serif' }}
      >
        <MessagesProvider locale={locale} messages={getMessages(locale)}>
          {children}
        </MessagesProvider>
      </body>
    </html>
  );
}
```

The `cyrillic` subset on both fonts is not optional: without it Ukrainian renders in a fallback face and the brand typography silently stops applying.

- [ ] **Step 7: Add the locale toggle**

Create `web/components/locale-toggle.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useMessages } from '@/i18n/provider';
import { LOCALES } from '@/i18n/index';

/**
 * Switching locale is a link to the same path under the other prefix. It also
 * writes the `locale` cookie, so an unprefixed entry point — a bookmark to `/`
 * — honours the last choice rather than re-detecting.
 */
export function LocaleToggle() {
  const current = useLocale();
  const messages = useMessages();
  const pathname = usePathname();
  const rest = pathname.replace(/^\/(uk|en)/, '') || '';

  return (
    <div className="flex gap-2" aria-label={messages.nav.language}>
      {LOCALES.map((locale) => (
        <Link
          key={locale}
          href={`/${locale}${rest}`}
          onClick={() => {
            document.cookie = `locale=${locale}; path=/; max-age=31536000; samesite=lax`;
          }}
          aria-current={locale === current ? 'true' : undefined}
          className={`eonyx-label ${locale === current ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {locale.toUpperCase()}
        </Link>
      ))}
    </div>
  );
}
```

In `web/components/nav.tsx`, render `<LocaleToggle />` beside `<ThemeToggle />`, and prefix every `LINKS` href with the active locale from `useLocale()` — an unprefixed `/drafts` would bounce through the proxy on every click.

- [ ] **Step 8: Run the tests and build**

```bash
bun test tests/unit/localeRouting.test.ts
cd web && bun run build
```

Expected: tests pass. The build will report type errors in pages that call `formatDate(x)` with one argument — those are Task 3's work. If it reports anything about a missing root layout or a duplicate `<html>`, stop: the move in Step 5 or the delete in Step 6 is incomplete.

- [ ] **Step 9: Commit**

```bash
git add -A web tests/unit/localeRouting.test.ts
git commit -m "feat: move the dashboard under /[locale] and detect locale in the proxy

app/layout.tsx is deleted and app/[locale]/layout.tsx becomes the root
layout: <html lang> must reflect the locale, and a root layout cannot read a
child segment's params. That leaves nothing outside [locale], so / has no
page — the redirect to /uk happens in the proxy.

The login exemption moves out of the matcher into a readable check. It was a
negative lookahead, and AGENTS.md records that getting that regex wrong
blocked the login page's own CSS.

Both fonts gain the cyrillic subset; without it Ukrainian renders in a
fallback face and the brand typography silently stops applying."
```

---

### Task 3: Replace the literals in shared components

**Files:**
- Modify: `web/components/nav.tsx`, `brief-form.tsx`, `plan-approval.tsx`, `brand-review.tsx`, `publish-button.tsx`, `verdict-badge.tsx`, `stat-tile.tsx`, `activity-log.tsx`, `run-error.tsx`

**Interfaces:**
- Consumes: `useMessages()`, `useLocale()` (Task 1); `formatDate(iso, locale)`, `formatUsd(value, locale)`, `formatClock(ts, locale)` (Task 1).
- Produces: nothing new.

- [ ] **Step 1: Convert each component**

Every one of these is already a Client Component or can read from context. The pattern is identical throughout:

```tsx
const m = useMessages();
const locale = useLocale();
// ...
<Button>{m.common.approve}</Button>
<span>{formatUsd(draft.cost_usd, locale)}</span>
```

Work through them in this order, so the smallest and most-reused come first: `verdict-badge`, `stat-tile`, `publish-button`, `run-error`, `activity-log`, `nav`, `brief-form`, `plan-approval`, `brand-review`.

Two require care rather than substitution:

`plan-approval.tsx` renders the conflict line. Use the function form so word order is the translator's to choose:

```tsx
{m.run.conflictLine({ brief: conflict.brief_value, corpus: conflict.corpus_value })}
```

`brand-review.tsx` renders counts in its heading:

```tsx
{m.brands.reviewTitle({ name: profile.name })}
{m.brands.reviewMeta({ language: styleGuide.language, exemplars: exemplarCount })}
```

- [ ] **Step 2: Build**

Run: `cd web && bun run build`
Expected: fewer type errors than before — remaining ones are in pages, fixed in Task 4.

- [ ] **Step 3: Commit**

```bash
git add web/components
git commit -m "refactor: read shared component copy from the message catalogue"
```

---

### Task 4: Replace the literals in pages

**Files:**
- Modify: `web/app/[locale]/(dashboard)/page.tsx`, `run/page.tsx`, `brands/page.tsx`, `brands/new/page.tsx`, `brands/[id]/page.tsx`, `drafts/page.tsx`, `drafts/[id]/page.tsx`, `web/app/[locale]/login/page.tsx`

**Interfaces:**
- Consumes: `getMessages`, `isLocale` (Task 1); the formatters' locale argument.
- Produces: nothing new.

- [ ] **Step 1: Convert the Server Components**

The five Server Components take the locale from `params` — which is a Promise in Next 16 — and read messages directly rather than through context:

```tsx
export default async function DraftsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const m = getMessages(locale);
  const [drafts, brands] = await Promise.all([fetchDrafts(), fetchBrands()]);
  // ...
  <th className="eonyx-label p-3 font-normal">{m.common.topic}</th>
  <td className="p-3">{formatDate(draft.created_at, locale)}</td>
```

`brands/[id]/page.tsx` already destructures `params` for `id`; it gains `locale` from the same object.

The provenance count is the one plural in the app. Use the two written-out forms rather than a rule:

```tsx
{rawPages.length}{' '}
{rawPages.length === 1 ? m.brands.provenanceOne : m.brands.provenanceMany}
```

- [ ] **Step 2: Convert the Client Components**

`run/page.tsx` and `brands/new/page.tsx` are Client Components and read from context, not `params`:

```tsx
const m = useMessages();
const locale = useLocale();
```

Their `fetch` calls are unaffected — `/api/*` is not locale-prefixed, and the rewrite in `next.config.ts` stays exactly as it is.

- [ ] **Step 3: Convert the login page**

`login/page.tsx` sits outside the nav shell but inside `[locale]`, so context is available. On success it must redirect to the locale-prefixed dashboard: `router.push(`/${locale}`)`.

- [ ] **Step 4: Build and walk both locales**

```bash
cd web && bun run build
cd .. && bun run dev:all
```

Visit `/`, confirm it lands on `/uk`. Walk the dashboard, run, brands and drafts screens in both locales, and confirm no English fragment remains at `/uk/*`. Check that `/uk/login` renders **with styling** while signed out — that is the failure mode the matcher change risks.

- [ ] **Step 5: Commit**

```bash
git add web/app
git commit -m "refactor: read page copy from the message catalogue

Server Components take the locale from params — a Promise in Next 16 — and
read messages directly; the two Client Component pages read from context.
The provenance count uses two written-out forms rather than a plural rule."
```

---

### Task 5: API error codes

**Files:**
- Modify: `src/server.ts`, `web/lib/errors.ts`
- Test: `tests/unit/server.test.ts`, `tests/unit/errorMessages.test.ts`

**Interfaces:**
- Consumes: `Messages` (Task 1).
- Produces: `{ error: <code>, message: <English prose> }` on every non-validation error response; `errorMessage(res, fallback, messages)` in the dashboard.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/errorMessages.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import en from '../../web/i18n/messages/en';
import uk from '../../web/i18n/messages/uk';
import { messageForCode } from '../../web/lib/errors';

describe('messageForCode', () => {
  test('maps a known code to the active locale', () => {
    expect(messageForCode('brand_not_found', uk)).toBe(uk.errors.brandNotFound);
    expect(messageForCode('brand_not_found', en)).toBe(en.errors.brandNotFound);
  });

  test('an unknown code falls through so the caller can use the server prose', () => {
    expect(messageForCode('some_future_code', uk)).toBeNull();
  });

  test('every code the server can return is mapped', () => {
    // Adding a code to the API without a translation is the failure this
    // catches — it would otherwise surface as English in a Ukrainian view.
    for (const code of [
      'unauthorized',
      'password_required',
      'invalid_password',
      'brand_not_found',
      'brand_inactive',
      'brand_has_no_sources',
      'brand_paste_only',
      'brand_is_default',
      'draft_not_found',
      'run_not_found',
      'run_not_awaiting',
      'notion_not_configured',
      'publish_failed',
    ]) {
      expect(messageForCode(code, uk)).not.toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/unit/errorMessages.test.ts`
Expected: FAIL — `messageForCode` is not exported.

- [ ] **Step 3: Convert the server**

In `src/server.ts`, change every `c.json({ error: '<prose>' }, status)` to carry a code and keep the prose. The `error: parsed.error.issues` sites are **left alone** — Zod validation output is structured and developer-facing.

| Line | Code | Keeps message |
|---|---|---|
| 79 | `password_required` | `password required` |
| 80 | `invalid_password` | `invalid password` |
| 95, 101 | `unauthorized` | `unauthorized` |
| 141 | `brand_inactive` | `unknown or inactive brand` |
| 160, 176, 300, 330 | `brand_not_found` | `brand not found` |
| 188, 209 | `run_not_found` | `run not found` |
| 201 | `run_not_awaiting` | `run not found or not awaiting approval` (keeps `status`) |
| 348, 354 | `draft_not_found` | `draft not found` |
| ~365 | `notion_not_configured` | the existing Notion sentence |
| ~374 | `publish_failed` | the caught error's text |

Plus the two added during review: `brand_has_no_sources` and `brand_paste_only` on `/brands/:id/reingest`, and `brand_is_default` on `DELETE /brands/:id`.

Example:

```ts
if (!brand) return c.json({ error: 'brand_not_found', message: 'brand not found' }, 404);
```

`message` stays because this project treats a curl-able API as a feature; returning only `brand_not_found` would take that away.

- [ ] **Step 4: Rewrite the dashboard mapper**

Replace `web/lib/errors.ts`:

```ts
import type { Messages } from '@/i18n/index';

/**
 * API error codes to catalogue keys. The API sends a stable code and English
 * prose; the dashboard translates the code and falls back to the prose, so a
 * code added on the server without a translation degrades to readable English
 * rather than to nothing.
 */
const CODES: Record<string, (m: Messages) => string> = {
  unauthorized: (m) => m.errors.unauthorized,
  password_required: (m) => m.errors.passwordRequired,
  invalid_password: (m) => m.errors.invalidPassword,
  brand_not_found: (m) => m.errors.brandNotFound,
  brand_inactive: (m) => m.errors.brandInactive,
  brand_has_no_sources: (m) => m.errors.brandHasNoSources,
  brand_paste_only: (m) => m.errors.brandPasteOnly,
  brand_is_default: (m) => m.errors.brandIsDefault,
  draft_not_found: (m) => m.errors.draftNotFound,
  run_not_found: (m) => m.errors.runNotFound,
  run_not_awaiting: (m) => m.errors.runNotAwaiting,
  notion_not_configured: (m) => m.errors.notionNotConfigured,
  publish_failed: (m) => m.errors.publishFailed,
};

/** Null when the code is unknown, so the caller can fall back to the server's prose. */
export function messageForCode(code: string, messages: Messages): string | null {
  return CODES[code]?.(messages) ?? null;
}

/**
 * Turn a failed `Response` into something worth showing a user.
 *
 * Client-safe: unlike `lib/api.ts` this imports nothing from `next/headers`, so
 * both Client and Server Components can use it. Every screen that calls
 * `/api/*` should route its failures through here, otherwise status handling
 * (401 in particular) drifts between screens.
 */
export async function errorMessage(
  res: Response,
  fallback: string,
  messages: Messages,
): Promise<string> {
  if (res.status === 401) return messages.errors.sessionExpired;
  const body = (await res.json().catch(() => null)) as
    | { error?: unknown; message?: unknown }
    | null;

  if (typeof body?.error === 'string') {
    const translated = messageForCode(body.error, messages);
    if (translated) return translated;
    // An unmapped code: prefer the server's prose over showing the raw code.
    if (typeof body.message === 'string') return body.message;
  }
  return `${fallback} (HTTP ${res.status})`;
}
```

Update the three call sites of `errorMessage` to pass `useMessages()`.

- [ ] **Step 5: Update the server tests**

`tests/unit/server.test.ts` and `tests/unit/brands.test.ts` assert on `error` strings. Update those assertions to the codes — for example `expect(body.error).toBe('brand_not_found')` — and add one that the prose survives:

```ts
test('an error carries both a code and readable prose', async () => {
  await freshDb();
  const { app } = await import('../../src/server');
  const res = await app.request('/brands/nope');
  expect(res.status).toBe(404);
  const body = (await res.json()) as { error: string; message: string };
  expect(body.error).toBe('brand_not_found');
  expect(body.message).toBe('brand not found');
});
```

- [ ] **Step 6: Run everything**

```bash
bun run typecheck && bunx biome ci . && bun run test:unit
cd web && bun run build
```

- [ ] **Step 7: Commit**

```bash
git add src tests web/lib
git commit -m "feat: return API errors as codes and translate them in the dashboard

The API sent English prose in its error field and the dashboard rendered it
verbatim, so a dozen backend strings were user-facing copy in one language.
Errors now carry a stable code plus the prose: the dashboard translates the
code, and an unmapped code degrades to the server's English rather than to
nothing. The prose stays because a curl-able API is a feature here.

Zod validation responses are untouched — they are structured and
developer-facing rather than user-facing."
```

---

## Verification before handoff

Walk both locales end to end with `bun run dev:all`:

- `/` lands on `/uk`; the toggle switches to `/en` on the same path and back
- No English fragment anywhere under `/uk/*`, including an errored run and an expired session
- `/uk/login` renders **with styling** while signed out — the matcher change is what risks this
- Dates and costs format per locale
- Deleting a key from `uk.ts` fails `cd web && bun run build`

## Out of scope

- **A third locale.** The shape admits one; nothing is built for many.
- **Translating the CLI, `scripts/*` or log output.** Operator-facing, English.
- **`/spike`.** A diagnostic page already due for removal.
- **Brand and draft content.** User data in its own language.
- **Machine translation.** The Ukrainian copy in Task 1 needs a native speaker's read before merge — `typeof en` guarantees no key is missing, and nothing about whether it reads like a product.
