import { useState } from "react";
import { useCutPhases, useCreateCutPhase, useUpdateCutPhase } from "../hooks/use-daily-log";
import type { CutPhase, CutPhaseCreate } from "../lib/types";
import { isoDate } from "../lib/format";

const TODAY = isoDate();

function phaseIsActive(p: CutPhase) {
  return p.end_date === null || p.end_date >= TODAY;
}

function daysSince(start: string) {
  const ms = new Date().getTime() - new Date(start).getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

function weekOf(start: string) {
  return Math.floor(daysSince(start) / 7) + 1;
}

function PhaseCard({ phase, onEdit }: { phase: CutPhase; onEdit: (p: CutPhase) => void }) {
  const active = phaseIsActive(phase);
  const day = active ? daysSince(phase.start_date) : null;
  const week = active ? weekOf(phase.start_date) : null;

  return (
    <div className={`bg-zinc-900 border rounded-2xl p-4 flex flex-col gap-2 ${active ? "border-emerald-700" : "border-zinc-800"}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-100">{phase.name}</span>
            {active && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
                Active
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            {phase.start_date}{phase.end_date ? ` -> ${phase.end_date}` : " -> ongoing"}
          </p>
        </div>
        <button
          onClick={() => onEdit(phase)}
          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition-colors"
        >
          Edit
        </button>
      </div>

      {active && day !== null && (
        <div className="flex gap-3 text-xs text-zinc-400">
          <span>Week <span className="font-semibold text-zinc-200">{week}</span></span>
          <span>-</span>
          <span>Day <span className="font-semibold text-zinc-200">{day}</span></span>
          {phase.target_calories && (
            <>
              <span>-</span>
              <span>Target <span className="font-semibold text-zinc-200">{phase.target_calories} kcal</span></span>
            </>
          )}
          {phase.target_weight_kg && (
            <>
              <span>-</span>
              <span>Goal <span className="font-semibold text-zinc-200">{phase.target_weight_kg} kg</span></span>
            </>
          )}
        </div>
      )}
      {phase.notes && <p className="text-xs text-zinc-500">{phase.notes}</p>}
    </div>
  );
}

const EMPTY_FORM: CutPhaseCreate = {
  name: "",
  start_date: TODAY,
  end_date: null,
  target_weight_kg: null,
  target_calories: null,
  notes: null,
};

function PhaseForm({
  initial,
  onSave,
  onCancel,
  isLoading,
}: {
  initial: CutPhaseCreate;
  onSave: (data: CutPhaseCreate) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [form, setForm] = useState<CutPhaseCreate>(initial);

  function set(key: keyof CutPhaseCreate, val: unknown) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSave(form);
  }

  return (
    <form onSubmit={submit} className="bg-zinc-900 border border-zinc-700 rounded-2xl p-4 flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2 flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400">Phase name *</label>
          <input
            required
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Cut Phase 1"
            className="bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400">Start date *</label>
          <input
            required
            type="date"
            value={form.start_date}
            onChange={(e) => set("start_date", e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400">End date (leave blank = ongoing)</label>
          <input
            type="date"
            value={form.end_date ?? ""}
            onChange={(e) => set("end_date", e.target.value || null)}
            className="bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400">Target calories (kcal)</label>
          <input
            type="number"
            min={0}
            value={form.target_calories ?? ""}
            onChange={(e) => set("target_calories", e.target.value ? parseInt(e.target.value) : null)}
            placeholder="2000"
            className="bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400">Target weight (kg)</label>
          <input
            type="number"
            step="0.1"
            min={0}
            value={form.target_weight_kg ?? ""}
            onChange={(e) => set("target_weight_kg", e.target.value ? parseFloat(e.target.value) : null)}
            placeholder="82.0"
            className="bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <div className="sm:col-span-2 flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400">Notes</label>
          <textarea
            value={form.notes ?? ""}
            onChange={(e) => set("notes", e.target.value || null)}
            rows={2}
            className="bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-xl text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isLoading}
          className="px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 transition-colors"
        >
          {isLoading ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}

export function CutPhases() {
  const { data, isLoading } = useCutPhases();
  const createMut = useCreateCutPhase();
  const updateMut = useUpdateCutPhase();

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<CutPhase | null>(null);

  const phases = data?.phases ?? [];
  const active = phases.find(phaseIsActive) ?? null;

  function handleCreate(form: CutPhaseCreate) {
    createMut.mutate(form, { onSuccess: () => setShowCreate(false) });
  }

  function handleUpdate(form: CutPhaseCreate) {
    if (!editing) return;
    updateMut.mutate({ id: editing.id, data: form }, { onSuccess: () => setEditing(null) });
  }

  function handleEndPhase(phase: CutPhase) {
    updateMut.mutate({ id: phase.id, data: { end_date: TODAY } });
  }

  if (isLoading) return (
    <div className="p-6 flex items-center justify-center h-64">
      <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
    </div>
  );

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-zinc-50">Cut Phases</h1>
          {active && (
            <p className="text-sm text-zinc-500 mt-0.5">
              {active.name} - Week {weekOf(active.start_date)} - Day {daysSince(active.start_date)}
            </p>
          )}
        </div>
        {!showCreate && !editing && (
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
          >
            New phase
          </button>
        )}
      </div>

      {showCreate && (
        <PhaseForm
          initial={EMPTY_FORM}
          onSave={handleCreate}
          onCancel={() => setShowCreate(false)}
          isLoading={createMut.isPending}
        />
      )}

      {editing && (
        <PhaseForm
          initial={{
            name: editing.name,
            start_date: editing.start_date,
            end_date: editing.end_date,
            target_weight_kg: editing.target_weight_kg,
            target_calories: editing.target_calories,
            notes: editing.notes,
          }}
          onSave={handleUpdate}
          onCancel={() => setEditing(null)}
          isLoading={updateMut.isPending}
        />
      )}

      {phases.length === 0 && !showCreate && (
        <div className="text-center py-12 text-zinc-600 text-sm">
          No phases yet  -  create one to start tracking your cut.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {phases.map((p) => (
          <div key={p.id}>
            <PhaseCard phase={p} onEdit={setEditing} />
            {phaseIsActive(p) && !p.end_date && (
              <div className="mt-1 flex justify-end">
                <button
                  onClick={() => handleEndPhase(p)}
                  className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors px-2 py-1"
                >
                  End phase today
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
