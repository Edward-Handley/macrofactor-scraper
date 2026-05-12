import { useEffect, useRef, useState } from "react";
import { CheckCircle, Ruler } from "lucide-react";
import { useMeasurement, useMeasurements, useUpsertMeasurement } from "../hooks/use-daily-log";
import { isoDate, offsetDate } from "../lib/format";
import type { BodyMeasurementUpsert } from "../lib/types";

const TODAY = isoDate(new Date());
const HISTORY_START = offsetDate(-90);

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

export function Measurements() {
  const [date, setDate] = useState(TODAY);
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
          onChange={(event) => setDate(event.target.value || TODAY)}
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
