# Changelog — MigrationOS

All notable changes to the MigrationOS platform are documented in this file.

---

## [Unreleased] - Phase 7: Enterprise Billing & Metering

---

## [1.2.0-microsoft-connector] - 2026-07-27

### Added
- Implemented Microsoft Entra ID (Azure AD) OAuth 2.0 Authorization Code Flow endpoints (`GET /api/auth/microsoft/url`, `POST /api/auth/microsoft/token`).
- Hardened `MicrosoftConnector` in `apps/api/src/connectors/microsoft.connector.ts` using `@microsoft/microsoft-graph-client`.
- Implemented Microsoft Graph folder-to-standard mapping (`Inbox` &rarr; `INBOX`, `SentItems` &rarr; `Sent Items`, `DeletedItems` &rarr; `Trash`, `JunkEmail` &rarr; `Junk Email`, `Drafts` &rarr; `Drafts`, custom user folders).
- Added raw RFC822 MIME decoding stream extraction (`/me/messages/{id}/$value`) and Graph message importing (`/me/mailFolders/{id}/messages`).
- Added exponential backoff retry wrapper (`withRetry`) for Microsoft Graph rate limits (`429 Too Many Requests`).
- Added incremental synchronization `$filter` query options.
- Created `microsoft_connector.test.ts` test suite with 8 automated unit & integration tests (**50/50 total tests passing across 6 suites**).

---

## [1.1.0-google-connector] - 2026-07-27

### Added
- Implemented Google OAuth 2.0 Authorization Code Flow endpoints (`GET /api/auth/google/url`, `POST /api/auth/google/token`).
- Hardened `GoogleConnector` in `apps/api/src/connectors/google.connector.ts` using `googleapis` v173.
- Implemented label-to-folder mapping (`INBOX`, `SENT` &rarr; `Sent Items`, `TRASH` &rarr; `Trash`, `SPAM` &rarr; `Junk Email`, `DRAFT` &rarr; `Drafts`, custom user labels).
- Added RFC822 raw MIME extraction and base64url import via `users.messages.insert`.
- Added exponential backoff retry wrapper (`withRetry`) for Google API rate limit handling.
- Added incremental synchronization support via `q` query parameters.
- Created `google_connector.test.ts` test suite with 8 automated unit & integration tests.

---

## [1.0.1-saas-security] - 2026-07-27

### Added
- Created `.ai/` AI Operating System documentation suite (14 core documents).
- Implemented User, Session, Organization, OrganizationMembership, and AuditLog Prisma models.
- Added password hashing via Node `crypto.scryptSync` and HTTP-Only session cookies.
- Added RBAC middleware enforcing `owner`, `admin`, `operator`, and `viewer` roles.
- Enforced mandatory `organizationId` filtering across all API endpoints, background worker jobs, and Socket.io real-time rooms (`org:${id}`).
- Created `saas_security.test.ts` suite with 11 automated security and multi-tenant isolation tests.
