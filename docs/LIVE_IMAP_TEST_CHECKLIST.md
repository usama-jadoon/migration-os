# Live IMAP Migration Test Checklist

This checklist provides the exact specification for validating a real Generic IMAP to Generic IMAP migration using two dedicated test mailboxes.

> [!WARNING]
> Do NOT use primary production mailboxes for live migration testing. Always create dedicated test mailboxes (e.g. `migration-source-test@domain.com` and `migration-dest-test@domain.com`).

---

## 1. Required Credential Specification

To initiate a live migration test, the following parameters must be entered into the UI wizard at `http://localhost:3000/dashboard/new` or configured via the API:

### Source Mailbox Configuration
- **Provider**: `imap`
- **Source Email**: Source test email address (e.g., `src-test@domain.com`)
- **IMAP Host**: Source mail server hostname (e.g., `imap.gmail.com` or `mail.example.com`)
- **IMAP Port**: `993` (SSL/TLS) or `143` (STARTTLS)
- **Use TLS**: `true`
- **Username**: Full email address or account username
- **Password**: App-Specific Password (recommended) or account password

### Destination Mailbox Configuration
- **Provider**: `imap`
- **Destination Email**: Destination test email address (e.g., `dest-test@domain.com`)
- **IMAP Host**: Destination mail server hostname (e.g., `imap.gmail.com` or `mail.example.com`)
- **IMAP Port**: `993` (SSL/TLS) or `143` (STARTTLS)
- **Use TLS**: `true`
- **Username**: Full email address or account username
- **Password**: App-Specific Password (recommended) or account password

---

## 2. Test Execution Verification Steps

### Step 1: Connection & Discovery Verification
1. Click **Test Source Connection** &rarr; Verify green status badge (`200 OK`).
2. Click **Test Destination Connection** &rarr; Verify green status badge (`200 OK`).
3. Click **Discover Folders** &rarr; Verify that source folders (e.g. `INBOX`, `Sent`, nested folders) are listed along with message counts.

### Step 2: Live Migration Execution
1. Select a small controlled folder (e.g. 5–20 test messages).
2. Click **Start Migration**.
3. Monitor real-time progress bar, speed indicators, and Socket.io log output.
4. Verify overall status transitions from `queued` &rarr; `running` &rarr; `completed`.

### Step 3: Verification of Migrated Data Fidelity
1. Log into the destination test account.
2. **Message Count**: Verify destination folder contains the expected number of messages.
3. **MIME & Headers**: Verify Subject, Sender, Recipients, Attachments, and Body structure match original messages.
4. **Nested Folders**: Verify subfolders are automatically created on destination.
5. **Internal Dates**: Verify message timestamps reflect original received date.
6. **Read/Unread Status**: Verify unread messages remain unread (`\Seen` flag missing) and read messages remain read (`\Seen` flag present).
7. **Flagged Status**: Verify starred/flagged messages retain `\Flagged` state.

### Step 4: Checkpoint & Resume Validation
1. Trigger a migration on a folder containing 100+ messages.
2. Wait for at least 1 batch (50 messages) to complete.
3. Pause or terminate the worker process.
4. Inspect `MigrationCheckpoint` in database (`SELECT * FROM MigrationCheckpoint;`).
5. Click **Resume** or restart the worker.
6. Verify processing resumes cleanly from `lastProcessedUid` without re-processing batch 1.

### Step 5: Idempotency & Duplicate Prevention
1. Re-run the exact same migration job against the destination mailbox.
2. Verify `MigratedItem` table checks detect existing idempotency keys.
3. Confirm 0 duplicate messages are created in destination folders.
