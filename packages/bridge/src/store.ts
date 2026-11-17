import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Role } from "./config.ts";

export type Job = {
  id: number;
  role: Role;
  /** A Linear agent session event: the draft issue, the PM's message, and whether it approves. */
  payload: Record<string, unknown>;
  status: "queued" | "running" | "done" | "failed";
};

/** A single SQLite file holds the job queue. One agent, one job at a time, FIFO. */
export class Store {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, "specforge.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS job_scope (
        job_id INTEGER NOT NULL,
        ref TEXT NOT NULL,
        PRIMARY KEY (job_id, ref)
      );
    `);
  }

  /** The job the role is working on right now (one agent per role, one job at a time). */
  currentJob(role: Role): Job | undefined {
    const row = this.db
      .prepare("SELECT id, role, payload FROM jobs WHERE role = ? AND status = 'running' ORDER BY id DESC LIMIT 1")
      .get(role) as { id: number; role: Role; payload: string } | undefined;
    if (!row) return undefined;
    return { id: Number(row.id), role: row.role, payload: JSON.parse(row.payload), status: "running" };
  }

  /**
   * Issues a job may change: its own draft issue and the sub-issues it creates.
   * Both the UUID and the identifier (PRD-12) are stored, so either form matches.
   */
  addScope(jobId: number, refs: (string | null | undefined)[]): void {
    const insert = this.db.prepare("INSERT OR IGNORE INTO job_scope (job_id, ref) VALUES (?, ?)");
    for (const ref of refs) if (ref) insert.run(jobId, ref.toLowerCase());
  }

  inScope(jobId: number, ref: string | undefined): boolean {
    if (!ref) return false;
    return Boolean(
      this.db.prepare("SELECT 1 FROM job_scope WHERE job_id = ? AND ref = ?").get(jobId, ref.toLowerCase()),
    );
  }

  enqueue(role: Role, payload: Record<string, unknown>): number {
    const result = this.db.prepare("INSERT INTO jobs (role, payload) VALUES (?, ?)").run(role, JSON.stringify(payload));
    return Number(result.lastInsertRowid);
  }

  positionOf(id: number, role: Role): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM jobs WHERE role = ? AND id < ? AND status IN ('queued', 'running')")
      .get(role, id) as { n: number };
    return row.n;
  }

  claimNext(role: Role): Job | undefined {
    const row = this.db
      .prepare(
        `UPDATE jobs SET status = 'running'
         WHERE id = (SELECT id FROM jobs WHERE role = ? AND status = 'queued' ORDER BY id LIMIT 1)
         RETURNING id, role, payload`,
      )
      .get(role) as { id: number; role: Role; payload: string } | undefined;
    if (!row) return undefined;
    return { id: Number(row.id), role: row.role, payload: JSON.parse(row.payload), status: "running" };
  }

  finish(id: number, role: Role, status: "done" | "failed"): boolean {
    const result = this.db
      .prepare("UPDATE jobs SET status = ? WHERE id = ? AND role = ? AND status = 'running'")
      .run(status, id, role);
    return Number(result.changes) > 0;
  }
}
