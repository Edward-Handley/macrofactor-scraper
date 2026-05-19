import { useSearchParams } from "react-router-dom";
import { isoDate } from "../lib/format";

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function useActiveDate() {
  const [searchParams, setSearchParams] = useSearchParams();
  const TODAY = isoDate();

  const date = (() => {
    const p = searchParams.get("date");
    if (p && /^\d{4}-\d{2}-\d{2}$/.test(p) && p <= TODAY) return p;
    return TODAY;
  })();

  function setDate(iso: string) {
    if (iso >= TODAY) {
      setSearchParams((prev) => { prev.delete("date"); return prev; }, { replace: true });
    } else {
      setSearchParams((prev) => { prev.set("date", iso); return prev; }, { replace: true });
    }
  }

  function prev() { setDate(addDays(date, -1)); }
  function next() { if (date < TODAY) setDate(addDays(date, 1)); }
  function goToday() { setDate(TODAY); }

  return { date, setDate, prev, next, goToday, isToday: date === TODAY, TODAY };
}
