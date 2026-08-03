'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMessages } from '@/i18n/provider';
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
  const m = useMessages();
  const [feedback, setFeedback] = useState(defaultNote);

  return (
    <Card className="border-brand/40">
      <CardHeader>
        <CardTitle>{m.run.planTitle}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {plan.outline.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
        <p className="text-sm">
          <span className="font-medium">{m.run.keywords}</span> {plan.keywords.join(', ')}
        </p>
        <p className="text-sm">
          <span className="font-medium">{m.run.tone}</span> {plan.tone} ·{' '}
          <span className="font-medium">{m.run.audience}</span> {plan.target_audience}
        </p>
        {plan.conflicts?.length ? (
          <div className="space-y-1 border-l-2 border-brand pl-3">
            <p className="eonyx-label">{m.run.conflictsTitle}</p>
            {plan.conflicts.map((conflict) => (
              <p key={conflict.dimension} className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{conflict.dimension}</span> —{' '}
                {m.run.conflictLine({
                  brief: conflict.brief_value,
                  corpus: conflict.corpus_value,
                })}
              </p>
            ))}
            <p className="text-xs text-muted-foreground">{m.run.conflictsNote}</p>
          </div>
        ) : null}
        <textarea
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          placeholder={m.run.feedbackPlaceholder}
          className="min-h-20 w-full rounded-md border bg-transparent p-2 text-sm"
        />
        <div className="flex gap-2">
          <Button onClick={() => onDecision(true)}>{m.common.approve}</Button>
          <Button
            variant="secondary"
            disabled={feedback.trim().length === 0}
            onClick={() => onDecision(false, feedback.trim())}
          >
            {m.common.requestChanges}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
