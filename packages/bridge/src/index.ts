import { createServer } from "node:http";
import { loadConfig, loadEnv } from "./config.ts";
import { GitHub } from "./github.ts";
import { log, readBody, send } from "./http.ts";
import { Linear } from "./linear.ts";
import { onInternal } from "./routes.ts";
import { Store } from "./store.ts";
import { onLinearWebhook } from "./webhooks.ts";

const env = loadEnv();
const config = loadConfig();
const store = new Store(env.dataDir);
const linear = new Linear(env.linearToken, config);
const github = new GitHub(env.githubToken, config.github.repo, env.dataDir);
const deps = { env, config, store, linear, github };

/**
 * Public surface (expose only this through your reverse proxy):
 *   POST /hooks/linear   signed by Linear
 * Everything else is the internal agent API and must stay on the private network.
 */
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://bridge");
  try {
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true });
    const raw = await readBody(req);
    if (req.method === "POST" && url.pathname === "/hooks/linear") {
      return await onLinearWebhook(raw, req, res, deps);
    }
    return await onInternal(raw, req, res, url, deps);
  } catch (e) {
    log("request failed", req.method, url.pathname, (e as Error).message);
    if (!res.headersSent) send(res, 500, { error: "internal error" });
  }
});

await linear.init();
server.listen(env.port, () => log(`specforge bridge listening on :${env.port}`));
