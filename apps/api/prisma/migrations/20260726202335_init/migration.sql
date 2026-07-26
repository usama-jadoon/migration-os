-- CreateTable
CREATE TABLE "Migration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sourceProvider" TEXT NOT NULL,
    "sourceEmail" TEXT NOT NULL,
    "sourceCredentials" TEXT,
    "destProvider" TEXT NOT NULL,
    "destEmail" TEXT NOT NULL,
    "destCredentials" TEXT,
    "totalMessages" INTEGER NOT NULL DEFAULT 0,
    "migratedMessages" INTEGER NOT NULL DEFAULT 0,
    "failedMessages" INTEGER NOT NULL DEFAULT 0,
    "totalSizeBytes" BIGINT NOT NULL DEFAULT 0,
    "migratedSizeBytes" BIGINT NOT NULL DEFAULT 0,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MigrationFolder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "migrationId" TEXT NOT NULL,
    "sourceFolderName" TEXT NOT NULL,
    "destFolderName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalMessages" INTEGER NOT NULL DEFAULT 0,
    "migratedMessages" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MigrationFolder_migrationId_fkey" FOREIGN KEY ("migrationId") REFERENCES "Migration" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MigrationError" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "migrationId" TEXT NOT NULL,
    "messageId" TEXT,
    "folderName" TEXT,
    "errorMessage" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MigrationError_migrationId_fkey" FOREIGN KEY ("migrationId") REFERENCES "Migration" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MigrationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "migrationId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MigrationLog_migrationId_fkey" FOREIGN KEY ("migrationId") REFERENCES "Migration" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
