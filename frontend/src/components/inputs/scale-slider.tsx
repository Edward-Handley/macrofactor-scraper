import { cn } from "../../lib/utils";

export type ScaleVariant =
  | "energy" | "soreness" | "mood" | "motivation"
  | "hunger" | "stress" | "digestion" | "sleep_quality" | "default";

const ANCHOR_LABELS: Record<ScaleVariant, [string, string, string]> = {
  energy:        ["Dead", "OK", "🔥"],
  soreness:      ["None", "Moderate", "🤕"],
  mood:          ["Awful", "OK", "😄"],
  motivation:    ["None", "OK", "🚀"],
  hunger:        ["None", "Normal", "🍽️"],
  stress:        ["None", "Moderate", "🤯"],
  digestion:     ["Awful", "OK", "✅"],
  sleep_quality: ["Terrible", "OK", "Perfect"],
  default:       ["Low", "Mid", "High"],
};

// Color per value 1-10: red → amber → green
const COLOR_CLASSES = [
  "bg-red-600 border-red-500 text-white",        // 1
  "bg-red-500 border-red-400 text-white",        // 2
  "bg-orange-600 border-orange-500 text-white",  // 3
  "bg-orange-500 border-orange-400 text-white",  // 4
  "bg-amber-500 border-amber-400 text-white",    // 5
  "bg-yellow-500 border-yellow-400 text-zinc-900", // 6
  "bg-lime-500 border-lime-400 text-zinc-900",   // 7
  "bg-green-500 border-green-400 text-white",    // 8
  "bg-emerald-500 border-emerald-400 text-white", // 9
  "bg-emerald-400 border-emerald-300 text-zinc-900", // 10
];

interface ScaleSliderProps {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
  variant?: ScaleVariant;
}

export function ScaleSlider({ label, value, onChange, variant = "default" }: ScaleSliderProps) {
  const [lo, mid, hi] = ANCHOR_LABELS[variant];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-300">{label}</span>
        <span className="text-xs text-zinc-500 w-6 text-right">
          {value != null ? value : "—"}
        </span>
      </div>

      <div className="grid grid-cols-10 gap-1">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => {
          const isActive = value === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              className={cn(
                "h-10 rounded-lg border text-sm font-semibold transition-all",
                isActive
                  ? COLOR_CLASSES[v - 1]
                  : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
              )}
            >
              {v}
            </button>
          );
        })}
      </div>

      <div className="flex justify-between text-[10px] text-zinc-600 px-0.5">
        <span>{lo}</span>
        <span>{mid}</span>
        <span>{hi}</span>
      </div>
    </div>
  );
}
