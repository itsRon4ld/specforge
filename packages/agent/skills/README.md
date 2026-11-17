# Skills

Every folder here is a [Claude Code skill](https://docs.claude.com/en/docs/claude-code/skills) (`<name>/SKILL.md`). The runtime copies them into each job's `.claude/skills/`, so the agent can use them as project skills.

| Skill | Status | Used for |
|---|---|---|
| `enrich-requirement` | placeholder | Turning a rough request into a complete requirement (every request) |

Bring your team's own skills:

- **Replace** `enrich-requirement/SKILL.md` with your enrichment process.
- **Add** more skills, for example a `redesign` skill with your design system rules, which the agent uses for `redesign` requests.
- Or mount a folder of skills at runtime and point `SKILLS_DIR` at it, so your private skills stay out of this repository.
