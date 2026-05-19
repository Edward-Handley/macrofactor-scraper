import { useState } from "react";
import { useNavigate } from "react-router-dom";

type AnomalyKind = "good" | "warn" | "bad" | "info";

interface Anomaly {
  kind: AnomalyKind;
  label: string;
  detail: string;
  link_to?: string;
}

const CHIP_STYLES: Record<AnomalyKind, string> = {
  good: "bg-emerald-500/10 border-emerald-700/40 text-emerald-300",
  bad:  "bg-red-500/10 border-red-700/40 text-red-300",
  warn: "bg-amber-500/10 border-amber-700/40 text-amber-300",
  info: "bg-zinc-800 border-zinc-700 text-zinc-300",
};

const DOT_STYLES: Record<AnomalyKind, string> = {
  good: "bg-emerald-400",
  bad:  "bg-red-400",
  warn: "bg-amber-400",
  info: "bg-zinc-400",
};

export function AnomalyStrip({ anomalies }: { anomalies: Anomaly[] }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<number | null>(null);

  if (!anomalies.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {anomalies.map((a, i) => (
        <button
          key={i}
          onClick={() => {
            if (expanded === i) {
              if (a.link_to) navigate(a.link_to);
              setExpanded(null);
            } else {
              setExpanded(i);
            }
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all cursor-pointer ${CHIP_STYLES[a.kind]}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT_STYLES[a.kind]}`} />
          <span>{a.label}</span>
          {expanded === i && a.detail && (
            <span className="ml-1 font-normal opacity-70">&mdash; {a.detail}</span>
          )}
        </button>
      ))}
    </div>
  );
}
