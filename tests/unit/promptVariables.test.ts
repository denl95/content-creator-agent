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
  brand_id: 'test-brand',
};

const plan: ContentPlan = {
  outline: ['Intro', 'Problem', 'Solution', 'CTA'],
  keywords: ['ai assistant', 'small business'],
  key_messages: ['AI is accessible'],
  target_audience: 'SMB owners',
  tone: 'professional',
  conflicts: [],
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
      brand_id: 'b1',
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
      brand_id: 'b1',
      language: 'en',
    });
    expect(parsed.language).toBe('en');
  });
});

describe('approved_conflicts', () => {
  test('reads as agreement when the plan records no conflicts', () => {
    const vars = editorVariables(plan, brief, 'draft', 'BRAND RULES');
    expect(vars.approved_conflicts).toBe('None — the brief and the brand corpus agree.');
  });

  test('renders each conflict with the brief value marked authoritative', () => {
    const conflicted: ContentPlan = {
      ...plan,
      conflicts: [
        {
          dimension: 'word_count',
          brief_value: '300',
          corpus_value: '800–1200 for LinkedIn',
        },
      ],
    };
    const vars = editorVariables(conflicted, brief, 'draft', 'BRAND RULES');
    expect(vars.approved_conflicts).toContain('word_count');
    expect(vars.approved_conflicts).toContain('300');
    expect(vars.approved_conflicts).toContain('800–1200 for LinkedIn');
    expect(vars.approved_conflicts).toContain('authoritative');
  });
});
