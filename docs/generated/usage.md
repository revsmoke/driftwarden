# Driftwarden Usage Guide

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd driftwarden

# Install dependencies
bun install
```

## Configuration

### Create Config File

Copy the example configuration and customize for your environment:

```bash
cp config/config.json.example config/config.json
```

### Config File Structure

```json
{
  "ssh": {
    "host": "your-server.com",
    "port": 22,
    "user": "ssh-user",
    "privateKeyPath": "/path/to/private/key",
    "passphrase": ""
  },
  "tunnel": {
    "localPort": 33306,
    "remoteHost": "127.0.0.1",
    "remotePort": 3306
  },
  "remote": {
    "mysql": {
      "host": "127.0.0.1",
      "port": 3306,
      "user": "driftwarden_ro",
      "password": "db_password",
      "database": "production_db"
    }
  },
  "local": {
    "mysql": {
      "host": "127.0.0.1",
      "port": 3306,
      "user": "local_user",
      "password": "local_password",
      "database": "local_db"
    }
  },
  "sync": {
    "tables": [],
    "chunkSize": 1000,
    "confirm": true,
    "yolo": false
  },
  "retry": {
    "maxAttempts": 3,
    "baseDelayMs": 1000,
    "maxDelayMs": 30000,
    "multiplier": 2
  },
  "logging": {
    "level": "INFO",
    "activityLog": "logs/activity.log",
    "errorLog": "logs/error.log"
  }
}
```

### Configuration Options

#### SSH Settings
| Field | Description | Required |
|-------|-------------|----------|
| `host` | SSH server hostname | Yes |
| `port` | SSH server port | Yes (default: 22) |
| `user` | SSH username | Yes |
| `privateKeyPath` | Path to SSH private key | Yes |
| `passphrase` | Key passphrase (if encrypted) | No |

#### Tunnel Settings
| Field | Description | Required |
|-------|-------------|----------|
| `localPort` | Local port for tunnel | Yes |
| `remoteHost` | Remote MySQL host (from SSH server perspective) | Yes |
| `remotePort` | Remote MySQL port | Yes |

#### MySQL Settings (remote & local)
| Field | Description | Required |
|-------|-------------|----------|
| `host` | MySQL server hostname | Yes |
| `port` | MySQL server port | Yes |
| `user` | MySQL username | Yes |
| `password` | MySQL password | Yes |
| `database` | Database name | Yes |

**⚠️ Security Best Practice:** For `remote.mysql.user`, use a dedicated **read-only MySQL user** (e.g., `driftwarden_ro`). This provides database-level protection against accidental writes, complementing Driftwarden's application-level read-only enforcement. See the [Remote Database Protection](#remote-database-protection) section for setup instructions.

#### Sync Settings
| Field | Description | Default |
|-------|-------------|---------|
| `tables` | Array of tables to sync (empty = all) | `[]` |
| `chunkSize` | Rows per batch for large tables | `1000` |
| `confirm` | Require confirmation for changes | `true` |
| `yolo` | Auto-accept all changes | `false` |

#### Retry Settings
| Field | Description | Default |
|-------|-------------|---------|
| `maxAttempts` | Maximum retry attempts | `3` |
| `baseDelayMs` | Initial retry delay (ms) | `1000` |
| `maxDelayMs` | Maximum retry delay (ms) | `30000` |
| `multiplier` | Backoff multiplier | `2` |

#### Logging Settings
| Field | Description | Default |
|-------|-------------|---------|
| `level` | Log level (DEBUG, INFO, WARN, ERROR) | `INFO` |
| `activityLog` | Path to activity log file | `null` |
| `errorLog` | Path to error log file | `null` |

## Commands

### Sync Command

Synchronize remote database to local:

```bash
# Basic sync (all tables, with confirmation)
bun run sync

# With explicit config path
bun run sync -- --config config/config.json

# Sync specific tables only
bun run sync -- --tables users,orders,products

# Auto-accept all changes (YOLO mode)
bun run sync -- --yolo

# Preview changes without applying (dry-run)
bun run sync -- --dry-run
# Force full comparison (detect deletes)
bun run sync -- --full-sync

# Combine options
bun run sync -- --tables users --dry-run
```

### Issues Command

View tracked issues:

```bash
bun run issues
```

### Help & Version

```bash
# Show help
bun run sync -- --help

# Show version
bun run sync -- --version
```

## CLI Options

| Option | Short | Description |
|--------|-------|-------------|
| `--config` | `-c` | Path to config file |
| `--tables` | `-t` | Comma-separated list of tables |
| `--yolo` | | Auto-accept all changes (including destructive) |
| `--per-table` | | Confirm changes table-by-table |
| `--dry-run` | | Preview only, no changes applied |
| `--full-sync` | | Force full comparison (detect deletes), disables incremental sync |
| `--help` | `-h` | Show help message |
| `--version` | `-v` | Show version |

## Workflow Examples

### Daily Development Sync

```bash
# Preview what would change
bun run sync -- --dry-run

# Apply changes with confirmation
bun run sync
```

### Sync Specific Tables

```bash
# Only sync user-related tables
bun run sync -- --tables users,user_profiles,user_settings
```

### Fast Sync (Experienced Users)

```bash
# Skip confirmation prompts
bun run sync -- --yolo
```

### Debug Connection Issues

```bash
# Enable debug logging in config
# Set logging.level to "DEBUG"
bun run sync -- --dry-run
```

## Confirmation Flow

When `--yolo` is not set, Driftwarden displays proposed changes and asks for confirmation:

1. **Schema changes** are shown first (new tables, column additions/modifications)
2. **Data changes** are shown next (inserts, updates, deletes per table)
3. **Destructive changes** require explicit "CONFIRM" if detected
4. User can approve all changes or cancel
5. Only approved changes are applied

### Destructive Change Confirmation

Certain operations are flagged as destructive and require typing "CONFIRM" to proceed:

- **Column removals**: Dropping columns causes permanent data loss
- **Full table replacements**: Tables without primary keys are fully replaced
- **Large deletes**: Deleting 100+ rows from a single table

Example destructive warning:
```
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
           ⚠️  DESTRUCTIVE CHANGES DETECTED
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

📛 COLUMN REMOVALS (data will be permanently deleted):
   • users: dropping columns [legacy_field, old_status]

🗑️  LARGE DELETES (100+ rows):
   • logs: deleting 1500 rows

!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

Type "CONFIRM" to proceed with destructive changes:
```

### Per-Table Confirmation

Use `--per-table` to approve changes for each table individually:

```bash
bun run sync -- --per-table
```

This prompts for each table separately:
```
Apply changes to users? (15 inserts, 3 updates) [y/N]:
Apply changes to orders? (100 inserts, 0 updates, 5 deletes) [y/N]:
```

### Standard Confirmation

Example output:
```
=== Schema Changes ===
Table: users
  + ADD COLUMN email_verified BOOLEAN DEFAULT false

=== Data Changes ===
Table: orders
  INSERT: 15 rows
  UPDATE: 3 rows
  DELETE: 0 rows

Apply these changes? [y/N]
```

## Safety Features

### Remote Database Protection
- Remote database is **read-only**
- Only SELECT, SHOW, DESCRIBE, EXPLAIN queries allowed
- No INSERT, UPDATE, DELETE, ALTER, DROP, CREATE, TRUNCATE

**Recommended: Use a read-only MySQL user for remote connections**

For maximum safety, create a dedicated read-only MySQL user on your production database:

```sql
-- Create a read-only user (run as MySQL admin)
CREATE USER 'driftwarden_ro'@'%' IDENTIFIED BY 'secure_password';

-- Grant SELECT-only access to the target database
GRANT SELECT ON production_db.* TO 'driftwarden_ro'@'%';

-- Optional: Restrict to specific tables
-- GRANT SELECT ON production_db.users TO 'driftwarden_ro'@'%';
-- GRANT SELECT ON production_db.orders TO 'driftwarden_ro'@'%';

-- Apply changes
FLUSH PRIVILEGES;
```

This provides defense-in-depth: even if Driftwarden's read-only enforcement were bypassed, the database user itself cannot modify data.

**Verifying read-only access:**
```bash
# Test that writes are blocked at the MySQL level
mysql -u driftwarden_ro -p production_db -e "DELETE FROM users LIMIT 0;"
# Expected: ERROR 1142 (42000): DELETE command denied
```

### Local Database Safety
- All changes require confirmation (unless `--yolo`)
- Changes are wrapped in transactions
- Automatic rollback on error
- Partial changes are prevented

### Connection Resilience
- Automatic retry with exponential backoff and jitter
- Query-level retry for transient MySQL errors
- SSH tunnel reconnection on failure
- Graceful handling of dropped connections
- Clear error messages with suggested fixes

### Incremental Sync

For tables with `updated_at` or `created_at` timestamp columns, Driftwarden uses incremental sync:

- Only fetches rows modified since the last sync
- Dramatically reduces data transfer for large tables
- Falls back to full comparison when timestamps unavailable
- Note: Incremental sync cannot detect remote deletions (use `--full-sync` if needed)

### Issue Tracking

Driftwarden automatically tracks issues in the `issues/` directory:

- Issues include git metadata (branch, commit hash)
- Useful for debugging and post-mortem analysis
- View issues with `bun run issues`

Example issue metadata:
```
**Git Branch:** feature/sync-improvements
**Git Commit:** a1b2c3d (uncommitted changes)
```

## Troubleshooting

### SSH Connection Failed
1. Verify SSH credentials in config
2. Check private key file exists and has correct permissions
3. Ensure remote host is reachable
4. Try increasing retry settings

### MySQL Connection Failed
1. Verify MySQL credentials
2. Check database exists
3. Ensure MySQL server is running
4. Verify tunnel configuration

### Config Validation Error
1. Check all required fields are present
2. Verify JSON syntax
3. Ensure file paths are correct

### View Issues
```bash
# List all tracked issues
bun run issues

# View specific issue
cat issues/ISSUE-0001.md
```

## Logging

Activity logs are written to the configured `activityLog` path in JSON lines format:

```json
{"timestamp":"2024-01-15T10:30:00.000Z","event":"sync_start","data":{"tables":["users"]}}
{"timestamp":"2024-01-15T10:30:05.000Z","event":"sync_complete","data":{"success":true}}
```

Error logs include stack traces for debugging:

```json
{"timestamp":"2024-01-15T10:30:02.000Z","level":"ERROR","message":"Connection failed","error":"ETIMEDOUT"}
```
