'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMessages } from '@/i18n/provider';
import type { BrandProfilePayload, StyleGuidePayload } from '@/lib/types';

const AREA = 'min-h-24 w-full rounded-md border bg-transparent p-2 text-sm';

/** One line per entry keeps the round-trip lossless and obvious to edit. */
function toLines(values: string[]): string {
  return values.join('\n');
}

function fromLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function BrandReview({
  profile,
  styleGuide,
  exemplarCount,
  onDecision,
}: {
  profile: BrandProfilePayload;
  styleGuide: StyleGuidePayload;
  exemplarCount: number;
  onDecision: (
    approved: boolean,
    payload?: { feedback?: string; edits?: Record<string, unknown> },
  ) => void;
}) {
  const m = useMessages();
  const [mission, setMission] = useState(profile.mission);
  const [voice, setVoice] = useState(toLines(styleGuide.voice));
  const [forbidden, setForbidden] = useState(toLines(styleGuide.forbidden_phrases));
  const [feedback, setFeedback] = useState('');

  return (
    <Card className="border-brand/40">
      <CardHeader>
        <CardTitle>
          {m.brands.reviewTitle({ name: profile.name })}{' '}
          <span className="text-sm font-normal text-muted-foreground">
            {m.brands.reviewMeta({ language: styleGuide.language, exemplars: exemplarCount })}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="block space-y-1 text-sm">
          <span className="eonyx-label">{m.brands.mission}</span>
          <textarea value={mission} onChange={(e) => setMission(e.target.value)} className={AREA} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="eonyx-label">{m.brands.voice}</span>
          <textarea value={voice} onChange={(e) => setVoice(e.target.value)} className={AREA} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="eonyx-label">{m.brands.forbidden}</span>
          <textarea
            value={forbidden}
            onChange={(e) => setForbidden(e.target.value)}
            className={AREA}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          {m.brands.exemplarNote}
        </p>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={m.brands.feedbackPlaceholder}
          className={AREA}
        />
        <div className="flex gap-2">
          <Button
            onClick={() =>
              onDecision(true, {
                edits: {
                  profile: { mission },
                  style_guide: {
                    voice: fromLines(voice),
                    forbidden_phrases: fromLines(forbidden),
                  },
                },
              })
            }
          >
            {m.common.approve}
          </Button>
          <Button
            variant="secondary"
            disabled={feedback.trim().length === 0}
            onClick={() => onDecision(false, { feedback: feedback.trim() })}
          >
            {m.brands.distilAgain}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
