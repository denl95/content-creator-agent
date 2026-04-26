import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import 'dotenv/config';
import { Command } from '@langchain/langgraph';
import { z } from 'zod';
import { graph } from './graph';
import { shutdown } from './observability';
import { BriefSchema } from './schemas';
import { makeInitialState } from './state';

const ArgsSchema = z.object({
  topic: z.string().min(1),
  channel: z.enum(['blog', 'linkedin', 'twitter', 'instagram', 'threads']),
  tone: z.string().min(1),
  audience: z.string().min(1),
  'word-count': z.coerce.number().int().positive(),
  verbose: z.boolean().default(false),
});

const USAGE = `
Usage: bun run index.ts [options]

Options:
  --topic       Content topic (required)
  --channel     Publishing channel: blog | linkedin | twitter | instagram | threads (required)
  --tone        Tone of voice, e.g. "professional" (required)
  --audience    Target audience, e.g. "SMB owners" (required)
  --word-count  Target word count (required)
  --verbose     Show tool-call details

Example:
  bun run index.ts --topic "AI in accounting" --channel blog \\
    --tone professional --audience "SMB owners" --word-count 1200
`.trim();

function formatChunk(nodeName: string, value: unknown, verbose: boolean): string | null {
  if (nodeName === '__interrupt__') return null;

  const v = value as Record<string, unknown>;

  if (nodeName === 'strategist' && v.plan) {
    const plan = v.plan as { outline: string[]; keywords: string[]; tone: string };
    return [
      '  Outline:',
      ...plan.outline.map((item: string, i: number) => `    ${i + 1}. ${item}`),
      `  Keywords: ${plan.keywords.join(', ')}`,
      `  Tone: ${plan.tone}`,
    ].join('\n');
  }

  if (nodeName === 'writer' && v.draft) {
    const draft = v.draft as { content: string; word_count: number };
    const preview = draft.content.slice(0, 200).replace(/\n/g, ' ');
    return `  ${preview}... [${draft.word_count} words]`;
  }

  if (nodeName === 'editor' && v.editFeedback) {
    const fb = v.editFeedback as {
      verdict: string;
      tone_score: number;
      accuracy_score: number;
      structure_score: number;
      issues: string[];
    };
    const scores = `tone=${fb.tone_score.toFixed(2)} accuracy=${fb.accuracy_score.toFixed(2)} structure=${fb.structure_score.toFixed(2)}`;
    const firstIssue = fb.issues[0] ? `\n  Issue: ${fb.issues[0]}` : '';
    return `  Verdict: ${fb.verdict} (${scores})${firstIssue}`;
  }

  if (nodeName === 'finalizer' && v.finalContent) {
    return '  Content saved to ./output/';
  }

  return verbose ? `  ${JSON.stringify(v).slice(0, 200)}` : null;
}

function prettyPlan(plan: {
  outline: string[];
  keywords: string[];
  key_messages: string[];
  target_audience: string;
  tone: string;
}): string {
  return [
    '',
    '┌─ Content Plan ────────────────────────────────────────',
    `│  Tone:     ${plan.tone}`,
    `│  Audience: ${plan.target_audience}`,
    '│  Outline:',
    ...plan.outline.map((item, i) => `│    ${i + 1}. ${item}`),
    `│  Keywords: ${plan.keywords.join(', ')}`,
    `│  Key messages: ${plan.key_messages.join(' | ')}`,
    '└────────────────────────────────────────────────────────',
    '',
  ].join('\n');
}

export async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      topic: { type: 'string' },
      channel: { type: 'string' },
      tone: { type: 'string' },
      audience: { type: 'string' },
      'word-count': { type: 'string' },
      verbose: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  const parsed = ArgsSchema.safeParse(values);
  if (!parsed.success) {
    console.error(
      'Invalid arguments:\n' +
        parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'),
    );
    console.error('\n' + USAGE);
    process.exit(1);
  }

  const args = parsed.data;
  const brief = BriefSchema.parse({
    topic: args.topic,
    channel: args.channel,
    tone: args.tone,
    target_audience: args.audience,
    word_count: args['word-count'],
  });

  const threadId = crypto.randomUUID();
  console.log(`\nThread ID: ${threadId}`);
  console.log(`Topic:     ${brief.topic}`);
  console.log(`Channel:   ${brief.channel} | Tone: ${brief.tone} | Words: ${brief.word_count}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const config = { configurable: { thread_id: threadId } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let currentInput: any = makeInitialState(brief);

  try {
    while (true) {
      const stream = graph.stream(currentInput, config);

      let interrupted = false;
      let interruptPayload: unknown = null;

      for await (const chunk of await stream) {
        for (const [nodeName, value] of Object.entries(chunk)) {
          if (nodeName === '__interrupt__') {
            interrupted = true;
            const interrupts = value as Array<{ value: unknown }>;
            interruptPayload = interrupts[0]?.value;
            continue;
          }
          const line = formatChunk(nodeName, value, args.verbose);
          if (line) {
            console.log(`[${nodeName}]\n${line}\n`);
          } else {
            console.log(`[${nodeName}]`);
          }
        }
      }

      if (!interrupted) break;

      // Show the plan and prompt for user decision
      const payload = interruptPayload as { plan?: unknown };
      if (payload?.plan) {
        console.log(prettyPlan(payload.plan as Parameters<typeof prettyPlan>[0]));
      }

      const answer = (await rl.question('[a]pprove, [r]evise, [q]uit? ')).trim().toLowerCase();

      if (answer === 'q') {
        console.log(`\nAborted. Thread ID: ${threadId}`);
        process.exit(0);
      }

      if (answer === 'r') {
        const feedback = await rl.question('Feedback: ');
        currentInput = new Command({ resume: { approved: false, feedback } });
      } else {
        currentInput = new Command({ resume: { approved: true } });
      }
    }

    // Print final result
    const finalState = await graph.getState(config);
    const finalContent = finalState.values.finalContent as string | null;

    if (finalContent) {
      console.log('\n✓ Done! Content saved to ./output/');
      console.log(`\nFinal preview:\n${finalContent.slice(0, 400)}...`);
    } else {
      console.log('\nPipeline completed — check ./output/ for the saved file.');
    }
  } catch (err) {
    console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`Thread ID for debugging: ${threadId}`);
    process.exit(1);
  } finally {
    rl.close();
    await shutdown();
  }
}
