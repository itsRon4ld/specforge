---
name: enrich-requirement
description: Turn a rough product request into a complete, unambiguous requirement. Use on every request before filling the issue template.
---

# Enrich a requirement

> **Placeholder.** Replace this file with your team's own enrichment skill. specforge
> loads every skill under `skills/` (or `SKILLS_DIR`) as a Claude Code project skill.

## 1. Restate the problem

- Rewrite the request as a problem, not a solution: "Coordinators can't tell which students are missing documents", not "add a filter".
- Name the user (role and context) and the outcome they want.
- If the request already prescribes a solution, keep it as a proposal and still state the underlying problem.

## 2. Fill the gaps

Check every request against this list. Any item you cannot answer is either a question for the PM or an explicit assumption.

- **Who:** which roles, customers or tenants. Is it everyone or a segment?
- **When / where:** which screen, flow, device or environment.
- **Success:** how we will know it works, as observable behavior.
- **Edge cases:** empty data, permissions, errors, large volumes, concurrent edits.
- **Constraints:** deadlines, legal or compliance needs, existing commitments.
- **Dependencies:** other teams, integrations, data that must exist first.

## 3. Write acceptance criteria

- Use Given / When / Then, one behavior per criterion.
- Each criterion must be verifiable by a test or a demo. Avoid "fast", "intuitive" and "better".
- Cover the happy path, at least one edge case and at least one error case.

## 4. Size and split (INVEST)

A good issue is Independent, Negotiable, Valuable, Estimable, Small and Testable. If it is not Small, split it by user-visible slices (by role, by step of the flow, or by data subset), never by technical layer.

## 5. Ground it in the codebase

- Find the screens, endpoints and models involved, and name the files.
- Say whether the capability exists, partially exists or is new.
- Flag risky areas: shared components, migrations, permissions.
