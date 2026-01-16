# Driftwarden Examples

This folder contains concise, copy‑paste examples for each supported CLI use case.

## Index

- [01-basic-sync.md](01-basic-sync.md) — interactive sync (default)
- [02-dry-run.md](02-dry-run.md) — preview only
- [03-per-table.md](03-per-table.md) — confirm each table
- [04-yolo.md](04-yolo.md) — auto‑accept changes
- [05-full-sync.md](05-full-sync.md) — full comparison (detect deletes/inserts)
- [06-table-scoped.md](06-table-scoped.md) — target specific tables
- [07-custom-config.md](07-custom-config.md) — alternate config file
- [08-issues.md](08-issues.md) — list tracked issues
- [09-troubleshooting.md](09-troubleshooting.md) — common checks

## Safety reminders

- Remote database is **read‑only**.
- Local changes require confirmation unless `--yolo` is used.
- Use `--full-sync` to detect deletes; it is slower on large tables.
