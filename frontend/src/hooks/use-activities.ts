import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { ActivityCreate } from "../lib/types";

export function useActivities(options: { start?: string; end?: string; sport?: string } = {}) {
  return useQuery({
    queryKey: ["activities", options],
    queryFn: () => api.activities.list(options),
    staleTime: 60_000,
  });
}

export function useActivity(id: number) {
  return useQuery({
    queryKey: ["activity", id],
    queryFn: () => api.activities.get(id),
    staleTime: 60_000,
    enabled: id > 0,
  });
}

export function useCreateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ActivityCreate) => api.activities.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activities"] }),
  });
}

export function useUpdateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ActivityCreate> }) =>
      api.activities.update(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["activities"] });
      qc.invalidateQueries({ queryKey: ["activity", id] });
    },
  });
}

export function useDeleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.activities.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activities"] }),
  });
}

export function useSyncActivities() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (daysBack?: number) => api.activities.syncGarmin(daysBack),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activities"] }),
  });
}
