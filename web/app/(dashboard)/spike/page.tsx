'use client';

import { useState } from 'react';

type Tick = { i: number; ts: number; receivedAt: number };

export default function SpikePage() {
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [status, setStatus] = useState('idle');

  function start() {
    setTicks([]);
    setStatus('streaming');
    const source = new EventSource('/api/debug/sse-ping');
    source.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as { i: number; ts: number };
      setTicks((prev) => [...prev, { ...parsed, receivedAt: Date.now() }]);
    };
    source.onerror = () => {
      source.close();
      setStatus('closed');
    };
  }

  const gaps = ticks.slice(1).map((tick, i) => tick.receivedAt - (ticks[i]?.receivedAt ?? 0));
  const buffered = gaps.length > 0 && gaps.every((gap) => gap < 100);

  return (
    <main style={{ fontFamily: 'monospace', padding: 24 }}>
      <button type="button" onClick={start}>
        Start SSE ping
      </button>
      <p>status: {status}</p>
      <p>events: {ticks.length}</p>
      <p>gaps between arrivals (ms): {gaps.join(', ') || '—'}</p>
      <p style={{ fontWeight: 'bold' }}>
        {ticks.length < 5
          ? 'waiting for 5 events…'
          : buffered
            ? 'BUFFERED — all events arrived at once. Rewrites are NOT streaming.'
            : 'STREAMING OK — events arrived ~500ms apart.'}
      </p>
    </main>
  );
}
