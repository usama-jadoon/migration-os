# Changelog — MigrationOS

All notable changes to the MigrationOS platform are documented in this file.

---

## [1.4.0-enterprise-compliance] - 2026-07-27

### Added
- Implemented `ComplianceService` in `apps/api/src/services/compliance.service.ts` managing SOC 2 audit trail queries, CSV log export, retention log purging, and GDPR Right to Be Forgotten Data Erasure.
- Implemented Express compliance REST endpoints in `apps/api/src/routes/compliance.ts` (`GET /api/compliance/audit-logs`, `POST /api/compliance/retention-purge`, `POST /api/compliance/data-erasure`).
- Added RBAC role enforcement on compliance endpoints (`owner` / `admin` required for audit logs & retention, `owner` required for data erasure).
- Created automated test suite `compliance.test.ts` with 5 unit & integration tests (**61/61 total tests passing across 8 suites**).

---

## [1.3.0-enterprise-billing] - 2026-07-27

### Added
- Created `Subscription` Prisma model with plan tiers (`free`, `pro`, `enterprise`), quotas (`maxMailboxes`, `maxDataBytes`, `maxConcurrentJobs`), and Stripe customer IDs.
- Implemented `BillingService` in `apps/api/src/services/billing.service.ts` managing plan specs, usage aggregation, quota limit checks (`checkMigrationLimit`), and Stripe Checkout Session creation.
- Implemented Express billing REST endpoints in `apps/api/src/routes/billing.ts` (`GET /api/billing/subscription`, `POST /api/billing/checkout`, `POST /api/billing/upgrade`, `POST /api/billing/webhook`).
- Added tier quota limit gating on `POST /api/migrations` and `POST /api/migrations/:id/start` returning `HTTP 402 Payment Required` when quota limits are exceeded.
- Added automated test suite `billing.test.ts` with 6 unit and integration tests.

---

## [1.2.0-microsoft-connector] - 2026-07-27

### Added
- Implemented Microsoft Entra ID (Azure AD) OAuth 2.0 Authorization Code Flow endpoints (`GET /api/auth/microsoft/url`, `POST /api/auth/microsoft/token`).
- Hardened `MicrosoftConnector` in `apps/api/src/connectors/microsoft.connector.ts` using `@microsoft/microsoft-graph-client`.
- Implemented Microsoft Graph folder-to-standard mapping (`Inbox` &rarr; `INBOX`, `SentItems` &rarr; `Sent Items`, `DeletedItems` &rarr; `Trash`, `JunkEmail` &rarr; `Junk Email`, `Drafts` &rarr; `Drafts`, custom user folders).
- Added raw RFC822 MIME decoding stream extraction (`/me/messages/{id}/$value`) and Graph message importing (`/me/mailFolders/{id}/messages`).
- Added exponential backoff retry wrapper (`withRetry`) for Microsoft Graph rate limits (`429 Too Many Requests`).
- Created `microsoft_connector.test.ts` test suite with 8 automated unit & integration tests.
