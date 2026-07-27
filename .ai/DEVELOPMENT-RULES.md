# Permanent Development Rules — MigrationOS AI Operating System

**Scope**: Mandatory behavioral and technical constraints for all human developers and AI coding agents working on the MigrationOS codebase.

---

## 1. Autonomous Execution & Continuity

1. **Continuous Progress**: Never stop execution after completing a single sub-task or milestone unless explicitly instructed or genuinely blocked by an unavailable external dependency.
2. **Autonomous Resolution**: Continue working autonomously through inspection, design, implementation, verification, documentation, commit, and push.
3. **No Unnecessary Polling**: Never execute spinning terminal polling loops. Use background timers (`schedule`) or event notifications.
4. **Targeted Stop Conditions**: Stop only when blocked by missing external credentials, required external OAuth registrations, explicit human decision approval, or total roadmap completion.

---

## 2. Code Preservation & Refactoring Discipline

1. **No Churn or Erasure**: Never rewrite working functionality or delete existing passing unit tests without verified empirical justification.
2. **Preserve User Changes**: Always check `git status` and inspect uncommitted work before making edits.
3. **No Superficial Symptom Patches**: Never fix failing tests by swallowing exceptions, deleting broken assertions, or returning dummy fallbacks. Address the root cause.
4. **Audit Before Re-inventing**: Always search the existing codebase before creating new utility functions or data abstractions.

---

## 3. Security & Secret Redaction

1. **Zero Secret Leakage**: Never print, expose, log, commit, or output passwords, tokens, API keys, decrypted credentials, raw email bodies, `.env` files, or SQLite database files.
2. **Automatic Redaction**: Always wrap logging statements with `redactSensitive()` or use `logger.ts` structured logging.
3. **Strict Encryption**: Always encrypt credentials using AES-256-GCM prior to database persistence.
4. **Tenant Scoping**: Always enforce `organizationId` filtering on all database queries, API endpoints, worker jobs, and Socket.io rooms.

---

## 4. Quality Verification & Gate Enforcement

1. **Mandatory Gate Execution**: Before declaring any task complete or creating a Git commit, execute and verify all four mandatory gates:
   ```bash
   npm run lint
   npm run typecheck
   npm run test
   npm run build
   ```
2. **Zero Failures Allowed**: Fix all linting warnings, TypeScript errors, and failing tests before committing code.
3. **Verified Pushes**: Push to the Git remote repository (`origin/main`) only after all verification gates have passed 100%.

---

## 5. Documentation Discipline

1. **Synchronized Documentation**: Always update `.ai/PROJECT-STATUS.md`, `.ai/CHANGELOG.md`, and relevant feature documentation in `docs/` before ending a turn.
2. **Clear Commit Messages**: Provide factual, descriptive Git commit messages explaining what changed and why.
