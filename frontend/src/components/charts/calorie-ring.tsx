import { useEffect, useRef } from "react";
import { fmt, dayProgressFraction } from "../../lib/format";

interface CalorieRingProps {
  calories: number | null;
  protein: number | null;
  carbohydrates: number | null;
  fat: number | null;
  size?: number;
}

export function CalorieRing({ calories, protein, carbohydrates, fat, size = 260 }: CalorieRingProps) {
  const ringRef = useRef<SVGCircleElement>(null);
  const arcRef = useRef<SVGCircleElement>(null);

  const r = (size / 2) * 0.78;
  const innerR = (size / 2) * 0.58;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const innerCircumference = 2 * Math.PI * innerR;

  useEffect(() => {
    const progress = dayProgressFraction();
    if (ringRef.current) {
      ringRef.current.style.strokeDashoffset = String(circumference * (1 - progress));
    }
    const macroTotal = (protein ?? 0) * 4 + (carbohydrates ?? 0) * 4 + (fat ?? 0) * 9;
    const pFrac = macroTotal > 0 ? ((protein ?? 0) * 4) / macroTotal : 0.33;
    const cFrac = macroTotal > 0 ? ((carbohydrates ?? 0) * 4) / macroTotal : 0.33;
    // inner arc shows protein fraction
    if (arcRef.current) {
      arcRef.current.style.strokeDashoffset = String(innerCircumference * (1 - pFrac - cFrac));
    }
  }, [calories, protein, carbohydrates, fat, circumference, innerCircumference]);

  const macros = [
    { key: "P", value: protein, color: "#34d399" },
    { key: "C", value: carbohydrates, color: "#60a5fa" },
    { key: "F", value: fat, color: "#c084fc" },
  ];

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <defs>
            <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#059669" />
            </linearGradient>
            <linearGradient id="inner-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#818cf8" />
              <stop offset="100%" stopColor="#c084fc" />
            </linearGradient>
          </defs>
          {/* Track */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeWidth={14}
            className="text-zinc-800" />
          {/* Progress ring */}
          <circle
            ref={ringRef}
            cx={cx} cy={cy} r={r} fill="none"
            stroke="url(#ring-grad)" strokeWidth={14}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference}
            style={{ transition: "stroke-dashoffset 1s ease" }}
          />
          {/* Inner track */}
          <circle cx={cx} cy={cy} r={innerR} fill="none" stroke="currentColor" strokeWidth={8}
            className="text-zinc-800" />
          {/* Inner macro arc */}
          <circle
            ref={arcRef}
            cx={cx} cy={cy} r={innerR} fill="none"
            stroke="url(#inner-grad)" strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={innerCircumference}
            strokeDashoffset={innerCircumference}
            style={{ transition: "stroke-dashoffset 1s ease" }}
          />
        </svg>

        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-4xl font-black text-zinc-50 tabular-nums leading-none">
            {fmt(calories, 0)}
          </span>
          <span className="text-xs text-zinc-400 mt-1">kcal today</span>
          <div className="flex gap-2 mt-2">
            {macros.map(({ key, value }) => (
              <span key={key} className="text-xs font-semibold text-zinc-300">
                {key} {value != null ? Math.round(value) : "—"}g
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
