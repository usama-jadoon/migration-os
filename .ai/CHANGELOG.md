# Changelog — MigrationOS

All notable changes to the MigrationOS platform are documented in this file.

---

## [Unreleased] - Phase 6: Microsoft 365 / Exchange Connector

---

## [1.1.0-google-connector] - 2026-07-27

### Added
- Implemented Google OAuth 2.0 Authorization Code Flow endpoints (`GET /api/auth/google/url`, `POST /api/auth/google/token`).
- Hardened `GoogleConnector` in `apps/api/src/connectors/google.connector.ts` using `googleapis` v173.
- Implemented label-to-folder mapping (`INBOX`, `SENT` &rarr; `Sent Items`, `TRASH` &rarr; `Trash`, `SPAM` &rarr; `Junk Email`, `DRAFT` &rarr; `Drafts`, custom user labels).
- Added RFC822 raw MIME extraction and base64url import via `users.messages.insert`.
- Added exponential backoff retry wrapper (`withRetry`) for Google API rate limit handling.
- Added incremental synchronization support via `q` query parameters.
- Created `google_connector.test.ts` test suite with 8 automated unit & integration tests (`42/42 total tests passing`).

---

## [1.0.1-saas-security] - 2026-07-27

### Added
- Created `.ai/` AI Operating System documentation suite (14 core documents).
- Implemented User, Session, Organization, OrganizationMembership, and AuditLog Prisma models.
- Added password hashing via Node `crypto.scryptSync` and HTTP-Only session cookies.
- Added RBAC middleware enforcing `owner`, `admin`, `operator`, and `viewer` roles.
- Enforced mandatory `organizationId` filtering across all API endpoints, background worker jobs, and Socket.io real-time rooms (`org:${id}`).
- Created `saas_security.test.ts` suite with 11 automated security and multi-tenant isolation tests.
