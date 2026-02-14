import type { ThreadsClient } from "./index.js";
import type { ThreadsPost, PaginatedResult } from "./types.js";

const REPLY_FIELDS = "id,media_type,text,timestamp,permalink,username,is_quote_post";

/** Get replies to a thread */
export async function getReplies(
  client: ThreadsClient,
  threadId: string,
  options?: { after?: string; before?: string },
): Promise<PaginatedResult<ThreadsPost>> {
  const params: Record<string, unknown> = { fields: REPLY_FIELDS };
  if (options?.after) params.after = options.after;
  if (options?.before) params.before = options.before;
  return client.request<PaginatedResult<ThreadsPost>>("GET", `${threadId}/replies`, params);
}

/** Get conversation (full thread) */
export async function getConversation(
  client: ThreadsClient,
  threadId: string,
  options?: { after?: string; before?: string },
): Promise<PaginatedResult<ThreadsPost>> {
  const params: Record<string, unknown> = { fields: REPLY_FIELDS };
  if (options?.after) params.after = options.after;
  if (options?.before) params.before = options.before;
  return client.request<PaginatedResult<ThreadsPost>>("GET", `${threadId}/conversation`, params);
}

/** Hide a reply */
export async function hideReply(client: ThreadsClient, replyId: string): Promise<boolean> {
  const res = await client.request<{ success?: boolean }>("POST", `${replyId}/manage_reply`, { hide: true } as Record<string, unknown>);
  return Boolean(res.success);
}

/** Unhide a reply */
export async function unhideReply(client: ThreadsClient, replyId: string): Promise<boolean> {
  const res = await client.request<{ success?: boolean }>("POST", `${replyId}/manage_reply`, { hide: false } as Record<string, unknown>);
  return Boolean(res.success);
}
