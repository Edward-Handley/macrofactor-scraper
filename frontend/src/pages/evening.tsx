import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle, ChevronDown, ChevronUp, Moon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ScaleSlider } from "../components/inputs/scale-slider";
import { useDailyLog, useUpsertDailyLog } from "../hooks/use-daily-log";
import { useDashboardSummary } from "../hooks/use-dashboard";
import { api } from "../lib/api";
import { formatMinutesAsHoursMinutes, isoDate, minutesToDecimalHours, fmt, formatDdMmYyyy } from "../lib/format";
import type { DailyLogUpsert } from "../lib/types";

const TODAY = isoDate(new Date());

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const TRAINING_TYPES = [
  { value: "upper", label: "Upper" },
  { value: "lower", label: "Lower" },
  { value: "cardio", label: "Cardio" },
  { value: "rest", label: "Rest" },
  { value: "other", label: "Other" },
] as const;

const CARDIO_TYPES = ["Treadmill", "Walk (outdoor)", "Walk (treadmill)", "Bike", "Rower", "Stairs", "Other"];

function Section({ title, defaultOpen = true, children }: {
  title: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">{title}</span>
        {open ? <ChevronUp size={15} className="text-zinc-600" /> : <ChevronDown size={15} className="text-zinc-600" />}
      </button>
      {open && <div className="px-4 pb-4 flex flex-col gap-4">{children}</div>}
    </div>
  );
}

function NumInput({ label, value, onChange, unit = "", min = 0, max = 999, step = 1 }: {
  label: string; value: number | null; onChange: (v: number | null) => void;
  unit?: string; min?: number; max?: number; step?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium text-zinc-300">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className="w-20 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 text-right focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        {unit && <span className="text-xs text-zinc-500 w-8">{unit}</span>}
      </div>
    </div>
  );
}

function MacroRef({ summary }: { summary?: { calories: number | null; protein: number | null; carbohydrates: number | null; fat: number | null; steps: number | null } }) {
  if (!summary) return null;
  return (
    <div className="bg-zinc-800/60 rounded-xl p-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
      <span>Yesterday</span>
      {summary.calories != null && <span className="text-zinc-200">{fmt(summary.calories, 0)} kcal</span>}
      {summary.protein != null && <span>P: <span className="text-zinc-200">{fmt(summary.protein, 0)}g</span></span>}
      {summary.carbohydrates != null && <span>C: <span className="text-zinc-200">{fmt(summary.carbohydrates, 0)}g</span></span>}
      {summary.fat != null && <span>F: <span className="text-zinc-200">{fmt(summary.fat, 0)}g</span></span>}
      {summary.steps != null && <span>Steps: <span className="text-zinc-200">{fmt(summary.steps, 0)}</span></span>}
    </div>
  );
}

export function Evening() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const forDate = (() => {
    const p = searchParams.get("date");
    if (p && /^\d{4}-\d{2}-\d{2}$/.test(p) && p <= TODAY) return p;
    return TODAY;
  })();
  const isPast = forDate < TODAY;
  const YESTERDAY = addDays(forDate, -1);

  const { data: existing } = useDailyLog(forDate);
  const upsert = useUpsertDailyLog(forDate);
  const dirtyRef = useRef(false);

  const { data: yestSummary } = useDashboardSummary(YESTERDAY, YESTERDAY);
  const yestData = yestSummary?.summaries?.[0];

  const { data: garminToday } = useQuery({
    queryKey: ["garmin-values", forDate],
    queryFn: () => api.garmin.values(forDate),
    staleTime: 300_000,
  });

  function goDate(iso: string) {
    if (iso >= TODAY) setSearchParams({});
    else setSearchParams({ date: iso });
  }

  const [pmEnergy, setPmEnergy] = useState<number | null>(null);
  const [motivation, setMotivation] = useState<number | null>(null);
  const [hunger, setHunger] = useState<number | null>(null);
  const [mood, setMood] = useState<number | null>(null);
  const [stress, setStress] = useState<number | null>(null);
  const [digestion, setDigestion] = useState<number | null>(null);
  const [trainingType, setTrainingType] = useState<string | null>(null);
  const [gymDone, setGymDone] = useState<boolean | null>(null);
  const [gymMins, setGymMins] = useState<number | null>(null);
  const [gymRpe, setGymRpe] = useState<number | null>(null);
  const [gymNotes, setGymNotes] = useState("");
  const [cardioType, setCardioType] = useState("");
  const [cardioMins, setCardioMins] = useState<number | null>(null);
  const [cardioAvgHr, setCardioAvgHr] = useState<number | null>(null);
  const [sleepHours, setSleepHours] = useState<number | null>(null);
  const [sleepQuality, setSleepQuality] = useState<number | null>(null);
  const [sleepScore, setSleepScore] = useState<number | null>(null);
  const [rhr, setRhr] = useState<number | null>(null);
  const [hrv, setHrv] = useState<number | null>(null);
  const [waterL, setWaterL] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!existing || dirtyRef.current) return;
    setPmEnergy(existing.pm_energy ?? null);
    setMotivation(existing.motivation ?? null);
    setHunger(existing.hunger ?? null);
    setMood(existing.mood ?? null);
    setStress(existing.stress ?? null);
    setDigestion(existing.digestion ?? null);
    setTrainingType(existing.training_type ?? null);
    setGymDone(existing.gym_done ?? null);
    setGymMins(existing.gym_minutes ?? null);
    setGymRpe(existing.gym_rpe ?? null);
    setGymNotes(existing.gym_notes ?? "");
    setCardioType(existing.cardio_type ?? "");
    setCardioMins(existing.cardio_minutes ?? null);
    setCardioAvgHr(existing.cardio_avg_hr ?? null);
    setSleepHours(existing.sleep_hours ?? null);
    setSleepQuality(existing.sleep_quality ?? null);
    setSleepScore(existing.sleep_score ?? null);
    setRhr(existing.rhr ?? null);
    setHrv(existing.hrv_overnight ?? null);
    setWaterL(existing.water_litres ?? null);
    setNotes(existing.notes ?? "");
  }, [existing]);

  function markDirty<T>(setter: (value: T) => void) {
    return (value: T) => {
      dirtyRef.current = true;
      setter(value);
    };
  }

  async function handleSave() {
    const payload: DailyLogUpsert = {};
    if (pmEnergy != null) payload.pm_energy = pmEnergy;
    if (motivation != null) payload.motivation = motivation;
    if (hunger != null) payload.hunger = hunger;
    if (mood != null) payload.mood = mood;
    if (stress != null) payload.stress = stress;
    if (digestion != null) payload.digestion = digestion;
    if (trainingType) payload.training_type = trainingType;
    if (gymDone != null) payload.gym_done = gymDone;
    if (gymMins != null) payload.gym_minutes = gymMins;
    if (gymRpe != null) payload.gym_rpe = gymRpe;
    if (gymNotes.trim()) payload.gym_notes = gymNotes.trim();
    if (cardioType.trim()) payload.cardio_type = cardioType.trim();
    if (cardioMins != null) payload.cardio_minutes = cardioMins;
    if (cardioAvgHr != null) payload.cardio_avg_hr = cardioAvgHr;
    if (sleepHours != null) payload.sleep_hours = sleepHours;
    if (sleepQuality != null) payload.sleep_quality = sleepQuality;
    if (sleepScore != null) payload.sleep_score = sleepScore;
    if (rhr != null) payload.rhr = rhr;
    if (hrv != null) payload.hrv_overnight = hrv;
    if (waterL != null) payload.water_litres = waterL;
    if (notes.trim()) payload.notes = notes.trim();

    await upsert.mutateAsync(payload);
    setSaved(true);
  }

  if (saved) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-6">
        <CheckCircle size={56} className="text-emerald-400" />
        <div className="text-center">
          <p className="text-lg font-semibold text-zinc-100">Evening logged.</p>
          <p className="text-sm text-zinc-500 mt-1">{formatDdMmYyyy(forDate)}</p>
        </div>
        <button
          onClick={() => navigate("/")}
          className="px-5 py-2.5 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors"
        >
          Go to Today
        </button>
      </div>
    );
  }

  const hasGym = trainingType && trainingType !== "rest";
  const hasCardio = trainingType === "cardio" || trainingType === "other";

  return (
    <div className="max-w-lg mx-auto p-4 flex flex-col gap-4 pb-28">
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-3">
          <Moon size={20} className="text-indigo-400" />
          <div>
            <h1 className="text-lg font-bold text-zinc-100">Evening review</h1>
            <p className="text-xs text-zinc-500">{formatDdMmYyyy(forDate)}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => goDate(addDays(forDate, -1))} className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors text-sm" title="Previous day">&#8592;</button>
          <button onClick={() => goDate(addDays(forDate, 1))} disabled={forDate >= TODAY} className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors text-sm disabled:opacity-30 disabled:cursor-not-allowed" title="Next day">&#8594;</button>
          {isPast && <button onClick={() => goDate(TODAY)} className="px-2 py-1 rounded-lg bg-emerald-800/40 hover:bg-emerald-700/40 text-emerald-400 text-xs font-semibold transition-colors">Today</button>}
        </div>
      </div>

      {isPast && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-900/30 border border-amber-800/50 text-amber-300 text-xs font-medium">
          Editing past day — {formatDdMmYyyy(forDate)}
        </div>
      )}

      <MacroRef summary={yestData ?? undefined} />

      <Section title="How was your day?">
        <ScaleSlider label="PM Energy" value={pmEnergy} onChange={markDirty(setPmEnergy)} variant="energy" />
        <ScaleSlider label="Motivation" value={motivation} onChange={markDirty(setMotivation)} variant="motivation" />
        <ScaleSlider label="Hunger" value={hunger} onChange={markDirty(setHunger)} variant="hunger" />
        <ScaleSlider label="Mood" value={mood} onChange={markDirty(setMood)} variant="mood" />
        <ScaleSlider label="Stress (1 = none)" value={stress} onChange={markDirty(setStress)} variant="stress" />
        <ScaleSlider label="Digestion" value={digestion} onChange={markDirty(setDigestion)} variant="digestion" />
      </Section>

      <Section title="Training" defaultOpen={!!trainingType}>
        <div className="grid grid-cols-5 gap-2">
          {TRAINING_TYPES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => markDirty(setTrainingType)(value)}
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

        {hasGym && (
          <>
            <NumInput label="Gym duration" value={gymMins} onChange={markDirty(setGymMins)} unit="min" max={300} />
            <ScaleSlider label="Session RPE" value={gymRpe} onChange={markDirty(setGymRpe)} variant="default" />
            <textarea
              value={gymNotes}
              onChange={(e) => markDirty(setGymNotes)(e.target.value)}
              placeholder="Gym notes (PRs, how it felt...)"
              rows={2}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
            />
          </>
        )}

        {(hasGym || hasCardio) && (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-zinc-300">Cardio type</span>
              <select
                value={cardioType}
                onChange={(e) => markDirty(setCardioType)(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">None</option>
                {CARDIO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {cardioType && (
              <>
                <NumInput label="Cardio duration" value={cardioMins} onChange={markDirty(setCardioMins)} unit="min" max={300} />
                <NumInput label="Avg HR" value={cardioAvgHr} onChange={markDirty(setCardioAvgHr)} unit="bpm" min={60} max={220} />
              </>
            )}
          </>
        )}
      </Section>

      <Section title="Last night's sleep" defaultOpen={false}>
        {garminToday?.sleep_minutes != null && sleepHours == null && (
          <div className="flex items-center justify-between bg-zinc-800/60 rounded-xl px-3 py-2 text-xs">
            <span className="text-zinc-400">Garmin: {formatMinutesAsHoursMinutes(garminToday.sleep_minutes)}</span>
            <button type="button" onClick={() => markDirty(setSleepHours)(minutesToDecimalHours(garminToday.sleep_minutes!))}
              className="text-emerald-400 hover:text-emerald-300 font-medium">Use</button>
          </div>
        )}
        <NumInput label="Sleep hours" value={sleepHours} onChange={markDirty(setSleepHours)} unit="hrs" step={0.5} max={24} />
        {sleepHours != null && (
          <p className="text-xs text-zinc-500 text-right">
            {formatMinutesAsHoursMinutes(sleepHours * 60)}
          </p>
        )}
        <ScaleSlider label="Sleep quality" value={sleepQuality} onChange={markDirty(setSleepQuality)} variant="sleep_quality" />
        {garminToday?.sleep_score != null && sleepScore == null && (
          <div className="flex items-center justify-between bg-zinc-800/60 rounded-xl px-3 py-2 text-xs">
            <span className="text-zinc-400">Garmin score: {garminToday.sleep_score}</span>
            <button type="button" onClick={() => markDirty(setSleepScore)(Math.round(garminToday.sleep_score!))}
              className="text-emerald-400 hover:text-emerald-300 font-medium">Use</button>
          </div>
        )}
        <NumInput label="Sleep score (Garmin)" value={sleepScore} onChange={markDirty(setSleepScore)} unit="" min={0} max={100} />
      </Section>

      <Section title="Recovery metrics" defaultOpen={false}>
        {garminToday?.resting_heart_rate != null && rhr == null && (
          <div className="flex items-center justify-between bg-zinc-800/60 rounded-xl px-3 py-2 text-xs">
            <span className="text-zinc-400">Garmin RHR: {garminToday.resting_heart_rate} bpm</span>
            <button type="button" onClick={() => markDirty(setRhr)(Math.round(garminToday.resting_heart_rate!))}
              className="text-emerald-400 hover:text-emerald-300 font-medium">Use</button>
          </div>
        )}
        <NumInput label="Resting HR" value={rhr} onChange={markDirty(setRhr)} unit="bpm" min={30} max={120} />
        {garminToday?.hrv_overnight != null && hrv == null && (
          <div className="flex items-center justify-between bg-zinc-800/60 rounded-xl px-3 py-2 text-xs">
            <span className="text-zinc-400">Garmin HRV: {garminToday.hrv_overnight} ms</span>
            <button type="button" onClick={() => markDirty(setHrv)(Math.round(garminToday.hrv_overnight!))}
              className="text-emerald-400 hover:text-emerald-300 font-medium">Use</button>
          </div>
        )}
        <NumInput label="Overnight HRV" value={hrv} onChange={markDirty(setHrv)} unit="ms" min={0} max={200} />
      </Section>

      <Section title="Water and notes" defaultOpen={false}>
        <NumInput label="Water" value={waterL} onChange={markDirty(setWaterL)} unit="L" step={0.1} max={10} />
        <textarea
          value={notes}
          onChange={(e) => markDirty(setNotes)(e.target.value)}
          placeholder="General notes for today..."
          rows={3}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
        />
      </Section>

      <button
        onClick={handleSave}
        disabled={upsert.isPending}
        className="w-full py-3.5 rounded-2xl bg-indigo-600 text-base font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors sticky bottom-4"
      >
        {upsert.isPending ? "Saving..." : "Save evening log"}
      </button>

      {upsert.isError && (
        <p className="text-sm text-red-400 text-center">Save failed - check connection</p>
      )}
    </div>
  );
}
