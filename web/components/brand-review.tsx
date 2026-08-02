'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  const [mission, setMission] = useState(profile.mission);
  const [voice, setVoice] = useState(toLines(styleGuide.voice));
  const [forbidden, setForbidden] = useState(toLines(styleGuide.forbidden_phrases));
  const [feedback, setFeedback] = useState('');

  return (
    <Card className="border-brand/40">
      <CardHeader>
        <CardTitle>
          {profile.name} — approve this brand?{' '}
          <span className="text-sm font-normal text-muted-foreground">
            {styleGuide.language} · {exemplarCount} exemplars
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="block space-y-1 text-sm">
          <span className="eonyx-label">Mission</span>
          <textarea value={mission} onChange={(e) => setMission(e.target.value)} className={AREA} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="eonyx-label">Voice — one per line</span>
          <textarea value={voice} onChange={(e) => setVoice(e.target.value)} className={AREA} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="eonyx-label">Forbidden phrases — one per line</span>
          <textarea
            value={forbidden}
            onChange={(e) => setForbidden(e.target.value)}
            className={AREA}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Exemplars are accepted or re-distilled as a set — a hand-edited exemplar stops being
          evidence of how the brand actually writes.
        </p>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Feedback (required to distil again)"
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
            Approve
          </Button>
          <Button
            variant="secondary"
            disabled={feedback.trim().length === 0}
            onClick={() => onDecision(false, { feedback: feedback.trim() })}
          >
            Distil again
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
