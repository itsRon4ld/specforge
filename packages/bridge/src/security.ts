import { createHmac, timingSafeEqual } from "node:crypto";
import type { RequestType, Role, StateKey } from "./config.ts";

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Linear signs webhooks with `Linear-Signature`: hex HMAC-SHA256 of the raw body. */
export function verifyLinearSignature(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  return safeEqual(createHmac("sha256", secret).update(raw).digest("hex"), header);
}

/** Rejects replayed Linear webhooks: `webhookTimestamp` (ms) must be within 60 s. */
export function isFreshWebhook(webhookTimestamp: unknown, now = Date.now(), maxAgeMs = 60_000): boolean {
  return typeof webhookTimestamp === "number" && Math.abs(now - webhookTimestamp) <= maxAgeMs;
}

/** Maps `Authorization: Bearer <token>` to the agent role that owns it. */
export function roleFor(authorization: string | undefined, tokens: Record<Role, string>): Role | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  for (const [role, expected] of Object.entries(tokens) as [Role, string][]) {
    if (safeEqual(token, expected)) return role;
  }
  return null;
}

/** Route matrix. Anything not listed is denied. One role today; the matrix keeps adding roles cheap. */
export const ROUTES: Record<string, Role[]> = {
  "GET /jobs/next": ["product"],
  "POST /jobs/finish": ["product"],
  "GET /linear/issue": ["product"],
  "GET /linear/search": ["product"],
  "GET /linear/file": ["product"],
  "GET /linear/knowledge": ["product"],
  "GET /linear/labels": ["product"],
  "POST /linear/knowledge": ["product"],
  "POST /linear/finalize": ["product"],
  "POST /linear/subissue": ["product"],
  "POST /linear/comment": ["product"],
  "POST /linear/state": ["product"],
  "POST /linear/activity": ["product"],
  "POST /linear/document": ["product"],
  "POST /linear/attachment": ["product"],
  "POST /github/branch": ["product"],
};

export function canCall(role: Role, route: string): boolean {
  return ROUTES[route]?.includes(role) ?? false;
}

/**
 * States the agent may set directly. `backlog` and `answered` are only reachable
 * through /linear/finalize, which enforces the Definition of Ready.
 */
export const STATE_ALLOWLIST: Record<Role, StateKey[]> = {
  product: ["needsInfo", "needsApproval"],
};

/** An approval is a whole message made of one approval word, written by an allowlisted Linear user. */
export function isApproval(
  text: string,
  authorId: string | undefined,
  approvals: { approvers: string[]; words: string[] },
): boolean {
  if (!authorId || !approvals.approvers.includes(authorId)) return false;
  const normalized = text
    .toLowerCase()
    .replace(/[.!¡?¿,;:\s]+$/g, "")
    .replace(/^[\s¡¿]+/, "")
    .trim();
  return approvals.words.includes(normalized);
}

/**
 * Definition of Ready. Returns the headings missing from the description
 * (`## Heading`, case-insensitive). "Original request" is always required, so the
 * stakeholder's own words are never lost.
 */
export function missingSections(description: string, required: string[], originalTitle = "Original request"): string[] {
  const headings = new Set(
    [...description.matchAll(/^#{2,3}\s+(.+?)\s*$/gm)].map((m) => m[1].toLowerCase()),
  );
  const collapsibles = new Set(
    [...description.matchAll(/^\+\+\+\s*(.+?)\s*$/gm)].map((m) => m[1].toLowerCase()),
  );
  const original = originalTitle.toLowerCase();
  const hasOriginal = collapsibles.has(original) || headings.has(original);
  const missing = required.filter((h) => !headings.has(h.toLowerCase()));
  return hasOriginal ? missing : [...missing, originalTitle];
}

export type LabelInfo = { id: string; name: string; description: string | null };

/**
 * Extra labels the agent asks for (tenant, area…). Any label that already exists
 * can be used; the agent never creates labels. Labels the bridge manages itself
 * (type labels and hotfix) are refused here: they follow the type and the hotfix flag.
 */
export function resolveExtraLabels(
  requested: string[],
  available: LabelInfo[],
  managedNames: string[],
): { ids: string[]; unknown: string[]; managed: string[] } {
  const byName = new Map(available.map((l) => [l.name.toLowerCase(), l]));
  const managedSet = new Set(managedNames.map((n) => n.toLowerCase()));
  const ids = new Set<string>();
  const unknown: string[] = [];
  const managed: string[] = [];
  for (const raw of requested) {
    const name = raw.trim();
    if (!name) continue;
    if (managedSet.has(name.toLowerCase())) managed.push(name);
    else if (byName.has(name.toLowerCase())) ids.add(byName.get(name.toLowerCase())!.id);
    else unknown.push(name);
  }
  return { ids: [...ids], unknown, managed };
}

/** Final state for each request type once it passes the Definition of Ready. */
export function finalStateFor(type: RequestType): StateKey {
  return type === "question" ? "answered" : "backlog";
}

const BRANCH_SAFE = /^[a-z0-9][a-z0-9._/-]*$/;

/** The agent may only push `<prefix><issue>-<slug>` design branches, never a protected branch. */
export function isAllowedBranch(branch: string, prefix: string, protectedBranches: string[]): boolean {
  return (
    branch.startsWith(prefix) &&
    branch.length > prefix.length &&
    !protectedBranches.includes(branch) &&
    BRANCH_SAFE.test(branch) &&
    !branch.includes("..")
  );
}

/** Linear-hosted uploads only: the bridge never fetches arbitrary URLs with its token. */
export function isLinearUpload(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "uploads.linear.app";
  } catch {
    return false;
  }
}
