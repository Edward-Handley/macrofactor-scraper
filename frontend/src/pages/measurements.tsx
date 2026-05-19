import { useEffect, useRef, useState, useMemo } from "react";
import { CheckCircle, Ruler } from "lucide-react";
import { useMeasurement, useMeasurements, useUpsertMeasurement } from "../hooks/use-daily-log";
import { useActiveDate } from "../hooks/use-active-date";
import { offsetDate } from "../lib/format";
import type { BodyMeasurement, BodyMeasurementUpsert } from "../lib/types";

const HISTORY_START = offsetDate(-90);

const MEAS_FIELDS: Array<{ key: keyof BodyMeasurementUpsert; label: string; lowerIsBetter: boolean }> = [
  { key: "waist_cm",   label: "Waist",       lowerIsBetter: true  },
  { key: "chest_cm",   label: "Chest",       lowerIsBetter: false },
  { key: "l_arm_cm",   label: "Left arm",    lowerIsBetter: false },
  { key: "r_arm_cm",   label: "Right arm",   lowerIsBetter: false },
  { key: "l_thigh_cm", label: "Left thigh",  lowerIsBetter: true  },
  { key: "r_thigh_cm", label: "Right thigh", lowerIsBetter: true  },
  { key: "hip_cm",     label: "Hip",         lowerIsBetter: true  },
];

const FIELDS: Array<{ key: keyof BodyMeasurementUpsert; label: string }> = [
  { key: "waist_cm", label: "Waist" },
  { key: "chest_cm", label: "Chest" },
  { key: "l_arm_cm", label: "Left arm" },
  { key: "r_arm_cm", label: "Right arm" },
  { key: "l_thigh_cm", label: "Left thigh" },
  { key: "r_thigh_cm", label: "Right thigh" },
  { key: "hip_cm", label: "Hip" },
];

function MeasurementInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-zinc-400">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          step={0.1}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <span className="text-xs text-zinc-500 w-7">cm</span>
      </div>
    </label>
  );
}

function DeltaSummaryCard({ rows }: { rows: BodyMeasurement[] }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => a.measure_date.localeCompare(b.measure_date)), [rows]);
  if (sorted.length < 2) return null;
  const baseline = sorted[0];
  const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
  const latest = sorted[sorted.length - 1];

  const deltas = MEAS_FIELDS.map(({ key, label, lowerIsBetter }) => {
    const latestVal = latest[key] as number | null;
    const prevVal = prev?.[key] as number | null | undefined;
    const baseVal = baseline[key] as number | null;
    if (latestVal == null) return null;
    const fromPrev = prevVal != null ? latestVal - prevVal : null;
    const fromBase = baseVal != null ? latestVal - baseVal : null;
    return { key, label, lowerIsBetter, latestVal, fromPrev, fromBase };
  }).filter(Boolean) as Array<{
    key: string; label: string; lowerIsBetter: boolean;
    latestVal: number; fromPrev: number | null; fromBase: number | null;
  }>;

  if (deltas.length === 0) return null;

  function deltaColor(val: number, lowerIsBetter: boolean) {
    if (Math.abs(val) < 0.05) return "text-zinc-500";
    const improved = lowerIsBetter ? val < 0 : val > 0;
    return improved ? "text-emerald-400" : "text-red-400";
  }

  function fmt(v: number | null) {
    if (v == null) return "—";
    return (v > 0 ? "+" : "") + v.toFixed(1) + " cm";
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Changes since last measurement</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {deltas.map(({ key, label, lowerIsBetter, fromPrev, fromBase }) => (
          <div key={key} className="flex flex-col gap-0.5">
            <span className="text-[10px] text-zinc-600 uppercase tracking-wide">{label}</span>
            {fromPrev != null && (
              <span className={`text-sm font-semibold tabular-nums ${deltaColor(fromPrev, lowerIsBetter)}`}>
                {fmt(fromPrev)} <span className="text-[10px] font-normal text-zinc-600">vs prev</span>
              </span>
            )}
            {fromBase != null && (
              <span className={`text-xs tabular-nums ${deltaColor(fromBase, lowerIsBetter)}`}>
                {fmt(fromBase)} <span className="text-[10px] text-zinc-600">total</span>
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-zinc-600 mt-2">Baseline: {baseline.measure_date} · Latest: {latest.measure_date}</p>
    </div>
  );
}

export function Measurements() {
  const { date, setDate, TODAY } = useActiveDate();
  const [form, setForm] = useState<BodyMeasurementUpsert>({});
  const [saved, setSaved] = useState(false);
  const dirtyRef = useRef(false);

  const { data: existing } = useMeasurement(date);
  const { data: history } = useMeasurements(HISTORY_START, TODAY);
  const upsert = useUpsertMeasurement(date);

  useEffect(() => {
    dirtyRef.current = false;
    setSaved(false);
    setForm({});
  }, [date]);

  useEffect(() => {
    if (!existing || dirtyRef.current) return;
    setForm({
      waist_cm: existing.waist_cm,
      chest_cm: existing.chest_cm,
      l_arm_cm: existing.l_arm_cm,
      r_arm_cm: existing.r_arm_cm,
      l_thigh_cm: existing.l_thigh_cm,
      r_thigh_cm: existing.r_thigh_cm,
      hip_cm: existing.hip_cm,
    });
  }, [existing]);

  function setField(key: keyof BodyMeasurementUpsert, value: number | null) {
    dirtyRef.current = true;
    setSaved(false);
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSave() {
    await upsert.mutateAsync(form);
    dirtyRef.current = false;
    setSaved(true);
  }

  const rows = history?.measurements ?? [];

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
      {rows.length >= 2 && <DeltaSummaryCard rows={rows} />}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
            <Ruler size={18} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-zinc-50">Measurements</h1>
            <p className="text-sm text-zinc-500 mt-0.5">Weekly body measurements</p>
          </div>
        </div>
        <input
          type="date"
          value={date}
          onChange={(event) => { if (event.target.value) setDate(event.target.value); }}
          className="bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FIELDS.map((field) => (
            <MeasurementInput
              key={field.key}
              label={field.label}
              value={form[field.key] ?? null}
              onChange={(value) => setField(field.key, value)}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="min-h-5">
            {saved && (
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-semibold">
                <CheckCircle size={14} /> Saved
              </span>
            )}
            {upsert.isError && (
              <span className="text-xs text-red-400 font-semibold">Save failed - check connection</span>
            )}
          </div>
          <button
            onClick={handleSave}
            disabled={upsert.isPending}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {upsert.isPending ? "Saving..." : "Save measurements"}
          </button>
        </div>
      </section>

      <section className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Recent entries</h2>
        </div>
        {rows.length === 0 ? (
          <div className="p-6 text-sm text-zinc-500 text-center">No measurements logged yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-zinc-500">
                <tr className="border-b border-zinc-800">
                  <th className="text-left font-semibold px-4 py-2">Date</th>
                  <th className="text-right font-semibold px-4 py-2">Waist</th>
                  <th className="text-right font-semibold px-4 py-2">Chest</th>
                  <th className="text-right font-semibold px-4 py-2">Hip</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {rows.slice().reverse().slice(0, 12).map((row) => (
                  <tr key={row.measure_date}>
                    <td className="px-4 py-2 text-zinc-200">{row.measure_date}</td>
                    <td className="px-4 py-2 text-right text-zinc-400">{row.waist_cm?.toFixed(1) ?? "-"}</td>
                    <td className="px-4 py-2 text-right text-zinc-400">{row.chest_cm?.toFixed(1) ?? "-"}</td>
                    <td className="px-4 py-2 text-right text-zinc-400">{row.hip_cm?.toFixed(1) ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
