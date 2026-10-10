# SHark Repository Guide

## Architecture

SHark is a pnpm monorepo for a self-hosted iPhone notification service:

- `apps/website/`: Hono server plus web dashboard.
- `apps/expo/`: Expo/iOS client and widgets.
- `packages/sharkctl/`: Node.js 22+ command-line client.
- `packages/shark-broker/`: private Node.js 22.13+ durable host reply broker (`sharkd`).
- `packages/contracts/`: shared API contracts.
- `packages/website-runtime/`: website runtime support.
- `skills/shark/`: installable agent skill.
- `deploy/`: production deployment and backup scripts; see `deploy/README.md` and `docs/operations.md` before operational changes.

The repository is a minimally rebranded Hark fork. Preserve protocol-compatibility identifiers such as `HARK_*`, token prefixes, API routes, and local config paths unless a migration is explicitly planned.

## Tooling and Conventions

- Package manager: `pnpm@11.10.0`.
- Runtime: Node.js 22 or newer.
- Formatting/linting: Biome.
- Treat credentials, webhook URLs, device tokens, and token prefixes/metadata as sensitive. Tests must use synthetic values; never print live secrets while debugging.

## Versioning

SHark has one product version, taken from the root `package.json`. Every workspace and integration
`package.json`, the macOS `MARKETING_VERSION` (`apps/macos/project.yml` and the generated Xcode
project), `sharkd`'s Codex `clientInfo` version, and the skill (`metadata.version` in
`skills/shark/SKILL.md` plus its "skill version … reviewed with `sharkctl` …" line) must match it.
To release, change all of them in one commit, run `pnpm macos:generate`, then `pnpm version:check`
(also run in CI). Build numbers (`CURRENT_PROJECT_VERSION`, EAS remote iOS build numbers) stay
monotonic and are not tied to the version. Protocol and schema versions, such as `sharkd`'s
`API_VERSION`, store `user_version`, and OpenAPI/MCP API versions, are separate and do not follow it.

The iOS app version in `apps/expo/app.config.ts` is held at `1.0.0` because a store-distribution
EAS build was made at that version and App Store Connect rejects lower versions; `HELD_VERSIONS` in
`scripts/check-versions.mjs` allows that until the product version reaches it.

An installed copy of the skill identifies its release through its frontmatter `metadata.version`.

## Validation

Run the narrowest relevant check first, then broaden when practical:

```sh
pnpm --filter sharkctl test
pnpm --filter sharkctl build
pnpm --filter @hark/shark-broker test
pnpm --filter @hark/shark-broker build
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
