import type {
  AiAnalyseResponse,
  BodyCompositionResponse,
  BodyMeasurement,
  BodyMeasurementListResponse,
  BodyMeasurementUpsert,
  CoachConversation,
  CoachConversationWithMessages,
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
  PhotoListResponse,
  Preferences,
  ReadinessReport,
  RepairReport,
  SmartInsightsResponse,
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
    drift: (id: number) =>
      request<{
        actual_rate_kg_week: number | null;
        expected_rate_kg_week: number | null;
        suggested_target_calories: number | null;
        confidence: number;
        days_evaluated: number;
        divergence_pct: number | null;
        current_target_calories: number | null;
        message?: string;
      }>(`/v1/cut-phases/${id}/drift`),
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
    draft: (date?: string, kind?: string) => {
      const params = new URLSearchParams();
      if (date) params.set("for_date", date);
      if (kind) params.set("kind", kind);
      const qs = params.toString();
      return request<CoachDraftResponse>(`/v1/coach/draft${qs ? `?${qs}` : ""}`);
    },
  },

  insights: {
    readiness: (date: string) => request<ReadinessReport>(`/v1/insights/readiness/${date}`),
    anomalies: (date: string) =>
      request<{ date: string; anomalies: Array<{ kind: string; label: string; detail: string; link_to?: string }> }>(
        `/v1/insights/anomalies/${date}`
      ),
    trainingCall: (date: string) =>
      request<{ date: string; call: string; reasons: string[]; confidence: number }>(
        `/v1/insights/training-call/${date}`
      ),
    refeedSuggestion: (date: string) =>
      request<{
        should_refeed: boolean;
        reasons: string[];
        suggested_kcal_bump: number;
        suggested_kcal_target: number | null;
        suggested_days: number;
        days_into_cut: number;
      }>(`/v1/insights/refeed-suggestion/${date}`),
  },

  photos: {
    list: () => request<PhotoListResponse>("/v1/photos/list"),
    upload: (date: string, pose: string, file: File) => {
      const body = new FormData();
      body.append("file", file);
      return request<{ date: string; pose: string; size_bytes: number }>(
        `/v1/photos/${date}?pose=${encodeURIComponent(pose)}`,
        { method: "POST", body }
      );
    },
    url: (date: string, pose: string) => `/v1/photos/${date}/${pose}`,
    delete: (date: string, pose: string) =>
      request<{ deleted: boolean }>(`/v1/photos/${date}/${pose}`, { method: "DELETE" }),
  },

  ai: {
    analyse: (type: string, date?: string) =>
      request<AiAnalyseResponse>("/v1/ai/analyse", {
        method: "POST",
        body: JSON.stringify({ type, date }),
      }),
  },

  coachChat: {
    list: () =>
      request<{ conversations: CoachConversation[] }>("/v1/coach/conversations"),
    create: (framing?: string, forDate?: string, title?: string) =>
      request<CoachConversation>("/v1/coach/conversations", {
        method: "POST",
        body: JSON.stringify({ framing, for_date: forDate, title }),
      }),
    get: (id: number) =>
      request<CoachConversationWithMessages>(`/v1/coach/conversations/${id}`),
    archive: (id: number) =>
      request<{ archived: boolean }>(`/v1/coach/conversations/${id}`, { method: "DELETE" }),
    streamMessage: (
      convId: number,
      message: string,
      onDelta: (text: string) => void,
      onDone: (tokens: number) => void,
      onError: (msg: string) => void,
      signal?: AbortSignal,
    ): Promise<void> => {
      return fetch(`/v1/coach/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
        signal,
      }).then(async (res) => {
        if (res.status === 401) { location.href = "/login"; throw new Error("auth"); }
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.delta) onDelta(data.delta);
              else if (data.done) onDone(data.tokens ?? 0);
              else if (data.error) onError(data.error);
            } catch { /* skip malformed */ }
          }
        }
      });
    },
  },

  streaks: {
    list: () => request<{ streaks: Array<{ key: string; label: string; current: number; longest: number; milestone_next: number }> }>("/v1/streaks"),
  },

  badges: {
    list: () => request<{ badges: Array<{ key: string; label: string; description: string; icon: string; category: string; earned: boolean }>; earned_count: number; total: number }>("/v1/badges"),
  },

  smartInsights: {
    get: (date: string) => request<SmartInsightsResponse>(`/v1/insights/smart/${date}`),
  },

  bodyComposition: {
    get: (start?: string, end?: string) => {
      const p = new URLSearchParams();
      if (start) p.set("start", start);
      if (end) p.set("end", end);
      const qs = p.toString();
      return request<BodyCompositionResponse>(`/v1/body-composition${qs ? `?${qs}` : ""}`);
    },
  },

  weeklyRecap: {
    list: () => request<{ recaps: WeeklyRecap[] }>("/v1/weekly-recap/list"),
    get: (weekStart: string) => request<WeeklyRecap>(`/v1/weekly-recap/${weekStart}`),
    regenerate: (weekStart: string) => request<WeeklyRecap>(`/v1/weekly-recap/${weekStart}/regenerate`, { method: "POST" }),
  },
};

export interface WeeklyRecap {
  week_start_date: string;
  narrative: string;
  highlights: string[];
  model: string;
  tokens_used: number;
  created_at: string;
}
