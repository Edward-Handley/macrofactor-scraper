import { useState } from "react";
import { Plus, Pencil, Trash2, X, Check } from "lucide-react";
import { useGoals, useCreateGoal, useUpdateGoal, useDeleteGoal } from "../hooks/use-performance";
import type { PerformanceGoal, PerformanceGoalCreate } from "../lib/types";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-4 ${className}`}>
      {children}
    </div>
  );
}

const GOAL_TYPES = [
  { value: "swim_pace", label: "Swim Pace" },
  { value: "weekly_volume", label: "Weekly Volume" },
  { value: "weekly_load", label: "Weekly Load" },
  { value: "frequency", label: "Frequency" },
  { value: "custom", label: "Custom" },
];

const SPORTS = ["swimming", "water_polo", "running", "cycling", "any"];

function GoalForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<PerformanceGoalCreate>;
  onSubmit: (data: PerformanceGoalCreate) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<PerformanceGoalCreate>({
    name: initial?.name ?? "",
    goal_type: initial?.goal_type ?? "custom",
    sport: initial?.sport ?? "",
    target_value: initial?.target_value ?? 0,
    unit: initial?.unit ?? "",
    target_date: initial?.target_date ?? "",
    notes: initial?.notes ?? "",
  });

  const set = (k: keyof PerformanceGoalCreate, v: string | number) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs text-zinc-400 mb-1 block">Goal name</label>
          <input
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Sub 1:40/100m pace"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">Type</label>
          <select
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500"
            value={form.goal_type}
            onChange={(e) => set("goal_type", e.target.value as PerformanceGoalCreate["goal_type"])}
          >
            {GOAL_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">Sport</label>
          <select
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500"
            value={form.sport ?? ""}
            onChange={(e) => set("sport", e.target.value)}
          >
            <option value="">Any</option>
            {SPORTS.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">Target value</label>
          <input
            type="number"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500"
            value={form.target_value ?? ""}
            onChange={(e) => set("target_value", +e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">Unit</label>
          <input
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500"
            value={form.unit ?? ""}
            onChange={(e) => set("unit", e.target.value)}
            placeholder="s/100m, km, sessions…"
          />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-zinc-400 mb-1 block">Target date (optional)</label>
          <input
            type="date"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500"
            value={form.target_date ?? ""}
            onChange={(e) => set("target_date", e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-zinc-400 mb-1 block">Notes (optional)</label>
          <textarea
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500 resize-none"
            rows={2}
            value={form.notes ?? ""}
            onChange={(e) => set("notes", e.target.value)}
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => form.name && onSubmit(form)}
          className="px-3 py-1.5 rounded-lg text-xs bg-cyan-600 hover:bg-cyan-500 text-white font-semibold transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function GoalCard({ goal }: { goal: PerformanceGoal }) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateGoal();
  const del = useDeleteGoal();

  if (editing) {
    return (
      <Card>
        <GoalForm
          initial={goal}
          onSubmit={(data) => {
            update.mutate({ id: goal.id, data }, { onSuccess: () => setEditing(false) });
          }}
          onCancel={() => setEditing(false)}
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-zinc-100 text-sm">{goal.name}</span>
            {!goal.active && (
              <span className="text-[10px] bg-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded-full">Archived</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2 mt-1">
            <span className="text-xs text-zinc-500 capitalize">{goal.goal_type.replace(/_/g, " ")}</span>
            {goal.sport && <span className="text-xs text-zinc-500 capitalize">{goal.sport.replace(/_/g, " ")}</span>}
            <span className="text-xs text-cyan-400 font-medium">
              Target: {goal.target_value} {goal.unit}
            </span>
            {goal.target_date && (
              <span className="text-xs text-zinc-500">by {goal.target_date}</span>
            )}
          </div>
          {goal.notes && <p className="text-xs text-zinc-500 mt-1">{goal.notes}</p>}
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={() => update.mutate({ id: goal.id, data: { active: !goal.active } })}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            title={goal.active ? "Archive" : "Restore"}
          >
            {goal.active ? <X size={13} /> : <Check size={13} />}
          </button>
          <button
            type="button"
            onClick={() => del.mutate(goal.id)}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </Card>
  );
}

export function Goals() {
  const [showCreate, setShowCreate] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { data: activeData } = useGoals(true);
  const { data: allData } = useGoals(false);
  const create = useCreateGoal();

  const goals = (showAll ? allData?.goals : activeData?.goals) ?? [];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-zinc-100">Goals</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {showAll ? "Active only" : "Show all"}
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors"
          >
            <Plus size={13} />
            New goal
          </button>
        </div>
      </div>

      {showCreate && (
        <Card>
          <p className="text-sm font-semibold text-zinc-200 mb-3">New Goal</p>
          <GoalForm
            onSubmit={(data) => {
              create.mutate(data, { onSuccess: () => setShowCreate(false) });
            }}
            onCancel={() => setShowCreate(false)}
          />
        </Card>
      )}

      {goals.length === 0 ? (
        <div className="text-center text-zinc-500 text-sm py-12">
          No goals yet. Create one to track your progress.
        </div>
      ) : (
        <div className="space-y-3">
          {goals.map((g) => <GoalCard key={g.id} goal={g} />)}
        </div>
      )}
    </div>
  );
}
