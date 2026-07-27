# Tech Stack & Dependency Matrix — MigrationOS

**Last Updated**: July 27, 2026  

---

## 1. Runtime Environment

- **Node.js**: `v24.18.0` (CommonJS / ESM workspace execution)
- **Package Manager**: `npm` v10+ with Workspace monorepo support (`apps/*`, `packages/*`)
- **OS Compatibility**: Windows 11, Linux (Ubuntu/Debian Alpine Docker images), macOS

---

## 2. API Workspace (`apps/api`)

| Package / Tool | Version | Purpose |
| :--- | :--- | :--- |
| **Express** | `^4.18.0` | HTTP REST API Web Server framework |
| **Prisma Client** | `^6.9.0` | ORM database client & schema query builder |
| **Prisma CLI** | `^6.9.0` | Migration and database management CLI |
| **imapflow** | `^1.5.0` | High-performance async IMAP client library |
| **googleapis** | `^173.0.0` | Official Google APIs client library |
| **@microsoft/microsoft-graph-client** | `^3.0.7` | Microsoft Graph API SDK |
| **bullmq** | `^5.81.2` | Distributed background queue for Redis |
| **ioredis** | `^5.11.1` | High-performance Redis client for Node.js |
| **zod** | `^4.4.3` | TypeScript-first schema & environment validation |
| **socket.io** | `^4.7.0` | Real-time WebSocket server for progress streaming |
| **cors** | `^2.8.5` | Cross-Origin Resource Sharing middleware |
| **dotenv** | `^16.4.0` | Environment variable loader |
| **jest** | `^30.4.2` | Automated unit & integration testing framework |
| **supertest** | `^7.0.0` | HTTP assertion testing library for Express APIs |
| **tsx** | `^4.19.0` | Fast TypeScript execute runtime for development |
| **typescript** | `^5.0.0` | Static type checker & compiler |

---

## 3. Web Workspace (`apps/web`)

| Package / Tool | Version | Purpose |
| :--- | :--- | :--- |
| **Next.js** | `^14.2.35` | React App Router Web Framework |
| **React** | `^18.3.1` | UI Component Library |
| **React DOM** | `^18.3.1` | DOM rendering for React |
| **socket.io-client** | `^4.7.0` | Real-time WebSocket client for Next.js |
| **tailwindcss** | `^3.4.0` | Utility-first CSS styling framework |
| **autoprefixer** | `^10.4.0` | PostCSS plugin to parse CSS & add vendor prefixes |
| **postcss** | `^8.4.0` | CSS transformation engine |
| **rimraf** | `^6.0.0` | Clean build cache utility (`rimraf .next`) |

---

## 4. Databases & Infrastructure

- **Primary Database**: SQLite (`apps/api/prisma/migrationos.db`) for local zero-install dev / PostgreSQL 16 (`migrationos_db`) for production deployments.
- **Message Queue**: Memory Queue (`MemoryMigrationQueue`) for local dev / Redis 7 (`migrationos-redis`) + BullMQ for production clusters.
- **Containers**: Docker & Docker Compose (`docker-compose.yml`).
