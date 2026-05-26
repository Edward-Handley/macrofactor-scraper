import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceArea,
} from "recharts";
import type { BodyCompositionPoint, CutPhase } from "../../lib/types";
import { formatShortDate } from "../../lib/format";

interface Props {
  points: BodyCompositionPoint[];
  cutPhases?: CutPhase[];
  height?: number;
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { dataKey: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-zinc-400 mb-1.5">{label ? formatShortDate(label) : ""}</p>
      {payload.map(({ dataKey, value, color }) => {
        const labels: Record<string, string> = { lean_kg: "Lean mass", fat_kg: "Fat mass", weight_kg: "Weight" };
        if (value == null) return null;
        return (
          <div key={dataKey} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
            <span className="text-zinc-300">{labels[dataKey] ?? dataKey}:</span>
            <span className="font-semibold text-zinc-100 tabular-nums">{Number(value).toFixed(1)} kg</span>
          </div>
        );
      })}
    </div>
  );
}

export function BodyCompositionChart({ points, cutPhases = [], height = 280 }: Props) {
  const hasComposition = points.some((p) => p.lean_kg != null && p.fat_kg != null);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(v) => formatShortDate(v)}
          tick={{ fill: "#52525b", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: "#52525b", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}kg`}
          domain={["auto", "auto"]}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 11, color: "#71717a" }}
          formatter={(value) => {
            const m: Record<string, string> = { lean_kg: "Lean mass", fat_kg: "Fat mass", weight_kg: "Weight" };
            return m[value] ?? value;
          }}
        />

        {/* Cut phase bands */}
        {cutPhases.map((phase) => (
          <ReferenceArea
            key={phase.id}
            x1={phase.start_date}
            x2={phase.end_date ?? undefined}
            fill="rgba(16,185,129,0.06)"
            stroke="rgba(16,185,129,0.2)"
            strokeDasharray="4 4"
          />
        ))}

        {hasComposition ? (
          <>
            <Area
              type="monotone"
              dataKey="lean_kg"
              stackId="comp"
              stroke="#6366f1"
              fill="#6366f1"
              fillOpacity={0.35}
              dot={false}
              connectNulls
            />
            <Area
              type="monotone"
              dataKey="fat_kg"
              stackId="comp"
              stroke="#f59e0b"
              fill="#f59e0b"
              fillOpacity={0.35}
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="weight_kg"
              stroke="#e4e4e7"
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
          </>
        ) : (
          <Line
            type="monotone"
            dataKey="weight_kg"
            stroke="#10b981"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
