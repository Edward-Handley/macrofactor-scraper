import { Link } from "react-router-dom";
import { TrendingUp, TrendingDown, Activity, Flame, Repeat2, AlertTriangle, CheckCircle, Info } from "lucide-react";
import type { SmartInsight } from "../../lib/types";

const SEVERITY_STYLES = {
  warn: {
    border: "border-l-amber-500",
    badge: "bg-amber-500/10 text-amber-400",
    icon: AlertTriangle,
    iconColor: "text-amber-400",
  },
  good: {
    border: "border-l-emerald-500",
    badge: "bg-emerald-500/10 text-emerald-400",
    icon: CheckCircle,
    iconColor: "text-emerald-400",
  },
  info: {
    border: "border-l-blue-500",
    badge: "bg-blue-500/10 text-blue-400",
    icon: Info,
    iconColor: "text-blue-400",
  },
};

const CATEGORY_ICONS = {
  correlation: TrendingUp,
  pattern: Repeat2,
  conditional: Activity,
  streak: Flame,
  trend: TrendingDown,
};

const CATEGORY_LABELS = {
  correlation: "Correlation",
  pattern: "Pattern",
  conditional: "Conditional",
  streak: "Streak",
  trend: "Trend shift",
};

interface SmartInsightCardProps {
  insight: SmartInsight;
  compact?: boolean;
}

export function SmartInsightCard({ insight, compact = false }: SmartInsightCardProps) {
  const sev = SEVERITY_STYLES[insight.severity] ?? SEVERITY_STYLES.info;
  const SevIcon = sev.icon;
  const CatIcon = CATEGORY_ICONS[insight.category] ?? Activity;
  const catLabel = CATEGORY_LABELS[insight.category] ?? insight.category;

  return (
    <div className={`bg-zinc-900 border border-zinc-800 border-l-2 ${sev.border} rounded-xl px-4 py-3 flex flex-col gap-1.5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <SevIcon size={15} className={`${sev.iconColor} shrink-0 mt-0.5`} />
          <p className="text-sm font-semibold text-zinc-100 leading-snug">{insight.title}</p>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 flex items-center gap-1 ${sev.badge}`}>
          <CatIcon size={10} />
          {catLabel}
        </span>
      </div>
      {!compact && (
        <p className="text-xs text-zinc-400 leading-relaxed pl-5">{insight.detail}</p>
      )}
      {!compact && insight.action && (
        <p className="text-xs text-violet-400 pl-5">{insight.action}</p>
      )}
    </div>
  );
}
