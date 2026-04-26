import { type ChatPromptClient, Langfuse } from 'langfuse';
import type { ContentPlan, DraftContent, EditFeedback } from '../schemas';
import { EDITOR_SYSTEM } from './editor';
import { STRATEGIST_SYSTEM } from './strategist';
import { WRITER_SYSTEM } from './writer';

export type ChatPromptMessage = {
  role: string;
  content: string;
};

export type PromptKey = 'strategist' | 'writer' | 'editor';

export type ManagedPromptSpec = {
  key: PromptKey;
  source: string;
  tags: string[];
  placeholders: string[];
  fallback: ChatPromptMessage[];
};

export type CompiledManagedPrompt = {
  messages: ChatPromptMessage[];
  langfusePrompt?: ChatPromptClient;
};

const commonTags = ['content-creator-agent'];

export const LANGFUSE_PROMPT_LABEL = process.env.LANGFUSE_PROMPT_LABEL ?? 'production';
export const LANGFUSE_PROMPT_PREFIX = process.env.LANGFUSE_PROMPT_PREFIX ?? 'content-creator-agent';
export const LANGFUSE_PROMPT_HOST = process.env.LANGFUSE_HOST ?? 'https://cloud.langfuse.com';
const LANGFUSE_PROMPT_CACHE_TTL_SECONDS = Number(
  process.env.LANGFUSE_PROMPT_CACHE_TTL_SECONDS ?? 300,
);

export function promptName(key: PromptKey): string {
  return `${LANGFUSE_PROMPT_PREFIX}/${key}`;
}

export const MANAGED_PROMPTS: Record<PromptKey, ManagedPromptSpec> = {
  strategist: {
    key: 'strategist',
    source: 'src/prompts/strategist.ts',
    tags: [...commonTags, 'strategist'],
    placeholders: [
      'topic',
      'target_audience',
      'channel',
      'tone',
      'word_count',
      'revision_feedback',
    ],
    fallback: [
      { role: 'system', content: STRATEGIST_SYSTEM },
      {
        role: 'user',
        content: [
          'Create a content plan for the following brief:',
          '',
          'Topic: {{topic}}',
          'Target audience: {{target_audience}}',
          'Channel: {{channel}}',
          'Tone: {{tone}}',
          'Target word count: {{word_count}}',
          '',
          '{{revision_feedback}}',
        ].join('\n'),
      },
    ],
  },
  writer: {
    key: 'writer',
    source: 'src/prompts/writer.ts',
    tags: [...commonTags, 'writer'],
    placeholders: [
      'outline',
      'keywords',
      'key_messages',
      'target_audience',
      'tone',
      'prior_draft',
      'editor_feedback',
    ],
    fallback: [
      { role: 'system', content: WRITER_SYSTEM },
      {
        role: 'user',
        content: [
          'Write a content piece based on this approved plan:',
          '',
          'Outline: {{outline}}',
          'Keywords: {{keywords}}',
          'Key messages: {{key_messages}}',
          'Target audience: {{target_audience}}',
          'Tone: {{tone}}',
          '',
          '{{prior_draft}}',
          '{{editor_feedback}}',
        ].join('\n'),
      },
    ],
  },
  editor: {
    key: 'editor',
    source: 'src/prompts/editor.ts',
    tags: [...commonTags, 'editor'],
    placeholders: ['outline', 'tone', 'target_audience', 'keywords', 'draft_content'],
    fallback: [
      { role: 'system', content: EDITOR_SYSTEM },
      {
        role: 'user',
        content: [
          'Evaluate this draft against the approved content plan.',
          '',
          '--- CONTENT PLAN ---',
          'Outline: {{outline}}',
          'Tone: {{tone}}',
          'Target audience: {{target_audience}}',
          'Keywords required: {{keywords}}',
          '',
          '--- DRAFT ---',
          '{{draft_content}}',
        ].join('\n'),
      },
    ],
  },
};

let langfusePromptClient: Langfuse | null | undefined;
const warnedFallbacks = new Set<string>();

function getLangfusePromptClient(): Langfuse | null {
  if (langfusePromptClient !== undefined) return langfusePromptClient;

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    langfusePromptClient = null;
    return langfusePromptClient;
  }

  langfusePromptClient = new Langfuse({
    publicKey,
    secretKey,
    baseUrl: LANGFUSE_PROMPT_HOST,
  });
  return langfusePromptClient;
}

function renderTemplate(text: string, variables: Record<string, string>): string {
  return text.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => variables[key] ?? '');
}

function renderFallback(
  messages: ChatPromptMessage[],
  variables: Record<string, string>,
): ChatPromptMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: renderTemplate(message.content, variables),
  }));
}

function toChatMessages(messages: unknown[]): ChatPromptMessage[] {
  return messages.flatMap((message) => {
    if (
      message &&
      typeof message === 'object' &&
      'role' in message &&
      'content' in message &&
      typeof message.role === 'string' &&
      typeof message.content === 'string'
    ) {
      return [{ role: message.role, content: message.content }];
    }
    return [];
  });
}

function warnFallbackOnce(key: PromptKey, reason: string): void {
  if (warnedFallbacks.has(key)) return;
  warnedFallbacks.add(key);
  console.warn(`[prompts] Using local ${key} prompt fallback (${reason})`);
}

export async function compileManagedPrompt(
  key: PromptKey,
  variables: Record<string, string>,
): Promise<CompiledManagedPrompt> {
  const spec = MANAGED_PROMPTS[key];
  const client = getLangfusePromptClient();

  if (!client) {
    return { messages: renderFallback(spec.fallback, variables) };
  }

  try {
    const prompt = await client.getPrompt(promptName(key), undefined, {
      label: LANGFUSE_PROMPT_LABEL,
      type: 'chat',
      fallback: spec.fallback,
      cacheTtlSeconds: LANGFUSE_PROMPT_CACHE_TTL_SECONDS,
      maxRetries: 1,
      fetchTimeoutMs: 2_000,
    });
    const messages = toChatMessages(prompt.compile(variables));
    if (messages.length > 0) {
      if (prompt.isFallback) warnFallbackOnce(key, 'Langfuse fetch returned fallback');
      return {
        messages,
        ...(prompt.isFallback ? {} : { langfusePrompt: prompt }),
      };
    }
  } catch (err) {
    warnFallbackOnce(key, err instanceof Error ? err.message : String(err));
  }

  return { messages: renderFallback(spec.fallback, variables) };
}

function formatOutline(outline: string[]): string {
  return outline.map((item, i) => `\n  ${i + 1}. ${item}`).join('');
}

export function strategistVariables(
  brief: {
    topic: string;
    target_audience: string;
    channel: string;
    tone: string;
    word_count: number;
  },
  feedback?: string | null,
): Record<string, string> {
  return {
    topic: brief.topic,
    target_audience: brief.target_audience,
    channel: brief.channel,
    tone: brief.tone,
    word_count: String(brief.word_count),
    revision_feedback: feedback ? `--- REVISION FEEDBACK (mandatory) ---\n${feedback}` : '',
  };
}

export function writerVariables(
  plan: ContentPlan,
  prior?: { draft: DraftContent; feedback: EditFeedback } | null,
): Record<string, string> {
  return {
    outline: formatOutline(plan.outline),
    keywords: plan.keywords.join(', '),
    key_messages: plan.key_messages.join(' | '),
    target_audience: plan.target_audience,
    tone: plan.tone,
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

export function editorVariables(plan: ContentPlan, draftContent: string): Record<string, string> {
  return {
    outline: formatOutline(plan.outline),
    tone: plan.tone,
    target_audience: plan.target_audience,
    keywords: plan.keywords.join(', '),
    draft_content: draftContent,
  };
}
