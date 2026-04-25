import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const OUTPUT_DIR = 'output';

export const saveContent = tool(
  async ({ filename, content }) => {
    await mkdir(OUTPUT_DIR, { recursive: true });
    const filePath = path.resolve(OUTPUT_DIR, filename);
    await Bun.write(filePath, content);
    return filePath;
  },
  {
    name: 'save_content',
    description: 'Persist the final approved article as a Markdown file under ./output/.',
    schema: z.object({
      filename: z
        .string()
        .regex(
          /^[a-z0-9-]+\.md$/,
          'filename must be lowercase alphanumeric with hyphens, ending in .md',
        )
        .describe("Output filename, e.g. 'ai-in-accounting.md'"),
      content: z.string().describe('Full Markdown content to save'),
    }),
  },
);
