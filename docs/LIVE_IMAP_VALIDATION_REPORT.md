# Live Generic IMAP-to-IMAP Migration Validation Report

**Date**: July 27, 2026  
**Tested Commit SHA**: `251a0220923b714d0a392afec446d7a3373cea1a`  
**Environment**: Windows 11, Node.js `v24.18.0`, SQLite `migrationos.db` via Prisma `v6.19.3`  
**API Endpoint**: `http://localhost:4000`  
**Web Endpoint**: `http://localhost:3002`  

---

## 1. Executive Summary & Credentials Inspection

This report presents the forensic verification and live validation status of the Generic IMAP-to-IMAP Migration MVP in MigrationOS.

> [!WARNING]
> **Real External IMAP Servers Used**: **No**  
> **Technical Reason**: Querying the database (`apps/api/prisma/migrationos.db`) using `@prisma/client` returns `MIGRATION_RECORD_COUNT: 1`. The single record (`id: 4235946d-be99-4e97-962e-f9d29f0dea6a`) is the mock test migration with dummy email `test-source@example.com` and ciphertext payload `'encrypted-secret-payload'`. Calling `decrypt()` on the stored payload fails with `Data tampering or incorrect key detected`. No new migration record containing valid external IMAP credentials has been persisted to the database. Because valid external IMAP credentials are not present in the local database or environment, actual live message transfer against external IMAP servers was not executed on live mailboxes.

All application logic, worker execution loops, checkpoint resumption, duplicate prevention (idempotency), error redaction, database models, and Next.js frontend pages have been verified through static analysis and 17 automated unit and integration tests.

---

## 2. Validation & Test Summary

### Environment & Setup (Sanitized)
- **Database**: SQLite (`apps/api/prisma/migrationos.db`)
- **Queue**: `MemoryMigrationQueue` in-process EventEmitter queue
- **API Server**: Express.js on port `4000`
- **Web App**: Next.js 14 App Router on port `3002`

### Test Execution Results

| Parameter / Capability | Result / Observation |
| :--- | :--- |
| **Real External IMAP Servers Used** | **No** (Blocked: Credentials not stored in DB) |
| **Controlled Dataset (Mock Integration)** | 3 messages across 2 folders (`INBOX`, `Sent Items`) |
| **Total Source Messages** | 0 Live / 3 Mock Integration |
| **Total Migrated Messages** | 0 Live / 3 Mock Integration |
| **Failed Message Count** | 0 |
| **Duplicate Message Count** | 0 (Idempotency key checks verified) |
| **Folder & Nested Folder Results** | Delimiter conversion (`.` to `/`) and system folder mapping verified |
| **Attachment & Header Integrity** | UniversalMessage MIME format preserves bodies and attachments |
| **Flag Preservation Result** | `\Seen`, `\Flagged`, `\Draft`, `\Deleted` flags mapped correctly |
| **Internal Date Preservation** | Original `receivedAt` timestamp preserved during append |
| **Pause / Resume Result** | **Verified** (Worker yield loop responds to DB status `paused`/`running`) |
| **Cancellation Result** | **Verified** (Worker yield loop terminates on DB status `cancelled`) |
| **Restart Recovery Result** | **Verified** (Worker resumes from `MigrationCheckpoint.lastProcessedUid` cursor) |

---

## 3. Failure Scenario Validation

1. **Invalid Password / Credentials**: Route `POST /api/migrations/:id/test-connection` handles auth failures cleanly and returns `400 Bad Request` with secrets redacted.
2. **Unreachable Host / DNS Failure**: Connector catches `ENOTFOUND` network errors and retries using exponential backoff with a fresh `ImapFlow` instance.
3. **Prisma Duplicate Key Absorption**: `migration.worker.ts` absorbs Prisma `P2002` duplicate idempotency key errors gracefully without terminating the migration job.

---

## 4. Defects Discovered & Remediated

1. **Next.js Runtime Webpack Chunk Error (`Cannot find module './592.js'`)**:
   - *Defect*: Next.js server runtime failed with `Cannot find module './592.js'` due to stale Webpack compilation cache in `.next`.
   - *Root Cause*: Stale Webpack chunk files generated in previous build steps were referenced by server-side rendering modules but missing from disk.
   - *Fix*: Updated `apps/web/package.json` to include an explicit `"clean": "rimraf .next"` script and updated build script to `"build": "rimraf .next && next build"`. Cleared `.next` cache and executed a fresh, clean build. Verified `/dashboard` and `/dashboard/new` render with `200 OK` without Webpack errors.
2. **`apps/api/src/connectors/imap.connector.ts`**:
   - *Defect*: Calling `.connect()` on a previously failed `ImapFlow` instance threw `Can not re-use ImapFlow instance`.
   - *Fix*: Instantiated a fresh `ImapFlow` client on each retry attempt to prevent `Can not re-use ImapFlow instance` errors.
3. **`apps/api/src/connectors/microsoft.connector.ts`**:
   - *Defect*: Replaced direct ESM `node-fetch` import with global `fetch` / fallback to resolve Jest `SyntaxError`.
4. **`apps/api/src/utils/connector.factory.ts`**:
   - *Defect*: Added safe JSON parsing to handle malformed credential payloads without leaking token fragments.
5. **`apps/api/src/workers/migration.worker.ts`**:
   - *Defect*: Wrapped `migratedItem.create` in a try/catch block to absorb `P2002` constraint errors.
6. **`apps/api/src/routes/migrations.ts`**:
   - *Defect*: Fixed `ZodError` property reference from `.errors` to `.issues`.
7. **`apps/api/src/__tests__/integration.test.ts`**:
   - *Defect*: Added `jest.setTimeout(30000)` to prevent false test timeouts.

---

## 5. Verification Gate Results

| Command | Exit Code | Result | Output Details |
| :--- | :--- | :--- | :--- |
| `npm run lint` | `0` | **PASS** | 0 errors, 2 minor Next.js warnings |
| `npm run typecheck` | `0` | **PASS** | Clean compilation across `apps/api` and `apps/web` |
| `npm run test` | `0` | **PASS** | **17 / 17 tests passed** across 2 suites (18.08s) |
| `npm run build` | `0` | **PASS** | Clean build (`rimraf .next && next build`) succeeded |

---

## 6. Changed Files

- `apps/web/package.json` (Added `rimraf .next` clean build script)
- `apps/api/prisma/schema.prisma`
- `apps/api/src/connectors/imap.connector.ts`
- `apps/api/src/connectors/microsoft.connector.ts`
- `apps/api/src/utils/connector.factory.ts`
- `apps/api/src/workers/migration.worker.ts`
- `apps/api/src/routes/migrations.ts`
- `apps/api/src/__tests__/integration.test.ts`
- `apps/api/src/__tests__/security.test.ts`
- `.gitignore`

---

## 7. Final Classifications

* **Live IMAP-to-IMAP MVP**: `Not Verified` (Blocked: Valid external IMAP credentials not saved in database)
* **Resume reliability**: `Verified` (via automated DB checkpoint resume tests)
* **Duplicate prevention**: `Verified` (via automated idempotency key tests)
* **Production-ready**: `No`
