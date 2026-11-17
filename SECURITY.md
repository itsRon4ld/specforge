# Security

## Threat model

specforge feeds an agent text written by other people: stakeholder messages, screenshots, issue comments and repository content. Treat all of it as **untrusted input**. The design assumes the agent can be prompt-injected and limits what that achieves.

| Control | Effect |
|---|---|
| The agent holds no Linear or GitHub credentials | It acts only through the bridge's narrow API. |
| Role token + route matrix | Unknown routes are denied. |
| Definition of Ready in the bridge | An issue reaches the backlog only through `finalize`, with every required section present. |
| State allowlist | The agent can only park issues (`needsInfo`, `needsApproval`). Development states belong to humans. |
| Bridge-verified approvals | UX and redesign approval comes from an allowlisted Linear user id. Text that claims approval is ignored. |
| Branch policy | Only `design/*` branches are pushed. No PRs, never the base branch. |
| Job write scope | The agent can only change the issue of the job it is running and the sub-issues it created, and can only post in that job's session. Reading and searching the team stay open. |
| Upload guard | The bridge downloads only from `uploads.linear.app`. |
| Signed, fresh webhooks | Linear payloads need a valid HMAC and a timestamp no older than 60 s. |

Not covered:
- Personal data inside the stakeholder messages you paste. The agent is told to redact it, so review issues before you share them outside the team.
- Answers to questions are only as accurate as the codebase and knowledge base they come from. Their sources are always listed.

## Reporting a vulnerability

Please open a private security advisory on GitHub (**Security → Report a vulnerability**) rather than a public issue.
