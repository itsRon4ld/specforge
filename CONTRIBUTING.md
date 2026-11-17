# Contributing

Thanks for helping. Please open an issue to discuss a feature before sending a large PR.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
```

Node 24+ runs the TypeScript sources directly. Keep the code within [erasable syntax](https://www.typescriptlang.org/tsconfig/#erasableSyntaxOnly).

## Guidelines

- **Policy lives in the bridge.** New agent capabilities go through a bridge route that is listed in the matrix in `security.ts`, and come with a test.
- **Instructions, templates and skills are behavior.** Changes to `packages/agent/instructions`, `templates` or `skills` change what the agent produces. Show a before/after example in the PR.
- **Templates and readiness move together.** If you change a template heading, update `DEFAULT_READINESS` and `config.example.yaml` too.
- **Conventional commits:** `feat(bridge): …`, `fix(agent): …`, `docs: …`.
