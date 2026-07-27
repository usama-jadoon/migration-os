# Security & Data Protection Policy — MigrationOS

**Last Updated**: July 27, 2026  

---

## 1. Authentication & Password Security

- **Algorithm**: Passwords are hashed using Node built-in `crypto.scryptSync` with a 16-byte random salt and 64-byte key length.
- **Session Tokens**: Session tokens are 64-character hex strings generated via `crypto.randomBytes(32)`.
- **Cookie Security**: Auth cookies (`auth_token`) use `httpOnly: true`, `sameSite: 'lax'`, `maxAge: 7 days`, and `secure: true` in production.

---

## 2. Multi-Tenant Data Isolation & IDOR Protection

- **Database Model Isolation**: Every workspace model contains a mandatory `organizationId` foreign key with cascade deletion.
- **Query Scoping**: Database queries strictly filter by `{ id, organizationId: req.organizationId }`.
- **404 Not Found Policy**: Unauthorized cross-tenant access attempts return generic `404 Not Found` responses to prevent attackers from inferring record existence across tenants.

---

## 3. Role-Based Access Control (RBAC)

- **Owner**: Full management of organization settings, memberships, and migrations.
- **Admin**: Member management, migration creation/deletion, credential updates.
- **Operator**: Migration creation, connection testing, execution control (start/pause/resume/cancel).
- **Viewer**: Read-only access. Forbidden from executing state mutations.

---

## 4. Encryption & Secret Redaction

- **Symmetric Encryption**: Provider passwords and OAuth tokens are encrypted using **AES-256-GCM** before database storage.
- **Environment Key Requirement**: Encryption uses `process.env.ENCRYPTION_KEY` (must be min 32 characters in production).
- **Log Secret Redaction**: All error and structured JSON log entries pass through `redactSensitive()` to mask passwords, tokens, and authorization headers (`password=[REDACTED]`).
- **Response Sanitization**: API endpoints automatically delete `sourceCredentials` and `destCredentials` fields prior to returning JSON payloads.
