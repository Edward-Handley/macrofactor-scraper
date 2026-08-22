import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { NutritionAlert } from "../../../lib/types";

const SEVERITY_STYLES: Record<string, { border: string; icon: typeof Info; iconClass: string }> = {
  warning: {
    border: "border-amber-500/40",
    icon: AlertTriangle,
    iconClass: "text-amber-400",
  },
  info: {
    border: "border-sky-500/40",
    icon: Info,
    iconClass: "text-sky-400",
  },
  good: {
    border: "border-emerald-500/40",
    icon: CheckCircle2,
    iconClass: "text-emerald-400",
  },
};

export function AlertCard({ alert }: { alert: NutritionAlert }) {
  const style = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.info;
  const Icon = style.icon;
  return (
    <div className={`rounded-xl border bg-zinc-900/60 px-3.5 py-3 ${style.border}`}>
      <div className="flex items-start gap-2.5">
        <Icon size={16} className={`mt-0.5 shrink-0 ${style.iconClass}`} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-100">{alert.title}</p>
          <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{alert.detail}</p>
          {alert.action && (
            <p className="text-xs text-zinc-300 mt-1.5">
              <span className="text-zinc-500">Try: </span>
              {alert.action}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
