'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export function SpendChart({ data }: { data: Array<{ day: string; costUsd: number }> }) {
  if (data.length === 0) {
    return (
      <p className="flex h-56 items-center justify-center text-sm text-muted-foreground">
        No spend recorded yet.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={224}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis
          tickLine={false}
          axisLine={false}
          fontSize={12}
          width={56}
          tickFormatter={(value) => `$${Number(value).toFixed(3)}`}
        />
        <Tooltip formatter={(value) => [`$${Number(value).toFixed(4)}`, 'spend']} />
        <Area
          type="monotone"
          dataKey="costUsd"
          stroke="var(--brand)"
          fill="var(--brand)"
          fillOpacity={0.15}
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
