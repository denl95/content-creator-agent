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
