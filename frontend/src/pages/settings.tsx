import { usePreferences, useUpdatePreferences } from "../hooks/use-dashboard";
import { Check, Save } from "lucide-react";
import { FIELD_META, ALL_FIELDS } from "../lib/types";
import type { SummaryField } from "../lib/types";

function Card({ children, title, className = "" }: { children: React.ReactNode; title: string; className?: string }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-4 ${className}`}>
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-4">{title}</p>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between gap-3 py-2 cursor-pointer group">
      <span className="text-sm text-zinc-300 group-hover:text-zinc-100 transition-colors">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          "relative w-9 h-5 rounded-full transition-colors shrink-0",
          checked ? "bg-emerald-500" : "bg-zinc-700",
        ].join(" ")}
      >
        <span className={[
          "absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        ].join(" ")} />
      </button>
    </label>
  );
}

const RANGE_OPTIONS = [7, 14, 30, 90];

export function Settings() {
  const { data: prefs, isLoading } = usePreferences();
  const update = useUpdatePreferences();

  if (isLoading || !prefs) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  const visibleSet = new Set(prefs.visible_summary_cards);
  const hiddenSet = new Set(prefs.hidden_summary_fields);

  function isFieldVisible(f: SummaryField) {
    return visibleSet.has(f) && !hiddenSet.has(f);
  }

  function toggleVisibility(f: SummaryField, show: boolean) {
    const p = prefs!;
    const visible = new Set(p.visible_summary_cards);
    const hidden = new Set(p.hidden_summary_fields);
    if (show) {
      visible.add(f);
      hidden.delete(f);
    } else {
      hidden.add(f);
    }
    update.mutate({
      ...p,
      visible_summary_cards: [...visible],
      hidden_summary_fields: [...hidden],
    });
  }

  function setRange(days: number) {
    update.mutate({ ...prefs!, preferred_range_days: days });
  }

  function toggleChartField(f: SummaryField) {
    const p = prefs!;
    const current = new Set(p.default_chart_set);
    current.has(f) ? current.delete(f) : current.add(f);
    update.mutate({ ...p, default_chart_set: [...current] });
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-zinc-50">Settings</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Dashboard preferences</p>
        </div>
        {update.isSuccess && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold">
            <Check size={14} /> Saved
          </span>
        )}
      </div>

      <Card title="Visible summary cards">
        <div className="divide-y divide-zinc-800">
          {ALL_FIELDS.map((f) => (
            <Toggle
              key={f}
              label={FIELD_META[f].label}
              checked={isFieldVisible(f)}
              onChange={(v) => toggleVisibility(f, v)}
            />
          ))}
        </div>
      </Card>

      <Card title="Default chart fields">
        <div className="flex flex-wrap gap-2">
          {ALL_FIELDS.map((f) => {
            const meta = FIELD_META[f];
            const active = prefs.default_chart_set.includes(f);
            return (
              <button
                key={f}
                onClick={() => toggleChartField(f)}
                className={[
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all",
                  active ? "text-zinc-900 border-transparent" : "bg-transparent border-zinc-700 text-zinc-500 hover:text-zinc-300",
                ].join(" ")}
                style={active ? { background: meta.color, borderColor: meta.color } : {}}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      </Card>

      <Card title="Default date range">
        <div className="flex gap-2">
          {RANGE_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setRange(d)}
              className={[
                "px-4 py-2 rounded-xl text-sm font-semibold border transition-colors",
                prefs.preferred_range_days === d
                  ? "bg-emerald-500 border-emerald-500 text-zinc-950"
                  : "border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:border-zinc-500",
              ].join(" ")}
            >
              {d}d
            </button>
          ))}
        </div>
      </Card>

      <Card title="Reset to defaults">
        <p className="text-sm text-zinc-500 mb-3">Restore all preferences to their default values.</p>
        <button
          onClick={() => update.mutate({
            visible_summary_cards: [...ALL_FIELDS],
            hidden_summary_fields: [],
            preferred_range_days: 30,
            trusted_metric_names: [],
            untrusted_metric_names: [],
            default_chart_set: ["calories", "protein", "carbohydrates", "fat", "active_energy"],
            source_filters: {},
          })}
          className="px-4 py-2 border border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:border-zinc-500 rounded-xl text-sm font-semibold transition-colors"
        >
          Reset preferences
        </button>
      </Card>
    </div>
  );
}
