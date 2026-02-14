import type { ThreadsConfig } from "../config.js";
import type { RequestMethod, ThreadsClientOptions } from "./types.js";

export type {
  RequestMethod,
  MediaType,
  ContainerStatus,
  ReplyControl,
  ThreadsPost,
  ThreadsUser,
  ThreadsInsight,
  MediaContainer,
  ThreadsApiResponse,
  PaginatedResult,
  ThreadsClientOptions,
} from "./types.js";

const BASE_URL = "https://graph.threads.net/v1.0";
const MAX_RATE_LIMIT_RETRIES = 2;
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;

export class ThreadsClient {
  private accessToken: string;
  public userId: string | undefined;
  private options: ThreadsClientOptions;

  constructor(config: ThreadsConfig, options: ThreadsClientOptions = {}) {
    this.accessToken = config.access_token;
    this.userId = config.user_id;
    this.options = options;
  }

  private async parseResponse<T>(res: Response): Promise<T> {
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      if (!res.ok) {
        throw new Error(`Threads API error ${res.status}: ${text.slice(0, 200)}`);
      }
      return {} as T;
    }

    if (!res.ok) {
      const err = (data as { error?: { message?: string; type?: string; code?: number } }).error;
      const detail = err
        ? `[${err.type ?? "Unknown"}] ${err.message ?? "Unknown error"} (code: ${err.code ?? "?"})`
        : JSON.stringify(data);
      throw new Error(`Threads API error ${res.status}: ${detail}`);
    }

    return data as T;
  }

  public async request<T>(method: RequestMethod, path: string, body?: Record<string, unknown>, retryCount = 0): Promise<T> {
    let url: string;
    if (method === "GET" || method === "DELETE") {
      const params = new URLSearchParams();
      params.set("access_token", this.accessToken);
      if (body) {
        for (const [k, v] of Object.entries(body)) {
          if (v !== undefined && v !== null) params.set(k, String(v));
        }
      }
      url = `${BASE_URL}/${path}?${params.toString()}`;
    } else {
      const params = new URLSearchParams();
      params.set("access_token", this.accessToken);
      if (body) {
        for (const [k, v] of Object.entries(body)) {
          if (v !== undefined && v !== null) params.set(k, String(v));
        }
      }
      url = `${BASE_URL}/${path}`;
      // Threads API uses form-encoded POST, not JSON body
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      if (res.status === 429 && retryCount < MAX_RATE_LIMIT_RETRIES) {
        return this.handleRateLimit<T>(method, path, body, retryCount);
      }

      return this.parseResponse<T>(res);
    }

    const res = await fetch(url, { method });

    if (res.status === 429 && retryCount < MAX_RATE_LIMIT_RETRIES) {
      return this.handleRateLimit<T>(method, path, body, retryCount);
    }

    return this.parseResponse<T>(res);
  }

  private async handleRateLimit<T>(method: RequestMethod, path: string, body: Record<string, unknown> | undefined, retryCount: number): Promise<T> {
    const waitMs = DEFAULT_RATE_LIMIT_WAIT_MS;
    const waitSeconds = (waitMs / 1000).toFixed(0);
    this.options.onRateLimit?.(
      `Rate limited. Waiting ${waitSeconds}s before retry ${retryCount + 1}/${MAX_RATE_LIMIT_RETRIES}.`
    );
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    return this.request<T>(method, path, body, retryCount + 1);
  }
}

export { BASE_URL };
