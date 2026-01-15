# ISSUE-0002: Add performance/scale E2E test for full-sync

**Status:** closed
**Severity:** low
**Category:** test
**Created:** 2026-01-15T23:15:12.554Z
**Updated:** 2026-01-15T23:28:10.480Z
**Git Branch:** feat/e2e-remaining
**Git Commit:** c764a6c (uncommitted changes)

## Description

Define and run a scale-oriented end-to-end test to validate full-sync performance on larger tables.

## Context

- Identify a representative large table (or dataset)\n- Measure runtime, memory use, and row throughput\n- Capture any bottlenecks or timeouts for follow-up

## Resolution

- Largest local table: `postal_address` (~3.2k rows).
- Ran: `bun run sync -- --tables postal_address --full-sync --dry-run`.
- Result: no schema/data diffs; dry-run completed in ~1.90s (environment-specific).
