import { useActiveDate } from "../../hooks/use-active-date";
import { formatDdMmYyyy } from "../../lib/format";

export function DateScope() {
  const { date, prev, next, goToday, isToday, TODAY } = useActiveDate();

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={prev}
        className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors text-sm"
        title="Previous day"
      >
        &#8592;
      </button>
      <span className="text-xs font-semibold text-zinc-300 tabular-nums min-w-[72px] text-center select-none">
        {isToday ? "Today" : formatDdMmYyyy(date)}
      </span>
      <button
        onClick={next}
        disabled={date >= TODAY}
        className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors text-sm disabled:opacity-30 disabled:cursor-not-allowed"
        title="Next day"
      >
        &#8594;
      </button>
      {!isToday && (
        <button
          onClick={goToday}
          className="px-2 py-1 rounded-lg bg-emerald-800/40 hover:bg-emerald-700/40 text-emerald-400 text-xs font-semibold transition-colors"
        >
          Now
        </button>
      )}
    </div>
  );
}
