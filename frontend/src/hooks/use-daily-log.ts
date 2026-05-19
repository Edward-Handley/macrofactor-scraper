import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { DailyLogUpsert, BodyMeasurementUpsert, CutPhaseCreate } from "../lib/types";

export function useDailyLog(date: string) {
  return useQuery({
    queryKey: ["daily-log", date],
    queryFn: () => api.dailyLog.get(date),
    retry: (count, error) => {
      if (error instanceof Error && error.message.startsWith("404")) return false;
      return count < 2;
    },
    staleTime: 30_000,
  });
}

export function useDailyLogs(start?: string, end?: string) {
  return useQuery({
    queryKey: ["daily-logs", start, end],
    queryFn: () => api.dailyLog.list(start, end),
    staleTime: 60_000,
  });
}

export function useUpsertDailyLog(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: DailyLogUpsert) => api.dailyLog.upsert(date, data),
    onSuccess: (data) => {
      qc.setQueryData(["daily-log", date], data);
      qc.invalidateQueries({ queryKey: ["daily-logs"] });
    },
  });
}

export function useMeasurement(date: string) {
  return useQuery({
    queryKey: ["measurement", date],
    queryFn: () => api.measurements.get(date),
    retry: (count, error) => {
      if (error instanceof Error && error.message.startsWith("404")) return false;
      return count < 2;
    },
    staleTime: 60_000,
  });
}

export function useMeasurements(start?: string, end?: string) {
  return useQuery({
    queryKey: ["measurements", start, end],
    queryFn: () => api.measurements.list(start, end),
    staleTime: 300_000,
  });
}

export function useUpsertMeasurement(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: BodyMeasurementUpsert) => api.measurements.upsert(date, data),
    onSuccess: (data) => {
      qc.setQueryData(["measurement", date], data);
      qc.invalidateQueries({ queryKey: ["measurements"] });
    },
  });
}

export function useCutPhases() {
  return useQuery({
    queryKey: ["cut-phases"],
    queryFn: api.cutPhases.list,
    staleTime: 300_000,
  });
}

export function useCreateCutPhase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CutPhaseCreate) => api.cutPhases.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cut-phases"] }),
  });
}

export function useUpdateCutPhase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<CutPhaseCreate> }) =>
      api.cutPhases.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cut-phases"] }),
  });
}

export function useCoachDraft(date?: string, kind = "check_in") {
  return useQuery({
    queryKey: ["coach-draft", date, kind],
    queryFn: () => api.coach.draft(date, kind),
    staleTime: 60_000,
  });
}
