# thrd-cli

A fast, lightweight CLI for the Meta Threads API.

```bash
npx thrd-cli post "Hello from the terminal!"
```

## Features

- **Post** — Create text, image, video, and carousel posts
- **Reply** — Reply to threads, list replies, hide/unhide
- **Timeline** — View your recent threads
- **Insights** — View media and account-level metrics
- **Delete** — Remove your posts
- **JSON output** — `--json` flag for scripting
- **Token management** — Auto-warns before token expiry, easy refresh
- **Two-step posting** — Handles container creation + publishing transparently

## Install

```bash
npm install -g thrd-cli
# or
pnpm add -g thrd-cli
# or
bun add -g thrd-cli
```

Or use directly without installing:
```bash
npx thrd-cli post "Hello!"
```

## Setup

### 1. Create a Meta App

1. Go to [Meta Developer Dashboard](https://developers.facebook.com/apps/)
2. Create a new app → select "Threads API" use case
3. Under **Settings > Basic**, note your **App ID** and **App Secret**
4. Under **Use Cases > Customize**, enable the permissions you need
5. Add a **Threads tester** (your Threads username) under the app settings
6. Accept the tester invitation at [Threads Settings](https://www.threads.net/settings/account)

### 2. Authenticate

```bash
thrd auth
```

This will:
1. Open your browser to authorize the app
2. Start a local callback server (default port 3000)
3. Exchange the authorization code for a long-lived token (valid 60 days)
4. Save credentials to `~/.config/thrd-cli/config.json` (mode 600)

Or set environment variables:
```bash
export THREADS_APP_ID="your_app_id"
export THREADS_APP_SECRET="your_app_secret"
export THREADS_ACCESS_TOKEN="your_access_token"
```

### 3. Refresh Token (before expiry)

```bash
thrd refresh
```

Long-lived tokens expire after 60 days. The CLI warns when your token is within 7 days of expiry.

## Usage

### Post

```bash
# Text post
thrd post "Shipping code at 2am"

# Post with image (must be a public URL)
thrd post "Check this out" --image https://example.com/photo.jpg

# Post with video
thrd post "Watch this" --video https://example.com/clip.mp4

# Control who can reply
thrd post "Thoughts?" --reply-control mentioned_only

# Dry run
thrd post "Testing..." --dry-run
```

### Carousel

```bash
# Multiple images/videos in one post (up to 10)
thrd carousel "My photo dump" \
  --media https://example.com/1.jpg \
  --media https://example.com/2.jpg \
  --media https://example.com/3.mp4
```

### Reply

```bash
# Reply to a thread
thrd reply 18050206876707110 "Great point!"
```

### Timeline

```bash
# Your recent threads
thrd timeline

# Last 5 posts
thrd timeline -n 5

# With pagination
thrd timeline --all
```

### Reply Management

```bash
# List replies to a thread
thrd replies 18050206876707110

# Hide/unhide a reply
thrd hide 18050206876707110
thrd unhide 18050206876707110
```

### Profile

```bash
# Your profile
thrd me
```

### Insights

```bash
# Account-level insights
thrd insights

# Media-level insights
thrd insights 18050206876707110
```

### Delete

```bash
thrd delete 18050206876707110
```

## Authentication

thrd-cli uses **OAuth 2.0** with the authorization code flow. Unlike twx-cli (which uses static OAuth 1.0a credentials), Threads requires:

1. **Browser-based authorization** — User must authorize in browser
2. **Short-lived token** — Valid for 1 hour, automatically exchanged
3. **Long-lived token** — Valid for 60 days, stored in config
4. **Token refresh** — Must be refreshed before expiry

Credentials are loaded in order:
1. Environment variables (`THREADS_APP_ID`, `THREADS_APP_SECRET`, `THREADS_ACCESS_TOKEN`)
2. `~/.config/thrd-cli/config.json`

### Required Scopes

| Scope | Purpose |
|-------|---------|
| `threads_basic` | Read profile info |
| `threads_content_publish` | Create and delete posts |
| `threads_read_replies` | Read replies |
| `threads_manage_replies` | Hide/unhide replies |
| `threads_manage_insights` | Read insights |

## Important Notes

- **Media must be hosted at a public URL** — The Threads API does not accept file uploads. Images and videos must be accessible via HTTPS.
- **Two-step posting** — The API requires creating a "container" first, then publishing it. thrd-cli handles this transparently.
- **Container processing time** — Image/video containers may take time to process. The CLI polls the container status before publishing.
- **Rate limits** — 250 API calls per user per hour; 250 posts per 24 hours.

## Project Structure

```
src/
├── cli.ts              # Command definitions (commander)
├── config.ts           # Token loading, validation, refresh
├── auth.ts             # OAuth 2.0 flow (local callback server)
└── client/
    ├── index.ts        # ThreadsClient base (token auth, fetch, rate limiting)
    ├── types.ts        # Shared type definitions
    ├── posts.ts        # Post creation (container + publish), delete, timeline
    ├── replies.ts      # Reply management
    ├── profiles.ts     # User profile
    └── insights.ts     # Media and account insights
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Requirements

- Node.js >= 18
- Meta Developer App with Threads API access ([developers.facebook.com](https://developers.facebook.com/apps/))
- A Threads account

## License

MIT
