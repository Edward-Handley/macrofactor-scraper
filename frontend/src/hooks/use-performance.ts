import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { PerformanceGoalCreate } from "../lib/types";

export function useTrainingLoad(start: string, end: string) {
  return useQuery({
    queryKey: ["training-load", start, end],
    queryFn: () => api.performance.load({ start, end }),
    staleTime: 60_000,
  });
}

export function useSwimAnalytics(start: string, end: string) {
  return useQuery({
    queryKey: ["swim-analytics", start, end],
    queryFn: () => api.performance.swim({ start, end }),
    staleTime: 60_000,
  });
}

export function useFueling(forDate?: string) {
  return useQuery({
    queryKey: ["fueling", forDate],
    queryFn: () => api.performance.fueling(forDate),
    staleTime: 60_000,
  });
}

export function useDailyRecommendation(forDate?: string) {
  return useQuery({
    queryKey: ["daily-recommendation", forDate],
    queryFn: () => api.performance.dailyRecommendation(forDate),
    staleTime: 300_000,
  });
}

export function usePerformanceReviews() {
  return useQuery({
    queryKey: ["performance-reviews"],
    queryFn: api.performance.reviews,
    staleTime: 300_000,
  });
}

export function useGenerateReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (weekStart?: string) => api.performance.generateReview(weekStart),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["performance-reviews"] }),
  });
}

export function useGoals(activeOnly = true) {
  return useQuery({
    queryKey: ["goals", activeOnly],
    queryFn: () => api.goals.list(activeOnly),
    staleTime: 60_000,
  });
}

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: PerformanceGoalCreate) => api.goals.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export function useUpdateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<PerformanceGoalCreate & { active: boolean }> }) =>
      api.goals.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.goals.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}
