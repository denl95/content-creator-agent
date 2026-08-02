'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ActivityLog, type ActivityEntry } from '@/components/activity-log';
import { BriefForm } from '@/components/brief-form';
import { PipelineProgress } from '@/components/pipeline-progress';
import { PlanApproval } from '@/components/plan-approval';
import { RunError, type RunFailure } from '@/components/run-error';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { errorMessage } from '@/lib/errors';
import { formatElapsed, formatUsd } from '@/lib/format';
import { type Brand, type ContentPlan, type EditFeedback, NODES, type RunEvent } from '@/lib/types';

/** Enough to follow a run without letting a long editor loop grow unbounded. */
const MAX_ACTIVITY = 50;

/** Where the run stands once a resume attempt has failed. */
type Gate =
  | 'restore' // still at the approval gate, or unknowable — put the card back
  | 'moved' // the decision landed after all; follow the run
  | 'gone'; // the run no longer exists

/**
 * A failed resume does not mean the resume never happened — a 502 from the
 * proxy, or a connection dropped after delivery, can both leave the run already
 * past the gate. Restoring the approval card then would show a plan for a run
 * that is mid-writer, and the next Approve would 409 with "the run timed out",
 * which is the opposite of true. An unknown answer maps to 'restore', because a
 * still-waiting run is the case where the user needs the card back.
 */
function gateFromStatus(status: unknown): Gate {
  if (status === null) return 'gone';
  if (typeof status !== 'string') return 'restore';
  return status === 'awaiting_approval' ? 'restore' : 'moved';
}

/** Ask the server where the run stands. Only needed when no response came back. */
async function fetchGate(id: string): Promise<Gate> {
  try {
    const res = await fetch(`/api/runs/${id}`);
    if (res.status === 404) return 'gone';
    if (!res.ok) return 'restore';
    const run = (await res.json().catch(() => null)) as { status?: unknown } | null;
    return gateFromStatus(run?.status);
  } catch {
    return 'restore';
  }
}

type Submission = { ok: true } | { ok: false; gate: Gate; message: string };

/**
 * Submit an approval decision. The 409 body carries the run's actual status, so
 * a rejected decision is classified without a second round-trip; only a genuine
 * transport failure has to ask.
 */
async function submitDecision(id: string, approved: boolean, note?: string): Promise<Submission> {
  let res: Response;
  try {
    res = await fetch(`/api/runs/${id}/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(approved ? { approved: true } : { approved: false, feedback: note }),
    });
  } catch {
    return {
      ok: false,
      gate: await fetchGate(id),
      message: 'The server was unreachable. The run is still waiting — try again.',
    };
  }
  if (res.ok) return { ok: true };
  if (res.status === 409) {
    const body = (await res.json().catch(() => null)) as { status?: unknown } | null;
    return {
      ok: false,
      gate: gateFromStatus(body?.status ?? null),
      message: 'The server restarted or the run timed out. Start a new run.',
    };
  }
  return {
    ok: false,
    gate: await fetchGate(id),
    message: await errorMessage(res, 'The server rejected the request'),
  };
}

export default function RunPage() {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [plan, setPlan] = useState<ContentPlan | null>(null);
  // Survives a failed "Request changes" so the user's typed note is not lost
  // when the approval card is restored; PlanApproval seeds its state from this.
  const [planNote, setPlanNote] = useState('');
  const [feedback, setFeedback] = useState<EditFeedback | null>(null);
  const [result, setResult] = useState<{ costUsd: number; tokens: number } | null>(null);
  const [error, setError] = useState<RunFailure | null>(null);
  const [running, setRunning] = useState(false);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // null until the request settles, so the form can tell loading from empty.
  const [brands, setBrands] = useState<Brand[] | null>(null);

  // The API sorts the default brand first, so the initial option is correct
  // without the client tracking a default of its own.
  useEffect(() => {
    fetch('/api/brands')
      .then((res) => (res.ok ? res.json() : []))
      .then((list: Brand[]) => setBrands(list))
      .catch(() => setBrands([]));
  }, []);
  const [elapsed, setElapsed] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const lastSeq = useRef(-1);
  const source = useRef<EventSource | null>(null);

  // Cost and tokens ride along on every activity event, and the cap drops from
  // the front — so the newest entry always holds the live totals. No separate
  // state to keep in step.
  const latest = activity[activity.length - 1];

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
   * Wind the run down. Closing the stream is part of stopping: leaving it open
   * after the run is gone means the endpoint 404s on the next reconnect,
   * `onerror` fires with readyState CLOSED, and an accurate message is replaced
   * a second later by "Lost the connection…". Every caller wants that, so it
   * belongs here rather than being repeated at each site.
   */
  function stop(failure?: RunFailure) {
    source.current?.close();
    setRunning(false);
    setActive(null);
    setReconnecting(false);
    if (failure) setError(failure);
  }

  function handle(event: RunEvent) {
    if (event.node === 'activity') {
      const entry: ActivityEntry = { ...event.data, ts: event.ts, seq: event.seq };
      setActivity((prev) => [...prev, entry].slice(-MAX_ACTIVITY));
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
      stop();
    }
    if (event.node === 'error') {
      stop({ title: 'Run failed', message: event.data.message ?? 'The run failed.' });
    }
  }

  function listen(id: string) {
    source.current?.close();
    const es = new EventSource(`/api/runs/${id}/events`);
    es.onopen = () => setReconnecting(false);
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
        stop({
          title: 'Connection lost',
          message:
            'Lost the connection to this run and could not reconnect. If the server restarted, the run is gone — but any finished draft is still saved under Drafts.',
          retry: true,
        });
      } else {
        setReconnecting(true);
      }
    };
    source.current = es;
  }

  /** Attach to a run that is (still) in flight. */
  function follow(id: string) {
    setThreadId(id);
    setRunning(true);
    listen(id);
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    // Close first: `lastSeq` is reset below, so a still-open stream from a
    // previous run (one parked at the approval gate, say) would have its events
    // accepted past the cleared floor and rendered as this run's.
    source.current?.close();
    setDone(new Set());
    setPlan(null);
    setPlanNote('');
    setFeedback(null);
    setResult(null);
    setError(null);
    setActivity([]);
    setStartedAt(Date.now());
    setElapsed(0);
    setReconnecting(false);
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
          language: formData.get('language'),
          brand_id: formData.get('brand_id'),
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
    follow(body.thread_id);
  }

  async function decide(approved: boolean, note?: string) {
    if (!threadId) return;
    const submitted = plan;
    // Clear any earlier failure up front: this attempt may well succeed, and a
    // stale red alert sitting above a streaming run reads as a broken run.
    setError(null);
    setPlan(null);
    setActive('writer');

    const outcome = await submitDecision(threadId, approved, note);
    if (outcome.ok || outcome.gate === 'moved') {
      setPlanNote('');
      follow(threadId);
      return;
    }
    if (outcome.gate === 'gone') {
      stop({ title: 'Run no longer active', message: outcome.message });
      return;
    }
    setPlan(submitted);
    setPlanNote(note ?? '');
    stop({ title: 'Could not submit your decision', message: outcome.message });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">New run</h1>

      <BriefForm running={running} brands={brands} onSubmit={start} />

      <div className="space-y-3">
        <PipelineProgress done={done} active={active} />

        {/* Deliberately not a live region: the elapsed clock ticks every second,
            so announcing it would mean continuous speech for the whole run. The
            activity log below carries role="log" instead. */}
        {running || activity.length > 0 ? (
          <p className="eonyx-label flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="tabular-nums">{formatElapsed(elapsed)} elapsed</span>
            {latest ? (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{(latest.tokens ?? 0).toLocaleString()} tokens</span>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{formatUsd(latest.costUsd ?? 0)}</span>
              </>
            ) : null}
            {reconnecting ? <span className="text-state-revision">· reconnecting…</span> : null}
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
        <RunError
          failure={error}
          onRetry={
            threadId
              ? () => {
                  setError(null);
                  follow(threadId);
                }
              : undefined
          }
        />
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
