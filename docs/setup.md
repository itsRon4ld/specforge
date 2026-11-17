# Setup

Allow about 15 minutes. You need admin access to the Linear workspace and access to the product's GitHub repository.

## 1. Configure

```bash
git clone https://github.com/itsRon4ld/specforge && cd specforge
cp .env.example .env
cp config.example.yaml config.yaml
```

In `config.yaml`:
- set the team key and the names of the states;
- create the five type labels (Feature, Bug, UX, Redesign, Question) in Linear and put their names in `linear.labels`;
- add your Linear user id as an approver;
- create an issue such as *"Knowledge base"* and set its identifier as `knowledgeIssue`.

## 2. Linear agent

1. In Linear, go to **Settings → API → OAuth applications → New**.
   - **Name / icon:** what your team will see, for example *specforge*.
   - **Callback URL:** `http://localhost:8765/callback`.
   - **Webhooks:** on. URL `https://<your-bridge>/hooks/linear`. Category **Agent session events**.
2. Install it as an agent:
   ```bash
   LINEAR_CLIENT_ID=… LINEAR_CLIENT_SECRET=… pnpm setup:linear
   ```
3. Put `LINEAR_ACCESS_TOKEN` and the webhook signing secret (`LINEAR_WEBHOOK_SECRET`) in `.env`.

## 3. GitHub

- **`REPO_CLONE_URL`:** a read-only clone of the product codebase, using a deploy key or a fine-grained token with *Contents: read*.
- **Branches:** set `github.branches.development` (for example `dev`) and `github.branches.production` (for example `main`). With a single branch, use the same name for both.
- **`GITHUB_TOKEN`** (bridge only): *Contents: read & write*, so it can push `design/*` branches. If you don't want redesign branches, a read-only token is enough; branch pushes will then fail cleanly.

## 4. Your skills

Replace `packages/agent/skills/enrich-requirement/SKILL.md` with your team's enrichment process, and add any other skills you use, such as a redesign skill.

The recommended way is to keep them **in your product repo**, for example under `infra/specforge/{skills,templates,context.md}`, and set `agent.skillsPath`, `templatesPath` and `contextPath`. They are versioned with your code, reviewed in PRs and stay private. Alternatively, mount a folder and set `SKILLS_DIR` / `TEMPLATES_DIR` / `CONTEXT_FILE`.

## 5. Run

```bash
echo "PRODUCT_TOKEN=$(openssl rand -hex 32)" >> .env   # plus ANTHROPIC_API_KEY
docker compose up -d --build
```

Expose **only** `/hooks/linear` through your reverse proxy.

## 6. First request

1. Create an issue in the team and paste a stakeholder message into it, screenshots included.
2. Mention `@specforge` in a comment, or delegate the issue to it.
3. Answer its questions in the session. The issue then lands in **Backlog**, ready for your review.
