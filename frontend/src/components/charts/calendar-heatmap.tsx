import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { DailySummary } from "../../lib/types";
import { isoDate } from "../../lib/format";

interface CalendarHeatmapProps {
  data: DailySummary[];
  field?: "calories";
}

function rollingQuintile(values: number[]): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    const rank = sorted.filter((x) => x <= v).length;
    const pct = rank / sorted.length;
    if (pct < 0.2) return 0;
    if (pct < 0.4) return 1;
    if (pct < 0.6) return 2;
    if (pct < 0.8) return 3;
    return 4;
  });
}

const BUCKET_COLORS = [
  "bg-zinc-800",           // very low
  "bg-emerald-900/80",     // low
  "bg-emerald-700/80",     // medium
  "bg-emerald-500/80",     // high
  "bg-emerald-400",        // very high
];

const BUCKET_LABELS = ["Very low", "Low", "Medium", "High", "Very high"];

export function CalendarHeatmap({ data, field = "calories" }: CalendarHeatmapProps) {
  const navigate = useNavigate();

  const { weeks, today } = useMemo(() => {
    const todayStr = isoDate();
    const values = data.map((d) => d[field] ?? 0);
    const buckets = rollingQuintile(values);
    const bucketMap: Record<string, { bucket: number; value: number }> = {};
    data.forEach((d, i) => {
      if (d[field] != null) bucketMap[d.date] = { bucket: buckets[i], value: d[field] as number };
    });

    // Build a 7×N grid starting from Monday of the earliest date
    const dates = data.map((d) => d.date).sort();
    if (dates.length === 0) return { weeks: [], today: todayStr };

    const start = new Date(dates[0] + "T00:00:00");
    // Align to Monday
    const dow = start.getDay();
    const offset = dow === 0 ? -6 : 1 - dow;
    start.setDate(start.getDate() + offset);

    const end = new Date(todayStr + "T00:00:00");
    end.setDate(end.getDate() + (7 - end.getDay() || 7)); // end of week

    const weeksArr: Array<Array<{ date: string; bucket: number | null; value: number | null }>> = [];
    let current = new Date(start);
    while (current <= end) {
      const week: typeof weeksArr[0] = [];
      for (let i = 0; i < 7; i++) {
        const iso = isoDate(current);
        const info = bucketMap[iso];
        week.push({ date: iso, bucket: info?.bucket ?? null, value: info?.value ?? null });
        current.setDate(current.getDate() + 1);
      }
      weeksArr.push(week);
    }

    return { weeks: weeksArr, today: todayStr };
  }, [data, field]);

  const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

  if (weeks.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {/* Day labels column */}
        <div className="flex flex-col gap-1 mr-1">
          {DAY_LABELS.map((d, i) => (
            <div key={i} className="w-4 h-4 flex items-center justify-center text-[10px] text-zinc-600">
              {d}
            </div>
          ))}
        </div>
        {/* Week columns */}
        <div className="flex gap-1 overflow-x-auto pb-1 flex-1">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1 shrink-0">
              {week.map(({ date, bucket, value }) => {
                const isToday = date === today;
                const isFuture = date > today;
                const hasData = bucket !== null && !isFuture;
                return (
                  <button
                    key={date}
                    onClick={() => hasData && navigate(`/data-health?date=${date}`)}
                    title={
                      hasData
                        ? `${date}: ${Math.round(value ?? 0)} kcal — ${BUCKET_LABELS[bucket!]}`
                        : isFuture
                        ? date
                        : `${date}: no data`
                    }
                    className={[
                      "w-4 h-4 rounded-sm transition-all",
                      isToday ? "ring-1 ring-emerald-400" : "",
                      hasData ? BUCKET_COLORS[bucket!] : "bg-zinc-900",
                      hasData ? "cursor-pointer hover:opacity-80 hover:scale-110" : "cursor-default",
                    ].join(" ")}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {/* Legend */}
      <div className="flex items-center gap-2 text-[10px] text-zinc-500">
        <span>Low</span>
        {BUCKET_COLORS.map((c, i) => (
          <div key={i} className={`w-3 h-3 rounded-sm ${c}`} />
        ))}
        <span>High</span>
      </div>
    </div>
  );
}
