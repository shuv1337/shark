# SHark Repository Guide

## Architecture

SHark is a pnpm monorepo for a self-hosted iPhone notification service:

- `apps/website/`: Hono server plus web dashboard.
- `apps/expo/`: Expo/iOS client and widgets.
- `packages/sharkctl/`: Node.js 22+ command-line client.
- `packages/contracts/`: shared API contracts.
- `packages/website-runtime/`: website runtime support.
- `skills/shark/`: installable agent skill.
- `deploy/`: production deployment and backup scripts; see `deploy/README.md` and `docs/operations.md` before operational changes.

The repository is a minimally rebranded Hark fork. Preserve protocol-compatibility identifiers such as `HARK_*`, token prefixes, API routes, and local config paths unless a migration is explicitly planned.

## Tooling and Conventions

- Package manager: `pnpm@11.10.0`.
- Runtime: Node.js 22 or newer.
- Formatting/linting: Biome.
- Version control: use Jujutsu (`jj`) for local work.
- Treat credentials, webhook URLs, device tokens, and token prefixes/metadata as sensitive. Tests must use synthetic values; never print live secrets while debugging.

## Validation

Run the narrowest relevant check first, then broaden when practical:

```sh
pnpm --filter sharkctl test
pnpm --filter sharkctl build
pnpm typecheck
pnpm test
pnpm lint
pnpm brand:check
```

For a single Node test name, invoke Node directly because the package test script does not forward `--test-name-pattern` after a bare `--`:

```sh
node --test --test-name-pattern='pattern' packages/sharkctl/test/cli.test.mjs
```

## Operational Notes

- Production is the personal noncommercial service at `https://shark.shuv.dev`.
- Review `docs/operations.md`, `docs/provisioning-gates.md`, and `docs/verification.md` before deploy, secret, backup, or production verification work.
- Do not send a real notification or mutate a Live Activity during tests unless the user explicitly authorizes it.
