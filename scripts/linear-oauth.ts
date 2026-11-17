#!/usr/bin/env node
/**
 * Installs your Linear OAuth app as an agent (actor=app) and prints the values
 * for .env. Run once, as a Linear workspace admin:
 *
 *   LINEAR_CLIENT_ID=... LINEAR_CLIENT_SECRET=... pnpm setup:linear
 *
 * The app must list http://localhost:8765/callback as a callback URL.
 */
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const PORT = 8765;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPES = ["read", "write", "app:assignable", "app:mentionable"];

const clientId = process.env.LINEAR_CLIENT_ID;
const clientSecret = process.env.LINEAR_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET (Linear → Settings → API → OAuth applications).");
  process.exit(1);
}

const state = randomBytes(16).toString("hex");
const authorizeUrl = new URL("https://linear.app/oauth/authorize");
authorizeUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  response_type: "code",
  scope: SCOPES.join(","),
  actor: "app", // the app acts as its own user: it can be delegated issues and @mentioned
  state,
}).toString();

async function exchange(code: string) {
  const res = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId!,
      client_secret: clientSecret!,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
}

async function viewer(token: string) {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: "{ viewer { id name } }" }),
  });
  const json = (await res.json()) as { data: { viewer: { id: string; name: string } } };
  return json.data.viewer;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", REDIRECT_URI);
  if (url.pathname !== "/callback") return res.writeHead(404).end();
  try {
    if (url.searchParams.get("state") !== state) throw new Error("state mismatch");
    const code = url.searchParams.get("code");
    if (!code) throw new Error(url.searchParams.get("error") ?? "no code returned");

    const token = await exchange(code);
    const app = await viewer(token.access_token);
    res.writeHead(200, { "Content-Type": "text/plain" }).end("specforge is installed. You can close this tab.");

    console.log(`\nInstalled as "${app.name}" (app user id ${app.id}). Add to .env:\n`);
    console.log(`LINEAR_ACCESS_TOKEN=${token.access_token}`);
    if (token.refresh_token) console.log(`# refresh token (store safely): ${token.refresh_token}`);
    console.log("\nLINEAR_WEBHOOK_SECRET is the signing secret shown on the OAuth app page.");
  } catch (e) {
    res.writeHead(400, { "Content-Type": "text/plain" }).end(`Setup failed: ${(e as Error).message}`);
    console.error(e);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log("Open this URL as a Linear workspace admin and approve the install:\n");
  console.log(authorizeUrl.toString());
});
