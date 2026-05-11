import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { isoDate, offsetDate } from "../lib/format";

export function useDateRange(defaultDays = 30) {
  const [params, setParams] = useSearchParams();

  const end = params.get("end") ?? isoDate();
  const start = params.get("start") ?? offsetDate(-(defaultDays - 1), new Date(end + "T00:00:00"));

  const setRange = useCallback(
    (newStart: string, newEnd: string) => {
      setParams((p) => {
        const next = new URLSearchParams(p);
        next.set("start", newStart);
        next.set("end", newEnd);
        return next;
      });
    },
    [setParams]
  );

  return { start, end, setRange };
}
