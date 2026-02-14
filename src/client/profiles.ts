import type { ThreadsClient } from "./index.js";
import type { ThreadsUser } from "./types.js";

const PROFILE_FIELDS = "id,username,threads_profile_picture_url,threads_biography";

/** Get authenticated user's profile */
export async function me(client: ThreadsClient): Promise<ThreadsUser> {
  return client.request<ThreadsUser>("GET", "me", { fields: PROFILE_FIELDS } as Record<string, unknown>);
}

/** Get a user's profile by ID */
export async function getProfile(client: ThreadsClient, userId: string): Promise<ThreadsUser> {
  return client.request<ThreadsUser>("GET", userId, { fields: PROFILE_FIELDS } as Record<string, unknown>);
}
