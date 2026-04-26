import { ChatOpenAI } from '@langchain/openai';

export const model = new ChatOpenAI({
  model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
});
