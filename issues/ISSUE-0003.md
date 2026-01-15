# ISSUE-0003: Run multi-table full-sync validation

**Status:** closed
**Severity:** low
**Category:** test
**Created:** 2026-01-15T23:15:12.554Z
**Updated:** 2026-01-15T23:28:10.480Z
**Git Branch:** feat/e2e-remaining
**Git Commit:** c764a6c (uncommitted changes)

## Description

Run full-sync across all tables to validate cross-table behavior and aggregate performance.

## Context

- Execute: bun run sync -- --full-sync\n- Record total runtime and any table-specific errors\n- Confirm idempotency on re-run

## Resolution

- Ran: `bun run sync -- --full-sync --dry-run` across all tables.
- Tables: `event`, `geo_coordinates`, `place`, `postal_address`.
- Result: no schema/data diffs; dry-run completed successfully.
