import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Preferences } from "../lib/types";

export function useDashboardSummary(start: string, end: string) {
  return useQuery({
    queryKey: ["dashboard-summary", start, end],
    queryFn: () => api.dashboardSummary(start, end),
    staleTime: 60_000,
  });
}

export function usePreferences() {
  return useQuery({
    queryKey: ["preferences"],
    queryFn: api.preferences.get,
    staleTime: 300_000,
  });
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.preferences.update,
    onSuccess: (data) => {
      qc.setQueryData(["preferences"], data);
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
      qc.invalidateQueries({ queryKey: ["strong-summary"] });
      qc.invalidateQueries({ queryKey: ["strong-analytics"] });
      qc.invalidateQueries({ queryKey: ["strong-sessions"] });
      qc.invalidateQueries({ queryKey: ["strong-session"] });
      qc.invalidateQueries({ queryKey: ["strong-exercise"] });
    },
  });
}

export function useMetricCatalog() {
  return useQuery({
    queryKey: ["metric-catalog"],
    queryFn: api.metricCatalog,
    staleTime: 300_000,
  });
}

export function useIngestStatus() {
  return useQuery({
    queryKey: ["ingest-status"],
    queryFn: api.ingestStatus,
    staleTime: 60_000,
  });
}

export function useWorkouts(start: string, end: string) {
  return useQuery({
    queryKey: ["workouts", start, end],
    queryFn: () => api.workouts(start, end),
    staleTime: 60_000,
  });
}

export function useStrongImports() {
  return useQuery({
    queryKey: ["strong-imports"],
    queryFn: api.strong.imports,
    staleTime: 60_000,
  });
}

export function useStrongSummary(start: string, end: string) {
  return useQuery({
    queryKey: ["strong-summary", start, end],
    queryFn: () => api.strong.summary(start, end),
    staleTime: 60_000,
  });
}

export function useStrongAnalytics(start: string, end: string) {
  return useQuery({
    queryKey: ["strong-analytics", start, end],
    queryFn: () => api.strong.analytics(start, end),
    staleTime: 60_000,
  });
}

export function useStrongSessions(start: string, end: string) {
  return useQuery({
    queryKey: ["strong-sessions", start, end],
    queryFn: () => api.strong.sessions(start, end),
    staleTime: 60_000,
  });
}

export function useStrongSession(sessionId: number | null) {
  return useQuery({
    queryKey: ["strong-session", sessionId],
    queryFn: () => api.strong.session(sessionId!),
    enabled: sessionId != null,
    staleTime: 60_000,
  });
}

export function useStrongExercise(exerciseName: string | null, start: string, end: string) {
  return useQuery({
    queryKey: ["strong-exercise", exerciseName, start, end],
    queryFn: () => api.strong.exercise(exerciseName!, start, end),
    enabled: !!exerciseName,
    staleTime: 60_000,
  });
}

export function useImportStrongCsv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.strong.importCsv,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["strong-imports"] });
      qc.invalidateQueries({ queryKey: ["strong-summary"] });
      qc.invalidateQueries({ queryKey: ["strong-analytics"] });
      qc.invalidateQueries({ queryKey: ["strong-sessions"] });
      qc.invalidateQueries({ queryKey: ["strong-session"] });
      qc.invalidateQueries({ queryKey: ["strong-exercise"] });
    },
  });
}

export function useDiagnostics(date: string | null) {
  return useQuery({
    queryKey: ["diagnostics", date],
    queryFn: () => api.diagnostics(date!),
    enabled: !!date,
    staleTime: 30_000,
  });
}

export function useRepair() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ date, dryRun }: { date: string; dryRun: boolean }) =>
      api.repair(date, dryRun),
    onSuccess: (_data, { date }) => {
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
      qc.invalidateQueries({ queryKey: ["diagnostics", date] });
    },
  });
}

export function useGarminCategories() {
  return useQuery({
    queryKey: ["garmin-categories"],
    queryFn: api.garmin.categories,
    staleTime: Infinity,
  });
}

export function useGarminSeries(metric: string, options: { days?: number; start?: string; end?: string } = { days: 30 }) {
  return useQuery({
    queryKey: ["garmin-series", metric, options],
    queryFn: () => api.garmin.series(metric, options),
    staleTime: 300_000,
    enabled: !!metric,
  });
}

export function useReadiness(date: string) {
  return useQuery({
    queryKey: ["readiness", date],
    queryFn: () => api.insights.readiness(date),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    enabled: !!date,
  });
}
