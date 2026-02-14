import { resolve } from "path";
import { homedir } from "os";
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync, chmodSync } from "fs";

export interface ThreadsConfig {
  app_id: string;
  app_secret: string;
  access_token: string;
  user_id?: string;
  expires_at?: string;
}

interface ConfigFile {
  app_id?: string;
  app_secret?: string;
  access_token?: string;
  user_id?: string;
  expires_at?: string;
}

const CONFIG_DIR = resolve(process.env.HOME ?? homedir(), ".config/thrd-cli");
const CONFIG_PATH = resolve(CONFIG_DIR, "config.json");

/**
 * Load config from environment variables or config file.
 * Priority: process.env → ~/.config/thrd-cli/config.json
 */
export function loadConfig(): ThreadsConfig {
  let fileConfig: ConfigFile = {};

  if (existsSync(CONFIG_PATH)) {
    try {
      const mode = statSync(CONFIG_PATH).mode;
      if (mode & 0o004) {
        console.warn(`⚠ ${CONFIG_PATH} is world-readable. Run: chmod 600 ${CONFIG_PATH}`);
      }
    } catch { /* ignore */ }

    try {
      fileConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    } catch (err) {
      console.warn(`⚠ Failed to parse ${CONFIG_PATH}: ${(err as Error).message}`);
    }
  }

  const app_id = process.env.THREADS_APP_ID ?? fileConfig.app_id;
  const app_secret = process.env.THREADS_APP_SECRET ?? fileConfig.app_secret;
  const access_token = process.env.THREADS_ACCESS_TOKEN ?? fileConfig.access_token;
  const user_id = process.env.THREADS_USER_ID ?? fileConfig.user_id;
  const expires_at = fileConfig.expires_at;

  if (!app_id || !app_secret || !access_token) {
    const missing: string[] = [];
    if (!app_id) missing.push("app_id");
    if (!app_secret) missing.push("app_secret");
    if (!access_token) missing.push("access_token");
    throw new Error(
      `Missing credentials: ${missing.join(", ")}\n` +
      `Set them in ~/.config/thrd-cli/config.json or as environment variables.\n` +
      `Run 'thrd auth' to authenticate via OAuth.`
    );
  }

  // Warn if token is expiring soon
  if (expires_at) {
    const expiresDate = new Date(expires_at);
    const daysLeft = (expiresDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysLeft < 0) {
      console.warn("⚠ Access token has expired. Run 'thrd refresh' to get a new one.");
    } else if (daysLeft < 7) {
      console.warn(`⚠ Access token expires in ${Math.ceil(daysLeft)} day(s). Run 'thrd refresh' to renew.`);
    }
  }

  return { app_id, app_secret, access_token, user_id, expires_at };
}

/** Get config file path */
export function getConfigPath(): string {
  return CONFIG_PATH;
}

/** Save config to file */
export function saveConfig(config: ConfigFile): void {
  mkdirSync(CONFIG_DIR, { recursive: true });

  // Merge with existing config
  let existing: ConfigFile = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      existing = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    } catch { /* ignore */ }
  }

  const merged = { ...existing, ...config };
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 });
  // Ensure permissions are correct even if file already existed
  try { chmodSync(CONFIG_PATH, 0o600); } catch { /* ignore */ }
}
