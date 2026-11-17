import { cpSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

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
export function prepareRepo(workDir: string, cloneUrl: string, branches: Branches): Checkouts {
  const repo = join(workDir, "repo");
  if (!existsSync(join(repo, ".git"))) {
    // Partial clone: full commit history (for diffs and logs) but file contents are
    // fetched on demand. Much faster and smaller for large monorepos.
    execFileSync("git", ["clone", "--quiet", "--filter=blob:none", cloneUrl, repo], { stdio: "inherit" });
  }
  run(repo, "fetch", "--quiet", "--prune", "origin");
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
 * Per-job folder. Skills are copied into `.claude/skills` so Claude Code loads
 * them as project skills; generated files (docx, xlsx, prototypes) go in `out/`.
 */
export function prepareJobDir(workDir: string, jobId: number, skillsDir: string): string {
  const dir = join(workDir, "jobs", String(jobId));
  mkdirSync(join(dir, "out"), { recursive: true });
  if (existsSync(skillsDir)) cpSync(skillsDir, join(dir, ".claude", "skills"), { recursive: true });
  return dir;
}
