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
