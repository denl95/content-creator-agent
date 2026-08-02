import { describe, expect, test } from 'bun:test';
import { editorVariables, strategistVariables, writerVariables } from '../../src/prompts/managed';
import { type Brief, BriefSchema, type ContentPlan } from '../../src/schemas';

const brief: Brief = {
  topic: 'AI assistants for SMBs',
  target_audience: 'SMB owners',
  channel: 'linkedin',
  tone: 'professional',
  word_count: 900,
  language: 'uk',
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
  test('includes channel, word counts, and brand style', () => {
    const vars = editorVariables(plan, brief, 'five words of draft content', 'BRAND RULES');
    expect(vars.channel).toBe('linkedin');
    expect(vars.word_count).toBe('900');
    expect(vars.actual_word_count).toBe('5');
    expect(vars.brand_style).toBe('BRAND RULES');
  });
});

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
