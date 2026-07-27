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
**Phase 5 — Google Workspace Connector (Live Verification)**

---

## ACTIVE TASK
<!-- Agent marks this [~] when working -->
- None (Live verification blocked pending Google Cloud OAuth client credentials in `.env`)

---

## NEXT TASKS (in order)
- [x] FIX: Delete apps/web/.next cache and rebuild to resolve 592.js error (Proof: Clean build & dashboard loaded at http://localhost:3000/dashboard)
- [x] VERIFY: Confirm exact Google OAuth redirect URI from apps/api/src/routes/auth.ts (Proof: http://localhost:3000/oauth/google/callback)
- [x] VERIFY: Confirm all required .env variable names for Google OAuth (Proof: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)
- [x] DOCS: Create docs/GOOGLE_OAUTH_LOCAL_SETUP.md with setup guide (Proof: Created and pushed in commit d488c6f01092e02b1071c946e9ed29c21e4d5933)
- [x] TEST: Run full test suite (Proof: 42/42 unit and integration tests passing)
- [x] TEST: Run lint, typecheck, build — all must pass (Proof: npm run lint, typecheck, test, build all 0 exit code)
- [ ] VERIFY: Live Google OAuth flow end-to-end with real credentials (BLOCKED: awaiting user credentials in .env)
- [ ] VERIFY: Token storage works correctly with live credentials
- [ ] COMMIT: Final Phase 5 verified commit with SHA after live credential verification
- [ ] BEGIN: Phase 6 — Microsoft 365 Connector

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
- [x] Phase 5 code implementation (commit: 60cf221c9b52a2b64ae8a3fb2cef492832c62b14)
- [x] Google OAuth Local Setup Guide (commit: d488c6f01092e02b1071c946e9ed29c21e4d5933)

---

## BLOCKED
<!-- Only real external blockers go here -->
<!-- Format: BLOCKED: [task] — [reason] — [what user needs to do] -->
- BLOCKED: Live Google OAuth verification — Google Cloud OAuth credentials not yet in .env — User must complete Google Cloud Console setup following docs/GOOGLE_OAUTH_LOCAL_SETUP.md and add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI to .env

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
