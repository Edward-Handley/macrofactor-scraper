import type {
  DashboardSummaryResponse,
  DiagnosticsResponse,
  IngestStatus,
  MetricCatalogResponse,
  Preferences,
  RepairReport,
} from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
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

  diagnostics: (date: string) =>
    request<DiagnosticsResponse>(`/v1/diagnostics/metrics/${date}`),

  repair: (date: string, dryRun: boolean) =>
    request<RepairReport>(
      `/v1/admin/repair?date=${date}&dry_run=${dryRun}`,
      { method: "POST" }
    ),
};
