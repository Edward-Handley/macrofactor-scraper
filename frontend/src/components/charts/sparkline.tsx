import { AreaChart, Area, ResponsiveContainer } from "recharts";
import type { DailySummary } from "../../lib/types";
import type { SummaryField } from "../../lib/types";

interface SparklineProps {
  data: DailySummary[];
  field: SummaryField;
  color: string;
  height?: number;
}

export function Sparkline({ data, field, color, height = 40 }: SparklineProps) {
  const chartData = data
    .filter((d) => d[field] != null)
    .map((d) => ({ v: d[field] as number }));

  if (chartData.length < 2) return null;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
        <defs>
          <linearGradient id={`spark-${field}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false}
          fill={`url(#spark-${field})`}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
