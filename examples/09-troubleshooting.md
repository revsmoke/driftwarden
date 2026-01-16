# Troubleshooting checks

Verify a config file exists:

```bash
test -f config/config.json && echo "config OK"
```

Check sync with a dry‑run:

```bash
bun run sync -- --dry-run
```

Scope to a single table:

```bash
bun run sync -- --tables postal_address --dry-run
```

List issues if errors are logged:

```bash
bun run issues
```
