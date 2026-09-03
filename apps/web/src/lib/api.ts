const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";

export interface ApiHealth {
  status: "ok";
  service: string;
  version: string;
}

export interface RunContext {
  run: {
    id: number;
    batchId: number;
    batchName: string;
    merchantName: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    totalRecords: number;
    matchedRecords: number;
    unmatchedRecords: number;
    matchRate: number;
    exceptionCount: number;
  };
  matchCount: number;
  exceptionsByType: Record<string, number>;
}

export interface RunMetrics {
  runId: number;
  status: string;
  records: { total: number; matched: number; unmatched: number; matchRate: number };
  exceptions: { total: number; byStatus: Record<string, number>; amountAtRiskPaise: number };
  resolutions: { autoResolved: number; humanReview: number; unresolved: number };
}

export type DashboardResult =
  | { status: "ready"; context: RunContext; metrics: RunMetrics }
  | { status: "not_found" }
  | { status: "unavailable" };

async function apiResponse<T>(path: string): Promise<{ status: number; data: T | null }> {
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    return { status: response.status, data: response.ok ? await response.json() as T : null };
  } catch {
    return { status: 0, data: null };
  }
}

export async function getApiHealth(): Promise<ApiHealth | null> {
  try {
    const response = await fetch(`${apiBaseUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return null;
    return await response.json() as ApiHealth;
  } catch {
    return null;
  }
}

export async function getRunDashboard(runId: number): Promise<DashboardResult> {
  const [context, metrics] = await Promise.all([
    apiResponse<RunContext>(`/api/runs/${runId}`),
    apiResponse<RunMetrics>(`/api/runs/${runId}/metrics`),
  ]);

  if (context.status === 404 || metrics.status === 404) return { status: "not_found" };
  if (!context.data || !metrics.data) return { status: "unavailable" };
  return { status: "ready", context: context.data, metrics: metrics.data };
}
