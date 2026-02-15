import { createServer as createHttpsServer } from "https";
import type { IncomingMessage, ServerResponse } from "http";
import { randomBytes } from "crypto";
import { execSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import open from "open";
import { saveConfig } from "./config.js";

const AUTHORIZE_URL = "https://threads.net/oauth/authorize";
const TOKEN_URL = "https://graph.threads.net/oauth/access_token";
const EXCHANGE_URL = "https://graph.threads.net/access_token";

const SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_read_replies",
  "threads_manage_replies",
  "threads_manage_insights",
  "threads_delete",
].join(",");

/**
 * Generate a self-signed certificate for the local HTTPS callback server.
 * Requires `openssl` CLI (available on macOS, Linux, and most Windows dev environments).
 */
function generateSelfSignedCert(): { key: string; cert: string; cleanup: () => void } {
  const tmp = mkdtempSync(join(tmpdir(), "thrd-cert-"));
  const keyPath = join(tmp, "key.pem");
  const certPath = join(tmp, "cert.pem");

  try {
    execSync(
      [
        "openssl", "req", "-x509",
        "-newkey", "rsa:2048",
        "-keyout", keyPath,
        "-out", certPath,
        "-days", "1",
        "-nodes",
        "-subj", "/CN=localhost",
      ].join(" "),
      { stdio: "ignore" },
    );
  } catch {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(
      "Failed to generate a self-signed certificate. Is OpenSSL installed?\n" +
      "  macOS:   brew install openssl\n" +
      "  Ubuntu:  sudo apt install openssl\n" +
      "  Windows: https://slproweb.com/products/Win32OpenSSL.html",
    );
  }

  const key = readFileSync(keyPath, "utf-8");
  const cert = readFileSync(certPath, "utf-8");
  const cleanup = () => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  return { key, cert, cleanup };
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  user_id?: number;
}

interface LongLivedTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

/**
 * Run the full OAuth 2.0 authorization code flow.
 */
export async function authenticate(
  appId: string,
  appSecret: string,
  port = 3000,
): Promise<void> {
  const redirectUri = `https://localhost:${port}/callback`;
  const state = randomBytes(16).toString("hex");

  const code = await getAuthorizationCode(appId, redirectUri, state, port);
  const shortLived = await exchangeCodeForToken(appId, appSecret, code, redirectUri);
  const longLived = await exchangeForLongLivedToken(appSecret, shortLived.access_token);

  const expiresAt = longLived.expires_in
    ? new Date(Date.now() + longLived.expires_in * 1000).toISOString()
    : undefined;

  saveConfig({
    app_id: appId,
    app_secret: appSecret,
    access_token: longLived.access_token,
    user_id: shortLived.user_id ? String(shortLived.user_id) : undefined,
    expires_at: expiresAt,
  });
}

function getAuthorizationCode(
  appId: string,
  redirectUri: string,
  state: string,
  port: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const tlsOptions = generateSelfSignedCert();
    const server = createHttpsServer(tlsOptions, (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `https://localhost:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400);
        res.end(`Authorization failed: ${error}`);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (!code || returnedState !== state) {
        res.writeHead(400);
        res.end("Invalid callback: missing code or state mismatch.");
        server.close();
        reject(new Error("Invalid OAuth callback."));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body><h2>✓ Authorization complete!</h2><p>You can close this tab.</p></body></html>");
      server.close();
      resolve(code);
    });

    server.listen(port, () => {
      const authUrl = new URL(AUTHORIZE_URL);
      authUrl.searchParams.set("client_id", appId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("scope", SCOPES);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("state", state);

      open(authUrl.toString()).catch(() => {
        console.log(`Open this URL in your browser:\n${authUrl.toString()}`);
      });
    });

    server.on("error", (err) => {
      tlsOptions.cleanup();
      reject(err);
    });
    server.on("close", () => tlsOptions.cleanup());
  });
}

async function exchangeCodeForToken(
  appId: string,
  appSecret: string,
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<TokenResponse>;
}

async function exchangeForLongLivedToken(
  appSecret: string,
  shortLivedToken: string,
): Promise<LongLivedTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "th_exchange_token",
    client_secret: appSecret,
    access_token: shortLivedToken,
  });

  const res = await fetch(`${EXCHANGE_URL}?${params.toString()}`);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Long-lived token exchange failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<LongLivedTokenResponse>;
}

/** Refresh a long-lived token */
export async function refreshToken(accessToken: string): Promise<LongLivedTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "th_refresh_token",
    access_token: accessToken,
  });

  const res = await fetch(`https://graph.threads.net/refresh_access_token?${params.toString()}`);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<LongLivedTokenResponse>;
}
