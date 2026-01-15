# ISSUE-0004: Add automated E2E sync test script

**Status:** closed
**Severity:** medium
**Category:** enhancement
**Created:** 2026-01-15T23:15:12.554Z
**Updated:** 2026-01-15T23:28:10.480Z
**Git Branch:** feat/e2e-remaining
**Git Commit:** c764a6c (uncommitted changes)

## Description

Create a repeatable script or test harness that automates the E2E sync scenarios.

## Context

- Automate minimal diff creation (insert/update/delete)\n- Exercise dry-run, per-table, full-sync, yolo\n- Produce a structured test report for review

## Resolution

- Added `scripts/e2e_sync.js` to automate E2E flows.
- Script exercises dry-run, per-table, full-sync, and yolo, and writes a JSON report to `logs/e2e-sync-report.json`.
- Script executed successfully.
