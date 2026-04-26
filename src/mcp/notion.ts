import type { StructuredToolInterface } from '@langchain/core/tools';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';

let clientSingleton: MultiServerMCPClient | null = null;
let toolsSingleton: Promise<StructuredToolInterface[]> | null = null;

function getClient(): MultiServerMCPClient {
  if (clientSingleton) return clientSingleton;

  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw new Error('NOTION_TOKEN is not set — required for Notion MCP integration');
  }

  clientSingleton = new MultiServerMCPClient({
    throwOnLoadError: true,
    prefixToolNameWithServerName: false,
    additionalToolNamePrefix: '',
    mcpServers: {
      notion: {
        command: 'npx',
        args: ['-y', '@notionhq/notion-mcp-server'],
        env: {
          OPENAPI_MCP_HEADERS: JSON.stringify({
            Authorization: `Bearer ${token}`,
            'Notion-Version': '2022-06-28',
          }),
        },
      },
    },
  });

  return clientSingleton;
}

async function getTools(): Promise<StructuredToolInterface[]> {
  if (!toolsSingleton) {
    toolsSingleton = getClient().getTools();
  }
  return toolsSingleton;
}

function toUUID(id: string): string {
  const hex = id.replaceAll('-', '');
  if (hex.length !== 32) return id;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const tools = await getTools();
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(
      `Notion MCP tool "${name}" not found. Available: ${tools.map((t) => t.name).join(', ')}`,
    );
  }
  const raw = await tool.invoke(args);
  const parsed: unknown = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : raw;
  if (parsed !== null && typeof parsed === 'object' && 'status' in parsed && typeof (parsed as { status: unknown }).status === 'number' && (parsed as { status: number }).status >= 400) {
    const msg = (parsed as { message?: string }).message ?? `Notion API error ${(parsed as { status: number }).status}`;
    throw new Error(msg);
  }
  return parsed as T;
}

export async function shutdownNotionMcp(): Promise<void> {
  if (!clientSingleton) return;
  await clientSingleton.close();
  clientSingleton = null;
  toolsSingleton = null;
}

// ── Domain helpers ──────────────────────────────────────────────────────────

type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  child_page?: { title: string };
  [key: string]: unknown;
};

type GetBlockChildrenResponse = {
  results: NotionBlock[];
  next_cursor: string | null;
  has_more: boolean;
};

type CreatePageResponse = {
  id: string;
  url: string;
};

export type BrandPage = {
  id: string;
  title: string;
  content: string;
};

async function getAllBlockChildren(blockId: string): Promise<NotionBlock[]> {
  const all: NotionBlock[] = [];
  let cursor: string | undefined;

  do {
    const resp = await callTool<GetBlockChildrenResponse>('API-get-block-children', {
      block_id: toUUID(blockId),
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    all.push(...resp.results);
    cursor = resp.has_more ? (resp.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return all;
}

function richTextToString(rich: unknown): string {
  if (!Array.isArray(rich)) return '';
  return rich.map((r: { plain_text?: string }) => r.plain_text ?? '').join('');
}

function blockToMarkdown(block: NotionBlock): string {
  const t = block.type;
  // biome-ignore lint/suspicious/noExplicitAny: Notion block types are dynamic
  const data = (block as any)[t];
  if (!data) return '';
  const text = richTextToString(data.rich_text);

  switch (t) {
    case 'heading_1':
      return `# ${text}`;
    case 'heading_2':
      return `## ${text}`;
    case 'heading_3':
      return `### ${text}`;
    case 'paragraph':
      return text;
    case 'bulleted_list_item':
      return `- ${text}`;
    case 'numbered_list_item':
      return `1. ${text}`;
    case 'quote':
      return `> ${text}`;
    case 'code':
      return ['```' + (data.language ?? ''), text, '```'].join('\n');
    case 'divider':
      return '---';
    default:
      return text;
  }
}

export async function fetchBrandPages(parentPageId: string): Promise<BrandPage[]> {
  const children = await getAllBlockChildren(parentPageId);
  const childPages = children.filter((b) => b.type === 'child_page');

  const pages = await Promise.all(
    childPages.map(async (page) => {
      const blocks = await getAllBlockChildren(page.id);
      const content = blocks.map(blockToMarkdown).filter(Boolean).join('\n\n');
      return {
        id: page.id,
        title: page.child_page?.title ?? 'Untitled',
        content,
      };
    }),
  );

  return pages;
}

// ── Markdown → Notion blocks ────────────────────────────────────────────────

type NotionRichText = { type: 'text'; text: { content: string } };
type NotionBlockBuild = {
  object: 'block';
  type: string;
  [key: string]: unknown;
};

function rt(content: string): NotionRichText[] {
  // Notion limits rich_text content to 2000 chars per item — split if longer
  const max = 2000;
  if (content.length <= max) return [{ type: 'text', text: { content } }];
  const chunks: NotionRichText[] = [];
  for (let i = 0; i < content.length; i += max) {
    chunks.push({ type: 'text', text: { content: content.slice(i, i + max) } });
  }
  return chunks;
}

function markdownToBlocks(md: string): NotionBlockBuild[] {
  const blocks: NotionBlockBuild[] = [];
  const lines = md.split('\n');

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    if (line.startsWith('### ')) {
      blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: rt(line.slice(4)) } });
    } else if (line.startsWith('## ')) {
      blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: rt(line.slice(3)) } });
    } else if (line.startsWith('# ')) {
      blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: rt(line.slice(2)) } });
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: rt(line.slice(2)) },
      });
    } else if (/^\d+\.\s/.test(line)) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: rt(line.replace(/^\d+\.\s/, '')) },
      });
    } else if (line.startsWith('> ')) {
      blocks.push({ object: 'block', type: 'quote', quote: { rich_text: rt(line.slice(2)) } });
    } else if (line === '---') {
      blocks.push({ object: 'block', type: 'divider', divider: {} });
    } else {
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: rt(line) } });
    }
  }

  return blocks;
}

// Omitting the `type` field lets all block types pass MCP schema validation;
// Notion infers the type from the block-key present in the object.
function toTypelessBlock(block: NotionBlockBuild): Record<string, unknown> {
  const { type, object: _obj, ...rest } = block;
  // Keep only the block-content key (e.g. { paragraph: { rich_text: [...] } })
  // Special case: divider has no content key, pass as-is
  if (type === 'divider') return { divider: {} };
  return rest;
}

async function appendBlocks(pageId: string, blocks: NotionBlockBuild[]): Promise<void> {
  for (let i = 0; i < blocks.length; i += 100) {
    await callTool('API-patch-block-children', {
      block_id: pageId,
      children: blocks.slice(i, i + 100).map(toTypelessBlock),
    });
  }
}

export async function createBrandPage(args: {
  parentPageId: string;
  title: string;
  content: string;
}): Promise<CreatePageResponse> {
  const page = await callTool<CreatePageResponse>('API-post-page', {
    parent: { page_id: toUUID(args.parentPageId) },
    properties: {
      title: {
        title: [{ type: 'text', text: { content: args.title } }],
      },
    },
  });

  await appendBlocks(page.id, markdownToBlocks(args.content));
  return page;
}

export type PublishArgs = {
  databaseId: string;
  title: string;
  content: string;
  channel: string;
  wordCount: number;
  status: 'Approved' | 'Unapproved';
};

async function ensureDatabaseColumns(databaseId: string): Promise<void> {
  console.log('[publisher] Creating missing database columns...');
  const token = process.env.NOTION_TOKEN;
  const resp = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        Channel: { select: {} },
        'Word Count': { number: { format: 'number' } },
        Status: {
          select: {
            options: [
              { name: 'Approved', color: 'green' },
              { name: 'Unapproved', color: 'red' },
            ],
          },
        },
      },
    }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(`Failed to create database columns: ${(body as { message?: string }).message ?? resp.statusText}`);
  }
  console.log('[publisher] Columns created.');
}

export async function publishDraft(args: PublishArgs): Promise<CreatePageResponse> {
  const dbId = toUUID(args.databaseId);
  const fullProperties = {
    Name: { title: [{ text: { content: args.title } }] },
    Channel: { select: { name: args.channel } },
    'Word Count': { number: args.wordCount },
    Status: { select: { name: args.status } },
  };

  let page: CreatePageResponse;
  try {
    page = await callTool<CreatePageResponse>('API-post-page', {
      parent: { database_id: dbId },
      properties: fullProperties,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('is not a property that exists')) {
      await ensureDatabaseColumns(dbId);
      page = await callTool<CreatePageResponse>('API-post-page', {
        parent: { database_id: dbId },
        properties: fullProperties,
      });
    } else {
      throw err;
    }
  }

  await appendBlocks(page.id, markdownToBlocks(args.content));
  return page;
}
