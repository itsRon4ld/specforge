/**
 * The agent's only door to the outside world. It holds a role token for the
 * bridge and nothing else: no Linear or GitHub credentials.
 */

export type ActivityType = "thought" | "response" | "elicitation" | "error";

export type JobEnvelope = {
  job: { id: number; role: "product"; payload: Record<string, any> };
  model: string;
  guidance: string;
  /** Paths relative to the product repo root; null means "use the bundled default". */
  paths: { skills: string | null; templates: string | null; context: string | null };
  repo: string;
  branches: { development: string; production: string };
  designBranchPrefix: string;
  readiness: Record<string, string[]>;
};

export class BridgeClient {
  private url: string;
  private token: string;

  constructor(url = process.env.BRIDGE_URL, token = process.env.BRIDGE_TOKEN) {
    if (!url || !token) throw new Error("BRIDGE_URL and BRIDGE_TOKEN are required");
    this.url = url.replace(/\/$/, "");
    this.token = token;
  }

  async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${this.url}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, ...(init.headers ?? {}) },
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(`bridge ${init.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`);
    }
    return res;
  }

  async request<T = any>(path: string, init: RequestInit = {}): Promise<T | null> {
    const res = await this.raw(path, init);
    if (res.status === 204) return null;
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  get<T = any>(path: string) {
    return this.request<T>(path);
  }

  post<T = any>(path: string, body: unknown) {
    return this.request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /** Binary upload with metadata in `X-Specforge-*` headers. */
  upload<T = any>(path: string, data: Buffer, contentType: string, meta: Record<string, string>) {
    const headers: Record<string, string> = { "Content-Type": contentType };
    for (const [k, v] of Object.entries(meta)) headers[`X-Specforge-${k}`] = encodeURIComponent(v);
    return this.request<T>(path, { method: "POST", headers, body: new Uint8Array(data) });
  }

  nextJob() {
    return this.get<JobEnvelope>("/jobs/next");
  }

  finish(jobId: number, status: "done" | "failed") {
    return this.post("/jobs/finish", { jobId, status });
  }

  activity(sessionId: string, type: ActivityType, body: string) {
    return this.post("/linear/activity", { sessionId, content: { type, body } });
  }
}
