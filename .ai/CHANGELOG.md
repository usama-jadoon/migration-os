# Changelog — MigrationOS

All notable changes to the MigrationOS platform are documented in this file.

---

## [Unreleased] - SaaS Core Security & AI Operating System

### Added
- Created `.ai/` AI Operating System documentation suite (14 core documents).
- Implemented User, Session, Organization, OrganizationMembership, and AuditLog Prisma models.
- Added password hashing via Node `crypto.scryptSync` and HTTP-Only session cookies.
- Added RBAC middleware enforcing `owner`, `admin`, `operator`, and `viewer` roles.
- Enforced mandatory `organizationId` filtering across all API endpoints, background worker jobs, and Socket.io real-time rooms (`org:${id}`).
- Created `saas_security.test.ts` suite with 11 automated security and multi-tenant isolation tests.

---

## [1.0.0-foundation] - 2026-07-27

### Added
- Implemented PostgreSQL database provider support via `DATABASE_PROVIDER` configuration.
- Added Redis and BullMQ queue adapter (`RedisMigrationQueue`) with exponential retry backoff and dead-letter queue (DLQ) support.
- Added worker graceful shutdown signal handlers (`SIGTERM`/`SIGINT`).
- Expanded `/health` REST endpoint returning database health, queue provider status, uptime, and timestamp.
- Created `docker-compose.yml` specifying PostgreSQL 16, Redis 7, Express API, and Next.js frontend services.
- Created `production_foundation.test.ts` test suite.

### Fixed
- Fixed Next.js runtime Webpack chunk error (`Cannot find module './592.js'`) by adding `rimraf .next` clean build script in `apps/web/package.json`.
- Fixed `ImapConnector` retry client re-use bug by instantiating fresh `ImapFlow` instance per retry attempt.
- Fixed `microsoft.connector.ts` ESM `node-fetch` SyntaxError in Jest by adopting global `fetch`.
- Wrapped `migratedItem.create` in try/catch block to absorb Prisma `P2002` duplicate key errors.

### Security
- Verified AES-256-GCM credential encryption prior to database storage.
- Added automatic password and token redaction in `logger.ts` structured logs and Express API JSON responses.
