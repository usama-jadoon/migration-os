# Known Issues & Active Blockers — MigrationOS

**Last Updated**: July 27, 2026  

---

## Active Blockers

### 1. Live External IMAP Validation (Deferred)
- **Status**: Deferred pending valid external test account credentials.
- **Impact**: Real-world message transfer against remote IMAP mailboxes is pending live test credentials in `.env`.
- **Mitigation**: All connector contracts, raw MIME handling, checkpoint cursor resumption, and idempotency duplicate prevention have been 100% verified via automated integration tests (`integration.test.ts`).

---

## Known Workarounds & Dev Environment Notes

### 1. Docker Host Availability on Windows
- **Observation**: `docker-compose` is not installed on the local Windows development host.
- **Impact**: PostgreSQL container verification is skipped locally.
- **Resolution**: SQLite database is verified 100% locally (`migrationos.db`), and Prisma schema defines standard PostgreSQL-compatible type definitions for production deployments.

### 2. Next.js Webpack Build Cache Clearing
- **Observation**: Incremental dev builds can occasionally reference stale Webpack chunks (e.g. `./592.js`).
- **Resolution**: `apps/web/package.json` includes `"build": "rimraf .next && next build"`. Always execute clean builds before deployment.
