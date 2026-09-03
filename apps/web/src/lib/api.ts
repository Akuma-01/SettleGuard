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

export interface ExceptionRecord {
  id: number;
  runId: number;
  type: string;
  severity: string;
  status: string;
  amountAtRiskPaise: number;
  summary: string | null;
  createdAt: string;
}

export interface InvestigationSummary {
  id: number;
  status: string;
  confidence: number | null;
  rootCause: string | null;
  recommendedAction: string | null;
}

export interface ExceptionList {
  items: Array<{ exception: ExceptionRecord; latestInvestigation: InvestigationSummary | null }>;
  pagination: { total: number; limit: number; offset: number };
}

export interface ExceptionDetail {
  exception: ExceptionRecord & { primaryRecordType: string | null; primaryRecordId: number | null; deterministicEvidenceJson: unknown; resolvedAt: string | null };
  run: { id: number; status: string; batchId: number };
  batch: { id: number; name: string; merchantId: number; merchantName: string };
  investigations: Array<{
    investigation: InvestigationSummary & { model: string | null; promptVersion: string | null; requiresHumanApproval: boolean; structuredOutputJson: unknown; completedAt: string | null };
    events: Array<{ id: number; sequenceNumber: number; eventType: string; toolName: string | null; toolInputJson: unknown; toolOutputJson: unknown; createdAt: string }>;
  }>;
  reviewCases: Array<{ id: number; status: string; proposedAction: string | null; reviewerDecision: string | null; reviewerNote: string | null; createdAt: string; reviewedAt: string | null }>;
  auditTrail: Array<{ id: number; actorType: string; action: string; entityType: string; entityId: number | null; createdAt: string }>;
}

export type ExceptionDetailResult = { status: "ready"; data: ExceptionDetail } | { status: "not_found" } | { status: "unavailable" };

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

export async function postApi(path: string, body?: unknown): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    if (response.ok) return { ok: true, message: "Action completed successfully." };
    const payload = await response.json() as { error?: { message?: string } };
    return { ok: false, message: payload.error?.message ?? `API request failed with status ${response.status}.` };
  } catch {
    return { ok: false, message: "The API could not be reached." };
  }
}

export async function postApiData<T>(path: string, body?: unknown): Promise<{ data: T | null; message: string }> {
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json() as T & { error?: { message?: string } };
    return response.ok
      ? { data: payload, message: "Action completed successfully." }
      : { data: null, message: payload.error?.message ?? `API request failed with status ${response.status}.` };
  } catch {
    return { data: null, message: "The API could not be reached." };
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

export async function getExceptions(query: URLSearchParams): Promise<ExceptionList | null> {
  const response = await apiResponse<ExceptionList>(`/api/exceptions?${query.toString()}`);
  return response.data;
}

export async function getExceptionDetail(exceptionId: number): Promise<ExceptionDetailResult> {
  const response = await apiResponse<ExceptionDetail>(`/api/exceptions/${exceptionId}`);
  if (response.status === 404) return { status: "not_found" };
  return response.data ? { status: "ready", data: response.data } : { status: "unavailable" };
}
