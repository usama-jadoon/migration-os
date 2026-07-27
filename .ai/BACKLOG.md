# Project Backlog — MigrationOS

**Last Updated**: July 27, 2026  

---

## Postponed Features & Future Enhancements

### 1. Google Workspace Connector Completion (Phase 5)
- Full OAuth2 authorization flow for Google accounts.
- `GoogleConnector` implementation using Gmail API `users.messages.insert`.
- Google Drive and Google Calendar migration support.

### 2. Microsoft 365 / Exchange Connector Completion (Phase 6)
- Entra ID (Azure AD) OAuth2 authorization flow.
- `MicrosoftConnector` implementation using Microsoft Graph API.
- Exchange Online folder and mail item mapping.

### 3. Enterprise Billing & Subscriptions (Phase 7)
- Stripe integration for billing plans (Free, Pro, Enterprise).
- Tier limits for maximum concurrent migrations and GB transfer quotas.

### 4. Advanced Analytics & Email Reports (Phase 8)
- Real-time migration velocity charts (messages/sec, throughput).
- Automated completion PDF/CSV report generation and email dispatch.
