import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The bridge is the only component with GitHub write access. For redesigns the
 * agent sends a git bundle (base..branch); the bridge imports it into a bare
 * mirror and pushes the already-validated `design/*` branch. No PR is opened:
 * a developer picks the branch up from the issue.
 */
export class GitHub {
  private mirror: string;
  private token: string;
  private repo: string;

  constructor(token: string, repo: string, dataDir: string) {
    this.token = token;
    this.repo = repo;
    this.mirror = join(dataDir, "mirror.git");
  }

  private get remote() {
    return `https://github.com/${this.repo}.git`;
  }

  /** Token goes in a per-command header, never in a remote URL or on disk. */
  private git(args: string[]) {
    const basic = Buffer.from(`x-access-token:${this.token}`).toString("base64");
    return run("git", ["-c", `http.extraHeader=Authorization: Basic ${basic}`, "--git-dir", this.mirror, ...args], {
      maxBuffer: 64 * 1024 * 1024,
    });
  }

  async pushBundle(bundle: Buffer, branch: string, baseBranch: string): Promise<{ branchUrl: string; compareUrl: string }> {
    if (!existsSync(this.mirror)) await run("git", ["init", "--bare", "-q", this.mirror]);
    await this.git(["fetch", "-q", this.remote, `+refs/heads/${baseBranch}:refs/remotes/origin/${baseBranch}`]);

    const file = join(this.mirror, `incoming-${Date.now()}.bundle`);
    await writeFile(file, bundle);
    try {
      await this.git(["bundle", "verify", "-q", file]);
      await this.git(["fetch", "-q", file, `+refs/heads/${branch}:refs/heads/${branch}`]);
      await this.git(["push", "-q", this.remote, `+refs/heads/${branch}:refs/heads/${branch}`]);
    } finally {
      await rm(file, { force: true });
    }
    return {
      branchUrl: `https://github.com/${this.repo}/tree/${branch}`,
      compareUrl: `https://github.com/${this.repo}/compare/${baseBranch}...${branch}`,
    };
  }
}
