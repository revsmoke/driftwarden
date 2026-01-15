# ISSUE-0001: You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version

**Status:** open
**Severity:** medium
**Category:** error
**Created:** 2026-01-15T20:57:24.537Z
**Updated:** 2026-01-15T20:57:24.537Z
**Git Branch:** main
**Git Commit:** 168359f (uncommitted changes)

## Description

An error occurred during sync operation.

**Error Message:**
You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '??' at line 1

## Context

```json
{
  "command": "sync",
  "configPath": "config/config.json",
  "tables": "ALL",
  "yolo": false,
  "dryRun": true,
  "errorName": "Error",
  "errorStack": "Error: You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '??' at line 1\n    at execute (/Users/twoedge/dev/driftwarden/node_modules/mysql2/lib/promise/connection.js:47:26)\n    at <anonymous> (/Users/twoedge/dev/driftwarden/src/db/remote-reader.js:91:46)\n    at <anonymous> (/Users/twoedge/dev/driftwarden/src/db/remote-reader.js:89:7)\n    at withRetry (/Users/twoedge/dev/driftwarden/src/utils/retry.js:75:20)\n    at withRetry (/Users/twoedge/dev/driftwarden/src/utils/retry.js:59:33)\n    at query (/Users/twoedge/dev/driftwarden/src/db/remote-reader.js:85:15)\n    at getTableSchema (/Users/twoedge/dev/driftwarden/src/db/remote-reader.js:119:32)\n    at getTableSchema (/Users/twoedge/dev/driftwarden/src/db/remote-reader.js:117:24)\n    at compareAllSchemas (/Users/twoedge/dev/driftwarden/src/diff/schema-diff.js:235:45)"
}
```
