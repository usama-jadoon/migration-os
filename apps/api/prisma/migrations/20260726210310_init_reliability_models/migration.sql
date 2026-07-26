-- CreateTable
CREATE TABLE "ProviderConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FolderMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "migrationId" TEXT NOT NULL,
    "sourceFolderName" TEXT NOT NULL,
    "destFolderName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalMessages" INTEGER NOT NULL DEFAULT 0,
    "migratedMessages" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FolderMapping_migrationId_fkey" FOREIGN KEY ("migrationId") REFERENCES "Migration" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MailboxMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "migrationId" TEXT NOT NULL,
    "sourceMailbox" TEXT NOT NULL,
    "destMailbox" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MailboxMapping_migrationId_fkey" FOREIGN KEY ("migrationId") REFERENCES "Migration" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MigrationCheckpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "migrationId" TEXT NOT NULL,
    "folderName" TEXT NOT NULL,
    "lastProcessedUid" TEXT,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MigrationCheckpoint_migrationId_fkey" FOREIGN KEY ("migrationId") REFERENCES "Migration" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MigratedItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "migrationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "folderName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MigratedItem_migrationId_fkey" FOREIGN KEY ("migrationId") REFERENCES "Migration" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MigrationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "migrationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MigrationEvent_migrationId_fkey" FOREIGN KEY ("migrationId") REFERENCES "Migration" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Migration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sourceProvider" TEXT NOT NULL,
    "sourceEmail" TEXT NOT NULL,
    "sourceCredentials" TEXT,
    "destProvider" TEXT NOT NULL,
    "destEmail" TEXT NOT NULL,
    "destCredentials" TEXT,
    "sourceConnectionId" TEXT,
    "destConnectionId" TEXT,
    "totalMessages" INTEGER NOT NULL DEFAULT 0,
    "migratedMessages" INTEGER NOT NULL DEFAULT 0,
    "failedMessages" INTEGER NOT NULL DEFAULT 0,
    "totalSizeBytes" BIGINT NOT NULL DEFAULT 0,
    "migratedSizeBytes" BIGINT NOT NULL DEFAULT 0,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Migration_sourceConnectionId_fkey" FOREIGN KEY ("sourceConnectionId") REFERENCES "ProviderConnection" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Migration_destConnectionId_fkey" FOREIGN KEY ("destConnectionId") REFERENCES "ProviderConnection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Migration" ("completedAt", "createdAt", "destCredentials", "destEmail", "destProvider", "failedMessages", "id", "migratedMessages", "migratedSizeBytes", "sourceCredentials", "sourceEmail", "sourceProvider", "startedAt", "status", "totalMessages", "totalSizeBytes", "updatedAt") SELECT "completedAt", "createdAt", "destCredentials", "destEmail", "destProvider", "failedMessages", "id", "migratedMessages", "migratedSizeBytes", "sourceCredentials", "sourceEmail", "sourceProvider", "startedAt", "status", "totalMessages", "totalSizeBytes", "updatedAt" FROM "Migration";
DROP TABLE "Migration";
ALTER TABLE "new_Migration" RENAME TO "Migration";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "FolderMapping_migrationId_sourceFolderName_key" ON "FolderMapping"("migrationId", "sourceFolderName");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationCheckpoint_migrationId_folderName_key" ON "MigrationCheckpoint"("migrationId", "folderName");

-- CreateIndex
CREATE UNIQUE INDEX "MigratedItem_idempotencyKey_key" ON "MigratedItem"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MigratedItem_migrationId_idx" ON "MigratedItem"("migrationId");

-- CreateIndex
CREATE INDEX "MigratedItem_idempotencyKey_idx" ON "MigratedItem"("idempotencyKey");
