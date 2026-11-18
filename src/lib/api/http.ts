// Low-level JSON over fetch. Never logs request or response bodies: they can
// carry tokens or ciphertext.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly detail: string,
  ) {
    super(`HTTP ${status} on ${path}${detail ? `: ${detail}` : ""}`);
    this.name = "HttpError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  token?: string | undefined;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal | undefined;
}

export async function requestJson(baseUrl: string, path: string, opts: RequestOptions = {}): Promise<unknown> {
  const url = new URL(path, baseUrl);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers,
    body: opts.body === undefined ? null : JSON.stringify(opts.body),
    signal: opts.signal ?? null,
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: unknown; message?: unknown };
      detail = typeof j.error === "string" ? j.error : typeof j.message === "string" ? j.message : "";
    } catch {
      /* non-JSON error body */
    }
    throw new HttpError(res.status, url.pathname, detail.slice(0, 200));
  }
  if (res.status === 204) return null;
  return res.json();
}
