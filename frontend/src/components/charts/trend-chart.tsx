import {
  ComposedChart, Area, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { DailySummary, SummaryField } from "../../lib/types";
import { FIELD_META } from "../../lib/types";
import { formatShortDate, fmt } from "../../lib/format";

type ChartRow = Record<string, string | number | null>;

interface TrendChartProps {
  /** Pre-computed rows with date + field keys (and optional <field>_ma keys) */
  rawData?: ChartRow[];
  /** Legacy: DailySummary[]  -  used by callers that don't pre-process */
  data?: DailySummary[];
  fields: SummaryField[];
  maFields?: SummaryField[];
  height?: number;
  showLegend?: boolean;
}

interface TickProps {
  x?: number;
  y?: number;
  payload?: { value: string };
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { dataKey: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const mainEntries = payload.filter(p => !String(p.dataKey).endsWith("_ma"));
  const maEntries = payload.filter(p => String(p.dataKey).endsWith("_ma"));
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-zinc-400 mb-1.5">{label ? formatShortDate(label) : ""}</p>
      {mainEntries.map(({ dataKey, value, color }) => {
        const meta = FIELD_META[dataKey as SummaryField];
        return (
          <div key={dataKey} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
            <span className="text-zinc-300">{meta?.label ?? dataKey}:</span>
            <span className="font-semibold text-zinc-100 tabular-nums">
              {fmt(value, meta?.decimals ?? 1)} {meta?.unit ?? ""}
            </span>
          </div>
        );
      })}
      {maEntries.map(({ dataKey, value }) => {
        const field = String(dataKey).replace("_ma", "") as SummaryField;
        const meta = FIELD_META[field];
        return (
          <div key={dataKey} className="flex items-center gap-2 opacity-60">
            <span className="w-2 h-2 border border-current rounded-full shrink-0" />
            <span className="text-zinc-400">{meta?.label} 7d avg:</span>
            <span className="text-zinc-300 tabular-nums">
              {fmt(value, meta?.decimals ?? 1)} {meta?.unit ?? ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function XTick({ x = 0, y = 0, payload }: TickProps) {
  if (!payload?.value) return null;
  return (
    <text x={x} y={y + 12} textAnchor="middle" fill="#52525b" fontSize={10}>
      {formatShortDate(payload.value)}
    </text>
  );
}

export function TrendChart({
  rawData,
  data,
  fields,
  maFields = [],
  height = 280,
  showLegend = false,
}: TrendChartProps) {
  const chartData: ChartRow[] = rawData
    ?? (data ?? []).map(d => ({
        date: d.date,
        ...Object.fromEntries(fields.map(f => [f, d[f]])),
      }));

  const [primary, ...rest] = fields;
  const hasWeight = fields.includes("weight") && fields.length > 1;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tick={<XTick />} axisLine={false} tickLine={false} minTickGap={40} />
        <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: "#52525b", fontSize: 10 }} width={36} />
        {hasWeight && (
          <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false}
            tick={{ fill: "#52525b", fontSize: 10 }} width={36} />
        )}
        <Tooltip content={<CustomTooltip />} />
        {showLegend && (
          <Legend
            wrapperStyle={{ fontSize: 11, color: "#71717a" }}
            formatter={(v: string) => {
              if (v.endsWith("_ma")) return `${FIELD_META[v.replace("_ma", "") as SummaryField]?.label} 7d avg`;
              return FIELD_META[v as SummaryField]?.label ?? v;
            }}
          />
        )}
        {primary && (
          <Area
            yAxisId="left"
            key={primary}
            type="monotone"
            dataKey={primary}
            stroke={FIELD_META[primary].color}
            fill={FIELD_META[primary].color}
            fillOpacity={0.12}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        )}
        {rest.map((f) => (
          <Line
            key={f}
            yAxisId={f === "weight" ? (hasWeight ? "right" : "left") : "left"}
            type="monotone"
            dataKey={f}
            stroke={FIELD_META[f].color}
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
        ))}
        {maFields.map((f) => (
          <Line
            key={`${f}_ma`}
            yAxisId={f === "weight" ? (hasWeight ? "right" : "left") : "left"}
            type="monotone"
            dataKey={`${f}_ma`}
            stroke={FIELD_META[f].color}
            strokeWidth={1}
            strokeDasharray="4 3"
            dot={false}
            connectNulls
            strokeOpacity={0.6}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

interface BarChartProps {
  data: DailySummary[];
  field: SummaryField;
  height?: number;
}

export function BarTrendChart({ data, field, height = 180 }: BarChartProps) {
  const meta = FIELD_META[field];
  const chartData = data.map((d) => ({ date: d.date, v: d[field] }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tick={<XTick />} axisLine={false} tickLine={false} minTickGap={40} />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: "#52525b", fontSize: 10 }} width={36} />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            return (
              <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs">
                <p className="text-zinc-400 mb-1">{label ? formatShortDate(label) : ""}</p>
                <span className="font-semibold text-zinc-100">{fmt(payload[0]?.value as number, meta.decimals)} {meta.unit}</span>
              </div>
            );
          }}
        />
        <Bar dataKey="v" fill={meta.color} fillOpacity={0.8} radius={[2, 2, 0, 0]} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
