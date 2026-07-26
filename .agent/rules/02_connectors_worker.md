# Connectors, Workers & Operations Rules

This workspace rule contains the implementation steps for connectors, migration workers, required states, error and duplication handling, testing, security, and verification commands.

---

## Implementation Stages (Part 2)

### Stage 3 — Frontend Verification
Verify these pages actually load:
* `/`
* `/dashboard`
* `/dashboard/new`
* Migration details page
* Provider connection page
* Mailbox mapping page
* Migration progress page
* Error report page

Verify the complete UI flow:
1. Create a migration.
2. Select source provider.
3. Select destination provider.
4. Enter or authorize credentials.
5. Test both connections.
6. Discover source mailboxes.
7. Map source and destination mailboxes.
8. Start migration.
9. View live progress.
10. Pause and resume the job.
11. Cancel the job.
12. Retry failed items.
13. View completion report.

Do not use a fake moving progress bar. Progress must come from actual worker events.

### Stage 4 — IMAP Connector First
Implement and stabilize IMAP before Google and Microsoft.
Use `imapflow` where appropriate.
The IMAP connector must support:
* Secure connection & connection timeout
* Authentication failure handling
* Folder & nested folder discovery
* Folder delimiter handling
* Message counting & UID-based pagination
* Raw MIME download & append
* Destination folder creation
* Read/unread flags & flagged status
* Original internal date where supported
* Graceful disconnect & rate limiting
* Retry with exponential backoff

Do not load an entire mailbox into memory. Messages must be processed in configurable batches of 50 messages. The connector must support a checkpoint cursor so interrupted jobs can resume.

### Stage 5 — Migration Worker
The migration worker must not contain provider-specific condition chains throughout the code. Use a connector factory:
```typescript
const source = connectorFactory.create(migration.sourceProvider, sourceCredentials);
const destination = connectorFactory.create(migration.destinationProvider, destinationCredentials);
```

Worker lifecycle:
1. Load migration.
2. Validate status.
3. Decrypt credentials.
4. Connect source & destination.
5. Discover folders & create mapping.
6. Calculate estimated item count.
7. Process folders in batches (checking pause/cancellation state between batches).
8. Save checkpoint after every successful batch.
9. Log failed items & retry transient failures.
10. Continue after non-fatal message failures.
11. Verify source and destination counts.
12. Mark status and disconnect all providers.
13. Remove temporary files.

Do not update the database after every individual message unless necessary. Use batched progress updates to reduce database load.

---

## Required Migration States & Duplicate Prevention

Use explicit states:
`draft`, `validating`, `ready`, `queued`, `running`, `paused`, `cancelling`, `cancelled`, `completed`, `completed_with_errors`, `failed`.

Even in local mode, store job state and checkpoints in the database. The in-memory queue may dispatch jobs, but the database remains the source of truth.

### Duplicate Prevention
Every imported message must have an idempotency key.
Possible inputs:
* Migration ID
* Source mailbox ID / folder ID
* Source UID
* Internet Message-ID
* Message size / received timestamp
* Content hash

Before importing, check whether the item was already completed. Restarting a migration must not duplicate successfully migrated messages.

---

## Failure Classification & Security

Classify errors as:
`authentication`, `authorization`, `rate_limit`, `network`, `source_not_found`, `destination_not_found`, `unsupported_item`, `message_too_large`, `invalid_mime`, `temporary_provider_error`, `permanent_provider_error`, `unknown`.

Retry only transient errors with exponential backoff. Do not retry permanent errors endlessly.

### Security Requirements
Never store passwords or OAuth tokens as plain text.
* Encrypt credentials at rest.
* Never log passwords, access tokens, or complete email bodies.
* Redact sensitive values from errors.
* Use least-privilege provider permissions.
* Delete temporary MIME files after processing.
* Add audit logs for connection, migration status changes, and API inputs validation.
* Prevent cross-tenant credentials access.
* Keep secrets outside source control (use `.env.example` with placeholders only).

---

## Google Workspace & Microsoft 365 Connectors

* Google Workspace: OAuth 2.0, refresh-token handling, Gmail API, label discovery, raw message retrieval/insertion, label mapping, rate-limit/token revocation handling. Build a proper authorization flow.
* Microsoft 365: Entra OAuth, Microsoft Graph, refresh-token, mail-folder discovery, message pagination, raw MIME retrieval/import, throttling handling. Preserve original dates and placement.

---

## Queue & Database Rules

* Abstraction interface:
```typescript
interface MigrationQueue {
  add(migrationId: string): Promise<void>;
  pause(migrationId: string): Promise<void>;
  resume(migrationId: string): Promise<void>;
  cancel(migrationId: string): Promise<void>;
  getState(migrationId: string): Promise<JobState>;
}
```
* Databases SQLite locally, PostgreSQL for production. Keep them model-compatible.
* Required records: `ProviderConnection`, `Migration`, `MailboxMapping`, `FolderMapping`, `MigrationCheckpoint`, `MigratedItem`, `MigrationError`, `MigrationEvent`, `AuditLog`. Do not store email bodies.

---

## Testing & Verification Commands

Automated unit, integration (IMAP connection, pagination, checkpoints), and end-to-end tests are required.

Available verification gates:
```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

---

## Working Behaviour & Truthfulness Rules

* Make safe, reversible engineering decisions.
* When blocked by credentials, build mock implementations/doubles and documentation.
* Honestly report implementation states using exact labels: `Implemented`, `Partially implemented`, `Simulated`, `Blocked by credentials`, `Tested locally`, `Not yet tested`, `Production-ready`, `Not production-ready`.
* The current milestone is `Local IMAP-to-IMAP Migration MVP`.
