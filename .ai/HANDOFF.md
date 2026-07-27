# AI Agent Handoff Guide — MigrationOS

**Last Updated**: July 27, 2026  
**Current Baseline Commit**: `57cfeb58558b049895b83a59058bcef9ce350b72`  
**Active Milestone**: **Phase 5 — Google Workspace Connector Completion**  

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
4. **Identify Next Task**: Proceed to **Phase 5 — Google Workspace Connector Completion**.
5. **Execute Workflow**:
   - Implement code.
   - Run verification gates.
   - Update `.ai/PROJECT-STATUS.md` and `.ai/CHANGELOG.md`.
   - Commit and push to `origin/main`.

---

## 2. Repository Quick Facts

- **Monorepo Layout**: `apps/api` (Express backend & worker engine), `apps/web` (Next.js 14 frontend).
- **Database Schema**: 169-line Prisma schema (`apps/api/prisma/schema.prisma`) with full multi-tenant `organizationId` relationships.
- **Authentication**: Salted `scrypt` password hashing + HTTP-Only cookie sessions (`auth_token`).
- **Authorization**: RBAC (`owner`, `admin`, `operator`, `viewer`) with IDOR protection (`404` on mismatched tenant records).
- **Test Suite**: 34 unit and integration tests passing (`npm run test`).
- **Live IMAP Status**: Deferred pending external test account credentials.
