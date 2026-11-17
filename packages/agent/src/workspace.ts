import { cpSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * Read-only clone of the product codebase, reset before every job. The agent
 * reads it to check what already exists and to scope work. Redesign commits
 * leave the sandbox only as a bundle through the bridge.
 */
export function prepareRepo(workDir: string, cloneUrl: string): string {
  const repo = join(workDir, "repo");
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "inherit" });

  if (!existsSync(join(repo, ".git"))) {
    execFileSync("git", ["clone", "--quiet", cloneUrl, repo], { stdio: "inherit" });
  }
  git("fetch", "--quiet", "--prune", "origin");
  git("reset", "--quiet", "--hard");
  git("clean", "-fdq");
  git("checkout", "--quiet", "--detach", "origin/HEAD");
  return repo;
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
