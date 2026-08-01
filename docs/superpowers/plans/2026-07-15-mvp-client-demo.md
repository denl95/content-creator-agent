# MVP Client-Demo Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `content-creator-agent` demo-ready for prospective agency clients: fix the correctness bugs (F1–F8), add cost tracking (F12), persist drafts to SQLite with Notion as an optional destination (F16), and expose the pipeline through an HTTP API (F10) and a minimal web UI (F11).

**Architecture:** The existing LangGraph pipeline (Strategist → HITL → Writer ↔ Editor → Finalizer → Publisher) is unchanged. We fix prompt/data-flow bugs, add a `CostTracker` callback, replace `./output/` files with a `bun:sqlite` drafts table, then wrap the compiled graph in a Hono HTTP server with SSE progress events and a single static HTML page.

**Tech Stack:** Bun, TypeScript, LangGraph/LangChain 1.x, Zod, `bun:sqlite` (built-in), Hono (only new dependency), Langfuse, Chroma, Notion MCP.

**Spec:** `docs/superpowers/specs/2026-07-15-mvp-client-demo-design.md`

## Global Constraints

- Runtime is **Bun** (`bun`, `bun test`, `bun add`) — never npm/node/vite (see `.cursor/rules/`).
- Code style is enforced by Biome: single quotes, 2-space indent, semicolons. Run `bun run check` before each commit.
- The only new dependency allowed is `hono`. Drafts DB uses built-in `bun:sqlite`.
- All new config is env-driven with sane defaults: `DRAFTS_DB_PATH` (default `data/app.db`), `WRITE_OUTPUT_FILES` (default off), `PRICE_INPUT_PER_1M` (default `0.15`), `PRICE_OUTPUT_PER_1M` (default `0.60`), `MAX_RUN_TOKENS` (default `0` = unlimited), `LLM_TIMEOUT_MS` (default `120000`), `PORT` (default `3000`).
- Unit tests live in `tests/unit/` and must never call an LLM or external service (judge tests in `tests/judge/` stay LLM-based and are NOT run in CI).
- After any change to `src/prompts/*.ts` fallback text: if `LANGFUSE_SECRET_KEY` is set locally, run `bun run upload-prompts` so the Langfuse-managed copies match; if unset, skip (fallbacks are used at runtime).
- Commit messages: conventional style (`fix:`, `feat:`, `chore:`), **no Co-Authored-By lines** (user preference).
- Decision note: the checkpointer stays `MemorySaver` for this MVP. `@langchain/langgraph-checkpoint-sqlite` depends on `better-sqlite3` (native module, unreliable under Bun) and restart-survival is not demo-critical. Revisit in the production plan.

---

### Task 1: Fix the brand identity mismatch (F1)

The agents' system prompts and the judge tests describe EONYX as *"a B2B SaaS product for SMB accounting automation"*, but `data/brand/brand.md` defines EONYX as an **AI development agency building custom LLM apps for small businesses**. Fix every occurrence.

**Files:**
- Modify: `src/prompts/strategist.ts:2`
- Modify: `src/prompts/writer.ts:4`
- Modify: `src/prompts/editor.ts:4`
- Modify: `tests/judge/e2e.test.ts:20`, `tests/judge/writer.test.ts:13`, `tests/judge/strategist.test.ts:19`
- Modify: `tests/fixtures/briefs.ts` (accounting-themed topics), `tests/fixtures/plans.ts:14`

**Interfaces:**
- Consumes: nothing.
- Produces: no API changes — text only. Canonical identity line used everywhere: `EONYX, an AI development agency that builds custom LLM applications for small businesses`.

- [ ] **Step 1: Update the three system prompts**

In each of `src/prompts/strategist.ts`, `src/prompts/writer.ts`, `src/prompts/editor.ts`, replace the opening line's `for EONYX, a B2B SaaS product for SMB accounting automation.` with:

```
for EONYX, an AI development agency that builds custom LLM applications for small businesses.
```

(Keep the role prefix: "senior content strategist" / "expert content writer" / "rigorous content editor".)

- [ ] **Step 2: Update the judge-test system prompts**

Same replacement in the `JUDGE_SYSTEM` strings of `tests/judge/e2e.test.ts`, `tests/judge/writer.test.ts`, `tests/judge/strategist.test.ts` — replace `EONYX, a B2B SaaS accounting product` with `EONYX, an AI development agency that builds custom LLM applications for small businesses`.

- [ ] **Step 3: Re-theme accounting fixtures**

In `tests/fixtures/briefs.ts` replace the three accounting-themed briefs (keep `e2eBrief` — it is already AI-themed):

```ts
export const linkedinBrief: Brief = {
  topic: '5 signs your business is ready for an AI assistant',
  target_audience: 'SMB owners with 1–20 employees',
  channel: 'linkedin',
  tone: 'professional',
  word_count: 900,
};

export const blogBrief: Brief = {
  topic: 'How to automate customer onboarding with an LLM without writing code',
  target_audience: 'Operations managers at small businesses',
  channel: 'blog',
  tone: 'professional',
  word_count: 1800,
};

export const twitterBrief: Brief = {
  topic: 'The real cost of answering the same customer question 50 times a week',
  target_audience: 'SMB founders',
  channel: 'twitter',
  tone: 'casual',
  word_count: 300,
};
```

In `tests/fixtures/plans.ts` replace the keyword `'SMB accounting'` with `'AI assistant for small business'` (adjust surrounding keywords in that fixture to the AI-agency theme if they are accounting-specific — read the file first).

- [ ] **Step 4: Verify no stale references remain**

Run: `grep -rn "accounting\|B2B SaaS" src/ tests/ --include='*.ts'`
Expected: no matches (the `bad-draft.md` fixture mention of accounting errors is fine — it is deliberately bad content — but `.ts` files must be clean).

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 5: Sync Langfuse prompts (if configured)**

Run: `bun run upload-prompts` (skip if `LANGFUSE_SECRET_KEY` unset).
Expected: three prompt versions written.

- [ ] **Step 6: Commit**

```bash
git add src/prompts tests
git commit -m "fix: align brand identity with AI-agency corpus in prompts, judge tests, fixtures"
```

---

### Task 2: Computed word count (F3)

`DraftContent.word_count` is self-reported by the LLM and flows into the CLI display and Notion. Compute it from the content instead.

**Files:**
- Create: `src/utils/text.ts`
- Create: `tests/unit/text.test.ts`
- Modify: `src/nodes/writer.ts` (override `word_count` on the returned draft)

**Interfaces:**
- Consumes: nothing.
- Produces: `countWords(text: string): number` from `src/utils/text.ts` — used later by Task 3 (`editorVariables`) and indirectly by Task 8 (DB rows get the computed value via the draft).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/text.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { countWords } from '../../src/utils/text';

describe('countWords', () => {
  test('counts whitespace-separated words', () => {
    expect(countWords('one two  three\nfour')).toBe(4);
  });

  test('handles markdown and unicode', () => {
    expect(countWords('# Заголовок\n\n**жирний** текст')).toBe(3);
  });

  test('returns 0 for empty or whitespace-only input', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n ')).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/text.test.ts`
Expected: FAIL — `Cannot find module '../../src/utils/text'`.

- [ ] **Step 3: Implement `countWords`**

Create `src/utils/text.ts`:

```ts
/** Counts whitespace-separated tokens, ignoring pure-markup tokens like "#". */
export function countWords(text: string): number {
  return text
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}
```

Note: the second test expects `3` because `#` alone is not a word — the `[\p{L}\p{N}]` filter drops it.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/text.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Override the LLM-reported word count in the writer node**

In `src/nodes/writer.ts`, add the import and change the return statement:

```ts
import { countWords } from '../utils/text';
```

```ts
  return {
    draft: {
      ...result.structuredResponse,
      word_count: countWords(result.structuredResponse.content),
    },
    iteration,
  };
```

- [ ] **Step 6: Verify and commit**

Run: `bun run typecheck && bun run check && bun test tests/unit`
Expected: all pass.

```bash
git add src/utils/text.ts src/nodes/writer.ts tests/unit/text.test.ts
git commit -m "fix: compute draft word count from content instead of trusting the LLM"
```

---

### Task 3: Thread word count and channel into Writer and Editor (F2)

The Writer's "±10% of target word count" rule is unenforceable — neither the Writer nor the Editor ever receives `brief.word_count` or `brief.channel`.

**Files:**
- Modify: `src/prompts/managed.ts` (`writerVariables`, `editorVariables`, placeholder lists, fallback templates)
- Modify: `src/prompts/writer.ts` (`WRITER_SYSTEM` channel rule)
- Modify: `src/prompts/editor.ts` (`EDITOR_SYSTEM` length/format verdict rule)
- Modify: `src/nodes/writer.ts`, `src/nodes/editor.ts` (pass `state.brief`)
- Create: `tests/unit/promptVariables.test.ts`

**Interfaces:**
- Consumes: `countWords` from Task 2; `Brief` type from `src/schemas.ts`.
- Produces (used by Task 4 and the nodes):
  - `writerVariables(plan: ContentPlan, brief: Brief, prior?: { draft: DraftContent; feedback: EditFeedback } | null): Record<string, string>`
  - `editorVariables(plan: ContentPlan, brief: Brief, draftContent: string): Record<string, string>` (Task 4 appends a fourth `brandStyle: string` param)
  - New template variables: `channel`, `word_count` (writer + editor), `actual_word_count` (editor).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/promptVariables.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { editorVariables, writerVariables } from '../../src/prompts/managed';
import type { Brief, ContentPlan } from '../../src/schemas';

const brief: Brief = {
  topic: 'AI assistants for SMBs',
  target_audience: 'SMB owners',
  channel: 'linkedin',
  tone: 'professional',
  word_count: 900,
};

const plan: ContentPlan = {
  outline: ['Intro', 'Problem', 'Solution', 'CTA'],
  keywords: ['ai assistant', 'small business'],
  key_messages: ['AI is accessible'],
  target_audience: 'SMB owners',
  tone: 'professional',
};

describe('writerVariables', () => {
  test('includes channel and target word count from the brief', () => {
    const vars = writerVariables(plan, brief, null);
    expect(vars.channel).toBe('linkedin');
    expect(vars.word_count).toBe('900');
  });
});

describe('editorVariables', () => {
  test('includes channel, target and actual word counts', () => {
    const vars = editorVariables(plan, brief, 'five words of draft content');
    expect(vars.channel).toBe('linkedin');
    expect(vars.word_count).toBe('900');
    expect(vars.actual_word_count).toBe('5');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/promptVariables.test.ts`
Expected: FAIL — current `writerVariables(plan, prior)` signature doesn't accept a brief; `vars.channel` is undefined.

- [ ] **Step 3: Update `src/prompts/managed.ts`**

Add imports: `import type { Brief, ... } from '../schemas';` and `import { countWords } from '../utils/text';`.

New signatures and bodies:

```ts
export function writerVariables(
  plan: ContentPlan,
  brief: Brief,
  prior?: { draft: DraftContent; feedback: EditFeedback } | null,
): Record<string, string> {
  return {
    outline: formatOutline(plan.outline),
    keywords: plan.keywords.join(', '),
    key_messages: plan.key_messages.join(' | '),
    target_audience: plan.target_audience,
    tone: plan.tone,
    channel: brief.channel,
    word_count: String(brief.word_count),
    prior_draft: prior ? `--- REVISION MODE ---\nPrevious draft:\n${prior.draft.content}` : '',
    editor_feedback: prior
      ? [
          'Editor issues to address:',
          ...prior.feedback.issues.map((issue) => `- ${issue}`),
          `Scores: tone=${prior.feedback.tone_score}, accuracy=${prior.feedback.accuracy_score}, structure=${prior.feedback.structure_score}`,
        ].join('\n')
      : '',
  };
}

export function editorVariables(
  plan: ContentPlan,
  brief: Brief,
  draftContent: string,
): Record<string, string> {
  return {
    outline: formatOutline(plan.outline),
    tone: plan.tone,
    target_audience: plan.target_audience,
    keywords: plan.keywords.join(', '),
    channel: brief.channel,
    word_count: String(brief.word_count),
    actual_word_count: String(countWords(draftContent)),
    draft_content: draftContent,
  };
}
```

Update the writer spec in `MANAGED_PROMPTS`: add `'channel', 'word_count'` to `placeholders`, and in the fallback user message insert after the `Tone: {{tone}}` line:

```
'Channel: {{channel}}',
'Target word count: {{word_count}} words — stay within ±10%.',
```

Update the editor spec: add `'channel', 'word_count', 'actual_word_count'` to `placeholders`, and in the fallback user message insert after `Keywords required: {{keywords}}`:

```
'Channel: {{channel}}',
'Target word count: {{word_count}} words (the draft below has {{actual_word_count}} words)',
```

- [ ] **Step 4: Update the system prompts**

In `src/prompts/writer.ts` `WRITER_SYSTEM`, replace rule 4 with:

```
4. Stay within ±10% of the target word count given in the brief. Respect the channel's format limits (e.g. a single tweet ≤ 280 characters; Instagram/Threads captions stay short and hook-first).
```

In `src/prompts/editor.ts` `EDITOR_SYSTEM`, add to the "Verdict rules" list:

```
- If the draft deviates more than 15% from the target word count, or violates the channel's format rules, return REVISION_NEEDED with an issue naming the actual and target lengths.
```

- [ ] **Step 5: Pass the brief from the nodes**

`src/nodes/writer.ts`: `writerVariables(state.plan, state.brief, prior)`.
`src/nodes/editor.ts`: `editorVariables(state.plan, state.brief, state.draft.content)` and add a guard above it:

```ts
  if (!state.brief) throw new Error('editor: state.brief is missing');
```

(`writer.ts` gets the same `state.brief` guard after its existing plan guard.)

- [ ] **Step 6: Run tests, sync prompts, commit**

Run: `bun test tests/unit && bun run typecheck && bun run check`
Expected: PASS / exit 0.

Run: `bun run upload-prompts` (if Langfuse configured).

```bash
git add src/prompts src/nodes tests/unit/promptVariables.test.ts
git commit -m "fix: give writer and editor the target word count and channel from the brief"
```

---

### Task 4: Inject brand style into the Editor (F4)

The Editor scores "brand voice" without ever seeing the brand style guide. Retrieve the top brand chunks and inject them into the editor prompt.

**Files:**
- Modify: `src/tools/rag.ts` (extract `lookupBrandStyle`)
- Modify: `src/prompts/managed.ts` (`editorVariables` fourth param, `brand_style` placeholder + fallback block)
- Modify: `src/prompts/editor.ts` (rubric line about the brand-style block)
- Modify: `src/nodes/editor.ts` (retrieve + pass)
- Modify: `tests/unit/promptVariables.test.ts`

**Interfaces:**
- Consumes: `getStore()`/similarity search internals of `src/tools/rag.ts`; `editorVariables` from Task 3.
- Produces:
  - `lookupBrandStyle(query: string): Promise<string>` exported from `src/tools/rag.ts` (joined chunk text, or a "no documents" sentinel string).
  - Final signature `editorVariables(plan: ContentPlan, brief: Brief, draftContent: string, brandStyle: string): Record<string, string>` with new `brand_style` variable.

- [ ] **Step 1: Extend the failing test**

In `tests/unit/promptVariables.test.ts`, update the editor describe block (the fourth argument is now required):

```ts
describe('editorVariables', () => {
  test('includes channel, word counts, and brand style', () => {
    const vars = editorVariables(plan, brief, 'five words of draft content', 'BRAND RULES');
    expect(vars.channel).toBe('linkedin');
    expect(vars.word_count).toBe('900');
    expect(vars.actual_word_count).toBe('5');
    expect(vars.brand_style).toBe('BRAND RULES');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/promptVariables.test.ts`
Expected: FAIL — `brand_style` is undefined.

- [ ] **Step 3: Extract `lookupBrandStyle` in `src/tools/rag.ts`**

Add above the `brandStyleRetriever` definition, and refactor the tool to use it:

```ts
export async function lookupBrandStyle(query: string): Promise<string> {
  const store = await getStore();
  const results = await store.similaritySearch(query, 4);
  if (results.length === 0) return 'No relevant brand style documents found.';
  return results.map((doc) => doc.pageContent).join('\n---\n');
}

export const brandStyleRetriever = tool(
  async ({ query }) => {
    console.log(`[brand_style_lookup] "${query}"`);
    return lookupBrandStyle(query);
  },
  { /* unchanged name/description/schema */ },
);
```

- [ ] **Step 4: Wire into managed prompts and the editor node**

`src/prompts/managed.ts`: add `brandStyle: string` as the fourth parameter of `editorVariables` and `brand_style: brandStyle` to its return object. Add `'brand_style'` to the editor `placeholders`. In the editor fallback user message, insert before the `--- DRAFT ---` block:

```
'--- BRAND STYLE (retrieved from style guide) ---',
'{{brand_style}}',
'',
```

`src/prompts/editor.ts` `EDITOR_SYSTEM`: extend the `tone_score` rubric line ending with:

```
Judge tone against the BRAND STYLE excerpts provided in the user message, not against generic assumptions.
```

`src/nodes/editor.ts`:

```ts
import { lookupBrandStyle } from '../tools/rag';
```

```ts
  const brandStyle = await lookupBrandStyle(
    `${state.brief.channel} tone of voice rules, forbidden phrases, style guide`,
  );
  const prompt = await compileManagedPrompt(
    'editor',
    editorVariables(state.plan, state.brief, state.draft.content, brandStyle),
  );
```

(One retrieval per editor iteration is acceptable — it's a single embedding call against local Chroma; deviation from the spec's "once per run" noted deliberately for simplicity.)

- [ ] **Step 5: Run tests, sync prompts, commit**

Run: `bun test tests/unit && bun run typecheck && bun run check`
Expected: PASS.

Run: `bun run upload-prompts` (if Langfuse configured).

```bash
git add src/tools/rag.ts src/prompts src/nodes/editor.ts tests/unit/promptVariables.test.ts
git commit -m "fix: editor judges brand voice against retrieved style-guide excerpts"
```

---

### Task 5: Strict HITL input and LLM timeouts (F6, F7)

Any CLI answer other than `r`/`q` currently approves the plan; and a hung LLM call blocks a run forever.

**Files:**
- Modify: `src/cli.ts` (the `[a]pprove` prompt, ~line 182)
- Modify: `src/model.ts`, `src/nodes/editor.ts` (timeouts)

**Interfaces:**
- Consumes: nothing.
- Produces: no API changes. New env var `LLM_TIMEOUT_MS` (default `120000`).

- [ ] **Step 1: Re-prompt until a valid answer**

In `src/cli.ts`, replace the single `rl.question('[a]pprove, ...')` line with:

```ts
      let answer = '';
      while (!['a', 'r', 'q'].includes(answer)) {
        answer = (await rl.question('[a]pprove, [r]evise, [q]uit? ')).trim().toLowerCase();
      }
```

(The `if (answer === 'q')` / `if (answer === 'r')` / else-approve logic below stays as is — `else` is now guaranteed to be `'a'`.)

- [ ] **Step 2: Add timeouts to both ChatOpenAI instances**

`src/model.ts`:

```ts
import { ChatOpenAI } from '@langchain/openai';

export const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 120_000);

export const model = new ChatOpenAI({
  model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  timeout: LLM_TIMEOUT_MS,
});
```

`src/nodes/editor.ts` — import `LLM_TIMEOUT_MS` from `../model` and add `timeout: LLM_TIMEOUT_MS` to the `editorLLM` constructor options.

- [ ] **Step 3: Verify and commit**

Run: `bun run typecheck && bun run check`
Expected: exit 0. Manual check: `bun run start -- --topic test --channel blog --tone x --audience y --word-count 100` and type `x` at the gate → it re-prompts (then `q` to quit; requires keys — skip if unavailable and rely on typecheck).

```bash
git add src/cli.ts src/model.ts src/nodes/editor.ts
git commit -m "fix: re-prompt on invalid HITL input; add LLM call timeouts"
```

---

### Task 6: Remove dead code (F8)

**Files:**
- Modify: `src/prompts/strategist.ts`, `src/prompts/writer.ts`, `src/prompts/editor.ts` (delete unused `build*Message` functions and now-unneeded type imports)
- Delete: `src/tools/saveContent.ts`
- Modify: `src/tools/index.ts` (remove the `saveContent` export)

**Interfaces:**
- Consumes: nothing. Produces: nothing — deletions only. `MANAGED_PROMPTS` fallbacks in `managed.ts` replaced these builders.

- [ ] **Step 1: Verify the functions are unreferenced**

Run: `grep -rn "buildStrategistMessage\|buildWriterMessage\|buildEditorMessage\|saveContent\|save_content" src/ tests/ scripts/ index.ts`
Expected: matches only inside the defining files and `src/tools/index.ts`.

- [ ] **Step 2: Delete**

Remove `buildStrategistMessage`, `buildWriterMessage`, `buildEditorMessage` (and their now-unused imports) from the three prompt files; delete `src/tools/saveContent.ts`; remove its line from `src/tools/index.ts`.

- [ ] **Step 3: Verify and commit**

Run: `bun run typecheck && bun run check && bun test tests/unit`
Expected: all pass.

```bash
git add -A src/prompts src/tools
git commit -m "chore: remove dead prompt builders and unused save_content tool"
```

---

### Task 7: Cost and token tracking (F12)

**Files:**
- Create: `src/costTracker.ts`
- Create: `tests/unit/costTracker.test.ts`
- Modify: `src/cli.ts` (attach tracker, budget guard, summary line)

**Interfaces:**
- Consumes: `@langchain/core` callback base class.
- Produces (used by Tasks 8, 10):

```ts
class CostTracker extends BaseCallbackHandler {
  name: string;              // 'cost_tracker'
  inputTokens: number;
  outputTokens: number;
  totalTokens(): number;
  costUsd(): number;         // (in*PRICE_INPUT_PER_1M + out*PRICE_OUTPUT_PER_1M) / 1e6
  overBudget(): boolean;     // true when MAX_RUN_TOKENS > 0 and exceeded
}
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/costTracker.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import type { LLMResult } from '@langchain/core/outputs';
import { CostTracker } from '../../src/costTracker';

function fakeResult(promptTokens: number, completionTokens: number): LLMResult {
  return {
    generations: [],
    llmOutput: { tokenUsage: { promptTokens, completionTokens } },
  };
}

describe('CostTracker', () => {
  test('accumulates token usage across calls', () => {
    const tracker = new CostTracker();
    tracker.handleLLMEnd(fakeResult(1000, 500));
    tracker.handleLLMEnd(fakeResult(200, 100));
    expect(tracker.inputTokens).toBe(1200);
    expect(tracker.outputTokens).toBe(600);
    expect(tracker.totalTokens()).toBe(1800);
  });

  test('computes cost from default gpt-4o-mini pricing', () => {
    const tracker = new CostTracker();
    tracker.handleLLMEnd(fakeResult(1_000_000, 1_000_000));
    expect(tracker.costUsd()).toBeCloseTo(0.15 + 0.6, 5);
  });

  test('falls back to usage_metadata on generation messages', () => {
    const tracker = new CostTracker();
    tracker.handleLLMEnd({
      generations: [
        [{ text: '', message: { usage_metadata: { input_tokens: 10, output_tokens: 5 } } }],
      ],
    } as unknown as LLMResult);
    expect(tracker.inputTokens).toBe(10);
    expect(tracker.outputTokens).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/costTracker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/costTracker.ts`**

```ts
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';

const PRICE_INPUT_PER_1M = Number(process.env.PRICE_INPUT_PER_1M ?? 0.15);
const PRICE_OUTPUT_PER_1M = Number(process.env.PRICE_OUTPUT_PER_1M ?? 0.6);

type UsageMetadata = { input_tokens?: number; output_tokens?: number };

export class CostTracker extends BaseCallbackHandler {
  name = 'cost_tracker';
  inputTokens = 0;
  outputTokens = 0;

  handleLLMEnd(output: LLMResult): void {
    const usage = output.llmOutput?.tokenUsage as
      | { promptTokens?: number; completionTokens?: number }
      | undefined;
    if (usage?.promptTokens || usage?.completionTokens) {
      this.inputTokens += usage.promptTokens ?? 0;
      this.outputTokens += usage.completionTokens ?? 0;
      return;
    }
    for (const generationList of output.generations) {
      for (const generation of generationList) {
        const meta = (generation as { message?: { usage_metadata?: UsageMetadata } }).message
          ?.usage_metadata;
        if (meta) {
          this.inputTokens += meta.input_tokens ?? 0;
          this.outputTokens += meta.output_tokens ?? 0;
        }
      }
    }
  }

  totalTokens(): number {
    return this.inputTokens + this.outputTokens;
  }

  costUsd(): number {
    return (
      (this.inputTokens * PRICE_INPUT_PER_1M + this.outputTokens * PRICE_OUTPUT_PER_1M) / 1_000_000
    );
  }

  overBudget(): boolean {
    const cap = Number(process.env.MAX_RUN_TOKENS ?? 0);
    return cap > 0 && this.totalTokens() > cap;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/costTracker.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into the CLI**

In `src/cli.ts` `main()`:

```ts
import { CostTracker } from './costTracker';
```

```ts
  const tracker = new CostTracker();
  const config = { configurable: { thread_id: threadId }, callbacks: [tracker] };
```

Inside the `for await (const chunk of await stream)` loop, after processing each chunk:

```ts
        if (tracker.overBudget()) {
          throw new Error(
            `Token budget exceeded: ${tracker.totalTokens()} tokens (cap MAX_RUN_TOKENS=${process.env.MAX_RUN_TOKENS})`,
          );
        }
```

After the final-result block (before `catch`):

```ts
    console.log(
      `\nTokens: ${tracker.inputTokens} in / ${tracker.outputTokens} out — est. cost $${tracker.costUsd().toFixed(4)}`,
    );
```

- [ ] **Step 6: Verify and commit**

Run: `bun test tests/unit && bun run typecheck && bun run check`
Expected: all pass.

```bash
git add src/costTracker.ts src/cli.ts tests/unit/costTracker.test.ts
git commit -m "feat: track token usage and estimated cost per run with a budget cap"
```

---

### Task 8: SQLite drafts store — Notion becomes optional (F16, F5)

Drafts become rows in `data/app.db` (source of truth). `./output/` files move behind `WRITE_OUTPUT_FILES=true`. The graph Publisher still auto-publishes when Notion is configured, and now writes the page URL back onto the row.

**Files:**
- Create: `src/db.ts`
- Create: `tests/unit/db.test.ts`
- Modify: `src/nodes/finalizer.ts` (insert row; file write behind flag)
- Modify: `src/nodes/publisher.ts` (write back `notion_url`)
- Modify: `src/cli.ts` (store cost on the row; new "Draft saved" message)
- Modify: `package.json` (`test:judge` gets `DRAFTS_DB_PATH=:memory:`), `.gitignore` (`data/app.db`)

**Interfaces:**
- Consumes: `CostTracker` (Task 7) for the cost write-back.
- Produces (used by Task 10's API):

```ts
// src/db.ts
export type DraftRow = {
  id: string; topic: string; channel: string; tone: string; audience: string;
  content: string; word_count: number; verdict: string | null;
  tone_score: number | null; accuracy_score: number | null; structure_score: number | null;
  iterations: number; issues: string;            // JSON-encoded string[]
  cost_usd: number | null; notion_url: string | null; created_at: string;
};
export type NewDraft = Omit<DraftRow, 'issues' | 'cost_usd' | 'notion_url' | 'created_at'> & { issues: string[] };
export function getDb(dbPath?: string): Database;   // opens DRAFTS_DB_PATH (default data/app.db) once
export function resetDbForTests(): void;
export function insertDraft(draft: NewDraft): void;
export function listDrafts(): DraftRow[];            // newest first
export function getDraft(id: string): DraftRow | null;
export function setDraftNotionUrl(id: string, url: string): void;
export function setDraftCost(id: string, costUsd: number): void;
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/db.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import {
  getDb, getDraft, insertDraft, listDrafts, resetDbForTests, setDraftCost, setDraftNotionUrl,
} from '../../src/db';

afterEach(() => resetDbForTests());

function sampleDraft(id: string) {
  return {
    id,
    topic: 'AI onboarding automation',
    channel: 'blog',
    tone: 'accessible',
    audience: 'SMB owners',
    content: '# Hello\n\nBody text.',
    word_count: 3,
    verdict: 'APPROVED' as string | null,
    tone_score: 0.9 as number | null,
    accuracy_score: 0.85 as number | null,
    structure_score: 0.9 as number | null,
    iterations: 2,
    issues: [] as string[],
  };
}

describe('drafts db', () => {
  test('insert, get, list round-trip', () => {
    getDb(':memory:');
    insertDraft(sampleDraft('t1'));
    insertDraft(sampleDraft('t2'));
    expect(listDrafts()).toHaveLength(2);
    const row = getDraft('t1');
    expect(row?.topic).toBe('AI onboarding automation');
    expect(row?.notion_url).toBeNull();
    expect(JSON.parse(row?.issues ?? '[]')).toEqual([]);
  });

  test('re-running the same topic never overwrites (distinct ids)', () => {
    getDb(':memory:');
    insertDraft(sampleDraft('run-1'));
    insertDraft(sampleDraft('run-2'));
    expect(listDrafts()).toHaveLength(2);
  });

  test('cost and notion url write-backs', () => {
    getDb(':memory:');
    insertDraft(sampleDraft('t1'));
    setDraftCost('t1', 0.031);
    setDraftNotionUrl('t1', 'https://notion.so/x');
    const row = getDraft('t1');
    expect(row?.cost_usd).toBeCloseTo(0.031);
    expect(row?.notion_url).toBe('https://notion.so/x');
  });

  test('getDraft returns null for unknown id', () => {
    getDb(':memory:');
    expect(getDraft('missing')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/db.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/db.ts`**

```ts
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Database } from 'bun:sqlite';

export type DraftRow = {
  id: string;
  topic: string;
  channel: string;
  tone: string;
  audience: string;
  content: string;
  word_count: number;
  verdict: string | null;
  tone_score: number | null;
  accuracy_score: number | null;
  structure_score: number | null;
  iterations: number;
  issues: string;
  cost_usd: number | null;
  notion_url: string | null;
  created_at: string;
};

export type NewDraft = Omit<DraftRow, 'issues' | 'cost_usd' | 'notion_url' | 'created_at'> & {
  issues: string[];
};

let db: Database | null = null;

export function getDb(dbPath = process.env.DRAFTS_DB_PATH ?? 'data/app.db'): Database {
  if (db) return db;
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath, { create: true });
  db.run(`CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    channel TEXT NOT NULL,
    tone TEXT NOT NULL,
    audience TEXT NOT NULL,
    content TEXT NOT NULL,
    word_count INTEGER NOT NULL,
    verdict TEXT,
    tone_score REAL,
    accuracy_score REAL,
    structure_score REAL,
    iterations INTEGER NOT NULL DEFAULT 0,
    issues TEXT NOT NULL DEFAULT '[]',
    cost_usd REAL,
    notion_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  return db;
}

export function resetDbForTests(): void {
  db?.close();
  db = null;
}

export function insertDraft(draft: NewDraft): void {
  getDb()
    .query(
      `INSERT INTO drafts
        (id, topic, channel, tone, audience, content, word_count,
         verdict, tone_score, accuracy_score, structure_score, iterations, issues)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      draft.id, draft.topic, draft.channel, draft.tone, draft.audience,
      draft.content, draft.word_count, draft.verdict,
      draft.tone_score, draft.accuracy_score, draft.structure_score,
      draft.iterations, JSON.stringify(draft.issues),
    );
}

export function listDrafts(): DraftRow[] {
  return getDb().query('SELECT * FROM drafts ORDER BY created_at DESC, id DESC').all() as DraftRow[];
}

export function getDraft(id: string): DraftRow | null {
  return (getDb().query('SELECT * FROM drafts WHERE id = ?').get(id) as DraftRow | null) ?? null;
}

export function setDraftNotionUrl(id: string, url: string): void {
  getDb().query('UPDATE drafts SET notion_url = ? WHERE id = ?').run(url, id);
}

export function setDraftCost(id: string, costUsd: number): void {
  getDb().query('UPDATE drafts SET cost_usd = ? WHERE id = ?').run(costUsd, id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/db.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Rewrite the finalizer**

Replace `src/nodes/finalizer.ts` with:

```ts
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { RunnableConfig } from '@langchain/core/runnables';
import { insertDraft } from '../db';
import type { GraphStateType } from '../state';

const OUTPUT_DIR = 'output';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export async function finalizer(
  state: GraphStateType,
  config?: RunnableConfig,
): Promise<Partial<GraphStateType>> {
  if (!state.draft?.content)
    throw new Error('finalizer: no draft content to save — check writer node');

  const threadId = (config?.configurable?.thread_id as string | undefined) ?? crypto.randomUUID();
  const fb = state.editFeedback;

  insertDraft({
    id: threadId,
    topic: state.brief?.topic ?? 'untitled',
    channel: state.brief?.channel ?? 'blog',
    tone: state.brief?.tone ?? '',
    audience: state.brief?.target_audience ?? '',
    content: state.draft.content,
    word_count: state.draft.word_count,
    verdict: fb?.verdict ?? null,
    tone_score: fb?.tone_score ?? null,
    accuracy_score: fb?.accuracy_score ?? null,
    structure_score: fb?.structure_score ?? null,
    iterations: state.iteration,
    issues: fb?.issues ?? [],
  });
  console.log(`[finalizer] Draft saved to database (id=${threadId})`);

  if (process.env.WRITE_OUTPUT_FILES === 'true') {
    await mkdir(OUTPUT_DIR, { recursive: true });
    const approved = fb?.verdict === 'APPROVED';
    const slug = slugify(state.brief?.topic ?? 'untitled') || 'content';
    const filename = `${slug}-${threadId.slice(0, 8)}${approved ? '' : '-unapproved'}.md`;
    await Bun.write(path.resolve(OUTPUT_DIR, filename), state.draft.content);
  }

  return { finalContent: state.draft.content };
}
```

(The thread-id suffix in the filename resolves F5; the `.review.md` sidecar is dropped — issues now live in the DB row.)

- [ ] **Step 6: Publisher writes back the URL**

In `src/nodes/publisher.ts`: change the signature to `publisher(state: GraphStateType, config?: RunnableConfig)` (import `RunnableConfig` type), and after the successful `publishDraft` call:

```ts
    const threadId = config?.configurable?.thread_id as string | undefined;
    if (threadId) setDraftNotionUrl(threadId, page.url);
```

with `import { setDraftNotionUrl } from '../db';`.

- [ ] **Step 7: CLI write-back and message**

In `src/cli.ts`, after the stream loop ends (where the final state is read), add:

```ts
import { setDraftCost } from './db';
```

```ts
    setDraftCost(threadId, tracker.costUsd());
```

Change the `formatChunk` finalizer branch text from `'  Content saved to ./output/'` to `'  Draft saved to database'`, and the final `'✓ Done! Content saved to ./output/'` to `` `✓ Done! Draft saved (id: ${threadId})` ``.

- [ ] **Step 8: Isolate the judge tests and ignore the DB file**

`package.json`: `"test:judge": "DRAFTS_DB_PATH=:memory: MAX_ITERATIONS=2 MAX_SEARCHES=3 bun test tests/judge"`.
`.gitignore`: add a line `data/app.db`.

- [ ] **Step 9: Verify and commit**

Run: `bun test tests/unit && bun run typecheck && bun run check`
Expected: all pass.

```bash
git add src/db.ts src/nodes/finalizer.ts src/nodes/publisher.ts src/cli.ts package.json .gitignore tests/unit/db.test.ts
git commit -m "feat: persist drafts to SQLite; Notion and file output become optional"
```

---

### Task 9: Per-thread web-search cap

The module-level search counter breaks once the server runs concurrent graphs. Key it by thread id.

**Files:**
- Modify: `src/tools/search.ts`
- Modify: `src/cli.ts` (`resetSearchCount(threadId)`)
- Create: `tests/unit/search.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Task 10's `runManager`):
  - `takeSearchSlot(threadId?: string): number | null` — increments and returns the 1-based slot, or `null` when the per-thread cap is hit.
  - `resetSearchCount(threadId?: string): void` — clears one thread's counter (default `'default'`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/search.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { resetSearchCount, takeSearchSlot } from '../../src/tools/search';

describe('takeSearchSlot', () => {
  test('caps per thread independently', () => {
    resetSearchCount('a');
    resetSearchCount('b');
    const cap = Number(process.env.MAX_SEARCHES ?? 10);
    for (let i = 1; i <= cap; i++) expect(takeSearchSlot('a')).toBe(i);
    expect(takeSearchSlot('a')).toBeNull();
    expect(takeSearchSlot('b')).toBe(1);
  });

  test('reset clears a single thread', () => {
    resetSearchCount('c');
    takeSearchSlot('c');
    resetSearchCount('c');
    expect(takeSearchSlot('c')).toBe(1);
    resetSearchCount('c');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/search.test.ts`
Expected: FAIL — `takeSearchSlot` is not exported.

- [ ] **Step 3: Rewrite `src/tools/search.ts`**

```ts
import { DynamicStructuredTool } from '@langchain/core/tools';
import { TavilySearch } from '@langchain/tavily';
import { z } from 'zod';

const MAX_SEARCHES = Number(process.env.MAX_SEARCHES ?? 10);
const counts = new Map<string, number>();

export function resetSearchCount(threadId = 'default'): void {
  counts.delete(threadId);
}

export function takeSearchSlot(threadId = 'default'): number | null {
  const used = counts.get(threadId) ?? 0;
  if (used >= MAX_SEARCHES) return null;
  counts.set(threadId, used + 1);
  return used + 1;
}

const tavily = new TavilySearch({ maxResults: 5 });

export const searchTool = new DynamicStructuredTool({
  name: 'web_search',
  description:
    'Search the web for current facts, statistics, trends, and competitor information. Use for research and fact-checking.',
  schema: z.object({
    input: z.string().describe('The search query'),
  }),
  func: async ({ input }, _runManager, config) => {
    const threadId = (config?.configurable?.thread_id as string | undefined) ?? 'default';
    const slot = takeSearchSlot(threadId);
    if (slot === null) {
      return `[web_search] Search limit reached (${MAX_SEARCHES} requests per run). Skipping query: "${input}"`;
    }
    console.log(`[web_search ${slot}/${MAX_SEARCHES}] "${input}"`);
    return tavily.invoke({ query: input });
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/search.test.ts`
Expected: PASS. Note: `MAX_SEARCHES` is read at module load; the test derives the cap from the same env var so it passes under both `bun test tests/unit` and the judge script's `MAX_SEARCHES=3`.

- [ ] **Step 5: Update the CLI call site**

In `src/cli.ts`, change `resetSearchCount();` to `resetSearchCount(threadId);` (move it after `threadId` is created). The no-arg call in `tests/judge/e2e.test.ts` still compiles (default parameter) — leave it.

- [ ] **Step 6: Verify and commit**

Run: `bun test tests/unit && bun run typecheck && bun run check`
Expected: all pass.

```bash
git add src/tools/search.ts src/cli.ts tests/unit/search.test.ts
git commit -m "feat: per-thread web-search cap to support concurrent runs"
```

---

### Task 10: HTTP API with Hono (F10)

**Files:**
- Create: `src/runManager.ts`
- Create: `src/server.ts`
- Create: `tests/unit/server.test.ts`
- Modify: `package.json` (add `hono`, `serve` and `test:unit` scripts)

**Interfaces:**
- Consumes: `graph` (`src/graph.ts`), `makeInitialState`, `BriefSchema`, `CostTracker`, `setDraftCost`/`listDrafts`/`getDraft`/`setDraftNotionUrl` (Task 8), `resetSearchCount` (Task 9), `publishDraft` (`src/mcp/notion.ts`).
- Produces:

```ts
// src/runManager.ts
export type RunStatus = 'running' | 'awaiting_approval' | 'done' | 'error';
export type RunEvent = { node: string; data: unknown; ts: number };
export type RunRecord = {
  threadId: string; status: RunStatus; interruptPayload: unknown;
  events: RunEvent[]; error?: string;
};
export function startRun(brief: Brief): string;                       // returns threadId
export function resumeRun(threadId: string, decision: { approved: boolean; feedback?: string }): boolean;
export function getRun(threadId: string): RunRecord | undefined;
export function subscribe(threadId: string, fn: (e: RunEvent) => void): (() => void) | null;
// src/server.ts
export const app: Hono;   // also exports default { port, fetch } for `bun run`
```

HTTP surface: `POST /runs` `{topic, channel, tone, target_audience, word_count}` → `{thread_id}`; `GET /runs/:id` → run record; `POST /runs/:id/resume` `{approved, feedback?}`; `GET /runs/:id/events` (SSE, JSON-encoded `RunEvent` per message); `GET /drafts`; `GET /drafts/:id`; `POST /drafts/:id/publish` → `{url}`.

- [ ] **Step 1: Install Hono**

Run: `bun add hono`
Expected: `hono` appears in `package.json` dependencies.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/server.test.ts` (exercises only DB-backed and 404 paths — no LLM calls; importing the server pulls in the graph, so dummy `OPENAI_API_KEY`/`TAVILY_API_KEY` must be present in the environment — see the CI task):

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getDb, insertDraft, resetDbForTests } from '../../src/db';
import { app } from '../../src/server';

beforeEach(() => {
  getDb(':memory:');
  insertDraft({
    id: 'd1', topic: 'T', channel: 'blog', tone: 'x', audience: 'y',
    content: '# Hi', word_count: 1, verdict: 'APPROVED',
    tone_score: 0.9, accuracy_score: 0.9, structure_score: 0.9,
    iterations: 1, issues: [],
  });
});

afterEach(() => resetDbForTests());

describe('drafts endpoints', () => {
  test('GET /drafts lists rows', async () => {
    const res = await app.request('/drafts');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body[0]?.id).toBe('d1');
  });

  test('GET /drafts/:id returns the row, 404 when missing', async () => {
    expect((await app.request('/drafts/d1')).status).toBe(200);
    expect((await app.request('/drafts/nope')).status).toBe(404);
  });

  test('POST /drafts/:id/publish returns 400 when Notion unconfigured', async () => {
    delete process.env.NOTION_TOKEN;
    delete process.env.NOTION_DRAFTS_DATABASE_ID;
    const res = await app.request('/drafts/d1/publish', { method: 'POST' });
    expect(res.status).toBe(400);
  });
});

describe('runs endpoints', () => {
  test('GET /runs/:id 404s for unknown run', async () => {
    expect((await app.request('/runs/unknown')).status).toBe(404);
  });

  test('POST /runs validates the brief', async () => {
    const res = await app.request('/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic: '' }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/unit/server.test.ts`
Expected: FAIL — `src/server` not found.

- [ ] **Step 4: Implement `src/runManager.ts`**

```ts
import { Command } from '@langchain/langgraph';
import { CostTracker } from './costTracker';
import { setDraftCost } from './db';
import { graph } from './graph';
import type { Brief } from './schemas';
import { makeInitialState } from './state';
import { resetSearchCount } from './tools/search';

export type RunStatus = 'running' | 'awaiting_approval' | 'done' | 'error';
export type RunEvent = { node: string; data: unknown; ts: number };

export type RunRecord = {
  threadId: string;
  status: RunStatus;
  interruptPayload: unknown;
  events: RunEvent[];
  error?: string;
};

type InternalRun = RunRecord & {
  listeners: Set<(e: RunEvent) => void>;
  tracker: CostTracker;
};

const runs = new Map<string, InternalRun>();

export function getRun(threadId: string): RunRecord | undefined {
  return runs.get(threadId);
}

export function subscribe(threadId: string, fn: (e: RunEvent) => void): (() => void) | null {
  const run = runs.get(threadId);
  if (!run) return null;
  run.listeners.add(fn);
  return () => run.listeners.delete(fn);
}

function emit(run: InternalRun, node: string, data: unknown): void {
  const event: RunEvent = { node, data, ts: Date.now() };
  run.events.push(event);
  for (const fn of run.listeners) fn(event);
}

function summarize(node: string, value: unknown): unknown {
  const v = value as Record<string, unknown>;
  if (node === 'strategist') return { plan: v.plan };
  if (node === 'writer') {
    const draft = v.draft as { content: string; word_count: number } | undefined;
    return draft ? { preview: draft.content.slice(0, 300), word_count: draft.word_count } : {};
  }
  if (node === 'editor') return { editFeedback: v.editFeedback };
  if (node === 'publisher') return { notionUrl: v.notionUrl ?? null };
  return {};
}

async function drive(run: InternalRun, input: unknown): Promise<void> {
  const config = { configurable: { thread_id: run.threadId }, callbacks: [run.tracker] };
  try {
    run.status = 'running';
    let interrupted = false;
    const stream = await graph.stream(input, config);
    for await (const chunk of stream) {
      for (const [node, value] of Object.entries(chunk)) {
        if (node === '__interrupt__') {
          interrupted = true;
          run.interruptPayload = (value as Array<{ value: unknown }>)[0]?.value ?? null;
          continue;
        }
        emit(run, node, summarize(node, value));
      }
      if (run.tracker.overBudget()) {
        throw new Error(`Token budget exceeded (${run.tracker.totalTokens()} tokens)`);
      }
    }
    if (interrupted) {
      run.status = 'awaiting_approval';
      emit(run, 'hitl', { awaiting: true, payload: run.interruptPayload });
    } else {
      run.status = 'done';
      setDraftCost(run.threadId, run.tracker.costUsd());
      emit(run, 'done', {
        costUsd: run.tracker.costUsd(),
        tokens: run.tracker.totalTokens(),
      });
    }
  } catch (err) {
    run.status = 'error';
    run.error = err instanceof Error ? err.message : String(err);
    emit(run, 'error', { message: run.error });
  }
}

export function startRun(brief: Brief): string {
  const threadId = crypto.randomUUID();
  const run: InternalRun = {
    threadId,
    status: 'running',
    interruptPayload: null,
    events: [],
    listeners: new Set(),
    tracker: new CostTracker(),
  };
  runs.set(threadId, run);
  resetSearchCount(threadId);
  void drive(run, makeInitialState(brief));
  return threadId;
}

export function resumeRun(
  threadId: string,
  decision: { approved: boolean; feedback?: string },
): boolean {
  const run = runs.get(threadId);
  if (!run || run.status !== 'awaiting_approval') return false;
  run.interruptPayload = null;
  void drive(run, new Command({ resume: decision }));
  return true;
}
```

- [ ] **Step 5: Implement `src/server.ts`**

```ts
import 'dotenv/config';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { getDraft, listDrafts, setDraftNotionUrl } from './db';
import { publishDraft } from './mcp/notion';
import { getRun, resumeRun, startRun, subscribe } from './runManager';
import { BriefSchema } from './schemas';

const ResumeSchema = z.union([
  z.object({ approved: z.literal(true) }),
  z.object({ approved: z.literal(false), feedback: z.string().min(1) }),
]);

export const app = new Hono();

app.post('/runs', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = BriefSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const threadId = startRun(parsed.data);
  return c.json({ thread_id: threadId }, 201);
});

app.get('/runs/:id', (c) => {
  const run = getRun(c.req.param('id'));
  if (!run) return c.json({ error: 'run not found' }, 404);
  return c.json(run);
});

app.post('/runs/:id/resume', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = ResumeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const ok = resumeRun(c.req.param('id'), parsed.data);
  if (!ok) return c.json({ error: 'run not found or not awaiting approval' }, 409);
  return c.json({ resumed: true });
});

app.get('/runs/:id/events', (c) => {
  const id = c.req.param('id');
  const run = getRun(id);
  if (!run) return c.json({ error: 'run not found' }, 404);
  return streamSSE(c, async (stream) => {
    for (const event of run.events) {
      await stream.writeSSE({ data: JSON.stringify(event) });
    }
    let open = true;
    stream.onAbort(() => {
      open = false;
    });
    const unsubscribe = subscribe(id, (event) => {
      void stream.writeSSE({ data: JSON.stringify(event) });
    });
    while (open) {
      const current = getRun(id);
      if (!current || current.status === 'done' || current.status === 'error') break;
      await stream.sleep(1000);
    }
    unsubscribe?.();
  });
});

app.get('/drafts', (c) => c.json(listDrafts()));

app.get('/drafts/:id', (c) => {
  const draft = getDraft(c.req.param('id'));
  if (!draft) return c.json({ error: 'draft not found' }, 404);
  return c.json(draft);
});

app.post('/drafts/:id/publish', async (c) => {
  const draft = getDraft(c.req.param('id'));
  if (!draft) return c.json({ error: 'draft not found' }, 404);
  const databaseId = process.env.NOTION_DRAFTS_DATABASE_ID;
  if (!databaseId || !process.env.NOTION_TOKEN) {
    return c.json({ error: 'Notion is not configured (NOTION_TOKEN, NOTION_DRAFTS_DATABASE_ID)' }, 400);
  }
  try {
    const page = await publishDraft({
      databaseId,
      title: draft.topic,
      content: draft.content,
      channel: draft.channel,
      wordCount: draft.word_count,
      status: draft.verdict === 'APPROVED' ? 'Approved' : 'Unapproved',
    });
    setDraftNotionUrl(draft.id, page.url);
    return c.json({ url: page.url });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

app.use('/*', serveStatic({ root: './public' }));

export default {
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/unit/server.test.ts`
Expected: PASS (5 tests). If `TavilySearch`/`ChatOpenAI` constructors complain about missing keys, ensure `.env` has real or dummy values (CI provides dummies).

- [ ] **Step 7: Add scripts**

`package.json` scripts:

```json
"serve": "bun run src/server.ts",
"test:unit": "bun test tests/unit",
```

- [ ] **Step 8: Verify and commit**

Run: `bun run test:unit && bun run typecheck && bun run check`
Expected: all pass. Optional smoke test with real keys: `bun run serve`, then `curl -s localhost:3000/drafts` → `[]` or existing rows.

```bash
git add src/runManager.ts src/server.ts tests/unit/server.test.ts package.json bun.lock
git commit -m "feat: Hono HTTP API — runs with SSE progress, async HITL, drafts endpoints"
```

---

### Task 11: Web demo UI (F11)

Single static page served by the Hono server. No build step, no framework.

**Files:**
- Create: `public/index.html`

**Interfaces:**
- Consumes: every endpoint from Task 10. SSE events are `{node, data, ts}` where `node ∈ {strategist, hitl, writer, editor, finalizer, publisher, done, error}`; the `hitl` event's `data.payload.plan` is a `ContentPlan`; the `done` event's `data` is `{costUsd, tokens}`.
- Produces: the demo page at `http://localhost:3000/`.

- [ ] **Step 1: Create `public/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>EONYX — Content Pipeline</title>
<style>
  :root { --accent: #4f46e5; --ok: #16a34a; --warn: #d97706; --muted: #6b7280; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; margin: 0 auto; max-width: 880px; padding: 24px; color: #111827; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 2rem; }
  form { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  label { display: flex; flex-direction: column; font-size: 0.85rem; color: var(--muted); gap: 4px; }
  input, select { padding: 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 1rem; }
  button { padding: 10px 16px; border: 0; border-radius: 6px; background: var(--accent); color: #fff; font-size: 1rem; cursor: pointer; }
  button.secondary { background: #e5e7eb; color: #111827; }
  button:disabled { opacity: 0.5; cursor: default; }
  .pipeline { display: flex; gap: 8px; flex-wrap: wrap; margin: 16px 0; }
  .step { padding: 6px 12px; border-radius: 999px; background: #f3f4f6; color: var(--muted); font-size: 0.85rem; }
  .step.active { background: var(--accent); color: #fff; }
  .step.done { background: #dcfce7; color: var(--ok); }
  .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 12px 0; }
  .scores span { margin-right: 12px; font-size: 0.85rem; }
  textarea { width: 100%; min-height: 60px; padding: 8px; border: 1px solid #d1d5db; border-radius: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e5e7eb; }
  #result-content { background: #f9fafb; padding: 16px; border-radius: 8px; overflow-x: auto; white-space: pre-wrap; }
  .hidden { display: none; }
  .badge { font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; }
  .badge.approved { background: #dcfce7; color: var(--ok); }
  .badge.unapproved { background: #fef3c7; color: var(--warn); }
</style>
</head>
<body>
<h1>EONYX — AI Content Pipeline</h1>

<form id="brief-form">
  <label>Topic <input name="topic" required placeholder="How an AI assistant saves 10 hours a week" /></label>
  <label>Channel
    <select name="channel">
      <option>blog</option><option>linkedin</option><option>twitter</option>
      <option>instagram</option><option>threads</option>
    </select>
  </label>
  <label>Tone <input name="tone" required value="professional" /></label>
  <label>Audience <input name="target_audience" required value="SMB owners" /></label>
  <label>Word count <input name="word_count" type="number" required value="800" /></label>
  <label style="justify-content:end"><button type="submit" id="start-btn">Generate</button></label>
</form>

<div class="pipeline" id="pipeline"></div>

<div class="card hidden" id="plan-card">
  <h2>Content plan — approve?</h2>
  <div id="plan-body"></div>
  <textarea id="feedback" placeholder="Feedback for revision (optional unless revising)"></textarea>
  <p>
    <button id="approve-btn">Approve</button>
    <button id="revise-btn" class="secondary">Request changes</button>
  </p>
</div>

<div class="card hidden" id="result-card">
  <h2>Result <span id="result-badge" class="badge"></span></h2>
  <p id="result-meta" style="color:var(--muted)"></p>
  <div id="result-content"></div>
  <p><button id="publish-btn" class="hidden">Publish to Notion</button> <a id="notion-link" target="_blank"></a></p>
</div>

<h2>Drafts library</h2>
<table id="drafts-table">
  <thead><tr><th>Topic</th><th>Channel</th><th>Verdict</th><th>Words</th><th>Cost</th><th>Created</th></tr></thead>
  <tbody></tbody>
</table>

<script>
const NODES = ['strategist', 'hitl', 'writer', 'editor', 'finalizer', 'publisher'];
let threadId = null;
let eventSource = null;

const $ = (id) => document.getElementById(id);

function renderPipeline(activeNode, doneNodes) {
  $('pipeline').innerHTML = NODES.map((n) => {
    const cls = doneNodes.has(n) ? 'done' : n === activeNode ? 'active' : '';
    return `<span class="step ${cls}">${n}</span>`;
  }).join('');
}

function mdToHtml(md) {
  const esc = md.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return esc
    .replace(/^### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^## (.*)$/gm, '<h3>$1</h3>')
    .replace(/^# (.*)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.*)$/gm, '&bull; $1');
}

async function loadDrafts() {
  const drafts = await (await fetch('/drafts')).json();
  $('drafts-table').querySelector('tbody').innerHTML = drafts.map((d) => `
    <tr>
      <td>${d.topic}</td><td>${d.channel}</td>
      <td><span class="badge ${d.verdict === 'APPROVED' ? 'approved' : 'unapproved'}">${d.verdict ?? '—'}</span></td>
      <td>${d.word_count}</td>
      <td>${d.cost_usd != null ? '$' + d.cost_usd.toFixed(4) : '—'}</td>
      <td>${d.created_at}</td>
    </tr>`).join('');
}

const doneNodes = new Set();

function handleEvent(e) {
  const { node, data } = JSON.parse(e.data);
  if (NODES.includes(node)) { doneNodes.add(node); renderPipeline(null, doneNodes); }

  if (node === 'hitl' && data.awaiting) {
    const plan = data.payload?.plan;
    if (plan) {
      $('plan-body').innerHTML =
        '<ol>' + plan.outline.map((i) => `<li>${i}</li>`).join('') + '</ol>' +
        `<p><strong>Keywords:</strong> ${plan.keywords.join(', ')}</p>` +
        `<p><strong>Tone:</strong> ${plan.tone} — <strong>Audience:</strong> ${plan.target_audience}</p>`;
    }
    $('plan-card').classList.remove('hidden');
  }
  if (node === 'editor' && data.editFeedback) {
    const fb = data.editFeedback;
    doneNodes.delete('editor');
    renderPipeline('editor', doneNodes);
    $('result-meta').textContent =
      `verdict: ${fb.verdict} · tone ${fb.tone_score} · accuracy ${fb.accuracy_score} · structure ${fb.structure_score}`;
  }
  if (node === 'done') {
    eventSource?.close();
    $('start-btn').disabled = false;
    showResult(data);
  }
  if (node === 'error') {
    eventSource?.close();
    $('start-btn').disabled = false;
    alert('Run failed: ' + data.message);
  }
}

async function showResult(doneData) {
  const draft = await (await fetch(`/drafts/${threadId}`)).json();
  $('result-card').classList.remove('hidden');
  $('result-badge').textContent = draft.verdict ?? '—';
  $('result-badge').className = 'badge ' + (draft.verdict === 'APPROVED' ? 'approved' : 'unapproved');
  $('result-meta').textContent =
    `${draft.word_count} words · $${(doneData.costUsd ?? 0).toFixed(4)} · ${doneData.tokens ?? 0} tokens`;
  $('result-content').innerHTML = mdToHtml(draft.content);
  $('publish-btn').classList.remove('hidden');
  loadDrafts();
}

$('brief-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = new FormData(ev.target);
  const brief = Object.fromEntries(form.entries());
  brief.word_count = Number(brief.word_count);
  $('start-btn').disabled = true;
  doneNodes.clear();
  $('plan-card').classList.add('hidden');
  $('result-card').classList.add('hidden');
  renderPipeline('strategist', doneNodes);
  const res = await fetch('/runs', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(brief),
  });
  if (!res.ok) { alert('Invalid brief'); $('start-btn').disabled = false; return; }
  threadId = (await res.json()).thread_id;
  eventSource = new EventSource(`/runs/${threadId}/events`);
  eventSource.onmessage = handleEvent;
});

async function resume(approved) {
  const feedback = $('feedback').value.trim();
  if (!approved && !feedback) { alert('Feedback is required to request changes'); return; }
  $('plan-card').classList.add('hidden');
  await fetch(`/runs/${threadId}/resume`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(approved ? { approved: true } : { approved: false, feedback }),
  });
  eventSource?.close();
  eventSource = new EventSource(`/runs/${threadId}/events`);
  eventSource.onmessage = handleEvent;
}
$('approve-btn').addEventListener('click', () => resume(true));
$('revise-btn').addEventListener('click', () => resume(false));

$('publish-btn').addEventListener('click', async () => {
  $('publish-btn').disabled = true;
  const res = await fetch(`/drafts/${threadId}/publish`, { method: 'POST' });
  const body = await res.json();
  if (res.ok) {
    $('notion-link').href = body.url;
    $('notion-link').textContent = 'Open in Notion';
    $('publish-btn').classList.add('hidden');
  } else {
    alert(body.error);
    $('publish-btn').disabled = false;
  }
  loadDrafts();
});

renderPipeline(null, doneNodes);
loadDrafts();
</script>
</body>
</html>
```

- [ ] **Step 2: Manual end-to-end verification (requires OpenAI + Tavily keys and Chroma running)**

Run: `SKIP_PUBLISH=true bun run serve`, open `http://localhost:3000/`.
Expected: submit the pre-filled brief → pipeline badges advance → plan card appears → Approve → writer/editor badges cycle → result card shows content, verdict badge, word count and cost → drafts library gains a row. Reload the page → drafts library still lists the row (SQLite persistence).

Note: the SSE reconnect after resume replays all past events (`run.events` are re-sent) — the UI is idempotent to replays because it only adds nodes to a `Set` and re-renders.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: single-page web demo UI — live progress, plan approval, drafts library"
```

---

### Task 12: CI workflow, env docs, README

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: `test:unit` script (Task 10), all env vars introduced above.
- Produces: green CI on push; accurate onboarding docs.

- [ ] **Step 1: CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]
jobs:
  checks:
    runs-on: ubuntu-latest
    env:
      OPENAI_API_KEY: test-key       # dummy — unit tests never call the API,
      TAVILY_API_KEY: test-key       # but client constructors require a value
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bunx biome ci .
      - run: bun run test:unit
```

(Judge tests are excluded — they cost money; run them manually before releases via `bun run test:judge`.)

- [ ] **Step 2: Update `.env.example`**

Append after the existing entries:

```
# Drafts database (SQLite, created automatically)
DRAFTS_DB_PATH=data/app.db
# Set to "true" to also write approved drafts as Markdown files under ./output/
WRITE_OUTPUT_FILES=

# HTTP server
PORT=3000

# Cost tracking (USD per 1M tokens; defaults match gpt-4o-mini)
PRICE_INPUT_PER_1M=0.15
PRICE_OUTPUT_PER_1M=0.60
# Hard token cap per run (0 or empty = unlimited)
MAX_RUN_TOKENS=

# LLM call timeout in milliseconds
LLM_TIMEOUT_MS=120000
```

- [ ] **Step 3: Update README**

Make these changes in `README.md`:

1. In the intro paragraph, replace "before saving the final approved result" with "before saving the final approved result to a local drafts database (and optionally Notion)".
2. Add a **Web UI & API** section after the **Run** section containing: an h3 heading `Web UI & API`; a bash code block with the single command `bun run serve`; this paragraph: "Opens the demo at `http://localhost:3000` — submit a brief, watch the pipeline live, approve or revise the plan, and browse the drafts library. For demos without Notion, no extra setup is needed: drafts persist to SQLite (`data/app.db` by default)."; and this line: "API endpoints: `POST /runs`, `GET /runs/:id`, `POST /runs/:id/resume`, `GET /runs/:id/events` (SSE), `GET /drafts`, `GET /drafts/:id`, `POST /drafts/:id/publish`."

3. In the **Limits** section, replace the Publisher bullet with: "**Publisher:** optional — drafts always persist to the SQLite database; the Notion publish runs only when `NOTION_TOKEN` and `NOTION_DRAFTS_DATABASE_ID` are set (or on demand via `POST /drafts/:id/publish` / the UI button). `SKIP_PUBLISH=true` disables the automatic graph publish."
4. Replace mentions of "saved to `output/`" (Limits → Iteration cap, Project structure → `output/`) with the drafts-database wording; note `WRITE_OUTPUT_FILES=true` re-enables file export.
5. Add to the **Tests** section: `bun run test:unit` — fast, free unit tests (also run in CI); judge tests remain manual.
6. Add a **Cost** line to the CLI Run section: each run prints token usage and estimated cost (configure via `PRICE_INPUT_PER_1M` / `PRICE_OUTPUT_PER_1M`).

- [ ] **Step 4: Full verification**

Run: `bun run typecheck && bun run check && bun run test:unit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml .env.example README.md
git commit -m "chore: add CI for typecheck/lint/unit tests; document drafts DB, API, and UI"
```

---

## Deferred (separate future plans — do NOT implement now)

- **F9** Notion inline rich-text formatting (bold/links/code fences in `markdownToBlocks`).
- **F13** Multi-channel repurposing (one plan → per-channel Writer/Editor fan-out).
- **F14** Final-draft HITL gate before publish.
- **F15** "Bring your own brand" onboarding script (per-client Chroma collections).

Each is scoped in the spec (`docs/superpowers/specs/2026-07-15-mvp-client-demo-design.md`, Phase 3) and gets its own plan when scheduled.

## Verification against spec success criteria

After Task 12, confirm:
1. Cold clone → demo: `bun install`, `cp .env.example .env` (+2 keys), `docker run … chroma`, `bun run serve` — ≤ 5 commands, no Notion keys.
2. Full run from the web UI with live progress and cost shown → draft appears in library → optional publish button.
3. Same topic twice → two DB rows (Task 8 test proves ids never collide).
4. 300-word LinkedIn brief lands within ±10% (manual judge-test run; Editor now enforces length).
5. `grep -rn "accounting" src/ tests/ --include='*.ts'` → empty.
