# Full‑sync (detect deletes/inserts)

Disable incremental sync and compare full table contents:

```bash
bun run sync -- --full-sync
```

This detects local‑only rows (deletes) and remote‑only rows (inserts), but can be slower.
