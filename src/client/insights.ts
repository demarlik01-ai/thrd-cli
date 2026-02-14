import type { ThreadsClient } from "./index.js";
import type { ThreadsInsight } from "./types.js";

/** Get media-level insights */
export async function getMediaInsights(
  client: ThreadsClient,
  mediaId: string,
): Promise<{ data: ThreadsInsight[] }> {
  return client.request<{ data: ThreadsInsight[] }>("GET", `${mediaId}/insights`, {
    metric: "views,likes,replies,reposts,quotes",
  } as Record<string, unknown>);
}

/** Get account-level insights */
export async function getUserInsights(
  client: ThreadsClient,
  options?: { since?: number; until?: number },
): Promise<{ data: ThreadsInsight[] }> {
  const userId = client.userId;
  if (!userId) throw new Error("user_id is required.");

  const params: Record<string, unknown> = {
    metric: "views,likes,replies,reposts,quotes,followers_count,follower_demographics",
  };
  if (options?.since) params.since = options.since;
  if (options?.until) params.until = options.until;

  return client.request<{ data: ThreadsInsight[] }>("GET", `${userId}/threads_insights`, params);
}
