# ISSUE-0003: Run multi-table full-sync validation

**Status:** open
**Severity:** low
**Category:** test
**Created:** 2026-01-15T23:15:12.554Z
**Updated:** 2026-01-15T23:15:12.554Z
**Git Branch:** main
**Git Commit:** 0408ce4 (uncommitted changes)

## Description

Run full-sync across all tables to validate cross-table behavior and aggregate performance.

## Context

- Execute: bun run sync -- --full-sync\n- Record total runtime and any table-specific errors\n- Confirm idempotency on re-run
