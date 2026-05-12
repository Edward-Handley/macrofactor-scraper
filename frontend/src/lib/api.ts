import type {
  BodyMeasurement,
  BodyMeasurementListResponse,
  BodyMeasurementUpsert,
  CoachDraftResponse,
  CutPhase,
  CutPhaseCreate,
  CutPhaseListResponse,
  DailyLog,
  DailyLogListResponse,
  DailyLogUpsert,
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
  StrongSessionRecord,
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
    session: (sessionId: number) =>
      request<StrongSessionRecord>(`/v1/strong/sessions/${sessionId}`),
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

  dailyLog: {
    get: (date: string) => request<DailyLog>(`/v1/daily-log/${date}`),
    list: (start?: string, end?: string) => {
      const params = new URLSearchParams();
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      return request<DailyLogListResponse>(`/v1/daily-log?${params}`);
    },
    upsert: (date: string, data: DailyLogUpsert) =>
      request<DailyLog>(`/v1/daily-log/${date}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
  },

  measurements: {
    get: (date: string) => request<BodyMeasurement>(`/v1/measurements/${date}`),
    list: (start?: string, end?: string) => {
      const params = new URLSearchParams();
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      return request<BodyMeasurementListResponse>(`/v1/measurements?${params}`);
    },
    upsert: (date: string, data: BodyMeasurementUpsert) =>
      request<BodyMeasurement>(`/v1/measurements/${date}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
  },

  cutPhases: {
    list: () => request<CutPhaseListResponse>("/v1/cut-phases"),
    create: (data: CutPhaseCreate) =>
      request<CutPhase>("/v1/cut-phases", { method: "POST", body: JSON.stringify(data) }),
    update: (id: number, data: Partial<CutPhaseCreate>) =>
      request<CutPhase>(`/v1/cut-phases/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  },

  garmin: {
    status: () => request<{ configured: boolean; last_sync_at: string | null; last_error: string | null }>("/v1/garmin/status"),
    values: (date: string) => request<Record<string, number>>(`/v1/garmin/values/${date}`),
    sync: (date?: string) =>
      request<{ synced: boolean; changed: Record<string, boolean> }>(
        `/v1/garmin/sync${date ? `?sync_date=${date}` : ""}`,
        { method: "POST" }
      ),
    categories: () => request<import("./types").GarminCategoriesResponse>("/v1/garmin/categories"),
    series: (metric: string, options: { days?: number; start?: string; end?: string } = {}) => {
      const p = new URLSearchParams();
      if (options.start && options.end) {
        p.set("start", options.start);
        p.set("end", options.end);
      } else if (options.days) {
        p.set("days", String(options.days));
      }
      const qs = p.toString();
      return request<import("./types").GarminSeriesResponse>(
        `/v1/garmin/series/${metric}${qs ? `?${qs}` : ""}`
      );
    },
  },

  coach: {
    draft: (date?: string) =>
      request<CoachDraftResponse>(`/v1/coach/draft${date ? `?for_date=${date}` : ""}`),
  },
};
