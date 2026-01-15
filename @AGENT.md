# Agent Build Instructions — Driftwarden

## Setup
```bash
bun install
```

## Run (once CLI is implemented)
```bash
bun run sync -- --config config/config.json --tables users,orders
```

## Tests
```bash
bun test
```

## Notes
- JavaScript only (no TypeScript)
- Primary runtime: Bun
- Update this file if commands change

