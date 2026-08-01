'use client';

import Link from 'next/link';
import { type FormEvent, useRef, useState } from 'react';
import { PipelineProgress } from '@/components/pipeline-progress';
import { PlanApproval } from '@/components/plan-approval';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatUsd } from '@/lib/format';
import { type ContentPlan, type EditFeedback, NODES, type RunEvent } from '@/lib/types';

const CHANNELS = ['blog', 'linkedin', 'twitter', 'instagram', 'threads'];

export default function RunPage() {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [plan, setPlan] = useState<ContentPlan | null>(null);
  const [feedback, setFeedback] = useState<EditFeedback | null>(null);
  const [result, setResult] = useState<{ costUsd: number; tokens: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const lastSeq = useRef(-1);
  const source = useRef<EventSource | null>(null);
  const threadIdRef = useRef<string | null>(null);

  function handle(event: RunEvent) {
    if (NODES.includes(event.node)) {
      setDone((prev) => new Set(prev).add(event.node));
      setActive(null);
    }
    if (event.node === 'hitl' && event.data?.awaiting) {
      setPlan(event.data.payload?.plan ?? null);
    }
    if (event.node === 'editor' && event.data?.editFeedback) {
      setFeedback(event.data.editFeedback);
      setDone((prev) => {
        const next = new Set(prev);
        next.delete('editor');
        return next;
      });
      setActive('editor');
    }
    if (event.node === 'done') {
      setResult({ costUsd: event.data.costUsd ?? 0, tokens: event.data.tokens ?? 0 });
      setRunning(false);
      setActive(null);
      source.current?.close();
    }
    if (event.node === 'error') {
      setError(event.data.message ?? 'Run failed');
      setRunning(false);
      setActive(null);
      source.current?.close();
    }
  }

  function listen(id: string) {
    source.current?.close();
    const es = new EventSource(`/api/runs/${id}/events`);
    es.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as RunEvent;
      // seq is monotonic per run; replayed events on reconnect are skipped.
      if (parsed.seq <= lastSeq.current) return;
      lastSeq.current = parsed.seq;
      handle(parsed);
    };
    source.current = es;
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    setDone(new Set());
    setPlan(null);
    setFeedback(null);
    setResult(null);
    setError(null);
    lastSeq.current = -1;
    setRunning(true);
    setActive('strategist');

    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        topic: formData.get('topic'),
        channel: formData.get('channel'),
        tone: formData.get('tone'),
        target_audience: formData.get('target_audience'),
        word_count: Number(formData.get('word_count')),
      }),
    });
    if (!res.ok) {
      setError('Invalid brief');
      setRunning(false);
      setActive(null);
      return;
    }
    const { thread_id } = (await res.json()) as { thread_id: string };
    threadIdRef.current = thread_id;
    setThreadId(thread_id);
    listen(thread_id);
  }

  async function decide(approved: boolean, note?: string) {
    const id = threadIdRef.current;
    if (!id) return;
    setPlan(null);
    setActive('writer');
    await fetch(`/api/runs/${id}/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(approved ? { approved: true } : { approved: false, feedback: note }),
    });
    listen(id);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">New run</h1>

      <Card>
        <CardContent className="p-6">
          <form onSubmit={start} className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Topic
              <input
                name="topic"
                required
                defaultValue="How an AI assistant saves 10 hours a week"
                className="rounded-md border bg-transparent px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Channel
              <select name="channel" className="rounded-md border bg-transparent px-3 py-2">
                {CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {channel}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Tone
              <input
                name="tone"
                required
                defaultValue="professional"
                className="rounded-md border bg-transparent px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Audience
              <input
                name="target_audience"
                required
                defaultValue="SMB owners"
                className="rounded-md border bg-transparent px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Word count
              <input
                name="word_count"
                type="number"
                required
                defaultValue={800}
                className="rounded-md border bg-transparent px-3 py-2"
              />
            </label>
            <div className="flex items-end">
              <Button type="submit" disabled={running} className="w-full">
                {running ? 'Running…' : 'Generate'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <PipelineProgress done={done} active={active} />

      {feedback ? (
        <p className="text-sm text-muted-foreground">
          editor: {feedback.verdict} · tone {feedback.tone_score} · accuracy{' '}
          {feedback.accuracy_score} · structure {feedback.structure_score}
        </p>
      ) : null}

      {plan ? <PlanApproval plan={plan} onDecision={decide} /> : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {result && threadId ? (
        <Card>
          <CardHeader>
            <CardTitle>Done</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {formatUsd(result.costUsd)} · {result.tokens} tokens
            </p>
            <Link href={`/drafts/${threadId}`} className="text-sm underline">
              Open the finished draft →
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
