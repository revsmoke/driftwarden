# Agent Build Instructions — Driftwarden

## Setup
```bash
bun install
```
## Run
## Run (once CLI is implemented)
```bash
bun run sync -- --help
bun run sync -- --dry-run
bun run sync -- --config config/config.json --tables users,orders
bun run issues
```

## Tests
```bash
bun test
```

## Notes
- JavaScript only (no TypeScript)
- Primary runtime: Bun
- Update this file if commands change
- Commits and pushes are allowed; use conventional commits and include `Co-Authored-By: Warp <agent@warp.dev>`

