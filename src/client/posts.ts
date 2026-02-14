import type { ThreadsClient } from "./index.js";
import type {
  ThreadsPost,
  ThreadsApiResponse,
  PaginatedResult,
  MediaContainer,
  MediaType,
  ReplyControl,
} from "./types.js";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60_000;

/** Create a media container */
export async function createContainer(
  client: ThreadsClient,
  options: {
    media_type: MediaType;
    text?: string;
    image_url?: string;
    video_url?: string;
    reply_to_id?: string;
    reply_control?: ReplyControl;
    is_carousel_item?: boolean;
  },
): Promise<MediaContainer> {
  const userId = client.userId;
  if (!userId) throw new Error("user_id is required. Run 'thrd auth' first.");

  const body: Record<string, unknown> = {
    media_type: options.media_type,
  };

  if (options.text) body.text = options.text;
  if (options.image_url) body.image_url = options.image_url;
  if (options.video_url) body.video_url = options.video_url;
  if (options.reply_to_id) body.reply_to_id = options.reply_to_id;
  if (options.reply_control) body.reply_control = options.reply_control;
  if (options.is_carousel_item) body.is_carousel_item = true;

  const res = await client.request<{ id: string }>("POST", `${userId}/threads`, body);
  return { id: res.id };
}

/** Get container status */
export async function getContainerStatus(
  client: ThreadsClient,
  containerId: string,
): Promise<MediaContainer> {
  return client.request<MediaContainer>("GET", containerId, { fields: "id,status,error_message" } as Record<string, unknown>);
}

/** Poll container status until FINISHED or timeout */
async function pollContainerStatus(
  client: ThreadsClient,
  containerId: string,
): Promise<MediaContainer> {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const status = await getContainerStatus(client, containerId);
    if (status.status === "FINISHED") return status;
    if (status.status === "ERROR") {
      throw new Error(`Container error: ${status.error_message ?? "Unknown error"}`);
    }
    if (status.status === "EXPIRED") {
      throw new Error("Container expired before publishing.");
    }
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Container status polling timed out after ${POLL_TIMEOUT_MS / 1000}s.`);
}

/** Publish a container */
export async function publishContainer(
  client: ThreadsClient,
  containerId: string,
): Promise<{ id: string }> {
  const userId = client.userId;
  if (!userId) throw new Error("user_id is required.");
  return client.request<{ id: string }>("POST", `${userId}/threads_publish`, {
    creation_id: containerId,
  });
}

/** Create and publish a text post */
export async function createPost(
  client: ThreadsClient,
  text: string,
  options?: {
    image_url?: string;
    video_url?: string;
    reply_to_id?: string;
    reply_control?: ReplyControl;
  },
): Promise<{ id: string }> {
  let media_type: MediaType = "TEXT";
  if (options?.image_url) media_type = "IMAGE";
  if (options?.video_url) media_type = "VIDEO";

  const container = await createContainer(client, {
    media_type,
    text,
    image_url: options?.image_url,
    video_url: options?.video_url,
    reply_to_id: options?.reply_to_id,
    reply_control: options?.reply_control,
  });

  // Poll status for media posts
  if (media_type !== "TEXT") {
    await pollContainerStatus(client, container.id);
  }

  return publishContainer(client, container.id);
}

/** Create a carousel post */
export async function createCarouselPost(
  client: ThreadsClient,
  text: string,
  mediaUrls: string[],
  options?: { reply_control?: ReplyControl },
): Promise<{ id: string }> {
  const userId = client.userId;
  if (!userId) throw new Error("user_id is required.");
  if (mediaUrls.length < 2 || mediaUrls.length > 10) {
    throw new Error("Carousel requires 2-10 media items.");
  }

  // Create carousel items
  const itemIds: string[] = [];
  for (const url of mediaUrls) {
    const isVideo = /\.(mp4|mov)$/i.test(url);
    const container = await createContainer(client, {
      media_type: isVideo ? "VIDEO" : "IMAGE",
      ...(isVideo ? { video_url: url } : { image_url: url }),
      is_carousel_item: true,
    });
    // Poll status for each item
    await pollContainerStatus(client, container.id);
    itemIds.push(container.id);
  }

  // Create carousel container
  const body: Record<string, unknown> = {
    media_type: "CAROUSEL",
    children: itemIds.join(","),
    text,
  };
  if (options?.reply_control) body.reply_control = options.reply_control;

  const carousel = await client.request<{ id: string }>("POST", `${userId}/threads`, body);
  return publishContainer(client, carousel.id);
}

/** Delete a post */
export async function deletePost(client: ThreadsClient, postId: string): Promise<boolean> {
  const res = await client.request<{ success?: boolean }>("DELETE", postId);
  return Boolean(res.success);
}

/** Get user's threads */
export async function getUserThreads(
  client: ThreadsClient,
  options?: { limit?: number; after?: string; before?: string },
): Promise<PaginatedResult<ThreadsPost>> {
  const userId = client.userId;
  if (!userId) throw new Error("user_id is required.");

  const params: Record<string, unknown> = {
    fields: "id,media_type,text,timestamp,permalink,username,is_quote_post",
  };
  if (options?.limit) params.limit = options.limit;
  if (options?.after) params.after = options.after;
  if (options?.before) params.before = options.before;

  return client.request<PaginatedResult<ThreadsPost>>("GET", `${userId}/threads`, params);
}

/** Get a single thread */
export async function getThread(
  client: ThreadsClient,
  threadId: string,
): Promise<ThreadsPost> {
  return client.request<ThreadsPost>("GET", threadId, {
    fields: "id,media_type,text,timestamp,permalink,username,is_quote_post",
  } as Record<string, unknown>);
}
