import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config, Env } from "./config.ts";
import { log, parseJson, send } from "./http.ts";
import type { Linear } from "./linear.ts";
import { isApproval, isFreshWebhook, verifyLinearSignature } from "./security.ts";
import type { Store } from "./store.ts";

type Deps = { env: Env; config: Config; store: Store; linear: Linear };

/**
 * Linear → product agent.
 * The PM writes a draft issue (pasted messages, screenshots) and delegates it to
 * the app, or @mentions it. `created` starts the work; `prompted` carries the PM's
 * answers. Approval of a UX proposal or redesign is computed HERE from the
 * author's Linear id; the agent never sets it.
 */
export async function onLinearWebhook(raw: Buffer, req: IncomingMessage, res: ServerResponse, deps: Deps) {
  const { env, config, store, linear } = deps;
  if (!verifyLinearSignature(raw, req.headers["linear-signature"] as string | undefined, env.linearWebhookSecret)) {
    return send(res, 401, { error: "invalid signature" });
  }
  const payload = parseJson<any>(raw);
  if (!isFreshWebhook(payload.webhookTimestamp)) return send(res, 401, { error: "stale webhook" });
  if (payload.type !== "AgentSessionEvent") return send(res, 200, { ignored: payload.type });

  // Linear expects a 200 within 5 s and a first activity within 10 s.
  send(res, 200, { ok: true });

  const session = payload.agentSession ?? {};
  const sessionId: string | undefined = session.id;
  const issueId: string | undefined = session.issue?.id ?? session.issueId;
  if (!sessionId || !issueId) return log("AgentSessionEvent without session or issue", payload.action);

  const activity = payload.agentActivity ?? {};
  const prompt: string =
    payload.action === "prompted" ? (activity.content?.body ?? activity.body ?? "") : (payload.promptContext ?? "");
  const author: string | undefined = activity.userId ?? activity.user?.id ?? payload.actor?.id;
  const approved = payload.action === "prompted" && isApproval(prompt, author, config.approvals);

  const jobId = store.enqueue("product", {
    kind: "session",
    sessionId,
    issueId,
    identifier: session.issue?.identifier ?? null,
    action: payload.action,
    prompt,
    author: author ?? null,
    approved,
  });

  const ahead = store.positionOf(jobId, "product");
  const body = approved
    ? "Approval received. Finishing the issue…"
    : payload.action === "prompted"
      ? "Got it. Updating the issue with your answer…"
      : ahead > 0
        ? `Received. Queued — ${ahead} request(s) ahead.`
        : "Received. Reading the request…";
  await linear.activity(sessionId, { type: "thought", body }).catch((e) => log("activity failed", e.message));
}
