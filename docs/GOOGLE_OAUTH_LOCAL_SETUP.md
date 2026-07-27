# Google OAuth 2.0 Local Setup & External Dependency Guide — MigrationOS

**Date**: July 27, 2026  
**Target Component**: Google Workspace / Gmail API Connector (`GoogleConnector`)  
**Status**: Implementation Verified (Code-Complete & Tested) — Awaiting Local OAuth Credentials  

---

## 1. Executive Summary

This guide provides step-by-step instructions for human administrators to configure Google OAuth 2.0 credentials in the Google Cloud Console for local testing and production deployment of MigrationOS.

---

## 2. Google Cloud Console Configuration Steps

### Step 1: Enable the Gmail API
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Select or create a project (e.g. `MigrationOS-Dev`).
3. Navigate to **APIs & Services** &gt; **Library**.
4. Search for **Gmail API** and click **Enable**.

### Step 2: Configure OAuth Consent Screen & Branding
1. Navigate to **APIs & Services** &gt; **OAuth consent screen** (or **Google Auth Platform**).
2. Choose **External** (or **Internal** if testing strictly within a Google Workspace domain).
3. Fill in basic application information:
   - **App Name**: `MigrationOS Local`
   - **User Support Email**: Your email address
   - **Developer Contact Information**: Your email address
4. Click **Save and Continue**.

### Step 3: Add Required OAuth Scopes
In the **Scopes** configuration step, click **Add or Remove Scopes** and select:
- `https://mail.google.com/` (Read, compose, send, and permanently delete all your email from Gmail)
- `https://www.googleapis.com/auth/userinfo.email` (View your email address)
- `https://www.googleapis.com/auth/userinfo.profile` (View your basic profile info)

### Step 4: Configure Test Users (Testing Audience)
1. In the **Test users** section, click **+ Add Users**.
2. Enter the target Gmail or Google Workspace test email addresses (e.g. `test-source@gmail.com`, `test-dest@gmail.com`).
3. Save the test user configuration.

### Step 5: Create OAuth 2.0 Web Application Credentials
1. Navigate to **APIs & Services** &gt; **Credentials**.
2. Click **+ Create Credentials** &gt; **OAuth client ID**.
3. Select **Application type**: `Web application`.
4. Name: `MigrationOS Local Client`.
5. Under **Authorized redirect URIs**, add the exact URI:
   ```
   http://localhost:3000/oauth/google/callback
   ```
6. Click **Create**. Copy your **Client ID** and **Client Secret**.

---

## 3. Environment Variables Configuration

Copy `.env.example` to `.env` in the root workspace and populate your credentials:

```ini
# Environment Configuration
ENCRYPTION_KEY="super-secret-key-32-chars-long-x"
NEXT_PUBLIC_API_URL="http://localhost:4000"
API_URL="http://localhost:4000"

# Google OAuth 2.0 Credentials
GOOGLE_CLIENT_ID="123456789012-abc123def456.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-your_actual_client_secret_here"
GOOGLE_REDIRECT_URI="http://localhost:3000/oauth/google/callback"
```

---

## 4. Local Execution & Validation Flow

### Step 1: Start Applications
Run the development servers:
```bash
npm run dev
```

### Step 2: Trigger Google OAuth Authorization Flow
1. Open your browser and navigate to `http://localhost:3000/dashboard/new`.
2. Select **Google Workspace / Gmail** as the source or destination provider.
3. The frontend requests the authorization URL via `GET http://localhost:4000/api/auth/google/url`.
4. Click **Authorize with Google** to redirect to the Google Consent screen.
5. Authenticate using an allowed **Test User** account and click **Allow**.

### Step 3: Token Exchange
1. Google redirects the browser to:
   ```
   http://localhost:3000/oauth/google/callback?code=4/0AeaYSH...&state=...
   ```
2. The frontend sends `POST http://localhost:4000/api/auth/google/token` with `{ code }`.
3. MigrationOS exchanges the code for `access_token` and `refresh_token`, encrypts them via AES-256-GCM, and persists them safely in the database.

---

## 5. Troubleshooting & Common Errors

| Error Code / Symptom | Root Cause | Solution |
| :--- | :--- | :--- |
| **`redirect_uri_mismatch`** | Redirect URI in request does not match Google Console settings. | Ensure `http://localhost:3000/oauth/google/callback` is listed under **Authorized redirect URIs** in Google Cloud Console without trailing slashes. |
| **Missing `refresh_token`** | Account was previously authorized without `prompt=consent` / `access_type=offline`. | MigrationOS requests `prompt=consent` & `access_type=offline`. If missing, revoke access at [Google Account Permissions](https://myaccount.google.com/permissions) and re-authorize. |
| **`403 Access Not Configured`** | Gmail API is not enabled in Google Cloud. | Enable Gmail API in Google Cloud Console Library. |
| **`403 userRateLimitExceeded`** | Per-user rate limit exceeded. | `GoogleConnector` automatically retries requests using exponential backoff (`withRetry`). |

---

## 6. Secret Handling & Security Discipline

> [!CAUTION]
> - **Never Commit Secrets**: Never commit real `GOOGLE_CLIENT_SECRET` values or decrypted refresh tokens into Git repositories or `.env` files.
> - **Log Redaction**: MigrationOS automatically redacts passwords and tokens in structured logs via `logger.ts`.
> - **Database Encryption**: All persisted tokens are encrypted using AES-256-GCM prior to storage.
