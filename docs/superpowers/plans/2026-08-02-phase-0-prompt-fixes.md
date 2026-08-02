# Phase 0 — Prompt Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the output language explicit rather than inferred, and make brief-versus-corpus conflicts a decision the human takes at plan approval instead of an unactionable Editor complaint.

**Architecture:** Two additions flow through the same seam. `BriefSchema` gains a `language` field that reaches all three prompts as `{{language}}`. `ContentPlanSchema` gains a `conflicts` array the Strategist fills when retrieved brand rules contradict the brief; because `hitl.ts` already puts the whole plan in its interrupt payload, `conflicts` reaches the approval card with no change to the HITL node, and reaches the Editor as "already decided, do not raise".

**Tech Stack:** Bun, TypeScript, Zod 3, LangGraph, Langfuse Prompt Management, Next.js 16, Biome.

## Global Constraints

- Runtime is **Bun**. Use `bun`, `bun test`, `bunx` — never `node`, `npm`, `npx`, `jest`, `vitest`.
- Root quality gates: `bun run typecheck`, `bunx biome ci .`, `bun run test:unit`. The `web/` directory is excluded from both root Biome and root `tsc` — typecheck it with `cd web && bun run build`.
- Biome style: single quotes, 2-space indent, semicolons, organised imports. `bun run check` auto-fixes.
- **The three prompts are Langfuse-managed.** `compileManagedPrompt()` prefers the Langfuse copy over the local fallback, so any prompt edit is inert in a Langfuse-configured environment until `bun run upload-prompts` runs. Task 5 is not optional.
- `{{placeholder}}` interpolation applies to **every** message including the system message — `renderFallback()` maps over all of them — so `{{language}}` works inside the `*_SYSTEM` constants.
- Every placeholder used in a prompt must also be listed in that prompt's `placeholders` array in `MANAGED_PROMPTS`; `scripts/upload-prompts.ts` publishes that array as the prompt's Langfuse `config`.
- **`conflicts` is a required field, not `.default([])`.** OpenAI strict structured output requires every property to be present in the response, so the schema demands the array and the prompt instructs an empty one when there is nothing to report.
- Default language is **`'uk'`**, matching the shipped Ukrainian corpus in `data/brand/`. It is surfaced as a visible control in the UI and a CLI flag, never silently applied.
- Commits: Conventional Commits. Do **not** add a Claude co-author trailer.

---

### Task 1: `language` on the brief, reaching all three prompts

**Files:**
- Modify: `src/schemas.ts` (`BriefSchema`)
- Modify: `src/prompts/managed.ts` (`MANAGED_PROMPTS` placeholders, `strategistVariables`, `writerVariables`, `editorVariables`)
- Modify: `src/prompts/strategist.ts`, `src/prompts/writer.ts`, `src/prompts/editor.ts`
- Modify: `src/cli.ts` (`ArgsSchema`, `USAGE`, brief construction)
- Test: `tests/unit/promptVariables.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Brief.language: string`; `strategistVariables(brief, feedback?)`, `writerVariables(plan, brief, prior?)` and `editorVariables(plan, brief, draftContent, brandStyle)` each return a `language` key. Task 2 extends `editorVariables`; Task 3 sends `language` from the web form.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/promptVariables.test.ts`. The existing `brief` fixture at the top of that file needs `language` added too, or it will not typecheck:

```ts
const brief: Brief = {
  topic: 'AI assistants for SMBs',
  target_audience: 'SMB owners',
  channel: 'linkedin',
  tone: 'professional',
  word_count: 900,
  language: 'uk',
};
```

Then add these cases:

```ts
describe('language', () => {
  test('strategistVariables passes the brief language through', () => {
    const vars = strategistVariables(brief, null);
    expect(vars.language).toBe('uk');
  });

  test('writerVariables passes the brief language through', () => {
    const vars = writerVariables(plan, brief, null);
    expect(vars.language).toBe('uk');
  });

  test('editorVariables passes the brief language through', () => {
    const vars = editorVariables(plan, brief, 'five words of draft content', 'BRAND RULES');
    expect(vars.language).toBe('uk');
  });

  test('BriefSchema defaults language to uk when omitted', () => {
    const parsed = BriefSchema.parse({
      topic: 'T',
      target_audience: 'A',
      channel: 'blog',
      tone: 'professional',
      word_count: 500,
    });
    expect(parsed.language).toBe('uk');
  });

  test('BriefSchema keeps an explicit language', () => {
    const parsed = BriefSchema.parse({
      topic: 'T',
      target_audience: 'A',
      channel: 'blog',
      tone: 'professional',
      word_count: 500,
      language: 'en',
    });
    expect(parsed.language).toBe('en');
  });
});
```

Update the imports at the top of the file to bring in `strategistVariables` and `BriefSchema`:

```ts
import {
  editorVariables,
  strategistVariables,
  writerVariables,
} from '../../src/prompts/managed';
import { type Brief, BriefSchema, type ContentPlan } from '../../src/schemas';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/unit/promptVariables.test.ts`
Expected: FAIL — TypeScript rejects `language` on the `Brief` fixture, and `vars.language` is `undefined`.

- [ ] **Step 3: Add `language` to `BriefSchema`**

In `src/schemas.ts`, append to `BriefSchema` after `word_count`:

```ts
  language: z
    .string()
    .min(2)
    .default('uk')
    .describe(
      "BCP-47 tag for the language the content must be written in, e.g. 'uk' or 'en'. Defaults to the shipped brand corpus language.",
    ),
```

- [ ] **Step 4: Thread `language` through the prompt variables**

In `src/prompts/managed.ts`, add `'language'` to the `placeholders` array of all three entries in `MANAGED_PROMPTS`.

Widen the `strategistVariables` brief parameter type and return the key:

```ts
export function strategistVariables(
  brief: {
    topic: string;
    target_audience: string;
    channel: string;
    tone: string;
    word_count: number;
    language: string;
  },
  feedback?: string | null,
): Record<string, string> {
  return {
    topic: brief.topic,
    target_audience: brief.target_audience,
    channel: brief.channel,
    tone: brief.tone,
    word_count: String(brief.word_count),
    language: brief.language,
    revision_feedback: feedback ? `--- REVISION FEEDBACK (mandatory) ---\n${feedback}` : '',
  };
}
```

In `writerVariables`, add `language: brief.language,` alongside `channel`. In `editorVariables`, add `language: brief.language,` alongside `channel`.

- [ ] **Step 5: Add the language rule to the three system prompts**

`src/prompts/strategist.ts` — add as rule 7, before the closing paragraph:

```
7. Write every field of the ContentPlan in {{language}}. The outline, keywords and key_messages are followed literally by the Writer, so a plan in the wrong language produces a draft in the wrong language.
```

`src/prompts/writer.ts` — add as rule 7, before the revision-mode paragraph:

```
7. Write the entire piece in {{language}}. Headings, body copy, calls to action and hashtags all use that language. Never mix languages within one draft.
```

`src/prompts/editor.ts` — add to the verdict rules list:

```
- The draft must be written in {{language}} throughout. If it is not, that is a structure issue: name the sections that use the wrong language.
- Write every entry in the issues list in {{language}}, so the Writer receives feedback in the language it must write in.
```

- [ ] **Step 6: Add the `--language` CLI flag**

In `src/cli.ts`, add to `ArgsSchema`:

```ts
  language: z.string().min(2).default('uk'),
```

Add to the `parseArgs` options object:

```ts
      language: { type: 'string' },
```

Add to `USAGE` after the `--word-count` line:

```
  --language    BCP-47 output language, e.g. uk | en (default: uk)
```

Add to the `BriefSchema.parse({...})` call:

```ts
    language: args.language,
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test tests/unit/promptVariables.test.ts`
Expected: PASS — all five new cases green.

- [ ] **Step 8: Run the full gates**

Run: `bun run typecheck && bunx biome ci . && bun run test:unit`
Expected: all pass. If Biome reports formatting, run `bun run check` and re-run.

- [ ] **Step 9: Commit**

```bash
git add src/schemas.ts src/prompts src/cli.ts tests/unit/promptVariables.test.ts
git commit -m "feat: make output language explicit via a {{language}} prompt placeholder

The corpus in data/brand is Ukrainian while the prompts, form defaults and
drafts were English, so the editor scored English copy against Ukrainian
style excerpts. Nothing in any prompt named a language — a live run stayed
Ukrainian only because the model inferred it from the topic.

Add language to BriefSchema (default uk, matching the shipped corpus),
thread it into all three managed prompts, and expose --language on the CLI."
```

---

### Task 2: `conflicts` on the plan, surfaced and then settled

**Files:**
- Modify: `src/schemas.ts` (`ContentPlanSchema`)
- Modify: `src/prompts/managed.ts` (`formatConflicts`, `editorVariables`, editor fallback message, placeholders)
- Modify: `src/prompts/strategist.ts`, `src/prompts/editor.ts`
- Modify: `tests/fixtures/plans.ts`
- Test: `tests/unit/promptVariables.test.ts`

**Interfaces:**
- Consumes: `editorVariables(plan, brief, draftContent, brandStyle)` and the `language` key from Task 1.
- Produces: `ContentPlan.conflicts: Array<{ dimension: string; brief_value: string; corpus_value: string }>`, and an `approved_conflicts` key on `editorVariables`'s return. Task 3 renders `conflicts` in the web UI.

**Note:** `src/nodes/hitl.ts` needs **no change**. It already passes `plan: state.plan` into `interrupt()`, so `conflicts` rides along inside the plan to the approval card. Likewise the Editor reads `state.plan.conflicts` — once HITL has passed, every conflict in the plan is by definition approved, so no new state channel is needed.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/promptVariables.test.ts`. First add `conflicts: []` to the existing `plan` fixture near the top of the file so it typechecks:

```ts
const plan: ContentPlan = {
  outline: ['Intro', 'Problem', 'Solution', 'CTA'],
  keywords: ['ai assistant', 'small business'],
  key_messages: ['AI is accessible'],
  target_audience: 'SMB owners',
  tone: 'professional',
  conflicts: [],
};
```

Then add:

```ts
describe('approved_conflicts', () => {
  test('reads as agreement when the plan records no conflicts', () => {
    const vars = editorVariables(plan, brief, 'draft', 'BRAND RULES');
    expect(vars.approved_conflicts).toBe('None — the brief and the brand corpus agree.');
  });

  test('renders each conflict with the brief value marked authoritative', () => {
    const conflicted: ContentPlan = {
      ...plan,
      conflicts: [
        {
          dimension: 'word_count',
          brief_value: '300',
          corpus_value: '800–1200 for LinkedIn',
        },
      ],
    };
    const vars = editorVariables(conflicted, brief, 'draft', 'BRAND RULES');
    expect(vars.approved_conflicts).toContain('word_count');
    expect(vars.approved_conflicts).toContain('300');
    expect(vars.approved_conflicts).toContain('800–1200 for LinkedIn');
    expect(vars.approved_conflicts).toContain('authoritative');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/unit/promptVariables.test.ts`
Expected: FAIL — TypeScript rejects `conflicts` on `ContentPlan`, and `vars.approved_conflicts` is `undefined`.

- [ ] **Step 3: Add `conflicts` to `ContentPlanSchema`**

In `src/schemas.ts`, append to `ContentPlanSchema` after `tone`:

```ts
  conflicts: z
    .array(
      z.object({
        dimension: z
          .string()
          .describe("Brief field that diverges, e.g. 'word_count' or 'tone'"),
        brief_value: z.string().describe("The brief's value, which is authoritative"),
        corpus_value: z.string().describe('The contradicting rule from the brand corpus'),
      }),
    )
    .describe(
      'Divergences between the brief and the retrieved brand-corpus rules. Return an empty array when there are none.',
    ),
```

- [ ] **Step 4: Add `formatConflicts` and wire it into `editorVariables`**

In `src/prompts/managed.ts`, add next to the existing `formatOutline` helper:

```ts
function formatConflicts(conflicts: ContentPlan['conflicts']): string {
  if (conflicts.length === 0) return 'None — the brief and the brand corpus agree.';
  return conflicts
    .map(
      (c) =>
        `- ${c.dimension}: the brief says "${c.brief_value}" and is authoritative; the brand corpus says "${c.corpus_value}"`,
    )
    .join('\n');
}
```

Add to the object returned by `editorVariables`:

```ts
    approved_conflicts: formatConflicts(plan.conflicts),
```

Add `'approved_conflicts'` to the editor entry's `placeholders` array in `MANAGED_PROMPTS`.

- [ ] **Step 5: Add the section to the editor's user message**

In `MANAGED_PROMPTS.editor.fallback`, insert into the user message content array between the `--- BRAND STYLE ...` block and the `--- DRAFT ---` line:

```ts
          '--- APPROVED DIVERGENCES (already decided by a human — do not raise) ---',
          '{{approved_conflicts}}',
          '',
```

- [ ] **Step 6: Add the precedence rules to the strategist and editor prompts**

`src/prompts/strategist.ts` — add as rule 8:

```
8. The brief's topic, channel, tone, target_audience and word_count are authoritative and override any contradicting rule returned by brand_style_lookup. When the brand corpus contradicts one of them — for example a channel word-count range that excludes the brief's target — keep the brief's value and record the divergence in `conflicts`. Never silently adopt the corpus value, and never leave a contradiction unrecorded. Return an empty `conflicts` array when the brief and the corpus agree.
```

`src/prompts/editor.ts` — add to the verdict rules list:

```
- Anything listed under APPROVED DIVERGENCES has already been decided by a human who saw both values. Never raise it as an issue, and never ask which of the two applies — judge the draft against the brief's value.
```

- [ ] **Step 7: Update the writer fixture plan**

In `tests/fixtures/plans.ts`, add to `writerFixturePlan` after `tone`:

```ts
  conflicts: [],
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test tests/unit/promptVariables.test.ts`
Expected: PASS — both new cases green.

- [ ] **Step 9: Run the full gates**

Run: `bun run typecheck && bunx biome ci . && bun run test:unit`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add src/schemas.ts src/prompts tests/fixtures/plans.ts tests/unit/promptVariables.test.ts
git commit -m "feat: record brief-versus-corpus conflicts on the plan

A live run asked for a 300-word LinkedIn post while data/brand/brand.md
states 800-1200 words for that channel. The editor noticed, refused to
resolve it, and emitted an issue the writer cannot act on.

The brief now governs the fields it names; the corpus governs the rest.
The strategist records divergences in ContentPlan.conflicts, which reaches
the approval card inside the existing interrupt payload, and reaches the
editor as APPROVED DIVERGENCES it is forbidden to raise."
```

---

### Task 3: Surface language and conflicts in the dashboard

**Files:**
- Modify: `web/lib/types.ts` (`ContentPlan`)
- Modify: `web/components/plan-approval.tsx`
- Modify: `web/app/(dashboard)/run/page.tsx` (form field, POST body, defaults)

**Interfaces:**
- Consumes: `ContentPlan.conflicts` from Task 2; the `language` field on the run payload from Task 1.
- Produces: no downstream consumers — this is the last code task.

- [ ] **Step 1: Extend the web `ContentPlan` type**

There is no shared type across the Hono/Next boundary, so this is a manual mirror of `src/schemas.ts`. In `web/lib/types.ts`, add to the `ContentPlan` type:

```ts
  conflicts?: Array<{ dimension: string; brief_value: string; corpus_value: string }>;
```

Optional here even though `src/schemas.ts` makes it required: the server replays a run's full event history on every SSE reconnect, so a run that started before this deploy delivers a plan with no `conflicts` key. The optional type is what makes the guard in Step 2 honest rather than redundant.

- [ ] **Step 2: Render conflicts on the approval card**

In `web/components/plan-approval.tsx`, insert directly above the `<textarea>`:

```tsx
        {plan.conflicts?.length ? (
          <div className="space-y-1 border-l-2 border-brand pl-3">
            <p className="eonyx-label">Brief overrides brand guide</p>
            {plan.conflicts.map((conflict) => (
              <p key={conflict.dimension} className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{conflict.dimension}</span> — brief:{' '}
                {conflict.brief_value} · brand guide: {conflict.corpus_value}
              </p>
            ))}
            <p className="text-xs text-muted-foreground">
              Approving keeps the brief's values.
            </p>
          </div>
        ) : null}
```

The optional chain on `plan.conflicts` matters: a run started before this deploy, replayed from the server's event history, has no `conflicts` key.

- [ ] **Step 3: Add the language control and align the form defaults**

In `web/app/(dashboard)/run/page.tsx`, add above the `CHANNELS` constant:

```tsx
const LANGUAGES = [
  { value: 'uk', label: 'Українська' },
  { value: 'en', label: 'English' },
];
```

Add a new labelled field inside the form, after the word-count field:

```tsx
            <label className="flex flex-col gap-1 text-sm">
              Language
              <select name="language" className="rounded-md border bg-transparent px-3 py-2">
                {LANGUAGES.map((language) => (
                  <option key={language.value} value={language.value}>
                    {language.label}
                  </option>
                ))}
              </select>
            </label>
```

Add `language` to the POST body in `start()`:

```tsx
        language: formData.get('language'),
```

Change the three English `defaultValue`s so the shipped form matches the Ukrainian corpus:

```tsx
defaultValue="Як LLM-асистент замінив менеджера підтримки"   // topic
defaultValue="доступний"                                      // tone
defaultValue="власники малого бізнесу"                        // audience
```

- [ ] **Step 4: Typecheck the web app**

Run: `cd web && bun run build`
Expected: build succeeds with no type errors. (`bun run typecheck` at the root does **not** cover `web/`.)

- [ ] **Step 5: Commit**

```bash
git add web/lib/types.ts web/components/plan-approval.tsx "web/app/(dashboard)/run/page.tsx"
git commit -m "feat: show language picker and brief-vs-brand conflicts on the run screen

The approval card now lists any divergence the strategist recorded, so the
human approving the plan sees both values before deciding. Form defaults
switch to Ukrainian to match the shipped brand corpus."
```

---

### Task 4: Publish the prompts and verify live

Prompt edits are inert until uploaded — `compileManagedPrompt()` prefers the Langfuse copy whenever `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set.

**Files:**
- Modify: `README.md`, `CLAUDE.md`
- No source changes.

**Interfaces:**
- Consumes: the prompt text from Tasks 1 and 2.
- Produces: nothing consumed by code.

- [ ] **Step 1: Upload the prompts**

Run: `bun run upload-prompts`
Expected: three lines reading `uploaded v<N>` for `content-creator-agent/strategist`, `/writer` and `/editor`. A line reading `unchanged` for any of the three means that prompt's local text was not actually edited — go back and check Tasks 1 and 2 before continuing.

- [ ] **Step 2: Run a live Ukrainian brief end to end**

Chroma must be running (`docker start chroma`). Drive the API rather than the CLI — the CLI's readline gate cannot be fed reliably from a pipe.

```bash
SKIP_PUBLISH=true MAX_ITERATIONS=2 MAX_SEARCHES=2 \
  DRAFTS_DB_PATH=/tmp/phase0-verify.db bun run src/server.ts &
sleep 3
TID=$(curl -s -X POST localhost:3000/runs -H 'content-type: application/json' \
  -d '{"topic":"Як LLM-асистент замінив менеджера підтримки","channel":"linkedin","tone":"доступний","target_audience":"власники малого бізнесу","word_count":300,"language":"uk"}' \
  | bun -e 'console.log(JSON.parse(await Bun.stdin.text()).thread_id)')
echo "thread=$TID"
```

Poll `curl -s localhost:3000/runs/$TID` until `"status":"awaiting_approval"`, inspect the plan's `conflicts` in the event payload, then approve:

```bash
curl -s -X POST localhost:3000/runs/$TID/resume -H 'content-type: application/json' -d '{"approved":true}'
```

Expected: the plan records a `word_count` conflict (the brief's 300 against the corpus's 800–1200 for LinkedIn), and the finished draft plus every Editor issue are in Ukrainian. Stop the server with `lsof -ti:3000 | xargs kill` when done.

- [ ] **Step 3: Confirm the Editor no longer raises the settled conflict**

Read the saved row:

```bash
bun -e "const {Database}=require('bun:sqlite');
const db=new Database('/tmp/phase0-verify.db');
const r=db.query('select verdict,issues from drafts order by created_at desc limit 1').get();
console.log(r.verdict); for(const i of JSON.parse(r.issues)) console.log('-',i);"
```

Expected: no issue asks which word count applies. The verdict may still be `REVISION_NEEDED` — the verdict-derivation bug is explicitly out of scope for this phase (spec §2), so do not chase it here.

- [ ] **Step 4: Document both changes**

In `README.md`, add `--language` to the CLI options table:

```
| `--language` | BCP-47 tag, e.g. `uk` / `en` (default `uk`) | no |
```

Add to the `ContentPlan` line in the structured-output contracts block:

```
ContentPlan   { outline, keywords, key_messages, target_audience, tone, conflicts }
```

In `CLAUDE.md`, add to the "Prompts have two sources" section:

> Prompts carry a `{{language}}` placeholder fed from `Brief.language` (default `uk`, matching the shipped corpus). The brief's `topic`, `channel`, `tone`, `target_audience` and `word_count` override any contradicting brand-corpus rule; the Strategist records each divergence in `ContentPlan.conflicts`, the approval card shows it, and the Editor is forbidden to raise it. Editing any of this means re-running `bun run upload-prompts`.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document the language placeholder and brief-vs-corpus precedence"
```

---

## Out of scope for this phase

Named here so no task drifts into them:

- **Deriving the Editor's verdict from its three scores.** A run scoring 0.95 / 0.90 / 0.90 returns `REVISION_NEEDED` against the prompt's own "all three ≥ 0.8, no exceptions" rule. Tracked separately (spec §2).
- **Per-brand language.** Phase 2 moves the source of `language` from the brief to the `Brand` row; the brief field then becomes an override. Do not build the brand plumbing here.
- **Prisma, brand models, ingestion.** Phases 1–3.
