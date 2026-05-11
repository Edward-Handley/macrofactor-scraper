import type {
  DashboardSummaryResponse,
  DiagnosticsResponse,
  IngestStatus,
  MetricCatalogResponse,
  Preferences,
  RepairReport,
  StrongAnalyticsResponse,
  StrongExerciseDetailResponse,
  StrongImportListResponse,
  StrongImportResponse,
  StrongSessionListResponse,
  StrongSummaryResponse,
  WorkoutListResponse,
} from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = init?.body instanceof FormData
    ? init?.headers
    : { "Content-Type": "application/json", ...(init?.headers ?? {}) };
  const res = await fetch(url, {
    ...init,
    headers,
  });
  if (res.status === 401) {
    location.href = "/login";
    throw new Error("auth");
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  dashboardSummary: (start: string, end: string, includeHidden = true) =>
    request<DashboardSummaryResponse>(
      `/v1/dashboard/summary?start=${start}&end=${end}&include_hidden=${includeHidden}`
    ),

  preferences: {
    get: () => request<Preferences>("/v1/dashboard/preferences"),
    update: (prefs: Preferences) =>
      request<Preferences>("/v1/dashboard/preferences", {
        method: "PUT",
        body: JSON.stringify(prefs),
      }),
  },

  metricCatalog: () => request<MetricCatalogResponse>("/v1/dashboard/metric-catalog"),

  ingestStatus: () => request<IngestStatus>("/v1/ingest/status"),

  workouts: (start: string, end: string) =>
    request<WorkoutListResponse>(`/v1/workouts?start=${start}&end=${end}`),

  strong: {
    importCsv: (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return request<StrongImportResponse>("/v1/strong/import", { method: "POST", body });
    },
    imports: () => request<StrongImportListResponse>("/v1/strong/imports"),
    summary: (start: string, end: string) =>
      request<StrongSummaryResponse>(`/v1/strong/summary?start=${start}&end=${end}`),
    analytics: (start: string, end: string) =>
      request<StrongAnalyticsResponse>(`/v1/strong/analytics?start=${start}&end=${end}`),
    sessions: (start: string, end: string) =>
      request<StrongSessionListResponse>(`/v1/strong/sessions?start=${start}&end=${end}`),
    exercise: (exerciseName: string, start: string, end: string) =>
      request<StrongExerciseDetailResponse>(
        `/v1/strong/exercises/${encodeURIComponent(exerciseName)}?start=${start}&end=${end}`
      ),
  },

  diagnostics: (date: string) =>
    request<DiagnosticsResponse>(`/v1/diagnostics/metrics/${date}`),

  repair: (date: string, dryRun: boolean) =>
    request<RepairReport>(
      `/v1/admin/repair?date=${date}&dry_run=${dryRun}`,
      { method: "POST" }
    ),
};
