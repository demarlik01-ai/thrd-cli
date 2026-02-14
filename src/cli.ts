#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, saveConfig, getConfigPath } from "./config.js";
import { ThreadsClient } from "./client/index.js";
import * as posts from "./client/posts.js";
import * as profiles from "./client/profiles.js";
import * as replies from "./client/replies.js";
import * as insights from "./client/insights.js";
import { authenticate, refreshToken } from "./auth.js";
import { createInterface } from "readline";

let jsonOutput = process.argv.includes("--json");

function getClient(): ThreadsClient {
  const config = loadConfig();
  return new ThreadsClient(config, {
    onRateLimit: jsonOutput ? undefined : (msg) => console.warn(chalk.yellow("⚠"), msg),
  });
}

/** Ensure client has user_id; if missing, fetch via /me and save to config */
async function ensureUserId(client: ThreadsClient): Promise<void> {
  if (client.userId) return;
  const user = await profiles.me(client);
  client.userId = user.id;
  saveConfig({ user_id: user.id });
  if (!jsonOutput) console.log(chalk.dim(`Auto-resolved user_id: ${user.id}`));
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const program = new Command()
  .name("thrd")
  .description("A fast, lightweight CLI for the Threads API")
  .version("0.1.0")
  .option("--json", "Output raw JSON");

program.hook("preAction", (thisCommand) => {
  jsonOutput = Boolean(thisCommand.optsWithGlobals().json);
});

// ─── auth ───
program
  .command("auth")
  .description("Authenticate via OAuth 2.0 (opens browser)")
  .option("-p, --port <port>", "Callback server port", "3000")
  .action(async (opts: { port: string }) => {
    const appId = process.env.THREADS_APP_ID ?? await prompt("App ID: ");
    const appSecret = process.env.THREADS_APP_SECRET ?? await prompt("App Secret: ");

    if (!appId || !appSecret) {
      console.error(chalk.red("✗"), "App ID and App Secret are required.");
      process.exit(1);
    }

    const port = parseInt(opts.port, 10);
    if (!jsonOutput) console.log(chalk.dim("Starting OAuth flow..."));

    await authenticate(appId, appSecret, port);

    if (jsonOutput) {
      printJson({ success: true, config_path: getConfigPath() });
    } else {
      console.log(chalk.green("✓"), `Authenticated! Config saved to ${getConfigPath()}`);
    }
  });

// ─── refresh ───
program
  .command("refresh")
  .description("Refresh the long-lived access token")
  .action(async () => {
    const config = loadConfig();
    const result = await refreshToken(config.access_token);

    const expiresAt = result.expires_in
      ? new Date(Date.now() + result.expires_in * 1000).toISOString()
      : undefined;

    saveConfig({ access_token: result.access_token, expires_at: expiresAt });

    if (jsonOutput) {
      printJson({ success: true, expires_at: expiresAt });
    } else {
      console.log(chalk.green("✓"), "Token refreshed.");
      if (expiresAt) console.log(chalk.dim(`Expires: ${expiresAt}`));
    }
  });

// ─── me ───
program
  .command("me")
  .description("Show authenticated user profile")
  .action(async () => {
    const client = getClient();
    const user = await profiles.me(client);
    // Auto-save user_id to config if not already set
    if (!client.userId && user.id) {
      saveConfig({ user_id: user.id });
    }
    if (jsonOutput) { printJson(user); return; }
    console.log(chalk.bold(`@${user.username ?? user.id}`));
    if (user.threads_biography) console.log(user.threads_biography);
  });

// ─── post ───
program
  .command("post [text]")
  .description("Create a post (text, image, or video)")
  .option("--image <url>", "Image URL")
  .option("--video <url>", "Video URL")
  .option("--reply-to <id>", "Reply to a thread ID")
  .option("--reply-control <mode>", "Reply control: everyone, accounts_you_follow, mentioned_only")
  .option("--dry-run", "Preview without posting")
  .action(async (text: string | undefined, opts: {
    image?: string; video?: string; replyTo?: string;
    replyControl?: string; dryRun?: boolean;
  }) => {
    if (!text && !opts.image && !opts.video) {
      console.error(chalk.red("✗"), "Provide text, --image, or --video.");
      process.exit(1);
    }

    if (opts.dryRun) {
      const preview = { dry_run: true, text: text ?? null, image: opts.image ?? null, video: opts.video ?? null, reply_to: opts.replyTo ?? null };
      if (jsonOutput) { printJson(preview); } else { console.log(chalk.yellow("[dry-run]"), JSON.stringify(preview, null, 2)); }
      return;
    }

    const client = getClient();
    await ensureUserId(client);
    const result = await posts.createPost(client, text ?? "", {
      image_url: opts.image,
      video_url: opts.video,
      reply_to_id: opts.replyTo,
      reply_control: opts.replyControl as import("./client/types.js").ReplyControl | undefined,
    });

    if (jsonOutput) { printJson(result); return; }
    console.log(chalk.green("✓ Posted"), chalk.dim(`(id: ${result.id})`));
  });

// ─── carousel ───
program
  .command("carousel <text>")
  .description("Create a carousel post (2-10 media items)")
  .requiredOption("--media <urls...>", "Media URLs (images/videos)")
  .option("--reply-control <mode>", "Reply control")
  .option("--dry-run", "Preview without posting")
  .action(async (text: string, opts: { media: string[]; replyControl?: string; dryRun?: boolean }) => {
    if (opts.dryRun) {
      const preview = { dry_run: true, text, media: opts.media, reply_control: opts.replyControl ?? null };
      if (jsonOutput) { printJson(preview); } else { console.log(chalk.yellow("[dry-run]"), JSON.stringify(preview, null, 2)); }
      return;
    }

    const client = getClient();
    await ensureUserId(client);
    const result = await posts.createCarouselPost(client, text, opts.media, {
      reply_control: opts.replyControl as import("./client/types.js").ReplyControl | undefined,
    });

    if (jsonOutput) { printJson(result); return; }
    console.log(chalk.green("✓ Carousel posted"), chalk.dim(`(id: ${result.id})`));
  });

// ─── delete ───
program
  .command("delete <id>")
  .description("Delete a post by ID")
  .action(async (id: string) => {
    const client = getClient();
    const deleted = await posts.deletePost(client, id);
    if (jsonOutput) { printJson({ id, deleted }); return; }
    console.log(deleted ? chalk.green("✓ Deleted") : chalk.red("✗ Failed to delete"), id);
  });

// ─── timeline ───
program
  .command("timeline")
  .description("Show your recent threads")
  .option("-n, --limit <n>", "Number of threads", "10")
  .action(async (opts: { limit: string }) => {
    const client = getClient();
    await ensureUserId(client);
    const result = await posts.getUserThreads(client, { limit: parseInt(opts.limit, 10) });
    if (jsonOutput) { printJson(result); return; }

    if (!result.data?.length) {
      console.log(chalk.dim("No threads found."));
      return;
    }
    for (const t of result.data) {
      const date = t.timestamp ? new Date(t.timestamp).toLocaleString() : "";
      console.log(chalk.dim(date), chalk.dim(`[${t.id}]`));
      if (t.text) console.log(t.text);
      if (t.permalink) console.log(chalk.dim(t.permalink));
      console.log();
    }
  });

// ─── reply ───
program
  .command("reply <thread-id> <text>")
  .description("Reply to a thread")
  .action(async (threadId: string, text: string) => {
    const client = getClient();
    await ensureUserId(client);
    const result = await posts.createPost(client, text, { reply_to_id: threadId });
    if (jsonOutput) { printJson(result); return; }
    console.log(chalk.green("✓ Replied"), chalk.dim(`(id: ${result.id})`));
  });

// ─── replies ───
program
  .command("replies <thread-id>")
  .description("List replies to a thread")
  .action(async (threadId: string) => {
    const client = getClient();
    const result = await replies.getReplies(client, threadId);
    if (jsonOutput) { printJson(result); return; }

    if (!result.data?.length) {
      console.log(chalk.dim("No replies."));
      return;
    }
    for (const r of result.data) {
      const date = r.timestamp ? new Date(r.timestamp).toLocaleString() : "";
      console.log(chalk.dim(date), chalk.bold(`@${r.username ?? "?"}`), chalk.dim(`[${r.id}]`));
      if (r.text) console.log(r.text);
      console.log();
    }
  });

// ─── hide ───
program
  .command("hide <reply-id>")
  .description("Hide a reply")
  .action(async (replyId: string) => {
    const client = getClient();
    const ok = await replies.hideReply(client, replyId);
    if (jsonOutput) { printJson({ reply_id: replyId, hidden: ok }); return; }
    console.log(ok ? chalk.green("✓ Hidden") : chalk.red("✗ Failed"), replyId);
  });

// ─── unhide ───
program
  .command("unhide <reply-id>")
  .description("Unhide a reply")
  .action(async (replyId: string) => {
    const client = getClient();
    const ok = await replies.unhideReply(client, replyId);
    if (jsonOutput) { printJson({ reply_id: replyId, unhidden: ok }); return; }
    console.log(ok ? chalk.green("✓ Unhidden") : chalk.red("✗ Failed"), replyId);
  });

// ─── insights ───
program
  .command("insights [thread-id]")
  .description("Show insights (media-level if thread-id given, otherwise account-level)")
  .action(async (threadId?: string) => {
    const client = getClient();

    if (threadId) {
      const result = await insights.getMediaInsights(client, threadId);
      if (jsonOutput) { printJson(result); return; }
      if (!result.data?.length) { console.log(chalk.dim("No insights.")); return; }
      for (const i of result.data) {
        const value = i.values?.[0]?.value ?? "N/A";
        console.log(`${chalk.bold(i.title ?? i.name)}: ${value}`);
      }
    } else {
      const result = await insights.getUserInsights(client);
      if (jsonOutput) { printJson(result); return; }
      if (!result.data?.length) { console.log(chalk.dim("No insights.")); return; }
      for (const i of result.data) {
        const value = i.values?.[0]?.value ?? "N/A";
        console.log(`${chalk.bold(i.title ?? i.name)}: ${value}`);
      }
    }
  });

program.parseAsync().catch((err: Error) => {
  if (jsonOutput) {
    printJson({ error: err.message });
    process.exit(1);
  }
  console.error(chalk.red("✗"), err.message);
  process.exit(1);
});
