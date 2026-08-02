'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';
import { type ActivityEntry, ActivityLog } from '@/components/activity-log';
import { BrandReview } from '@/components/brand-review';
import { PipelineProgress } from '@/components/pipeline-progress';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  type BrandProfilePayload,
  INGEST_NODES,
  type RunEvent,
  type StyleGuidePayload,
} from '@/lib/types';

const FIELD = 'rounded-md border bg-transparent px-3 py-2';
const LABEL = 'flex flex-col gap-1 text-sm';
const MAX_ACTIVITY = 50;

type ReviewPayload = {
  profile: BrandProfilePayload;
  styleGuide: StyleGuidePayload;
  exemplarCount: number;
};

export default function NewBrandPage() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [review, setReview] = useState<ReviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lastSeq = useRef(-1);
  const source = useRef<EventSource | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const brandIdRef = useRef<string | null>(null);

  function handle(event: RunEvent) {
    if (INGEST_NODES.includes(event.node)) {
      setDone((prev) => new Set(prev).add(event.node));
      setActive(null);
    }
    if (event.node === 'activity') {
      // ts and seq come from the envelope, not the payload — ActivityLog keys
      // its rows on seq and highlights the newest by it.
      const entry: ActivityEntry = { ...event.data, ts: event.ts, seq: event.seq };
      setActivity((prev) => [...prev, entry].slice(-MAX_ACTIVITY));
      // Activity is the only signal for which step is *currently* working; node
      // events only ever say a step finished.
      if (INGEST_NODES.includes(entry.step)) setActive(entry.step);
      return;
    }
    // Same 'hitl' node as a content run — the payload's own kind is what
    // distinguishes a brand review from a plan approval.
    if (event.node === 'hitl' && event.data?.awaiting) {
      const payload = event.data.payload;
      if (payload?.kind === 'brand_approval') {
        setReview({
          profile: payload.profile,
          styleGuide: payload.style_guide,
          exemplarCount: payload.exemplars?.length ?? 0,
        });
      }
    }
    if (event.node === 'done') {
      setRunning(false);
      source.current?.close();
      if (brandIdRef.current) router.push(`/brands/${brandIdRef.current}`);
    }
    if (event.node === 'error') {
      setError(event.data.message ?? 'Ingestion failed');
      setRunning(false);
      source.current?.close();
    }
  }

  function listen(id: string) {
    source.current?.close();
    const es = new EventSource(`/api/runs/${id}/events`);
    es.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as RunEvent;
      // seq is monotonic per run; the server replays history on every connect.
      if (parsed.seq <= lastSeq.current) return;
      lastSeq.current = parsed.seq;
      handle(parsed);
    };
    source.current = es;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const sources: Array<Record<string, string>> = [];
    const website = String(form.get('website') ?? '').trim();
    const rss = String(form.get('rss') ?? '').trim();
    const pasted = String(form.get('pasted') ?? '').trim();
    if (website) sources.push({ kind: 'website', locator: website });
    if (rss) sources.push({ kind: 'rss', locator: rss });
    if (pasted) sources.push({ kind: 'paste', locator: 'pasted', body: pasted });
    if (sources.length === 0) {
      setError('Give at least one source: a website, a feed, or pasted posts.');
      return;
    }

    setError(null);
    setDone(new Set());
    setActivity([]);
    setReview(null);
    lastSeq.current = -1;
    setRunning(true);
    setActive('fetcher');

    const res = await fetch('/api/brands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: form.get('name'), sources }),
    });
    if (!res.ok) {
      setError(`Could not start ingestion (${res.status})`);
      setRunning(false);
      setActive(null);
      return;
    }
    const { brand_id, thread_id } = (await res.json()) as {
      brand_id: string;
      thread_id: string;
    };
    brandIdRef.current = brand_id;
    threadIdRef.current = thread_id;
    listen(thread_id);
  }

  async function decide(
    approved: boolean,
    payload?: { feedback?: string; edits?: Record<string, unknown> },
  ) {
    const id = threadIdRef.current;
    if (!id) return;
    setReview(null);
    setActive('indexer');
    await fetch(`/api/runs/${id}/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        approved
          ? { approved: true, edits: payload?.edits }
          : { approved: false, feedback: payload?.feedback },
      ),
    });
    listen(id);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">New brand</h1>

      <Card>
        <CardContent className="p-6">
          <form onSubmit={submit} className="grid gap-4">
            <label className={LABEL}>
              Name
              <input name="name" required defaultValue="EONYX" className={FIELD} />
            </label>
            <label className={LABEL}>
              Website URL
              <input
                name="website"
                placeholder="https://eonyx.net/uk"
                defaultValue="https://eonyx.net/uk"
                className={FIELD}
              />
              <span className="text-xs text-muted-foreground">
                The path scopes the crawl: /uk stays inside that section, so a bilingual site does
                not produce a mixed-language corpus.
              </span>
            </label>
            <label className={LABEL}>
              RSS or Atom feed (optional)
              <input name="rss" placeholder="https://example.com/feed.xml" className={FIELD} />
            </label>
            <label className={LABEL}>
              Pasted posts (optional)
              <textarea
                name="pasted"
                placeholder={'Post one\n---\nPost two'}
                className={`${FIELD} min-h-32`}
              />
              <span className="text-xs text-muted-foreground">
                Separate posts with a line of three dashes. Real published copy is far better voice
                evidence than a landing page.
              </span>
            </label>
            <div>
              <Button type="submit" disabled={running}>
                {running ? 'Ingesting…' : 'Ingest brand'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {running || done.size > 0 ? (
        <PipelineProgress done={done} active={active} nodes={INGEST_NODES} />
      ) : null}

      <ActivityLog entries={activity} />

      {review ? (
        <BrandReview
          profile={review.profile}
          styleGuide={review.styleGuide}
          exemplarCount={review.exemplarCount}
          onDecision={decide}
        />
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
