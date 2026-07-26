# Security Model

This document outlines the security architecture and mechanisms implemented in MigrationOS to protect sensitive credentials and comply with data privacy best practices.

## 1. AES-256-GCM Credential Encryption

All credentials (including IMAP passwords, Google OAuth tokens, and Microsoft access tokens) are stored in an encrypted format within the local SQLite database.

### Key Derivation & Configuration
- **Encryption Key Source**: An environment-based variable `ENCRYPTION_KEY` is loaded from `.env`.
- **Key Derivation Function**: The key is hashed using **SHA-256** to dynamically produce a 32-byte (256-bit) buffer, ensuring robust defense against key length mismatch errors.
- **Algorithm**: **AES-256-GCM** (Galois/Counter Mode).

### Payload Serialization
When credentials are encrypted, they are formatted as a colon-separated string:
`ivHex:authTagHex:encryptedHex`

- **Initialization Vector (IV)**: A unique, cryptographically random 12-byte IV is generated for *every* encryption operation using `crypto.randomBytes(12)`.
- **Authentication Tag**: GCM generates a 16-byte authentication tag during encryption. During decryption, this tag is validated to ensure that no data tampering has occurred.
- **Tampered Payload Rejection**: Any attempt to manipulate the encrypted values or use an incorrect decryption key immediately causes decryption to fail and rejects the payload.

## 2. Decryption & Least Privilege

Credential decryption occurs *only* when absolutely required:
1. **Connection Testing**: Decrypted on-the-fly inside the `POST /api/migrations/:id/test-connection` endpoint.
2. **Migration Processing**: Decrypted only inside the background worker execution path (`migration.worker.ts`) when configuring provider connection instances.
Decrypted credentials are never written to disk or persisted in cleartext state.

## 3. Secret Redaction & Leakage Protection

- **API Filtering**: Outgoing migrations responses (`GET /api/migrations` and `GET /api/migrations/:id`) automatically strip the `sourceCredentials` and `destCredentials` properties before serialization.
- **Object Redaction**: A recursive utility `redactSensitive()` traverses objects and replaces values for keys matching patterns like `password`, `access_token`, `refresh_token`, `client_secret` with `[REDACTED]`.
- **Log Sanitization**: The `serializeError()` utility parses error messages and uses regular expressions to redact secrets (e.g. `password=[REDACTED]`, `Bearer [REDACTED]`) before saving database logs or returning error messages to clients.
