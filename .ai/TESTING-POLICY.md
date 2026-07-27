# Testing Policy & Verification Strategy — MigrationOS

**Last Updated**: July 27, 2026  

---

## 1. Test Suite Architecture

MigrationOS enforces automated unit, integration, and security testing across four main test suites in `apps/api/src/__tests__/`:

| Test Suite | File Path | Focus & Coverage |
| :--- | :--- | :--- |
| **SaaS Security & Multi-Tenancy** | `saas_security.test.ts` | Auth signup/login, cookie sessions, RBAC roles, IDOR cross-tenant isolation, worker payload refusal |
| **Production Foundation** | `production_foundation.test.ts` | Zod environment validation, structured logger secret redaction, DB health check, Queue adapter switching |
| **Connector Security** | `security.test.ts` | AES-256-GCM credential encryption/decryption, retry loop backoff, `ConnectorFactory` safe JSON parsing |
| **Worker E2E Integration** | `integration.test.ts` | Mocked connector migration workflow, checkpoint cursor resumption, idempotency duplicate prevention, connector disconnect |

---

## 2. Test Execution & Mandatory Commands

All tests are executed sequentially using Jest:
```bash
npm run test
```

### Mandatory Verification Gates
Before committing code or declaring any task finished, the entire verification suite must pass:
1. `npm run lint` — Zero ESLint errors.
2. `npm run typecheck` — Clean TypeScript compilation (`tsc --noEmit`).
3. `npm run test` — 34/34 unit and integration tests passing.
4. `npm run build` — Successful production compilation (`next build` & `tsc`).

---

## 3. External Dependency & Live Mailbox Testing Policy

1. **Mock Connector Isolation**: Unit and integration tests must mock external provider connectors (`ImapConnector`, `GoogleConnector`, `MicrosoftConnector`) so tests run quickly and reliably without requiring live network access or active user accounts.
2. **Live External Transfer Policy**: Live validation against real external IMAP/Gmail/Graph mailboxes is executed ONLY when non-production test account credentials are provided. Live validation must never be claimed unless actual external servers were queried.
3. **Database Reset Safety**: Test suites must create isolated test users and organizations and clean up database tables in `beforeEach`/`afterAll` hooks without affecting production databases.
