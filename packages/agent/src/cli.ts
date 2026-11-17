#!/usr/bin/env node
/**
 * `specforge` — the helper CLI the agent calls from Bash.
 * Text bodies (descriptions, comments, documents) are read from stdin so the
 * agent never has to escape markdown into shell arguments.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { parseArgs } from "node:util";
import { BridgeClient, type ActivityType } from "./bridge-client.ts";

const USAGE = `specforge <command>

Context
  job                                    Current job (JSON), including the Definition of Ready
  issue <ID|PRD-12>                      Issue with comments, attachments and documents
  image <uploads.linear.app URL> <out>   Download a pasted screenshot or file to look at it
  search <text>                          Team issues matching the text, in any state
  knowledge                              Saved answers to earlier questions
  labels                                 Labels you can add (tenant, area…), with descriptions

Publish (bodies come from stdin)
  finalize <issue> --type T --title X [--priority 0-4] [--hotfix] [--labels "A,B"]
                                                         Publish the finished issue (DoR enforced)
  subissue <parent> --type T --title X [--labels "A,B"]  Create a ready sub-issue (DoR enforced)
  attach <issue> <file> [--title X]                      Attach a file (docx, xlsx, png, html…)
  doc <issue> --title X                                  Add a document to the issue
  knowledge-save --title X                               Save an answer to the knowledge base
  branch                                                 Push the current design/* branch

Conversation
  activity <thought|response|elicitation|error>          Message in the agent session
  comment <issue>                                        Comment on an issue
  state <issue> <needsInfo|needsApproval>                Park the issue while waiting

Types: feature · bug · ux · redesign · question`;

const MIME: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".html": "text/html",
  ".md": "text/markdown",
  ".csv": "text/csv",
};

const bridge = new BridgeClient();
const stdin = () => readFileSync(0, "utf8").trim();
const out = (value: unknown) => console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));

function job() {
  const path = process.env.SPECFORGE_JOB_FILE;
  if (!path) throw new Error("SPECFORGE_JOB_FILE is not set: run inside a specforge job");
  return JSON.parse(readFileSync(path, "utf8"));
}

/** `--labels "UPEU, customer requirement"` → ["UPEU", "customer requirement"]. */
const labelList = (value: string | undefined) =>
  value ? value.split(",").map((l) => l.trim()).filter(Boolean) : undefined;

function arg(value: string | undefined, name: string): string {
  if (!value) throw new Error(`missing ${name}\n\n${USAGE}`);
  return value;
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      type: { type: "string" },
      title: { type: "string" },
      priority: { type: "string" },
      hotfix: { type: "boolean" },
      labels: { type: "string" },
    },
  });
  const [command, ...args] = positionals;

  switch (command) {
    case "job":
      return out(job());

    case "issue":
      return out(await bridge.get(`/linear/issue/${encodeURIComponent(arg(args[0], "issue"))}`));

    case "image": {
      const res = await bridge.raw(`/linear/file?url=${encodeURIComponent(arg(args[0], "url"))}`);
      writeFileSync(arg(args[1], "output path"), Buffer.from(await res.arrayBuffer()));
      return out(`saved ${args[1]} (${res.headers.get("content-type")})`);
    }

    case "search":
      return out(await bridge.get(`/linear/search?q=${encodeURIComponent(arg(args.join(" "), "text"))}`));

    case "knowledge":
      return out(await bridge.get("/linear/knowledge"));

    case "labels":
      return out(await bridge.get("/linear/labels"));

    case "knowledge-save":
      return out(await bridge.post("/linear/knowledge", { title: arg(values.title, "--title"), content: stdin() }));

    case "finalize":
      return out(
        await bridge.post("/linear/finalize", {
          issueId: arg(args[0], "issue"),
          type: arg(values.type, "--type"),
          title: arg(values.title, "--title"),
          priority: values.priority ? Number(values.priority) : undefined,
          hotfix: values.hotfix === true,
          labels: labelList(values.labels),
          description: stdin(),
        }),
      );

    case "subissue":
      return out(
        await bridge.post("/linear/subissue", {
          parentId: arg(args[0], "parent"),
          type: arg(values.type, "--type"),
          title: arg(values.title, "--title"),
          labels: labelList(values.labels),
          description: stdin(),
        }),
      );

    case "attach": {
      const file = arg(args[1], "file");
      const filename = basename(file);
      return out(
        await bridge.upload(
          "/linear/attachment",
          readFileSync(file),
          MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
          { Issue: arg(args[0], "issue"), Filename: filename, Title: values.title ?? filename },
        ),
      );
    }

    case "doc":
      return out(
        await bridge.post("/linear/document", {
          issueId: arg(args[0], "issue"),
          title: arg(values.title, "--title"),
          content: stdin(),
        }),
      );

    case "branch": {
      const envelope = job();
      const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8" }).trim();
      const branch = git("rev-parse", "--abbrev-ref", "HEAD");
      const base = `origin/${envelope.branches.development}`;
      if (git("rev-list", "--count", `${base}..HEAD`) === "0") throw new Error(`no commits ahead of ${base}`);
      const bundle = execFileSync("git", ["bundle", "create", "-", `${base}..${branch}`]);
      return out(await bridge.upload("/github/branch", bundle, "application/octet-stream", { Branch: branch }));
    }

    case "activity": {
      const { payload } = job().job;
      return out(await bridge.activity(payload.sessionId, arg(args[0], "type") as ActivityType, stdin()));
    }

    case "comment":
      return out(await bridge.post("/linear/comment", { issueId: arg(args[0], "issue"), body: stdin() }));

    case "state":
      return out(await bridge.post("/linear/state", { issueId: arg(args[0], "issue"), state: arg(args[1], "state") }));

    default:
      console.log(USAGE);
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((e) => {
  console.error(`specforge: ${(e as Error).message}`);
  process.exit(1);
});
