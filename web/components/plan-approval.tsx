'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ContentPlan } from '@/lib/types';

export function PlanApproval({
  plan,
  defaultNote = '',
  onDecision,
}: {
  plan: ContentPlan;
  /** Seeds the note so a failed submit does not discard what the user typed. */
  defaultNote?: string;
  onDecision: (approved: boolean, feedback?: string) => void;
}) {
  const [feedback, setFeedback] = useState(defaultNote);

  return (
    <Card className="border-brand/40">
      <CardHeader>
        <CardTitle>Content plan — approve?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {plan.outline.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
        <p className="text-sm">
          <span className="font-medium">Keywords:</span> {plan.keywords.join(', ')}
        </p>
        <p className="text-sm">
          <span className="font-medium">Tone:</span> {plan.tone} ·{' '}
          <span className="font-medium">Audience:</span> {plan.target_audience}
        </p>
        {plan.conflicts?.length ? (
          <div className="space-y-1 border-l-2 border-brand pl-3">
            <p className="eonyx-label">Brief overrides brand guide</p>
            {plan.conflicts.map((conflict) => (
              <p key={conflict.dimension} className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{conflict.dimension}</span> — brief:{' '}
                {conflict.brief_value} · brand guide: {conflict.corpus_value}
              </p>
            ))}
            <p className="text-xs text-muted-foreground">Approving keeps the brief&apos;s values.</p>
          </div>
        ) : null}
        <textarea
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          placeholder="Feedback (required to request changes)"
          className="min-h-20 w-full rounded-md border bg-transparent p-2 text-sm"
        />
        <div className="flex gap-2">
          <Button onClick={() => onDecision(true)}>Approve</Button>
          <Button
            variant="secondary"
            disabled={feedback.trim().length === 0}
            onClick={() => onDecision(false, feedback.trim())}
          >
            Request changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
