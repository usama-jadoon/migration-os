# IMAP MVP Implementation

This document describes the architectural changes, database reliability models, and connector implementations introduced for the MigrationOS local IMAP-to-IMAP email migration MVP.

## 1. Unified Connector Contract

We introduced a canonical `MigrationConnector` interface inside [connector.interface.ts](file:///D:/Usama%20Data/All%20Software/migration-os/apps/api/src/types/connector.interface.ts):

- `authenticate()`: Connects and log in.
- `testConnection()`: Tests authentication settings.
- `listFolders()`: Lists mailboxes with message counts.
- `createFolder(path)`: Discovers or creates destination directories.
- `listMessages(path, options)`: Returns paginated sequence of universal messages.
- `importMessage(msg, path)`: Appends message to folder, returning `ImportResult` (with success, message ID, and/or errors).
- `disconnect()`: Cleanly log out and close sockets.

All providers (IMAP, Google, Microsoft) implement this contract.

## 2. Hardened IMAP Connector

The [ImapConnector](file:///D:/Usama%20Data/All%20Software/migration-os/apps/api/src/connectors/imap.connector.ts) wraps the `imapflow` library to deliver enterprise-ready capabilities:

- **Robust Sequence Processing**: Messages are retrieved using UID ranges and sequence index page tokens, avoiding full-mailbox memory load bottlenecks.
- **TLS Secure Tunneling**: Fully supports encrypted connections.
- **Clean Disconnects**: `disconnect()` handles logouts in `finally` blocks, resolving connection leakage.
- **Transient Fault Tolerance**: Exponential backoff retries transient failures.

## 3. Database State Machine

We upgraded the database schema with reliability tables to make it the single source of truth:

- `FolderMapping`: Manages folder paths, enabled settings, and custom target folder names.
- `MigrationCheckpoint`: Persists current folders, offsets, and last processed UIDs.
- `MigratedItem`: Keeps a record of already migrated emails to enforce idempotency.
- `MigrationEvent`: Records configuration status edits.
- `AuditLog`: Enforces administrator auditing.

Supported migration statuses: `draft`, `validating`, `ready`, `queued`, `running`, `paused`, `cancelling`, `cancelled`, `completed`, `completed_with_errors`, `failed`.
All actions (start, pause, resume, cancel) validate state transitions.

## 4. Resume & Idempotency Engine

- **Checkpointing**: After each page batch is fetched and appended, the progress state (`lastProcessedUid` and counts) is written to `MigrationCheckpoint`. If interrupted, the worker re-queries this table to resume where it left off.
- **Idempotency Key**: Generated using a SHA-256 hash of:
  - `migrationId`
  - `folderName`
  - `sourceItemId` (UID)
  - `internetMessageId`
  - `messageSize`
  - `receivedDate`
  Before each upload, `MigratedItem` is checked. If it is already migrated, the email is skipped, preventing duplicates.
- **State Yielding**: The worker queries the database between batches to check if status was updated to `paused` or `cancelled`, pausing or canceling execution dynamically.
