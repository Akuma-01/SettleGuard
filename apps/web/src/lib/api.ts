const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";

export interface ApiHealth {
  status: "ok";
  service: string;
  version: string;
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
