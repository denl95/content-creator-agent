import 'dotenv/config';
import { type ApiCreatePromptRequest, type ApiPrompt, Langfuse } from 'langfuse';
import {
  LANGFUSE_PROMPT_HOST,
  LANGFUSE_PROMPT_LABEL,
  MANAGED_PROMPTS,
  type PromptKey,
  promptName,
} from '../src/prompts/managed';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set in .env`);
    process.exit(1);
  }
  return value;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => [key, stable(val)]),
    );
  }
  return value;
}

function comparablePrompt(prompt: ApiPrompt['prompt'] | ApiCreatePromptRequest['prompt']): unknown {
  if (!Array.isArray(prompt)) return prompt;
  return prompt.map((message) => {
    if ('role' in message && 'content' in message) {
      return { role: message.role, content: message.content };
    }
    return { type: 'placeholder', name: message.name };
  });
}

function samePrompt(a: ApiPrompt, b: ApiCreatePromptRequest): boolean {
  return (
    a.type === b.type &&
    JSON.stringify(stable(comparablePrompt(a.prompt))) ===
      JSON.stringify(stable(comparablePrompt(b.prompt))) &&
    JSON.stringify(stable(a.config)) === JSON.stringify(stable(b.config))
  );
}

const prompts: ApiCreatePromptRequest[] = (Object.keys(MANAGED_PROMPTS) as PromptKey[]).map(
  (key) => {
    const spec = MANAGED_PROMPTS[key];
    return {
      type: 'chat',
      name: promptName(key),
      labels: [LANGFUSE_PROMPT_LABEL],
      tags: spec.tags,
      commitMessage: `Sync ${key} prompt from repository`,
      config: {
        source: spec.source,
        placeholders: spec.placeholders,
      },
      prompt: spec.fallback.map((message) => ({ type: 'chatmessage' as const, ...message })),
    };
  },
);

async function main(): Promise<void> {
  const langfuse = new Langfuse({
    publicKey: requireEnv('LANGFUSE_PUBLIC_KEY'),
    secretKey: requireEnv('LANGFUSE_SECRET_KEY'),
    baseUrl: LANGFUSE_PROMPT_HOST,
  });

  console.log(
    `Uploading ${prompts.length} prompt(s) to Langfuse (${LANGFUSE_PROMPT_HOST}) with label "${LANGFUSE_PROMPT_LABEL}"`,
  );

  for (const prompt of prompts) {
    process.stdout.write(`  ${prompt.name}... `);
    try {
      const current = await langfuse.api.promptsGet({
        promptName: encodeURIComponent(prompt.name),
        label: LANGFUSE_PROMPT_LABEL,
      });
      if (samePrompt(current, prompt)) {
        console.log(`unchanged (v${current.version})`);
        continue;
      }
    } catch {
      // Prompt does not exist yet, or the requested label is not present.
    }

    const created = await langfuse.api.promptsCreate(prompt);
    console.log(`uploaded v${created.version}`);
  }

  await langfuse.shutdownAsync();
}

main().catch((err) => {
  console.error('Prompt upload failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
