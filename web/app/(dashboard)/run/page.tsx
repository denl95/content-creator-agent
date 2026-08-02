'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ActivityLog, type ActivityEntry } from '@/components/activity-log';
import { PipelineProgress } from '@/components/pipeline-progress';
import { PlanApproval } from '@/components/plan-approval';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatUsd } from '@/lib/format';
import { type ContentPlan, type EditFeedback, NODES, type RunEvent } from '@/lib/types';

const CHANNELS = ['blog', 'linkedin', 'twitter', 'instagram', 'threads'];
/** Enough to follow a run without letting a long editor loop grow unbounded. */
const MAX_ACTIVITY = 50;

type Connection = 'idle' | 'open' | 'reconnecting' | 'lost';

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  if (res.status === 401) return 'Your session expired. Sign in again to continue.';
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  if (typeof body?.error === 'string') return body.error;
  return `${fallback} (HTTP ${res.status})`;
}

/**
 * Where the run stands at the approval gate.
 *
 * A failed resume does not mean the resume never happened — a 502 from the
 * proxy, or a connection dropped after delivery, can both leave the run already
 * past the gate. Restoring the approval card then would show a plan for a run
 * that is mid-writer, and the next Approve would 409 with "the run timed out",
 * which is the opposite of true. 'unknown' keeps the card, because a still-
 * waiting run is the case where the user needs it.
 */
type GateState = 'awaiting' | 'moved' | 'gone' | 'unknown';

async function gateState(id: string): Promise<GateState> {
  try {
    const res = await fetch(`/api/runs/${id}`);
    if (res.status === 404) return 'gone';
    if (!res.ok) return 'unknown';
    const run = (await res.json().catch(() => null)) as { status?: unknown } | null;
    if (typeof run?.status !== 'string') return 'unknown';
    return run.status === 'awaiting_approval' ? 'awaiting' : 'moved';
  } catch {
    return 'unknown';
  }
}

export default function RunPage() {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [plan, setPlan] = useState<ContentPlan | null>(null);
  // Survives a failed "Request changes" so the user's typed note is not lost
  // when the approval card is restored. PlanApproval seeds its own state from
  // this on mount, and restoring the plan remounts it.
  const [planNote, setPlanNote] = useState('');
  const [feedback, setFeedback] = useState<EditFeedback | null>(null);
  const [result, setResult] = useState<{ costUsd: number; tokens: number } | null>(null);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [live, setLive] = useState<{ costUsd: number; tokens: number } | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [connection, setConnection] = useState<Connection>('idle');
  const lastSeq = useRef(-1);
  const source = useRef<EventSource | null>(null);
  const threadIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!running || startedAt === null) return;
    // `start()` resets elapsed to 0, so the first tick can wait for the interval
    // — setting state synchronously here would just cascade a render.
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [running, startedAt]);

  // The page owns the EventSource, so it must be closed when the user leaves.
  useEffect(() => () => source.current?.close(), []);

  /**
   * The run is no longer on the server. The stream has to be closed here:
   * leaving it open means the endpoint 404s on the next reconnect, `onerror`
   * fires with readyState CLOSED, and this accurate message is replaced a second
   * later by "Lost the connection…" plus a reconnect button that can only 404.
   */
  function runIsGone() {
    source.current?.close();
    setConnection('idle');
    stop({
      title: 'Run no longer active',
      message: 'The server restarted or the run timed out. Start a new run.',
    });
  }

  // Not every stop is a failed run — a rejected resume or a dropped connection
  // leaves the run alive server-side, so the heading has to say which it is.
  function stop(failure?: { title: string; message: string }) {
    setRunning(false);
    setActive(null);
    if (failure) setError(failure);
  }

  function handle(event: RunEvent) {
    if (event.node === 'activity') {
      const entry: ActivityEntry = { ...event.data, ts: event.ts, seq: event.seq };
      setActivity((prev) => [...prev, entry].slice(-MAX_ACTIVITY));
      setLive({ costUsd: entry.costUsd ?? 0, tokens: entry.tokens ?? 0 });
      // Activity is the only signal for which step is *currently* working — node
      // events only ever say a step finished.
      if (NODES.includes(entry.step)) setActive(entry.step);
      return;
    }
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
      setConnection('idle');
      stop();
      source.current?.close();
    }
    if (event.node === 'error') {
      setConnection('idle');
      stop({ title: 'Run failed', message: event.data.message ?? 'The run failed.' });
      source.current?.close();
    }
  }

  function listen(id: string) {
    source.current?.close();
    const es = new EventSource(`/api/runs/${id}/events`);
    es.onopen = () => setConnection('open');
    es.onmessage = (event) => {
      let parsed: RunEvent;
      try {
        parsed = JSON.parse(event.data) as RunEvent;
      } catch {
        // A malformed frame must not take down the whole stream.
        return;
      }
      // seq is monotonic per run; replayed events on reconnect are skipped.
      if (parsed.seq <= lastSeq.current) return;
      lastSeq.current = parsed.seq;
      handle(parsed);
    };
    es.onerror = () => {
      // CLOSED means the browser gave up (or the endpoint answered non-2xx, e.g.
      // the run is gone after a restart). CONNECTING means it is retrying on its
      // own, so say so rather than declaring failure.
      if (es.readyState === EventSource.CLOSED) {
        setConnection('lost');
        stop({
          title: 'Connection lost',
          message:
            'Lost the connection to this run and could not reconnect. If the server restarted, the run is gone — but any finished draft is still saved under Drafts.',
        });
      } else {
        setConnection('reconnecting');
      }
    };
    source.current = es;
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    // Close first: `lastSeq` is reset below, so a still-open stream from a
    // previous run (one parked at the approval gate, say) would have its events
    // accepted past the cleared floor and rendered as this run's. The early
    // returns further down never reach `listen()`, which would leave it feeding
    // `handle()` indefinitely.
    source.current?.close();
    setDone(new Set());
    setPlan(null);
    setPlanNote('');
    setFeedback(null);
    setResult(null);
    setError(null);
    setActivity([]);
    setLive(null);
    setStartedAt(Date.now());
    setElapsed(0);
    setConnection('idle');
    lastSeq.current = -1;
    setRunning(true);
    setActive('strategist');

    let res: Response;
    try {
      res = await fetch('/api/runs', {
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
    } catch {
      stop({
        title: 'Cannot reach the server',
        message: 'Check that the API is running and try again.',
      });
      return;
    }
    if (!res.ok) {
      stop({
        title: 'Could not start the run',
        message: await errorMessage(res, 'Could not start the run'),
      });
      return;
    }
    // A 2xx that is not the JSON we expect would otherwise throw here and leave
    // the form pinned on "Running…" with nothing shown.
    const body = (await res.json().catch(() => null)) as { thread_id?: unknown } | null;
    if (typeof body?.thread_id !== 'string') {
      stop({
        title: 'Could not start the run',
        message: 'The server accepted the brief but returned no run id.',
      });
      return;
    }
    threadIdRef.current = body.thread_id;
    setThreadId(body.thread_id);
    listen(body.thread_id);
  }

  async function decide(approved: boolean, note?: string) {
    const id = threadIdRef.current;
    if (!id) return;
    // Keep the plan so a failed submit can put the card back. Without this the
    // approval UI is gone for a run that is still sitting in awaiting_approval
    // server-side, and telling the user "the run is still waiting" is useless
    // because there is no longer anything to approve with.
    const submitted = plan;
    // Clear any earlier failure up front: this attempt may well succeed, and a
    // stale red alert sitting above a streaming run reads as a broken run.
    setError(null);
    setPlan(null);
    setActive('writer');

    // Shared by every failure path. Whether the card comes back depends on where
    // the run actually stands, not on the assumption that the request never landed.
    const handleFailure = async (message: string) => {
      const state = await gateState(id);
      if (state === 'moved') {
        // The decision was delivered after all — follow the run instead of
        // claiming a failure the user would otherwise "retry" into a 409.
        setRunning(true);
        listen(id);
        return;
      }
      if (state === 'gone') {
        runIsGone();
        return;
      }
      setPlan(submitted);
      setPlanNote(note ?? '');
      stop({ title: 'Could not submit your decision', message });
    };

    let res: Response;
    try {
      res = await fetch(`/api/runs/${id}/resume`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(approved ? { approved: true } : { approved: false, feedback: note }),
      });
    } catch {
      await handleFailure('The server was unreachable. The run is still waiting — try again.');
      return;
    }
    if (!res.ok) {
      // 409 is the one status that is self-explanatory: the run is no longer
      // awaiting approval because the server restarted or the TTL sweep dropped
      // it, and runs live in memory only.
      if (res.status === 409) runIsGone();
      else await handleFailure(await errorMessage(res, 'The server rejected the request'));
      return;
    }
    setPlanNote('');
    setRunning(true);
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

      <div className="space-y-3">
        <PipelineProgress done={done} active={active} />

        {/* Deliberately not a live region: the elapsed clock ticks every second,
            so announcing it would mean continuous speech for the whole run. The
            activity log below carries role="log" instead. */}
        {running || activity.length > 0 ? (
          <p className="eonyx-label flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="tabular-nums">{formatElapsed(elapsed)} elapsed</span>
            {live ? (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{live.tokens.toLocaleString()} tokens</span>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{formatUsd(live.costUsd)}</span>
              </>
            ) : null}
            {connection === 'reconnecting' ? (
              <span className="text-state-revision">· reconnecting…</span>
            ) : null}
          </p>
        ) : null}

        <ActivityLog entries={activity} />
      </div>

      {feedback ? (
        <p className="text-sm text-muted-foreground">
          editor: {feedback.verdict} · tone {feedback.tone_score} · accuracy{' '}
          {feedback.accuracy_score} · structure {feedback.structure_score}
        </p>
      ) : null}

      {plan ? <PlanApproval plan={plan} defaultNote={planNote} onDecision={decide} /> : null}

      {error ? (
        <div
          role="alert"
          className="rounded-sm border border-l-2 border-destructive/40 border-l-destructive bg-destructive/10 p-4"
        >
          <p className="eonyx-label text-destructive">{error.title}</p>
          <p className="mt-1 text-sm">{error.message}</p>
          {connection === 'lost' && threadId ? (
            <Button
              variant="secondary"
              className="mt-3"
              onClick={() => {
                setError(null);
                setRunning(true);
                listen(threadId);
              }}
            >
              Try reconnecting
            </Button>
          ) : null}
        </div>
      ) : null}

      {result && threadId ? (
        <Card>
          <CardHeader>
            <CardTitle>Done</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {formatUsd(result.costUsd)} · {result.tokens.toLocaleString()} tokens ·{' '}
              {formatElapsed(elapsed)}
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
