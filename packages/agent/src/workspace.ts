import { cpSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { RepoAccessError, type RepoKind } from "./repo-access.ts";

export type Branches = { development: string; production: string };

export type Checkouts = {
  /** Clean checkout of the development branch (where new work lands). */
  development: string;
  /** Clean checkout of the production branch (what users run today), or the same path for single-branch repos. */
  production: string;
};

const run = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { stdio: "inherit" });

function resetTo(dir: string, ref: string) {
  run(dir, "reset", "--quiet", "--hard");
  run(dir, "clean", "-fdq");
  run(dir, "checkout", "--quiet", "--detach", ref);
}

/**
 * Read-only view of the product codebase, refreshed before every job: one
 * checkout per branch, so the agent can compare what is in production with
 * what is coming next (and tell whether a bug is already fixed in development).
 * Redesign commits leave the sandbox only as a bundle through the bridge.
 */
/** Runs a network git step; any failure becomes a RepoAccessError that never echoes the token. */
function networkStep(kind: RepoKind, step: () => void) {
  try {
    step();
  } catch {
    throw new RepoAccessError(kind);
  }
}

export function prepareRepo(workDir: string, cloneUrl: string, branches: Branches): Checkouts {
  const repo = join(workDir, "repo");
  networkStep("product", () => {
    if (!existsSync(join(repo, ".git"))) {
      // Partial clone: full commit history (for diffs and logs) but file contents are
      // fetched on demand. Much faster and smaller for large monorepos.
      execFileSync("git", ["clone", "--quiet", "--filter=blob:none", cloneUrl, repo], { stdio: "ignore" });
    }
    execFileSync("git", ["-C", repo, "fetch", "--quiet", "--prune", "origin"], { stdio: "ignore" });
  });
  resetTo(repo, `origin/${branches.development}`);

  if (branches.production === branches.development) return { development: repo, production: repo };

  // A second worktree shares the same object store: no second download.
  const production = join(workDir, "repo-production");
  if (!existsSync(join(production, ".git"))) {
    run(repo, "worktree", "prune");
    run(repo, "worktree", "add", "--quiet", "--detach", production, `origin/${branches.production}`);
  } else {
    resetTo(production, `origin/${branches.production}`);
  }
  return { development: repo, production };
}

/**
 * Optional private "setup" repository holding a team's skills, templates and
 * context, kept apart from both specforge and the product code. Refreshed before
 * every job, so a pushed change applies to the next request.
 */
export function prepareSetupRepo(workDir: string, cloneUrl: string | undefined): string | null {
  if (!cloneUrl) return null;
  const dir = join(workDir, "setup");
  networkStep("setup", () => {
    if (!existsSync(join(dir, ".git"))) {
      execFileSync("git", ["clone", "--quiet", "--depth=1", cloneUrl, dir], { stdio: "ignore" });
    }
    execFileSync("git", ["-C", dir, "fetch", "--quiet", "--depth=1", "origin"], { stdio: "ignore" });
  });
  resetTo(dir, "FETCH_HEAD");
  return dir;
}

/**
 * Per-job folder. Skills are copied into `.claude/skills` so Claude Code loads
 * them as project skills; generated files (docx, xlsx, prototypes) go in `out/`.
 */
export function prepareJobDir(workDir: string, jobId: number, skillsDir: string): string {
  const dir = join(workDir, "jobs", String(jobId));
  mkdirSync(join(dir, "out"), { recursive: true });
  if (existsSync(skillsDir)) cpSync(skillsDir, join(dir, ".claude", "skills"), { recursive: true });
  return dir;
}
