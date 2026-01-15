# Driftwarden Architecture

## Overview

Driftwarden is a MySQL schema and data synchronization tool that keeps local databases synchronized with remote production databases via SSH tunnels.

## Core Principles

1. **Remote Read-Only**: Remote database access is strictly read-only. No INSERT, UPDATE, DELETE, ALTER, or DROP operations are ever executed remotely.

2. **Confirmation Required**: All local database modifications require explicit user confirmation unless `--yolo` mode is enabled.

3. **Incremental Updates**: Prefers merge-style updates using primary keys and timestamps over drop/recreate operations.

## System Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   CLI Layer     │────▶│   Sync Engine   │────▶│   DB Readers/   │
│  (src/cli.js)   │     │                 │     │   Writers       │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  SSH Tunnel     │────▶│   Diff Engine   │────▶│   Change        │
│  Manager        │     │ (Schema + Data) │     │   Executor      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Component Details

### CLI Layer (`src/cli.js`)
- Entry point for all operations
- Argument parsing and validation
- Orchestrates sync workflow
- Commands: `sync`, `issues`

### Config System (`src/config/loader.js`)
- JSON-based configuration
- Schema validation
- SSH key file verification
- Default value application

### SSH Tunnel Manager (`src/tunnel/ssh-tunnel.js`)
- Establishes secure tunnels to remote servers
- Connection keepalive and timeout handling
- Retry with exponential backoff
- Graceful connection cleanup

### Remote Reader (`src/db/remote-reader.js`)
- **Strictly read-only** - validates all queries
- Whitelist: SELECT, SHOW, DESCRIBE, EXPLAIN
- Throws on any write operation attempt
- Chunked data retrieval for large tables

### Local Writer (`src/db/local-writer.js`)
- Full CRUD operations on local database
- Transaction support (begin, commit, rollback)
- Batch operations for performance
- Schema modification execution

### Schema Diff (`src/diff/schema-diff.js`)
- Compares table structures between databases
- Detects: added/modified/removed columns
- Detects: added/removed indexes
- Generates ALTER TABLE SQL statements

### Data Diff (`src/diff/data-diff.js`)
- Row-by-row comparison using primary keys
- Supports incremental sync with `updated_at`/`created_at`
- Handles tables without primary keys (requires full approval)
- Generates INSERT/UPDATE/DELETE operations

### Preview UI (`src/ui/preview.js`)
- Formatted change display
- Interactive confirmation prompts
- Bulk or per-table approval
- YOLO mode bypass
- Dry-run mode support

### Change Executor (`src/executor/change-executor.js`)
- Applies schema changes first
- Data changes wrapped in transactions
- Rollback on error
- Execution summary reporting

### Retry Utility (`src/utils/retry.js`)
- Exponential backoff with jitter
- Configurable retry limits
- Retryable error detection
- Circuit breaker pattern

### Logger (`src/utils/logger.js`)
- Timestamped console output
- File-based activity logging (JSON lines)
- Error logging with stack traces
- Structured sync event logging

### Issue Tracker (`src/issues/tracker.js`)
- Persistent markdown issue records
- Auto-incrementing issue IDs
- Error-to-issue conversion
- Resolution tracking

## Data Flow

### Sync Operation

1. **Load Config** → Validate and apply defaults
2. **Establish SSH Tunnel** → Secure connection to remote
3. **Connect Databases** → Remote (read-only) + Local
4. **Schema Diff** → Compare table structures
5. **Data Diff** → Compare row contents
6. **Preview Changes** → Display proposed modifications
7. **Confirm** → Get user approval (unless --yolo)
8. **Execute** → Apply changes to local only
9. **Cleanup** → Close connections

## Safety Mechanisms

### Remote Protection
```javascript
// src/db/remote-reader.js
const ALLOWED_KEYWORDS = ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'];
const FORBIDDEN_KEYWORDS = ['INSERT', 'UPDATE', 'DELETE', 'ALTER', 'DROP', 'CREATE', 'TRUNCATE'];
```

### Local Confirmation
- All writes display preview first
- User must type 'y' to confirm
- `--yolo` flag explicitly bypasses

### Transaction Safety
- Data changes wrapped in BEGIN/COMMIT
- Automatic ROLLBACK on error
- Partial changes prevented

## Configuration Schema

```json
{
  "ssh": { "host", "port", "user", "privateKeyPath" },
  "tunnel": { "localPort", "remoteHost", "remotePort" },
  "remote.mysql": { "host", "port", "user", "password", "database" },
  "local.mysql": { "host", "port", "user", "password", "database" },
  "sync": { "tables", "chunkSize", "confirm", "yolo" },
  "retry": { "maxAttempts", "baseDelayMs", "maxDelayMs", "multiplier" },
  "logging": { "level", "activityLog", "errorLog" }
}
```

## Error Handling

1. **Connection Errors** → Retry with backoff
2. **Query Errors** → Log and create issue
3. **Transaction Errors** → Rollback and report
4. **Config Errors** → Actionable error messages

## Testing Strategy

Tests cover:
- Config loading and validation
- Schema diff calculations
- SQL generation
- Retry/backoff logic
- CLI argument parsing
