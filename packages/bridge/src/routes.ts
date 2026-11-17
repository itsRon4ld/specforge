import type { IncomingMessage, ServerResponse } from "node:http";
import { REQUEST_TYPES, type Config, type Env, type RequestType, type StateKey } from "./config.ts";
import type { GitHub } from "./github.ts";
import { parseJson, send } from "./http.ts";
import type { ActivityContent, Linear } from "./linear.ts";
import {
  canCall,
  finalStateFor,
  isAllowedBranch,
  isLinearUpload,
  missingSections,
  resolveExtraLabels,
  roleFor,
  STATE_ALLOWLIST,
} from "./security.ts";
import type { Store } from "./store.ts";

type Deps = { env: Env; config: Config; store: Store; linear: Linear; github: GitHub };

/** `GET /linear/issue/PRD-1` → `GET /linear/issue` (the key used by the route matrix). */
function routeKey(method: string, pathname: string): { key: string; param: string | undefined } {
  const [, first = "", second = "", ...rest] = pathname.split("/");
  return { key: `${method} /${first}/${second}`, param: rest.length ? decodeURIComponent(rest.join("/")) : undefined };
}

const header = (req: IncomingMessage, name: string) => decodeURIComponent(String(req.headers[name] ?? ""));

const isRequestType = (value: unknown): value is RequestType => REQUEST_TYPES.includes(value as RequestType);

/** Internal API for the agent. Reachable only on the private network. */
export async function onInternal(raw: Buffer, req: IncomingMessage, res: ServerResponse, url: URL, deps: Deps) {
  const { env, config, store, linear, github } = deps;
  const role = roleFor(req.headers.authorization, env.roleTokens);
  if (!role) return send(res, 401, { error: "unauthorized" });

  const { key, param } = routeKey(req.method ?? "GET", url.pathname);
  if (!canCall(role, key)) return send(res, 403, { error: `${role} cannot call ${key}` });
  const body = () => parseJson<any>(raw);

  /** Definition of Ready gate shared by finalize and subissue. */
  const notReady = (type: unknown, description: unknown) => {
    if (!isRequestType(type)) return `type must be one of ${REQUEST_TYPES.join(", ")}`;
    if (typeof description !== "string" || !description.trim()) return "description is required";
    const missing = missingSections(description, config.readiness[type], config.originalRequestTitle);
    return missing.length ? `not ready, missing sections: ${missing.join(", ")}` : null;
  };

  /** Validates extra label names against the live Linear labels; returns ids or an error message. */
  const extraLabels = async (names: unknown): Promise<{ ids: string[] } | { error: string }> => {
    if (names === undefined || names === null) return { ids: [] };
    if (!Array.isArray(names) || !names.every((n) => typeof n === "string")) {
      return { error: "labels must be a list of label names" };
    }
    const result = resolveExtraLabels(names, await linear.labels(), linear.managedLabelNames());
    if (result.managed.length) {
      return { error: `labels set by type or --hotfix, not by name: ${result.managed.join(", ")}` };
    }
    if (result.unknown.length) {
      return { error: `labels do not exist in Linear (run \`specforge labels\`): ${result.unknown.join(", ")}` };
    }
    return { ids: result.ids };
  };

  /**
   * Write scope. The agent may only change the issue of the job it is running and
   * the sub-issues it created in that job, and may only talk in that job's session.
   * Reading stays open: searching the team is part of the job.
   */
  const outOfScope = (issueRef: unknown): string | null => {
    const job = store.currentJob(role);
    if (!job) return "no job is running";
    if (typeof issueRef !== "string" || !store.inScope(job.id, issueRef)) {
      return `issue ${String(issueRef)} is outside this job (only its own issue and the sub-issues it created)`;
    }
    return null;
  };

  switch (key) {
    case "GET /linear/labels": {
      const managed = new Set(linear.managedLabelNames().map((n) => n.toLowerCase()));
      return send(res, 200, (await linear.labels()).filter((l) => !managed.has(l.name.toLowerCase())));
    }

    case "GET /jobs/next": {
      const job = store.claimNext(role);
      if (!job) return send(res, 204);
      // Resolve the draft once, so both its UUID and its identifier are in scope.
      try {
        const draft = await linear.issue(String(job.payload.issueId));
        store.addScope(job.id, [draft.id, draft.identifier]);
      } catch (e) {
        store.finish(job.id, role, "failed"); // don't leave a job running that the agent never received
        throw e;
      }
      return send(res, 200, {
        job,
        model: config.agent.model,
        guidance: config.agent.guidance ?? "",
        paths: {
          skills: config.agent.skillsPath ?? null,
          templates: config.agent.templatesPath ?? null,
          context: config.agent.contextPath ?? null,
        },
        repo: config.github.repo,
        branches: config.github.branches,
        designBranchPrefix: config.github.designBranchPrefix,
        readiness: config.readiness,
        originalRequestTitle: config.originalRequestTitle,
        knowledgeBase: Boolean(config.linear.knowledgeIssue),
      });
    }

    case "POST /jobs/finish": {
      const { jobId, status } = body();
      const ok = store.finish(Number(jobId), role, status === "failed" ? "failed" : "done");
      return send(res, ok ? 200 : 404, { ok });
    }

    case "GET /linear/issue":
      if (!param) return send(res, 400, { error: "issue id required" });
      return send(res, 200, await linear.issue(param));

    case "GET /linear/search": {
      const q = url.searchParams.get("q");
      if (!q) return send(res, 400, { error: "q required" });
      return send(res, 200, await linear.search(q));
    }

    case "GET /linear/file": {
      const fileUrl = url.searchParams.get("url") ?? "";
      if (!isLinearUpload(fileUrl)) return send(res, 400, { error: "only https://uploads.linear.app URLs" });
      const file = await linear.download(fileUrl);
      res.writeHead(200, { "Content-Type": file.contentType, "Content-Length": file.data.length });
      return res.end(file.data);
    }

    case "GET /linear/knowledge": {
      if (!config.linear.knowledgeIssue) return send(res, 200, []);
      return send(res, 200, (await linear.issue(config.linear.knowledgeIssue)).documents);
    }

    case "POST /linear/knowledge": {
      if (!config.linear.knowledgeIssue) return send(res, 409, { error: "linear.knowledgeIssue is not configured" });
      const { title, content } = body();
      const target = await linear.issue(config.linear.knowledgeIssue);
      return send(res, 200, await linear.document(target.id, title, content));
    }

    case "POST /linear/finalize": {
      const { issueId, type, title, description, priority, hotfix, labels } = body();
      const scope = outOfScope(issueId);
      if (scope) return send(res, 403, { error: scope });
      const problem = notReady(type, description) ?? (title ? null : "title is required");
      if (problem) return send(res, 422, { error: problem });
      const extra = await extraLabels(labels);
      if ("error" in extra) return send(res, 422, { error: extra.error });
      const state = finalStateFor(type);
      await linear.finalize(issueId, {
        type,
        title,
        description,
        priority,
        state,
        hotfix: hotfix === true,
        extraLabelIds: extra.ids,
      });
      return send(res, 200, { ok: true, state, hotfix: hotfix === true, labels: labels ?? [] });
    }

    case "POST /linear/subissue": {
      const { parentId, type, title, description, labels } = body();
      const scope = outOfScope(parentId);
      if (scope) return send(res, 403, { error: scope });
      const problem = notReady(type, description) ?? (title ? null : "title is required");
      if (problem) return send(res, 422, { error: problem });
      const extra = await extraLabels(labels);
      if ("error" in extra) return send(res, 422, { error: extra.error });
      const created = await linear.createSubIssue(parentId, { type, title, description, extraLabelIds: extra.ids });
      store.addScope(store.currentJob(role)!.id, [created.id, created.identifier]);
      return send(res, 200, created);
    }

    case "POST /linear/comment": {
      const { issueId, body: text } = body();
      const scope = outOfScope(issueId);
      if (scope) return send(res, 403, { error: scope });
      await linear.comment(issueId, text);
      return send(res, 200, { ok: true });
    }

    case "POST /linear/state": {
      const { issueId, state } = body() as { issueId: string; state: StateKey };
      if (!STATE_ALLOWLIST[role].includes(state)) {
        return send(res, 403, { error: `${role} cannot set ${state} directly; use finalize` });
      }
      const scope = outOfScope(issueId);
      if (scope) return send(res, 403, { error: scope });
      await linear.setState(issueId, state);
      return send(res, 200, { ok: true });
    }

    case "POST /linear/activity": {
      const { sessionId, content } = body() as { sessionId: string; content: ActivityContent };
      if (!sessionId || store.currentJob(role)?.payload.sessionId !== sessionId) {
        return send(res, 403, { error: "activities only go to the running job's own session" });
      }
      await linear.activity(sessionId, content);
      return send(res, 200, { ok: true });
    }

    case "POST /linear/document": {
      const { issueId, title, content } = body();
      const scope = outOfScope(issueId);
      if (scope) return send(res, 403, { error: scope });
      return send(res, 200, await linear.document(issueId, title, content));
    }

    case "POST /linear/attachment": {
      const issueId = header(req, "x-specforge-issue");
      const filename = header(req, "x-specforge-filename");
      if (!issueId || !filename || !raw.length) return send(res, 400, { error: "issue, filename and body required" });
      const scope = outOfScope(issueId);
      if (scope) return send(res, 403, { error: scope });
      return send(
        res,
        200,
        await linear.attach(issueId, {
          filename,
          title: header(req, "x-specforge-title") || filename,
          contentType: String(req.headers["content-type"] ?? "application/octet-stream"),
          data: raw,
        }),
      );
    }

    case "POST /github/branch": {
      const branch = header(req, "x-specforge-branch");
      const { development, production } = config.github.branches;
      if (!isAllowedBranch(branch, config.github.designBranchPrefix, [development, production])) {
        return send(res, 403, { error: `branch "${branch}" is not allowed` });
      }
      // Redesigns are new work: they always start from the development branch.
      return send(res, 200, await github.pushBundle(raw, branch, development));
    }
  }
  send(res, 404, { error: "not found" });
}
