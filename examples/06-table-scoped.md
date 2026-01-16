# Table‑scoped sync

Sync only specific tables:

```bash
bun run sync -- --tables users,orders,postal_address
```

Combine with other flags as needed:

```bash
bun run sync -- --tables postal_address --full-sync --dry-run
```
