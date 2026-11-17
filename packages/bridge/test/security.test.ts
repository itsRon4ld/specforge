import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { DEFAULT_READINESS } from "../src/config.ts";
import {
  canCall,
  finalStateFor,
  isAllowedBranch,
  isApproval,
  isFreshWebhook,
  isLinearUpload,
  missingSections,
  roleFor,
  STATE_ALLOWLIST,
  verifyLinearSignature,
} from "../src/security.ts";

describe("Linear webhook verification", () => {
  const secret = "whsec_test";
  const body = Buffer.from('{"type":"AgentSessionEvent"}');
  const sign = (b: Buffer) => createHmac("sha256", secret).update(b).digest("hex");

  it("accepts valid signatures and rejects everything else", () => {
    assert.equal(verifyLinearSignature(body, sign(body), secret), true);
    assert.equal(verifyLinearSignature(Buffer.from("{}"), sign(body), secret), false);
    assert.equal(verifyLinearSignature(body, undefined, secret), false);
  });

  it("rejects stale timestamps", () => {
    const now = 1_700_000_000_000;
    assert.equal(isFreshWebhook(now - 30_000, now), true);
    assert.equal(isFreshWebhook(now - 61_000, now), false);
  });
});

describe("Definition of Ready", () => {
  const ready = `## Problem
x
## Users
x
## Acceptance criteria
- [ ] x
## Out of scope
x
## Technical notes
x
## Target branch
dev

+++ Original request

> please add it

+++`;

  it("accepts a complete feature", () => {
    assert.deepEqual(missingSections(ready, DEFAULT_READINESS.feature), []);
  });

  it("lists missing sections, case-insensitively", () => {
    const partial = "## problem\nx\n## USERS\nx";
    assert.deepEqual(missingSections(partial, DEFAULT_READINESS.feature), [
      "Acceptance criteria",
      "Out of scope",
      "Technical notes",
      "Target branch",
      "Original request",
    ]);
  });

  it("always requires the original request", () => {
    const withoutOriginal = ready.replace(/\+\+\+ Original request[\s\S]*\+\+\+/, "");
    assert.deepEqual(missingSections(withoutOriginal, DEFAULT_READINESS.feature), ["Original request"]);
  });

  it("sends questions to answered and everything else to backlog", () => {
    assert.equal(finalStateFor("question"), "answered");
    assert.equal(finalStateFor("feature"), "backlog");
    assert.equal(finalStateFor("redesign"), "backlog");
  });
});

describe("agent policy", () => {
  it("authenticates the role token", () => {
    assert.equal(roleFor(`Bearer ${"p".repeat(32)}`, { product: "p".repeat(32) }), "product");
    assert.equal(roleFor("Bearer nope", { product: "p".repeat(32) }), null);
  });

  it("only allows listed routes", () => {
    assert.equal(canCall("product", "POST /linear/finalize"), true);
    assert.equal(canCall("product", "POST /github/pr"), false);
  });

  it("cannot reach backlog or answered without the readiness gate", () => {
    assert.equal(STATE_ALLOWLIST.product.includes("backlog"), false);
    assert.equal(STATE_ALLOWLIST.product.includes("answered"), false);
  });

  it("only pushes design branches", () => {
    const protectedBranches = ["dev", "main"];
    assert.equal(isAllowedBranch("design/prd-12-new-dashboard", "design/", protectedBranches), true);
    assert.equal(isAllowedBranch("main", "design/", protectedBranches), false);
    assert.equal(isAllowedBranch("dev", "design/", protectedBranches), false);
    assert.equal(isAllowedBranch("agent/prd-12", "design/", protectedBranches), false);
    assert.equal(isAllowedBranch("design/../main", "design/", protectedBranches), false);
  });

  it("only downloads Linear uploads", () => {
    assert.equal(isLinearUpload("https://uploads.linear.app/abc/def/image.png"), true);
    assert.equal(isLinearUpload("https://evil.example.com/image.png"), false);
    assert.equal(isLinearUpload("http://uploads.linear.app/x"), false);
    assert.equal(isLinearUpload("not a url"), false);
  });

  it("verifies approvals by author id and exact wording", () => {
    const approvals = { approvers: ["pm-1"], words: ["approved", "ok"] };
    assert.equal(isApproval("Approved!", "pm-1", approvals), true);
    assert.equal(isApproval("approved", "someone-else", approvals), false);
    assert.equal(isApproval("ok but change the color", "pm-1", approvals), false);
  });
});
