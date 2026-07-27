# Architecture Decision Records (ADR) — MigrationOS

**Last Updated**: July 27, 2026  

---

## ADR 001: NPM Workspaces Monorepo Layout

- **Status**: Accepted
- **Context**: MigrationOS requires an Express.js API backend for high-performance background workers and a Next.js App Router frontend for interactive migration management.
- **Decision**: Adopt NPM Workspaces (`apps/api`, `apps/web`) to keep backend and frontend code synchronized while sharing TypeScript definitions without complex build tooling.

---

## ADR 002: Prisma ORM with Dual Database Provider Compatibility

- **Status**: Accepted
- **Context**: Local development needs zero-install instant startup (`SQLite`), while cloud production deployment requires high-concurrency ACID transactions (`PostgreSQL`).
- **Decision**: Use Prisma ORM with a configurable `DATABASE_PROVIDER` environment flag. Keep schema definitions compatible across SQLite and PostgreSQL (using String UUIDs for primary keys).

---

## ADR 003: In-Memory / Redis Queue Adapter Abstraction

- **Status**: Accepted
- **Context**: Developers need local zero-install execution (`MemoryMigrationQueue`), while multi-node production clusters require Redis & BullMQ (`RedisMigrationQueue`).
- **Decision**: Implement the `IMigrationQueue` interface and a factory (`createMigrationQueue()`) that inspects `QUEUE_PROVIDER` (`'memory'` vs `'redis'`).

---

## ADR 004: Native Crypto Password Hashing (`scryptSync`)

- **Status**: Accepted
- **Context**: External C-extension password hashing libraries (e.g. `bcrypt`) frequently fail native compilation across different OS environments (Windows/Alpine Linux).
- **Decision**: Use Node built-in `crypto.scryptSync` with a 16-byte random salt. It requires no native build dependencies, is cryptographically secure, and runs reliably on all platforms.

---

## ADR 005: Strict Multi-Tenant Organization IDOR Isolation

- **Status**: Accepted
- **Context**: Cross-tenant data leaks or unauthorized migration control in a multi-tenant platform could expose sensitive email records.
- **Decision**: Enforce `organizationId` foreign keys on every operational model and append `{ organizationId: req.organizationId }` to every database query. Return `404 Not Found` when a resource ID does not belong to the caller's active organization.
