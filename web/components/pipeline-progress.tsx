import { NODES } from '@/lib/types';

export function PipelineProgress({
  done,
  active,
  nodes = NODES,
}: {
  done: Set<string>;
  active: string | null;
  /** Defaults to the content pipeline; the ingest screen passes INGEST_NODES. */
  nodes?: string[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {nodes.map((node) => {
        const state = done.has(node) ? 'done' : node === active ? 'active' : 'idle';
        return (
          // EONYX: angular, not rounded — pipeline steps are structural, not status
          <span
            key={node}
            className={`rounded-sm border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors ${
              state === 'done'
                ? 'border-state-approved/30 bg-state-approved-bg text-state-approved'
                : state === 'active'
                  ? 'border-brand bg-brand text-brand-foreground'
                  : 'border-border text-muted-foreground'
            }`}
          >
            {node}
          </span>
        );
      })}
    </div>
  );
}
