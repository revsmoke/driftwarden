# Contributing to Driftwarden

Thanks for helping improve Driftwarden. The project is optimized for personal use first, but contributions are welcome.

## Quickstart
- Install dependencies: `bun install`
- Run tests: `bun test`
- Run a dry-run sync: `bun run sync -- --dry-run` (requires `config/config.json`)

## Reporting issues
- Prefer GitHub issues as the source of truth.
- If you’re working offline, add a file under `issues/ISSUE-XXXX.md` and sync it to GitHub later.
- Include: environment, steps to reproduce, expected vs actual, and relevant logs.

## Proposing changes
- Open or comment on an issue before starting work.
- Keep PRs small and focused.
- Update docs and examples when behavior changes.
- Add tests when you change behavior or fix a bug.

## Labels (recommended)
Type: `type/bug`, `type/feature`, `type/docs`, `type/test`, `type/chore`
Priority: `priority/p0`, `priority/p1`, `priority/p2`, `priority/p3`
Area: `area/cli`, `area/db`, `area/diff`, `area/schema`, `area/docs`, `area/tests`
Status: `status/blocked`, `status/needs-info`, `status/ready`

## Milestones
- Use milestones for versions (e.g., `v0.2`) or quarters (e.g., `2026-Q1`).
- Roadmap items should be tied to milestones where possible.

## Development conventions
- JavaScript only (no TypeScript).
- Primary runtime is Bun.
- ES modules only (`type: module` in `package.json`).

## Safety rules
- Remote DB is read-only (no writes, ever).
- Local changes should be previewed and confirmed unless `--yolo` is intentionally used.
