import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { BridgeClient, type JobEnvelope } from "./bridge-client.ts";
import { prepareJobDir, prepareRepo } from "./workspace.ts";

/**
 * Agent runtime: poll the bridge → prepare the job folder and the read-only
 * repo → run Claude Code with the product instructions, the templates and the
 * team's skills → report back. The agent itself talks to Linear and GitHub
 * only through the `specforge` CLI, which goes through the bridge.
 */
const WORK_DIR = process.env.WORK_DIR ?? "/work";
const POLL_MS = Number(process.env.POLL_SECONDS ?? 10) * 1000;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const instructions = readFileSync(join(root, "instructions", "product.md"), "utf8");
const TEMPLATES_DIR = join(root, "templates");
const SKILLS_DIR = process.env.SKILLS_DIR ?? join(root, "skills");
const bridge = new BridgeClient();

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), "[product]", ...args);
}

function taskPrompt(envelope: JobEnvelope, repo: string): string {
  const p = envelope.job.payload;
  return [
    `Linear agent session event: ${p.action}. Draft issue: ${p.identifier ?? p.issueId}.`,
    `Approved by an allowlisted reviewer: ${p.approved ? "YES" : "no"}`,
    p.prompt ? `\nMessage from the PM:\n${p.prompt}` : "",
    "",
    `- Product codebase (read-only clone): ${repo}`,
    `- Issue templates: ${TEMPLATES_DIR}`,
    `- Put generated files in ./out/`,
    "",
    `Start with \`specforge job\` and \`specforge issue ${p.issueId}\`.`,
  ].join("\n");
}

async function runJob(envelope: JobEnvelope) {
  const jobDir = prepareJobDir(WORK_DIR, envelope.job.id, SKILLS_DIR);
  const jobFile = join(jobDir, "job.json");
  writeFileSync(jobFile, JSON.stringify(envelope, null, 2));
  const repo = prepareRepo(WORK_DIR, process.env.REPO_CLONE_URL ?? "");

  const append = [instructions, envelope.guidance && `## Product context\n\n${envelope.guidance}`]
    .filter(Boolean)
    .join("\n\n");

  for await (const message of query({
    prompt: taskPrompt(envelope, repo),
    options: {
      model: envelope.model,
      cwd: jobDir,
      additionalDirectories: [repo, TEMPLATES_DIR],
      systemPrompt: { type: "preset", preset: "claude_code", append },
      settingSources: ["project"], // loads the skills copied into .claude/skills
      allowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Skill", "TodoWrite"],
      permissionMode: "acceptEdits",
      env: { ...process.env, SPECFORGE_JOB_FILE: jobFile },
    },
  })) {
    if (message.type === "result") {
      log(`job ${envelope.job.id} finished: ${message.subtype}`, `cost=$${message.total_cost_usd?.toFixed(2)}`);
      if (message.subtype !== "success") throw new Error(`agent run ended with ${message.subtype}`);
    }
  }
}

async function main() {
  log("runtime started");
  for (;;) {
    let envelope: JobEnvelope | null = null;
    try {
      envelope = await bridge.nextJob();
      if (!envelope) {
        await sleep(POLL_MS);
        continue;
      }
      log(`job ${envelope.job.id} claimed`);
      await runJob(envelope);
      await bridge.finish(envelope.job.id, "done");
    } catch (e) {
      log("job failed", (e as Error).message);
      if (!envelope) {
        await sleep(POLL_MS);
        continue;
      }
      const sessionId = envelope.job.payload.sessionId as string | undefined;
      if (sessionId) {
        await bridge
          .activity(sessionId, "error", "I could not finish this request. Mention me again to retry.")
          .catch(() => undefined);
      }
      await bridge.finish(envelope.job.id, "failed").catch(() => undefined);
    }
  }
}

await main();
