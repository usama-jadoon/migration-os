# MigrationOS — CLAUDE.md

## Project Mission

Build a reliable multi-provider email migration platform that allows an administrator to select a source provider, select a destination provider, connect both accounts, map mailboxes, and run a monitored migration.

The initial supported migration paths are:

* Generic IMAP to Generic IMAP
* Generic IMAP to Google Workspace
* Generic IMAP to Microsoft 365
* Google Workspace to Microsoft 365
* Microsoft 365 to Google Workspace

The project must be developed incrementally. Do not pretend unfinished integrations are production-ready.

---

## Current Development Mode

The current priority is a working local MVP.

For local development:

* Use SQLite as the default database.
* Use an in-process development queue.
* Do not require Docker to start the application.
* Do not require Redis for local development.
* Do not require PostgreSQL for local development.
* Keep production infrastructure files available for future use.
* Do not permanently delete Docker, PostgreSQL, Redis, or BullMQ configuration unless it is confirmed to be unused.
* Separate local-development infrastructure from production infrastructure.

The local application should start with normal npm commands.

Example:

```bash
npm install
npm run dev
```

---

## Architecture Rules

The system must use provider-independent interfaces.

Do not write separate migration logic for every provider combination.

Use this architecture:

```text
Source Provider Connector
        ↓
Universal Migration Model
        ↓
Destination Provider Connector
```

Each provider must implement a shared connector contract.

Example responsibilities:

```typescript
interface MigrationConnector {
  authenticate(): Promise<void>;
  testConnection(): Promise<boolean>;
  listFolders(): Promise<MigrationFolder[]>;
  createFolder(folder: MigrationFolder): Promise<string>;
  listMessages(
    folderId: string,
    cursor?: string
  ): Promise<MessageBatch>;
  importMessage(
    message: UniversalMessage,
    destinationFolderId: string
  ): Promise<ImportResult>;
  getTotalMessageCount(): Promise<number>;
  disconnect(): Promise<void>;
}
```

Do not allow provider-specific response objects to leak into the migration worker.

---

## Universal Message Model

All source-provider messages must be transformed into a universal model before import.

The universal model should preserve:

* Source message ID
* Internet Message-ID
* Subject
* From
* To
* CC
* BCC
* Reply-To
* Sent date
* Received date
* Text body
* HTML body
* Raw MIME content
* Attachments
* Folder path
* Labels or categories
* Read state
* Flagged state
* Draft state
* Importance
* Thread identifiers where available

Prefer raw MIME migration when supported because it preserves more message fidelity.

---

## Implementation Priority

Follow this order strictly.

### Stage 1 — Repository Audit

Before changing code:

1. Read the complete repository structure.
2. Read package.json files.
3. Read the database schema.
4. Read existing connectors.
5. Read the migration worker.
6. Read API routes.
7. Read frontend migration flows.
8. Identify simulated, incomplete, or placeholder logic.
9. Create a written implementation plan inside the repository.
10. Do not claim anything works until it has been executed and verified.

---

### Stage 2 — Local Development Simplification

Configure a local development mode using:

* SQLite
* Local file storage or temporary directory
* In-process queue adapter
* Single worker process
* Local Socket.IO or Server-Sent Events
* Environment variables through `.env.local`

Create environment-based adapters:

```text
DATABASE_PROVIDER=sqlite
QUEUE_PROVIDER=memory
STORAGE_PROVIDER=local
```

Production-compatible values may later include:

```text
DATABASE_PROVIDER=postgresql
QUEUE_PROVIDER=redis
STORAGE_PROVIDER=s3
```

The application code must depend on abstractions rather than directly depending on SQLite or an in-memory queue.

---

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

---

### Stage 4 — IMAP Connector First

Implement and stabilize IMAP before Google and Microsoft.

Use `imapflow` where appropriate.

The IMAP connector must support:

* Secure connection
* Connection timeout
* Authentication failure handling
* Folder discovery
* Nested folder discovery
* Folder delimiter handling
* Message counting
* UID-based pagination
* Raw MIME download
* Destination folder creation
* Raw MIME append
* Read/unread flags
* Flagged status
* Original internal date where supported
* Graceful disconnect
* Rate limiting
* Retry with exponential backoff

Do not load an entire mailbox into memory.

Messages must be processed in configurable batches.

Default batch size:

```text
50 messages
```

The connector must support a checkpoint cursor so interrupted jobs can resume.

---

### Stage 5 — Migration Worker

The migration worker must not contain provider-specific condition chains throughout the code.

Use a connector factory:

```typescript
const source = connectorFactory.create(
  migration.sourceProvider,
  sourceCredentials
);

const destination = connectorFactory.create(
  migration.destinationProvider,
  destinationCredentials
);
```

Worker lifecycle:

1. Load migration.
2. Validate status.
3. Decrypt credentials.
4. Connect source.
5. Connect destination.
6. Discover folders.
7. Create folder mapping.
8. Calculate estimated item count.
9. Process folders in batches.
10. Check pause and cancellation state between batches.
11. Save checkpoint after every successful batch.
12. Log failed items.
13. Retry transient failures.
14. Continue after non-fatal message failures.
15. Verify source and destination counts.
16. Mark migration completed, completed-with-errors, failed, or cancelled.
17. Disconnect all providers.
18. Remove temporary files.

Do not update the database after every individual message unless necessary.

Use batched progress updates to reduce database load.

---

## Required Migration States

Use explicit states:

```text
draft
validating
ready
queued
running
paused
cancelling
cancelled
completed
completed_with_errors
failed
```

Do not infer pause or cancellation state from an in-memory variable only.

Even in local mode, store job state and checkpoints in the database.

The in-memory queue may dispatch jobs, but the database remains the source of truth.

---

## Duplicate Prevention

Every imported message must have an idempotency key.

Possible inputs:

* Migration ID
* Source mailbox ID
* Source folder ID
* Source UID
* Internet Message-ID
* Message size
* Received timestamp
* Content hash

Before importing, check whether the item was already completed.

Restarting a migration must not duplicate successfully migrated messages.

---

## Failure Classification

Classify errors as:

```text
authentication
authorization
rate_limit
network
source_not_found
destination_not_found
unsupported_item
message_too_large
invalid_mime
temporary_provider_error
permanent_provider_error
unknown
```

Retry only transient errors.

Use exponential backoff with a maximum retry limit.

Do not retry permanent authentication or unsupported-item errors endlessly.

---

## Security Requirements

Never store provider passwords or OAuth tokens as plain text.

Required protections:

* Encrypt credentials at rest.
* Never log passwords.
* Never log access tokens.
* Never log complete email bodies.
* Redact sensitive values from errors.
* Use least-privilege provider permissions.
* Delete temporary MIME files after processing.
* Add audit logs for connection, migration start, pause, resume, cancel, and completion.
* Validate all API inputs.
* Prevent one migration from accessing another migration’s credentials.
* Keep secrets outside source control.

Create `.env.example` with placeholders only.

---

## Google Workspace Connector

Do not implement Google Workspace until IMAP migration is proven end to end.

Google implementation should eventually support:

* OAuth 2.0
* Refresh-token handling
* Gmail API
* Label discovery
* Message pagination
* Raw message retrieval
* Raw message insertion
* Label mapping
* Gmail system-label handling
* Rate-limit handling
* Token revocation handling

Do not ask the user to paste permanent Google access tokens manually.

Build a proper OAuth authorization flow.

Domain-wide delegation should be implemented later as a separate enterprise feature.

---

## Microsoft 365 Connector

Do not implement Microsoft 365 until IMAP migration is stable.

Microsoft implementation should eventually support:

* Microsoft Entra OAuth
* Microsoft Graph authentication
* Refresh-token handling
* Recursive mail-folder discovery
* Message pagination
* MIME retrieval where supported
* MIME import where supported
* Folder mapping
* Throttling handling
* Shared-mailbox support in a later phase

Do not assume that creating a Graph draft message is equivalent to importing a historical email.

Preserve original dates, headers, MIME content, and folder placement using the correct supported migration approach.

---

## Development Queue Rules

For local development, implement a queue abstraction.

Example:

```typescript
interface MigrationQueue {
  add(migrationId: string): Promise<void>;
  pause(migrationId: string): Promise<void>;
  resume(migrationId: string): Promise<void>;
  cancel(migrationId: string): Promise<void>;
  getState(migrationId: string): Promise<JobState>;
}
```

Create:

* `MemoryMigrationQueue` for local development
* `RedisMigrationQueue` placeholder or production implementation for later

The migration worker must not directly call Redis APIs.

---

## Database Rules

SQLite may be used locally, but database models must remain compatible with PostgreSQL where reasonably possible.

Required records:

* ProviderConnection
* Migration
* MailboxMapping
* FolderMapping
* MigrationCheckpoint
* MigratedItem
* MigrationError
* MigrationEvent
* AuditLog

Do not store entire email bodies in the database.

Store only metadata, status, identifiers, hashes, progress, and error information.

---

## Testing Requirements

Required automated tests:

### Unit Tests

* Connector factory
* Universal-message conversion
* Folder mapping
* Idempotency-key generation
* Retry classification
* Progress calculation
* ETA calculation
* Pause/resume state
* Cancellation state
* Credential encryption

### Integration Tests

* IMAP connection failure
* Folder listing
* Folder creation
* Raw MIME append
* Batch migration
* Checkpoint resume
* Duplicate prevention
* Failed-item continuation

### End-to-End Test

Use controlled test mailboxes.

The test must:

1. Create source test messages.
2. Create nested folders.
3. Add attachments.
4. Mark some messages read and flagged.
5. Run migration.
6. Compare source and destination counts.
7. Verify folder structure.
8. Verify raw content or important headers.
9. Restart an interrupted migration.
10. Verify no duplicates were created.

Do not perform destructive actions against real user mailboxes.

---

## Verification Commands

Detect the package manager and workspace commands from the repository.

Run all available gates:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Also run database migrations and relevant integration tests.

Never report a command as passing unless it was actually executed successfully.

If environment restrictions prevent a command from running, state exactly:

* Which command was attempted
* What error occurred
* What remains unverified

Do not say “confirmed passing through analysis.”

---

## Working Behaviour

Work autonomously through the current task list.

Do not repeatedly ask the user which small task to perform next.

Make safe, reversible engineering decisions.

Before large architectural changes:

* Inspect existing implementation.
* Preserve working functionality.
* Use small commits or clearly separated change groups.
* Avoid rewriting the entire project unnecessarily.

When blocked by missing credentials:

* Complete all code that does not require credentials.
* Add validation and setup documentation.
* Add safe test doubles.
* Clearly mark the external credential-dependent test as pending.
* Continue with other implementation work.

---

## Truthfulness Rules

Never claim:

* A connector is complete when it is still simulated.
* OAuth works without completing an OAuth flow.
* A migration works without migrating controlled test messages.
* Live progress works when values are generated artificially.
* Production readiness when only SQLite and an in-memory queue are tested.
* Tests passed when they were not executed.
* Security is complete without credential encryption and tenant isolation.

Use these labels:

```text
Implemented
Partially implemented
Simulated
Blocked by credentials
Tested locally
Not yet tested
Production-ready
Not production-ready
```

---

## Immediate Execution Goal

Complete the following milestone before expanding scope:

```text
Local IMAP-to-IMAP Migration MVP
```

The milestone is complete only when:

* Frontend loads successfully.
* Source IMAP connection can be tested.
* Destination IMAP connection can be tested.
* Source folders are discovered.
* Destination folders are created.
* Real messages are migrated in batches.
* Original MIME data is preserved.
* Read and flagged states are preserved where supported.
* Progress is based on real migrated counts.
* Pause works.
* Resume works.
* Cancel works.
* Failed messages are recorded.
* An interrupted job resumes from a checkpoint.
* Re-running does not create duplicates.
* Final verification report is generated.
* Lint, typecheck, tests, and production build pass.

After this milestone, proceed to Google OAuth and Gmail API integration.

Do not start multiple provider integrations simultaneously.
