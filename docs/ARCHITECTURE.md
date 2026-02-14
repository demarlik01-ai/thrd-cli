# Architecture

## Overview

thrd-cli is a TypeScript CLI application that wraps Meta's Threads API (via `graph.threads.net`) for terminal usage. It follows a modular architecture similar to [twx-cli](https://github.com/user/twx-cli), with domain-separated client modules.

### Key Differences from twx-cli

| Aspect | twx-cli (X/Twitter) | thrd-cli (Threads) |
|--------|---------------------|---------------------|
| Auth | OAuth 1.0a (4 credentials, HMAC signing) | OAuth 2.0 (short-lived → long-lived token) |
| Post creation | Single POST request | Two-step: create container → publish |
| Media upload | Upload endpoint | External URL reference (no upload) |
| Token management | Static (no expiry) | 60-day long-lived tokens, requires refresh |
| API base | `api.x.com/2/` | `graph.threads.net/v1.0/` |

## Project Structure

```
thrd-cli/
├── src/
│   ├── cli.ts              # Entry point, command definitions (commander)
│   ├── config.ts            # Token loading, validation, refresh logic
│   ├── auth.ts              # OAuth 2.0 flow (local HTTP server for callback)
│   └── client/
│       ├── index.ts         # ThreadsClient base — token auth, fetch, rate limiting
│       ├── types.ts         # Shared type definitions
│       ├── posts.ts         # Post creation (container + publish), delete, timeline
│       ├── replies.ts       # Reply management (list, hide/unhide, respond)
│       ├── profiles.ts      # User profile retrieval
│       └── insights.ts      # Media and account-level insights
├── docs/
│   ├── ARCHITECTURE.md
│   └── ARCHITECTURE-ko.md
├── package.json
├── tsconfig.json
└── README.md
```

## Module Diagram

```
                    ┌──────────────┐
                    │   cli.ts     │
                    │  - Commands  │
                    │  - Output    │
                    │  - Routing   │
                    └──────┬───────┘
                           │
         ┌─────────┬───────┼──────────┐
         ▼         ▼       ▼          ▼
  ┌──────────┐ ┌───────┐ ┌─────┐ ┌────────┐
  │config.ts │ │auth.ts│ │chalk│ │client/ │
  │ (tokens) │ │(OAuth)│ │     │ ├────────┤
  └──────────┘ └───┬───┘ └─────┘ │index.ts│
                   │              │posts.ts│
                   │              │replies │
                   │              │profiles│
                   │              │insights│
                   │              └───┬────┘
                   │                  │
                   ▼                  ▼
            ┌────────────┐   ┌──────────────────┐
            │ Local HTTP │   │ graph.threads.net │
            │  (callback)│   │   (REST API)      │
            └────────────┘   └──────────────────┘
```

## Modules

### `cli.ts` — Entry Point & Commands

Defines the CLI structure using commander.

**Subcommands:**

| Command | Description |
|---------|-------------|
| `auth` | Interactive OAuth 2.0 flow (opens browser, starts local callback server) |
| `refresh` | Refresh the long-lived access token |
| `me` | Show authenticated user profile |
| `post <text>` | Create a text post (container → publish) |
| `post --image <url> [text]` | Create a post with image |
| `post --video <url> [text]` | Create a post with video |
| `carousel <text> --media <urls...>` | Create a carousel post (up to 10 items) |
| `reply <thread-id> <text>` | Reply to a thread |
| `delete <id>` | Delete a post by ID |
| `timeline` | Show your recent threads (with pagination) |
| `replies <thread-id>` | List replies to a thread |
| `hide <reply-id>` | Hide a reply |
| `unhide <reply-id>` | Unhide a reply |
| `insights [thread-id]` | Show insights (media-level or account-level) |

### `auth.ts` — OAuth 2.0 Flow

Handles the complete OAuth 2.0 authorization code flow:

1. Starts a temporary local HTTP server on a configurable port (default: 3000)
2. Opens the browser to `https://threads.net/oauth/authorize` with:
   - `client_id` — App ID from Meta Developer Dashboard
   - `redirect_uri` — Local callback URL
   - `scope` — Requested permissions
   - `response_type=code`
3. Receives the authorization code at the callback
4. Exchanges code for short-lived token via POST to `https://graph.threads.net/oauth/access_token`
5. Exchanges short-lived token for long-lived token (60 days) via GET to `https://graph.threads.net/access_token?grant_type=th_exchange_token`
6. Saves the long-lived token and expiry to config file

**Scopes:**
- `threads_basic` — Read profile info
- `threads_content_publish` — Create and delete posts
- `threads_read_replies` — Read replies to your posts
- `threads_manage_replies` — Hide/unhide replies
- `threads_manage_insights` — Read insights data

### `config.ts` — Token Management

**Token storage:** `~/.config/thrd-cli/config.json`

```json
{
  "app_id": "...",
  "app_secret": "...",
  "access_token": "...",
  "user_id": "...",
  "expires_at": "2025-08-15T00:00:00Z"
}
```

**Credential resolution priority:**
1. Environment variables (`THREADS_APP_ID`, `THREADS_APP_SECRET`, `THREADS_ACCESS_TOKEN`)
2. Config file (`~/.config/thrd-cli/config.json`)

**Token refresh:** Long-lived tokens are valid for 60 days. Can be refreshed after 1 day (but before expiry) via:
```
GET https://graph.threads.net/access_token?grant_type=th_exchange_token&access_token=<token>
```

The CLI warns when a token is within 7 days of expiry.

### `client/index.ts` — Base Client

`ThreadsClient` wraps Node.js native `fetch` with bearer token auth.

**Responsibilities:**
- Bearer token Authorization header
- Base URL management (`https://graph.threads.net/v1.0/`)
- Rate limit handling (250 requests per user per hour, 1000 calls per 48 hours per app)
- JSON response parsing with error handling
- Auto-retry on rate limit (429) with backoff

### `client/types.ts` — Shared Types

- `ThreadsPost` — Thread media object (id, media_type, text, timestamp, permalink, etc.)
- `ThreadsUser` — User profile (id, username, threads_profile_picture_url, threads_biography)
- `ThreadsInsight` — Insight metric (views, likes, replies, reposts, quotes)
- `MediaContainer` — Container status (id, status: IN_PROGRESS | FINISHED | ERROR | EXPIRED | PUBLISHED)
- `ThreadsApiResponse<T>` — API response wrapper
- `PaginatedResult<T>` — Cursor-based pagination (before/after cursors)

### `client/posts.ts` — Post Operations

The Threads API uses a **two-step publishing flow**:

1. **Create container** — `POST /{user-id}/threads` with media_type + content
2. **Check status** (optional) — `GET /{container-id}?fields=status` (recommended for media posts)
3. **Publish** — `POST /{user-id}/threads_publish` with `creation_id={container-id}`

| Function | HTTP | Endpoint |
|----------|------|----------|
| `createContainer` | POST | `/{user_id}/threads` |
| `getContainerStatus` | GET | `/{container_id}?fields=status` |
| `publishContainer` | POST | `/{user_id}/threads_publish` |
| `createPost` | — | Orchestrates: create → (poll status) → publish |
| `deletePost` | DELETE | `/{post_id}` |
| `getUserThreads` | GET | `/{user_id}/threads` |
| `getThread` | GET | `/{thread_id}` |
| `createCarouselItem` | POST | `/{user_id}/threads` (type=CAROUSEL_ITEM) |
| `createCarouselPost` | — | Create items → create carousel container → publish |

**Supported media types:**
- `TEXT` — Text-only post
- `IMAGE` — Single image (JPEG, PNG; referenced by URL)
- `VIDEO` — Single video (MP4, MOV; referenced by URL)
- `CAROUSEL` — Up to 10 images/videos in a single post

### `client/replies.ts` — Reply Management

| Function | HTTP | Endpoint |
|----------|------|----------|
| `getReplies` | GET | `/{thread_id}/replies` |
| `getConversation` | GET | `/{thread_id}/conversation` |
| `hideReply` | POST | `/{reply_id}/manage_reply` (hide=true) |
| `unhideReply` | POST | `/{reply_id}/manage_reply` (hide=false) |

Reply control can be set during post creation:
- `everyone` (default)
- `accounts_you_follow`
- `mentioned_only`

### `client/profiles.ts` — Profile Operations

| Function | HTTP | Endpoint |
|----------|------|----------|
| `getProfile` | GET | `/{user_id}?fields=id,username,...` |
| `me` | GET | `/me?fields=id,username,...` |

**Available profile fields:** id, username, threads_profile_picture_url, threads_biography

### `client/insights.ts` — Insights

| Function | HTTP | Endpoint |
|----------|------|----------|
| `getMediaInsights` | GET | `/{media_id}/insights` |
| `getUserInsights` | GET | `/{user_id}/threads_insights` |

**Media-level metrics:** views, likes, replies, reposts, quotes

**Account-level metrics:** views, likes, replies, reposts, quotes, followers_count, follower_demographics

## Authentication Flow

```
┌──────┐         ┌───────────┐        ┌──────────────┐
│ User │         │ thrd-cli  │        │ Threads API  │
└──┬───┘         └─────┬─────┘        └──────┬───────┘
   │  thrd auth        │                     │
   │──────────────────>│                     │
   │                   │ Start local server  │
   │                   │ Open browser to     │
   │   Browser opens   │ /oauth/authorize    │
   │<──────────────────│                     │
   │                   │                     │
   │  User authorizes  │                     │
   │──────────────────────────────────────-->│
   │                   │                     │
   │                   │  Callback with code │
   │                   │<────────────────────│
   │                   │                     │
   │                   │  Exchange for       │
   │                   │  short-lived token  │
   │                   │────────────────────>│
   │                   │                     │
   │                   │  Exchange for       │
   │                   │  long-lived token   │
   │                   │────────────────────>│
   │                   │                     │
   │                   │  Save to config     │
   │  Auth complete!   │                     │
   │<──────────────────│                     │
```

## Rate Limits

| Limit | Value |
|-------|-------|
| Per user per hour | 250 API calls |
| Per app per 48 hours | 1,000 API calls (development) |
| Post creation | 250 posts per 24 hours |
| Reply creation | 1,000 replies per 24 hours |

## Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI argument parsing |
| `chalk` | Terminal color output |
| `open` | Open browser for OAuth flow |

**Node.js built-ins used:**
- `http` — Local callback server for OAuth
- `fetch` — HTTP requests (Node >= 18)
- `fs`, `path` — Config file management
- `crypto` — Random state parameter for OAuth

## Design Decisions

- **Two-step publishing abstraction**: `createPost()` orchestrates container creation, status polling, and publishing into a single call — hiding API complexity from the CLI layer
- **Separate `auth.ts` module**: OAuth 2.0 flow is complex enough (local server, browser, token exchange) to warrant its own module — unlike twx-cli which uses static OAuth 1.0a credentials
- **Token expiry tracking**: Config stores `expires_at` so the CLI can warn/auto-refresh before token expiry
- **Functional module pattern**: Same as twx-cli — domain functions take client as first parameter
- **Native fetch**: No HTTP library dependency — Node >= 18
- **Status polling for media posts**: Image/video containers may take time to process; the CLI polls status before publishing with configurable timeout
- **Carousel as first-class command**: Multi-media posts are common enough on Threads to justify a dedicated subcommand
- **No upload endpoint**: Threads API requires media to be hosted at a public URL — the CLI documents this clearly and does not provide upload functionality
