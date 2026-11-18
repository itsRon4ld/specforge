/**
 * Clone credentials are fine-grained tokens embedded in the clone URLs. They
 * expire, so the runtime warns before they do and explains clearly when access fails.
 */

export type RepoKind = "product" | "setup";

const ENV_VAR: Record<RepoKind, string> = { product: "REPO_CLONE_URL", setup: "SETUP_REPO_URL" };

/** Raised when a repository cannot be cloned or fetched; the message never contains the token. */
export class RepoAccessError extends Error {
  kind: RepoKind;
  constructor(kind: RepoKind) {
    super(
      `I couldn't access the ${kind} repository. The read-only token in ${ENV_VAR[kind]} has probably ` +
        "expired or lost access to the repository. Renew it, restart the agent, and mention me again.",
    );
    this.kind = kind;
  }
}

/** Extracts the token from `https://x-access-token:<token>@github.com/...` or `https://<token>@github.com/...`. */
export function tokenFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com") return null;
    return decodeURIComponent(u.password || u.username) || null;
  } catch {
    return null;
  }
}

/** GitHub reports a token's expiry in the `github-authentication-token-expiration` header. */
export async function tokenExpiry(token: string): Promise<Date | null> {
  try {
    const res = await fetch("https://api.github.com/rate_limit", { headers: { Authorization: `Bearer ${token}` } });
    const header = res.headers.get("github-authentication-token-expiration");
    if (!header) return null; // no expiry, or not a fine-grained/classic PAT
    const date = new Date(header.replace(" UTC", "Z").replace(" ", "T"));
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null; // never block a job on this check
  }
}

const WARN_DAYS = 7;
const DAY_MS = 86_400_000;
const cache = new Map<string, { checkedAt: number; expiry: Date | null }>();

/** Human-readable warnings for clone tokens expiring within 7 days (checked at most once a day). */
export async function expiryWarnings(now = Date.now()): Promise<string[]> {
  const warnings: string[] = [];
  for (const kind of ["product", "setup"] as RepoKind[]) {
    const token = tokenFromUrl(process.env[ENV_VAR[kind]]);
    if (!token) continue;
    let entry = cache.get(kind);
    if (!entry || now - entry.checkedAt > DAY_MS) {
      entry = { checkedAt: now, expiry: await tokenExpiry(token) };
      cache.set(kind, entry);
    }
    if (!entry.expiry) continue;
    const days = Math.ceil((entry.expiry.getTime() - now) / DAY_MS);
    if (days <= WARN_DAYS) {
      warnings.push(
        days <= 0
          ? `The read-only token in ${ENV_VAR[kind]} (${kind} repository) has expired.`
          : `The read-only token in ${ENV_VAR[kind]} (${kind} repository) expires in ${days} day(s), on ${entry.expiry.toISOString().slice(0, 10)}. Renew it to avoid interruptions.`,
      );
    }
  }
  return warnings;
}
