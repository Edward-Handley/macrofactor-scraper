import type { ReadinessReport } from "../../lib/types";

const BAND_STYLES = {
  green: {
    pill: "bg-emerald-500/20 text-emerald-400 border border-emerald-700/50",
    score: "text-emerald-400",
    label: "Well recovered",
  },
  amber: {
    pill: "bg-amber-500/20 text-amber-400 border border-amber-700/50",
    score: "text-amber-400",
    label: "Moderate recovery",
  },
  red: {
    pill: "bg-red-500/20 text-red-400 border border-red-700/50",
    score: "text-red-400",
    label: "Low recovery",
  },
};

const BAND_HINTS = {
  green: "Good day for high-intensity training or PR attempts.",
  amber: "Moderate session recommended — avoid max effort.",
  red: "Consider active recovery or rest today.",
};

function ZRow({
  label,
  today,
  unit,
  z,
  baseline,
  invert = false,
}: {
  label: string;
  today: number | null;
  unit: string;
  z: number | null;
  baseline: number | null;
  invert?: boolean;
}) {
  if (today == null) return null;
  const direction = z != null ? (z >= 0 ? "above" : "below") : null;
  const isGood = z != null ? (invert ? z <= 0 : z >= 0) : null;
  return (
    <div className="flex items-center justify-between py-1 border-t border-zinc-800 first:border-t-0">
      <span className="text-xs text-zinc-500">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-zinc-200 tabular-nums">
          {today.toFixed(0)}{unit}
        </span>
        {z != null && direction && baseline != null && (
          <span
            className={`text-[10px] font-semibold tabular-nums ${
              isGood ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {Math.abs(z).toFixed(1)}σ {direction} {baseline.toFixed(0)}{unit} avg
          </span>
        )}
      </div>
    </div>
  );
}

export function ReadinessCard({ report }: { report: ReadinessReport }) {
  if (!report.band || report.score == null) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Recovery Readiness</p>
        <p className="text-xs text-zinc-600">{report.summary}</p>
      </div>
    );
  }

  const styles = BAND_STYLES[report.band];

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Recovery Readiness</p>
        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${styles.pill}`}>
          {styles.label}
        </span>
      </div>

      <div className="flex items-end gap-2 mb-3">
        <span className={`text-4xl font-black tabular-nums leading-none ${styles.score}`}>
          {report.score.toFixed(0)}
        </span>
        <span className="text-sm text-zinc-600 mb-1">/ 100</span>
      </div>

      <div className="space-y-0">
        <ZRow
          label="Overnight HRV"
          today={report.hrv_today}
          unit=" ms"
          z={report.hrv_z}
          baseline={report.hrv_baseline_mean}
          invert={false}
        />
        <ZRow
          label="Resting HR"
          today={report.rhr_today}
          unit=" bpm"
          z={report.rhr_z}
          baseline={report.rhr_baseline_mean}
          invert={true}
        />
      </div>

      <p className={`mt-3 text-xs font-medium ${styles.score}`}>
        {BAND_HINTS[report.band]}
      </p>
    </div>
  );
}
