# Project Mission & Architecture Rules

This workspace rule contains the core mission, development mode guidelines, and architectural requirements for the MigrationOS project.

---

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

The priority is a working local MVP.

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

## Implementation Stages (Part 1)

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
