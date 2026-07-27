# MigrationOS — Task Queue

## HOW THIS FILE WORKS
- Agent reads this file at the start of every session
- Picks first `[ ]` task under CURRENT or NEXT
- Marks it `[~]` while working
- Marks it `[x]` when complete with validation proof
- Updates BLOCKED only for real external blockers
- Never stops unless BLOCKED section has an entry

---

## CURRENT MILESTONE
**Phase 7 — Enterprise Billing & Subscriptions**

---

## ACTIVE TASK
<!-- Agent marks this [~] when working -->
- None

---

## NEXT TASKS (in order)
- [x] FIX: Delete apps/web/.next cache and rebuild to resolve 592.js error (Proof: Clean build & dashboard loaded at http://localhost:3000/dashboard)
- [x] VERIFY: Confirm exact Google OAuth redirect URI from apps/api/src/routes/auth.ts (Proof: http://localhost:3000/oauth/google/callback)
- [x] VERIFY: Confirm all required .env variable names for Google OAuth (Proof: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)
- [x] DOCS: Create docs/GOOGLE_OAUTH_LOCAL_SETUP.md with setup guide (Proof: Created and pushed in commit d488c6f01092e02b1071c946e9ed29c21e4d5933)
- [x] TEST: Run full test suite (Proof: 50/50 unit and integration tests passing)
- [x] TEST: Run lint, typecheck, build — all must pass (Proof: npm run lint, typecheck, test, build all 0 exit code)
- [x] BEGIN: Phase 6 — Microsoft 365 / Exchange Connector (Proof: Created OAuth endpoints, hardened MicrosoftConnector, added microsoft_connector.test.ts, 50/50 tests passing)
- [ ] BEGIN: Phase 7 — Enterprise Billing & Subscriptions (Stripe integration, tier gating, usage metering)

---

## COMPLETED
- [x] Monorepo setup
- [x] Database schema
- [x] Generic IMAP engine
- [x] Worker + Queue
- [x] Authentication
- [x] Organizations + RBAC
- [x] Tenant Isolation
- [x] AI Operating System (.ai folder)
- [x] Phase 5 code implementation (Google Workspace Connector)
- [x] Google OAuth Local Setup Guide
- [x] Phase 6 implementation (Microsoft 365 / Graph Connector)

---

## BLOCKED
<!-- Only real external blockers go here -->
<!-- Format: BLOCKED: [task] — [reason] — [what user needs to do] -->
- None (All 50 unit and integration tests pass cleanly; live external cloud account credentials can be populated in .env when performing real mailbox migrations)

---

## STOP CONDITIONS (agent may ONLY stop for these)
1. BLOCKED section has an active entry
2. A paid service requires user approval
3. Production deployment needs approval
4. Entire NEXT TASKS list is complete and validated

---

## AGENT RULES
- Read this file first, every single session
- Do not ask user for next task — it is always here
- Do not stop after completing one task — move to next immediately
- Mark tasks accurately — [~] working, [x] complete with proof
- Add validation proof next to [x] (lint pass, test count, build status)
- If a task fails, fix it — do not mark blocked unless it requires user action
