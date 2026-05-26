import { useState } from "react";
import type { DailySummary } from "../../lib/types";

interface SankeyProps {
  summaries: DailySummary[];
  dateLabel?: string;
}

interface Node {
  id: string;
  label: string;
  color: string;
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Link {
  from: string;
  to: string;
  value: number;
  color: string;
}

function SankeyTooltip({ node, visible }: { node: Node | null; visible: boolean }) {
  if (!visible || !node) return null;
  return (
    <div
      className="pointer-events-none absolute bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs shadow-xl z-10"
      style={{ left: node.x + node.w + 8, top: node.y }}
    >
      <p className="font-semibold text-zinc-100">{node.label}</p>
      <p className="text-zinc-400">{Math.round(node.value)} kcal</p>
    </div>
  );
}

function buildLayout(data: ReturnType<typeof computeFlows>) {
  const W = 440;
  const H = 220;
  const nodeW = 14;
  const gap = 8;

  // Left column: total calories
  // Middle column: macros (protein, carbs, fat)
  // Right column: BMR estimate, active burn, deficit/surplus

  const totalIn = data.caloriesIn;
  const totalOut = data.totalOut;
  const maxH = H - 20;

  function nodeHeight(val: number, total: number) {
    return Math.max(8, (val / total) * maxH);
  }

  const nodes: Node[] = [];
  const links: Link[] = [];

  // LEFT: Calories In
  const inH = nodeHeight(totalIn, Math.max(totalIn, totalOut));
  nodes.push({ id: "in", label: "Calories In", color: "#10b981", value: totalIn, x: 10, y: 10, w: nodeW, h: inH });

  // MIDDLE: macros
  const midX = W / 2 - nodeW / 2;
  let midY = 10;
  const macros = [
    { id: "protein", label: "Protein kcal", color: "#60a5fa", value: data.proteinKcal },
    { id: "carbs",   label: "Carb kcal",    color: "#fbbf24", value: data.carbKcal    },
    { id: "fat",     label: "Fat kcal",     color: "#f87171", value: data.fatKcal     },
  ].filter(m => m.value > 0);

  for (const macro of macros) {
    const h = nodeHeight(macro.value, totalIn);
    nodes.push({ id: macro.id, label: macro.label, color: macro.color, value: macro.value, x: midX, y: midY, w: nodeW, h });
    links.push({ from: "in", to: macro.id, value: macro.value, color: macro.color });
    midY += h + gap;
  }

  // RIGHT: outputs
  const rightX = W - nodeW - 10;
  let rightY = 10;
  const bmr = data.bmrEstimate;
  const active = data.activeBurn;
  const deficitSurplus = totalIn - totalOut;

  const outputs = [
    { id: "bmr",    label: "BMR (est)",     color: "#a78bfa", value: bmr             },
    { id: "active", label: "Active Burn",   color: "#fb923c", value: active          },
    { id: "delta",  label: deficitSurplus < 0 ? "Deficit" : "Surplus",
      color: deficitSurplus < 0 ? "#10b981" : "#f87171", value: Math.abs(deficitSurplus) },
  ].filter(o => o.value > 10);

  const totalRight = outputs.reduce((a, b) => a + b.value, 0);

  for (const out of outputs) {
    const h = nodeHeight(out.value, Math.max(totalIn, totalRight));
    nodes.push({ id: out.id, label: out.label, color: out.color, value: out.value, x: rightX, y: rightY, w: nodeW, h });
    rightY += h + gap;
  }

  // Links: macros → outputs (simplified: all macros contribute to BMR+active proportionally)
  const totalNonDelta = (bmr + active) || 1;
  if (bmr > 10) {
    links.push({ from: "protein", to: "bmr",    value: bmr * (data.proteinKcal / totalIn),    color: "#a78bfa" });
    links.push({ from: "carbs",   to: "bmr",    value: bmr * (data.carbKcal / totalIn),        color: "#a78bfa" });
    links.push({ from: "fat",     to: "bmr",    value: bmr * (data.fatKcal / totalIn),         color: "#a78bfa" });
  }
  if (active > 10) {
    links.push({ from: "protein", to: "active", value: active * (data.proteinKcal / totalIn), color: "#fb923c" });
    links.push({ from: "carbs",   to: "active", value: active * (data.carbKcal / totalIn),     color: "#fb923c" });
    links.push({ from: "fat",     to: "active", value: active * (data.fatKcal / totalIn),      color: "#fb923c" });
  }

  return { nodes, links, W, H };
}

function cubicBezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const cx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
}

function computeFlows(summaries: DailySummary[]) {
  function avg(vals: (number | null | undefined)[]) {
    const c = vals.filter((v): v is number => v != null);
    return c.length ? c.reduce((a, b) => a + b, 0) / c.length : 0;
  }
  const caloriesIn = avg(summaries.map(s => s.calories));
  const proteinKcal = avg(summaries.map(s => s.protein)) * 4;
  const carbKcal = avg(summaries.map(s => s.carbohydrates)) * 4;
  const fatKcal = avg(summaries.map(s => s.fat)) * 9;
  const activeBurn = avg(summaries.map(s => s.active_energy));
  const bmrEstimate = Math.max(0, caloriesIn - activeBurn - Math.abs(caloriesIn - proteinKcal - carbKcal - fatKcal));
  // simpler: BMR ≈ 1600 kcal typical, but we approximate as totalOut - activeBurn
  const bmrEst = Math.max(0, Math.round(1500 + (caloriesIn - proteinKcal - carbKcal - fatKcal) * 0));
  const estimatedBMR = caloriesIn > 0 ? Math.max(0, caloriesIn * 0.65) : 1500;
  const totalOut = estimatedBMR + activeBurn;
  return { caloriesIn, proteinKcal, carbKcal, fatKcal, activeBurn, bmrEstimate: estimatedBMR, totalOut };
}

export function CalorieSankey({ summaries, dateLabel }: SankeyProps) {
  const [hoveredNode, setHoveredNode] = useState<Node | null>(null);

  if (!summaries.length || !summaries.some(s => s.calories)) {
    return (
      <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">
        No calorie data available for this period.
      </div>
    );
  }

  const data = computeFlows(summaries);
  const { nodes, links, W, H } = buildLayout(data);

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  function getLinkPath(link: Link): string {
    const from = nodeMap.get(link.from);
    const to = nodeMap.get(link.to);
    if (!from || !to) return "";
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    const x2 = to.x;
    const y2 = to.y + to.h / 2;
    return cubicBezierPath(x1, y1, x2, y2);
  }

  function getLinkWidth(link: Link): number {
    const total = data.caloriesIn || 1;
    return Math.max(1, (link.value / total) * 30);
  }

  return (
    <div className="relative">
      {dateLabel && <p className="text-xs text-zinc-500 mb-2">{dateLabel}</p>}
      <svg viewBox={`0 0 ${W} ${H + 30}`} className="w-full" style={{ maxHeight: 260 }}>
        {/* Links */}
        {links.map((link, i) => (
          <path
            key={i}
            d={getLinkPath(link)}
            fill="none"
            stroke={link.color}
            strokeWidth={getLinkWidth(link)}
            strokeOpacity={0.25}
          />
        ))}

        {/* Nodes */}
        {nodes.map((node) => (
          <g key={node.id} onMouseEnter={() => setHoveredNode(node)} onMouseLeave={() => setHoveredNode(null)}>
            <rect
              x={node.x}
              y={node.y}
              width={node.w}
              height={node.h}
              rx={3}
              fill={node.color}
              fillOpacity={hoveredNode?.id === node.id ? 0.9 : 0.7}
            />
          </g>
        ))}

        {/* Node labels */}
        {nodes.map((node) => {
          const isLeft = node.x < W / 3;
          const isRight = node.x > W * 2 / 3;
          const textX = isLeft ? node.x + node.w + 4 : isRight ? node.x - 4 : node.x + node.w / 2;
          const anchor = isLeft ? "start" : isRight ? "end" : "middle";
          const textY = node.y + node.h / 2;
          return (
            <g key={`label-${node.id}`}>
              <text x={textX} y={textY - 5} textAnchor={anchor} fill="#71717a" fontSize={9} fontWeight={600}>
                {node.label}
              </text>
              <text x={textX} y={textY + 7} textAnchor={anchor} fill="#a1a1aa" fontSize={9}>
                {Math.round(node.value)} kcal
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-2 justify-center">
        {[
          { color: "#10b981", label: "Calories In" },
          { color: "#60a5fa", label: "Protein" },
          { color: "#fbbf24", label: "Carbs" },
          { color: "#f87171", label: "Fat" },
          { color: "#a78bfa", label: "BMR (est)" },
          { color: "#fb923c", label: "Active Burn" },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
            <span className="text-[10px] text-zinc-500">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
