import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle, Moon } from "lucide-react";
import { ScaleSlider } from "../components/inputs/scale-slider";
import { useDailyLog, useUpsertDailyLog } from "../hooks/use-daily-log";
import { useDashboardSummary } from "../hooks/use-dashboard";
import { isoDate } from "../lib/format";

const TODAY = isoDate(new Date());

const TRAINING_TYPES = [
  { value: "upper", label: "Upper" },
  { value: "lower", label: "Lower" },
  { value: "cardio", label: "Cardio" },
  { value: "rest",   label: "Rest Day" },
  { value: "other",  label: "Other" },
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-4">
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">{title}</h2>
      {children}
    </div>
  );
}

function PillToggle({ label, value, onChange, onLabel = "Yes", offLabel = "No" }: {
  label: string; value: boolean | null; onChange: (v: boolean) => void;
  onLabel?: string; offLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium text-zinc-300">{label}</span>
      <div className="flex rounded-lg overflow-hidden border border-zinc-800">
        {[true, false].map((opt) => (
          <button
            key={String(opt)}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              value === opt
                ? "bg-emerald-600 text-white"
                : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {opt ? onLabel : offLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

function TimeInput({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium text-zinc-300">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
    </div>
  );
}

export function Morning() {
  const navigate = useNavigate();
  const { data: existing } = useDailyLog(TODAY);
  const upsert = useUpsertDailyLog(TODAY);

  // Pull today's weight from dashboard summary (last 1 day)
  const { data: summary } = useDashboardSummary(TODAY, TODAY);
  const latestWeight = summary?.summaries?.[0]?.weight ?? null;

  const [amEnergy, setAmEnergy] = useState<number | null>(existing?.am_energy ?? null);
  const [soreness, setSoreness] = useState<number | null>(existing?.soreness ?? null);
  const [gymDone, setGymDone] = useState<boolean | null>(existing?.gym_done ?? null);
  const [trainingType, setTrainingType] = useState<string | null>(existing?.training_type ?? null);
  const [vyvanstaken, setVyvanseTaken] = useState<boolean | null>(existing?.vyvanse_taken ?? null);
  const [vyvansetime, setVyvansTime] = useState<string>(existing?.vyvanse_time ?? "");
  const [dexTaken, setDexTaken] = useState<boolean | null>(existing?.dex_booster_taken ?? null);
  const [dexTime, setDexTime] = useState<string>(existing?.dex_time ?? "");
  const [notes, setNotes] = useState<string>(existing?.notes ?? "");
  const [saved, setSaved] = useState(false);

  const isMonday = new Date().getDay() === 1;

  async function handleSave() {
    const payload: Record<string, unknown> = {};
    if (amEnergy != null)     payload.am_energy = amEnergy;
    if (soreness != null)     payload.soreness = soreness;
    if (gymDone != null)      payload.gym_done = gymDone;
    if (trainingType)         payload.training_type = trainingType;
    if (vyvanstaken != null)  payload.vyvanse_taken = vyvanstaken;
    if (vyvansetime)          payload.vyvanse_time = vyvansetime;
    if (dexTaken != null)     payload.dex_booster_taken = dexTaken;
    if (dexTime)              payload.dex_time = dexTime;
    if (notes.trim())         payload.notes = notes.trim();

    await upsert.mutateAsync(payload);
    setSaved(true);
  }

  if (saved) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-6">
        <CheckCircle size={56} className="text-emerald-400" />
        <div className="text-center">
          <p className="text-lg font-semibold text-zinc-100">Morning logged!</p>
          <p className="text-sm text-zinc-500 mt-1">
            {new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        {isMonday && (
          <button
            onClick={() => navigate("/measurements")}
            className="px-5 py-2.5 rounded-xl bg-zinc-800 text-sm font-medium text-zinc-200 hover:bg-zinc-700 transition-colors"
          >
            📏 It's Monday — log measurements
          </button>
        )}
        <button
          onClick={() => navigate("/")}
          className="px-5 py-2.5 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors"
        >
          Go to Today
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto p-4 flex flex-col gap-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 pt-2">
        <Moon size={20} className="text-emerald-400" />
        <div>
          <h1 className="text-lg font-bold text-zinc-100">Good morning</h1>
          <p className="text-xs text-zinc-500">
            {new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}
            {latestWeight != null && ` · ${latestWeight.toFixed(1)} kg`}
          </p>
        </div>
      </div>

      {/* Subjective AM */}
      <Section title="How are you feeling?">
        <ScaleSlider label="Energy" value={amEnergy} onChange={setAmEnergy} variant="energy" />
        <ScaleSlider label="Soreness (1 = none)" value={soreness} onChange={setSoreness} variant="soreness" />
      </Section>

      {/* Meds */}
      <Section title="Medication">
        <PillToggle label="Vyvanse" value={vyvanstaken} onChange={setVyvanseTaken} />
        {vyvanstaken && (
          <TimeInput label="Vyvanse time" value={vyvansetime} onChange={setVyvansTime} />
        )}
        <PillToggle label="Dex Booster" value={dexTaken} onChange={setDexTaken} />
        {dexTaken && (
          <TimeInput label="Dex time" value={dexTime} onChange={setDexTime} />
        )}
      </Section>

      {/* Training plan */}
      <Section title="Today's training">
        <div className="grid grid-cols-5 gap-2">
          {TRAINING_TYPES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setTrainingType(value);
                if (value === "rest") setGymDone(false);
                else if (value !== "cardio") setGymDone(true);
              }}
              className={`py-2.5 rounded-xl text-xs font-medium border transition-all ${
                trainingType === value
                  ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {trainingType && trainingType !== "rest" && (
          <PillToggle label="Gym done?" value={gymDone} onChange={setGymDone} />
        )}
      </Section>

      {/* Notes */}
      <Section title="Notes (optional)">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything on your mind this morning..."
          rows={3}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
        />
      </Section>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={upsert.isPending}
        className="w-full py-3.5 rounded-2xl bg-emerald-600 text-base font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors sticky bottom-4"
      >
        {upsert.isPending ? "Saving…" : "Save morning log"}
      </button>

      {upsert.isError && (
        <p className="text-sm text-red-400 text-center">Save failed — check connection</p>
      )}
    </div>
  );
}
