import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';

export const JudgeVerdictSchema = z.object({
  pass: z.boolean().describe('true if the output meets all criteria'),
  overall_score: z.number().min(0).max(1).describe('0–1 aggregate quality score'),
  criteria: z
    .record(z.string(), z.number().min(0).max(1))
    .describe('per-criterion scores keyed by criterion name'),
  reasoning: z.string().min(20).describe('explanation of the verdict, at least one sentence'),
});

export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

const TEST_MODEL = process.env.TEST_MODEL ?? 'gpt-4o-mini';

export function makeJudge(systemPrompt: string) {
  const llm = new ChatOpenAI({ model: TEST_MODEL, temperature: 0 }).withStructuredOutput(
    JudgeVerdictSchema,
    { name: 'judge_verdict' },
  );

  return async (userMessage: string): Promise<JudgeVerdict> => {
    return llm.invoke([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ]);
  };
}
