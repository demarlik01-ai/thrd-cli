// ─── Shared Types ───

export type RequestMethod = "GET" | "POST" | "DELETE";

export type MediaType = "TEXT" | "IMAGE" | "VIDEO" | "CAROUSEL";

export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED";

export type ReplyControl = "everyone" | "accounts_you_follow" | "mentioned_only";

export interface ThreadsPost {
  id: string;
  media_type?: MediaType;
  media_url?: string;
  text?: string;
  timestamp?: string;
  permalink?: string;
  username?: string;
  is_quote_post?: boolean;
  shortcode?: string;
  children?: { data: Array<{ id: string }> };
}

export interface ThreadsUser {
  id: string;
  username?: string;
  threads_profile_picture_url?: string;
  threads_biography?: string;
}

export interface ThreadsInsight {
  name: string;
  title: string;
  description?: string;
  period: string;
  values: Array<{ value: number }>;
  id: string;
}

export interface MediaContainer {
  id: string;
  status?: ContainerStatus;
  error_message?: string;
}

export interface ThreadsApiResponse<T> {
  data?: T;
  error?: {
    message: string;
    type: string;
    code: number;
    fbtrace_id?: string;
  };
}

export interface PaginatedResult<T> {
  data: T[];
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
    next?: string;
    previous?: string;
  };
}

export interface ThreadsClientOptions {
  onRateLimit?: (message: string) => void;
}
