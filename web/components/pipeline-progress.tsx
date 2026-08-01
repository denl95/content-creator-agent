import { NODES } from '@/lib/types';

export function PipelineProgress({ done, active }: { done: Set<string>; active: string | null }) {
  return (
    <div className="flex flex-wrap gap-2">
      {NODES.map((node) => {
        const state = done.has(node) ? 'done' : node === active ? 'active' : 'idle';
        return (
          <span
            key={node}
            className={`rounded-full px-3 py-1 text-sm transition-colors ${
              state === 'done'
                ? 'bg-state-approved-bg text-state-approved'
                : state === 'active'
                  ? 'bg-brand text-brand-foreground'
                  : 'bg-muted text-muted-foreground'
            }`}
          >
            {node}
          </span>
        );
      })}
    </div>
  );
}
