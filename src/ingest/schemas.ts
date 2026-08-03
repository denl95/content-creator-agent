import { z } from 'zod';

export const BrandProfileSchema = z.object({
  name: z.string().describe('The brand name as it refers to itself'),
  mission: z.string().describe('What the brand exists to do, in its own framing'),
  services: z.array(z.string()).describe('Concrete products or services offered'),
  audience_primary: z.string().describe('Who the brand mainly writes for'),
  audience_secondary: z.string().describe('A secondary audience, or an empty string'),
  positioning: z.string().describe('How the brand differs from its competitors'),
  channels: z
    .array(
      z.object({
        channel: z.string(),
        description: z.string(),
        word_range: z.string().describe("Observed length, e.g. '800-1200'; empty when unknown"),
        cadence: z.string().describe('Observed posting rhythm; empty when unknown'),
      }),
    )
    .describe('Channels the brand publishes on. Return an empty array when none are evident.'),
});

export const StyleGuideSchema = z.object({
  voice: z.array(z.string()).describe('Tone attributes, each with a short explanation'),
  forbidden_phrases: z
    .array(z.string())
    .describe(
      'Phrases the brand demonstrably avoids or explicitly bans. Ground each one in the corpus; an empty array is a valid answer.',
    ),
  preferred_constructions: z.array(z.string()).describe('Sentence and structure habits to imitate'),
  formatting_rules: z.array(z.string()).describe('Heading, list and length conventions'),
  language: z.string().describe("BCP-47 tag for the language the corpus is written in, e.g. 'uk'"),
});

export const ExemplarSchema = z.object({
  title: z.string(),
  channel: z.string(),
  content: z.string().describe('Copied verbatim from the corpus, never paraphrased'),
  why_representative: z.string(),
});

export const DistillationSchema = z.object({
  profile: BrandProfileSchema,
  style_guide: StyleGuideSchema,
  exemplars: z
    .array(ExemplarSchema)
    .describe(
      'The most representative pieces in the corpus, copied verbatim. Prefer real published posts over marketing pages. Return fewer rather than inventing any.',
    ),
});

export type BrandProfile = z.infer<typeof BrandProfileSchema>;
export type StyleGuide = z.infer<typeof StyleGuideSchema>;
export type Exemplar = z.infer<typeof ExemplarSchema>;
export type Distillation = z.infer<typeof DistillationSchema>;
