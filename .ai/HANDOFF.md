# AI Agent Handoff Guide — MigrationOS

**Last Updated**: July 27, 2026  
**Status**: **All Core Roadmap & Enterprise Features Completed (100%)**  

---

## 1. How to Continue Development Immediately

If you are an AI agent taking over this repository, follow this exact sequence:

1. **Read Status**: Inspect `.ai/PROJECT-STATUS.md` and `.ai/ROADMAP.md`.
2. **Review Rules**: Read `.ai/DEVELOPMENT-RULES.md` and `.ai/AI-WORKFLOW.md`.
3. **Verify Baseline**: Confirm all 4 verification gates pass cleanly:
   ```bash
   npm run lint
   npm run typecheck
   npm run test
   npm run build
   ```

---

## 2. Repository Quick Facts

- **Monorepo Layout**: `apps/api` (Express backend & worker engine), `apps/web` (Next.js 14 frontend).
- **Database Schema**: Prisma schema with multi-tenant `organizationId` relationships, `Subscription` model, and audit logging.
- **Authentication**: Salted `scrypt` password hashing + HTTP-Only cookie sessions (`auth_token`).
- **Authorization**: RBAC (`owner`, `admin`, `operator`, `viewer`) with IDOR protection (`404` on mismatched tenant records).
- **Connectors Built**:
  - `ImapConnector` (IMAP RFC3501, raw MIME append, folder proposal)
  - `GoogleConnector` (Gmail API v1, OAuth2, label mapping, RFC822 base64url import)
  - `MicrosoftConnector` (Microsoft Graph API, Entra ID OAuth2, raw MIME extraction, folder mapping)
- **Billing & Metering**: Stripe checkout, subscription tiers (`free`, `pro`, `enterprise`), HTTP 402 quota enforcement (`BillingService`).
- **Enterprise Compliance**: SOC 2 audit logs (JSON/CSV), retention policy purging, GDPR Right to Be Forgotten Data Erasure (`ComplianceService`).
- **Test Suite**: 61 unit and integration tests passing (`npm run test`).
