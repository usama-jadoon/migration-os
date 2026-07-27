# Coding Standards & Conventions — MigrationOS

**Last Updated**: July 27, 2026  

---

## 1. Naming Conventions

- **Files & Directories**: `kebab-case.ts` (e.g. `imap.connector.ts`, `migration.worker.ts`, `auth.middleware.ts`).
- **Interfaces & Types**: `PascalCase` (e.g. `UniversalMessage`, `MigrationConnector`, `EnvConfig`).
- **Classes**: `PascalCase` (e.g. `ImapConnector`, `RedisMigrationQueue`, `JobQueue`).
- **Functions & Variables**: `camelCase` (e.g. `runMigration`, `generateIdempotencyKey`, `createSession`).
- **Constants & Enums**: `UPPER_SNAKE_CASE` or string literals (e.g. `ENCRYPTION_KEY`, `LOG_LEVELS`).

---

## 2. TypeScript & Type Safety Rules

1. **Strict Null Checks**: Always handle nullable fields explicitly (`string | null | undefined`).
2. **No Implicit `any`**: Specify explicit parameter types and return signatures for all exported functions.
3. **Zod Input Validation**: Validate all incoming HTTP request bodies and query parameters with Zod schemas in `validation.ts` or inline Zod schemas before processing.
4. **Interface Contracts**: Implement standard connector and queue interfaces (`MigrationConnector`, `IMigrationQueue`) for all provider and infrastructure implementations.

---

## 3. Express API Route Conventions

1. **Route File Organization**: Keep routes organized by resource (`auth.ts`, `organizations.ts`, `migrations.ts`, `providers.ts`).
2. **Middleware Ordering**:
   ```typescript
   router.use(authenticateSession);
   router.post('/action', requireRole(['owner', 'admin']), async (req, res) => { ... });
   ```
3. **Response Sanitization**: Always strip encrypted credentials, password hashes, and tokens from JSON responses using helper functions (e.g. `sanitizeMigration()`).
4. **Consistent HTTP Status Codes**:
   - `200 OK`: Successful read/update.
   - `201 Created`: Resource successfully created.
   - `400 Bad Request`: Validation failure.
   - `401 Unauthorized`: Missing or invalid session token.
   - `403 Forbidden`: Insufficient RBAC role.
   - `404 Not Found`: Resource missing or owned by another tenant.
   - `500 Internal Server Error`: Unexpected runtime error.

---

## 4. Error Handling & Logging

1. **Structured Logging**: Use `logger.ts` methods (`logger.info`, `logger.warn`, `logger.error`) rather than raw `console.log`.
2. **Secret Redaction**: Always pass error objects through `serializeError()` to ensure connection passwords and tokens are redacted.
3. **Graceful Try/Catch**: Wrap async operations in try/catch blocks and clean up sockets/connections in `finally` blocks.
