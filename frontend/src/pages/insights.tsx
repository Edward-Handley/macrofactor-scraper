import { useState } from "react";
import { useActiveDate } from "../hooks/use-active-date";
import { useSmartInsights, useAnomalies } from "../hooks/use-dashboard";
import { SmartInsightCard } from "../components/insights/smart-insight-card";
import { AnomalyStrip } from "../components/insights/anomaly-strip";
import { Lightbulb } from "lucide-react";
import type { SmartInsight } from "../lib/types";

const CATEGORY_FILTERS = [
  { value: "all",         label: "All"          },
  { value: "correlation", label: "Correlations" },
  { value: "pattern",     label: "Patterns"     },
  { value: "conditional", label: "Conditional"  },
  { value: "streak",      label: "Streaks"      },
  { value: "trend",       label: "Trends"       },
] as const;

const SEVERITY_FILTERS = [
  { value: "all",  label: "All"      },
  { value: "warn", label: "Warnings" },
  { value: "good", label: "Good"     },
  { value: "info", label: "Info"     },
] as const;

export function Insights() {
  const { date: forDate } = useActiveDate();
  const { data, isLoading, error } = useSmartInsights(forDate);
  const { data: anomaliesData } = useAnomalies(forDate);
  const [catFilter, setCatFilter] = useState<string>("all");
  const [sevFilter, setSevFilter] = useState<string>("all");

  const insights: SmartInsight[] = data?.insights ?? [];
  const filtered = insights.filter((ins) => {
    if (catFilter !== "all" && ins.category !== catFilter) return false;
    if (sevFilter !== "all" && ins.severity !== sevFilter) return false;
    return true;
  });

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-violet-600/20 flex items-center justify-center">
          <Lightbulb size={18} className="text-violet-400" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-zinc-50">Smart Insights</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Correlations, patterns, and trends from your last 30 days</p>
        </div>
      </div>

      {/* Anomalies */}
      {anomaliesData?.anomalies && anomaliesData.anomalies.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Today's Anomalies</p>
          <AnomalyStrip anomalies={anomaliesData.anomalies as any} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setCatFilter(f.value)}
              className={["px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all",
                catFilter === f.value
                  ? "bg-violet-600 border-violet-600 text-white"
                  : "border-zinc-700 text-zinc-500 hover:text-zinc-300",
              ].join(" ")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SEVERITY_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setSevFilter(f.value)}
              className={["px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all",
                sevFilter === f.value
                  ? "bg-zinc-700 border-zinc-600 text-zinc-100"
                  : "border-zinc-700 text-zinc-500 hover:text-zinc-300",
              ].join(" ")}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
        </div>
      ) : error ? (
        <div className="px-4 py-3 rounded-xl bg-red-900/30 border border-red-800/50 text-red-300 text-sm">
          Failed to load insights — {(error as Error).message}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-zinc-600">
          <Lightbulb size={32} />
          <p className="text-sm">
            {insights.length === 0
              ? "Not enough data yet — log for at least 7 days to see insights."
              : "No insights match the current filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-zinc-600">{filtered.length} insight{filtered.length !== 1 ? "s" : ""} for {forDate}</p>
          {filtered.map((ins) => (
            <SmartInsightCard key={ins.id} insight={ins} />
          ))}
        </div>
      )}
    </div>
  );
}
