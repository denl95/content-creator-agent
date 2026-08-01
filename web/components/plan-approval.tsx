'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ContentPlan } from '@/lib/types';

export function PlanApproval({
  plan,
  onDecision,
}: {
  plan: ContentPlan;
  onDecision: (approved: boolean, feedback?: string) => void;
}) {
  const [feedback, setFeedback] = useState('');

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
