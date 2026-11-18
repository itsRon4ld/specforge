import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RepoAccessError, tokenFromUrl } from "../src/repo-access.ts";

describe("clone token handling", () => {
  it("extracts the token from GitHub clone URLs", () => {
    assert.equal(tokenFromUrl("https://x-access-token:github_pat_abc@github.com/org/repo.git"), "github_pat_abc");
    assert.equal(tokenFromUrl("https://github_pat_abc@github.com/org/repo.git"), "github_pat_abc");
  });

  it("ignores URLs without a token or outside GitHub", () => {
    assert.equal(tokenFromUrl("https://github.com/org/repo.git"), null);
    assert.equal(tokenFromUrl("https://user:secret@gitlab.com/org/repo.git"), null);
    assert.equal(tokenFromUrl(undefined), null);
    assert.equal(tokenFromUrl("not a url"), null);
  });

  it("explains access failures without leaking the token", () => {
    const error = new RepoAccessError("product");
    assert.match(error.message, /REPO_CLONE_URL/);
    assert.doesNotMatch(error.message, /github_pat/);
  });
});
