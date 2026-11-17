import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Store } from "../src/store.ts";

describe("job write scope", () => {
  const dir = mkdtempSync(join(tmpdir(), "specforge-"));
  const store = new Store(dir);
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("limits a running job to its own issue and the sub-issues it created", () => {
    store.enqueue("product", { kind: "session", sessionId: "s1", issueId: "uuid-draft" });
    const job = store.claimNext("product")!;
    assert.equal(store.currentJob("product")?.id, job.id);

    store.addScope(job.id, ["uuid-draft", "MYW-12"]);
    assert.equal(store.inScope(job.id, "uuid-draft"), true);
    assert.equal(store.inScope(job.id, "myw-12"), true, "identifiers match case-insensitively");
    assert.equal(store.inScope(job.id, "MYW-99"), false, "other issues are out of scope");

    store.addScope(job.id, ["uuid-sub", "MYW-13"]);
    assert.equal(store.inScope(job.id, "MYW-13"), true, "sub-issues created by the job are in scope");
  });

  it("has no running job once it finishes, and scope does not carry over", () => {
    const job = store.currentJob("product")!;
    store.finish(job.id, "product", "done");
    assert.equal(store.currentJob("product"), undefined);

    store.enqueue("product", { kind: "session", sessionId: "s2", issueId: "uuid-other" });
    const next = store.claimNext("product")!;
    assert.equal(store.inScope(next.id, "MYW-12"), false);
  });
});
