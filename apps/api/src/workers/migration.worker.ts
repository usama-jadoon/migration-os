import { migrationQueue } from '../queues/migration.queue';
import { decrypt, serializeError } from '../utils/crypto';
import { generateIdempotencyKey } from '../utils/idempotency';
import { connectorFactory } from '../utils/connector.factory';
import { MigrationConnector } from '../types/connector.interface';
import { prisma } from '../utils/db';
import { logger } from '../utils/logger';
import { io } from '../index';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let isShuttingDown = false;

process.on('SIGTERM', handleGracefulShutdown);
process.on('SIGINT', handleGracefulShutdown);

async function handleGracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`[Worker] Received ${signal}. Starting graceful shutdown...`);

  try {
    await migrationQueue.close();
    await prisma.$disconnect();
    logger.info('[Worker] Connections closed. Exiting process safely.');
    process.exit(0);
  } catch (err: any) {
    logger.error('[Worker] Error during graceful shutdown:', { error: err.message });
    process.exit(1);
  }
}

migrationQueue.on('added', (job) => {
  logger.info(`[Queue] Job ${job.id} queued.`);
});

migrationQueue.on('started', (job) => {
  logger.info(`[Worker] Starting migration job ${job.id}`);
  const organizationId = job.data?.organizationId;
  runMigration(job.id, organizationId);
});

migrationQueue.on('paused', (job) => {
  logger.info(`[Worker] Paused migration job ${job.id}`);
  const orgId = job.data?.organizationId;
  if (io && orgId) {
    io.to(`org:${orgId}`).emit('migration:paused', { migrationId: job.id });
  }
});

migrationQueue.on('resumed', (job) => {
  logger.info(`[Worker] Resumed migration job ${job.id}`);
  const orgId = job.data?.organizationId;
  if (io && orgId) {
    io.to(`org:${orgId}`).emit('migration:resumed', { migrationId: job.id });
  }
});

migrationQueue.on('cancelled', (job) => {
  logger.info(`[Worker] Cancelled migration job ${job.id}`);
  const orgId = job.data?.organizationId;
  if (io && orgId) {
    io.to(`org:${orgId}`).emit('migration:cancelled', { migrationId: job.id });
  }
});

export async function runMigration(migrationId: string, organizationId?: string) {
  let source: MigrationConnector | null = null;
  let destination: MigrationConnector | null = null;
  const startTime = Date.now();

  try {
    let migration = await prisma.migration.findFirst({
      where: organizationId ? { id: migrationId, organizationId } : { id: migrationId },
    });

    if (!migration) {
      logger.error(`[Worker] Migration ${migrationId} not found or tenant mismatched.`);
      return;
    }

    const tenantId = migration.organizationId;

    if (migration.status !== 'queued' && migration.status !== 'running') {
      logger.warn(`[Worker] Migration ${migrationId} in unexpected status '${migration.status}'. Aborting.`);
      return;
    }

    migration = await prisma.migration.update({
      where: { id: migrationId },
      data: { status: 'running' },
    });

    await prisma.migrationLog.create({
      data: {
        migrationId,
        organizationId: tenantId,
        level: 'info',
        message: 'Decrypted credentials and connecting to endpoints...',
      },
    });

    const decryptedSourceCreds = migration.sourceCredentials ? decrypt(migration.sourceCredentials) : null;
    const decryptedDestCreds = migration.destCredentials ? decrypt(migration.destCredentials) : null;

    source = connectorFactory.create(migration.sourceProvider, decryptedSourceCreds);
    destination = connectorFactory.create(migration.destProvider, decryptedDestCreds);

    await source.authenticate();
    await destination.authenticate();

    let folderMappings = await prisma.folderMapping.findMany({
      where: { migrationId, organizationId: tenantId },
    });

    if (folderMappings.length === 0) {
      const folders = await source.listFolders();
      for (const folder of folders) {
        await destination.createFolder(folder.path);
        await prisma.folderMapping.create({
          data: {
            migrationId,
            organizationId: tenantId,
            sourceFolderName: folder.path,
            destFolderName: folder.path,
            enabled: true,
            totalMessages: folder.messageCount,
          },
        });
      }
      folderMappings = await prisma.folderMapping.findMany({
        where: { migrationId, organizationId: tenantId },
      });
    }

    const activeMappings = folderMappings.filter((m) => m.enabled);
    const totalMessages = activeMappings.reduce((sum, m) => sum + m.totalMessages, 0);

    await prisma.migration.update({
      where: { id: migrationId },
      data: { totalMessages },
    });

    await prisma.migrationLog.create({
      data: {
        migrationId,
        organizationId: tenantId,
        level: 'info',
        message: `Beginning migration of ${activeMappings.length} mapped folders (${totalMessages} total messages).`,
      },
    });

    let globalMigratedCount = migration.migratedMessages;

    for (const mapping of activeMappings) {
      if (isShuttingDown) {
        logger.info(`[Worker] Graceful shutdown in progress. Yielding folder migration ${mapping.sourceFolderName}.`);
        return;
      }

      if (mapping.status === 'completed') {
        logger.info(`[Worker] Folder ${mapping.sourceFolderName} already completed. Skipping.`);
        continue;
      }

      await prisma.migrationLog.create({
        data: {
          migrationId,
          organizationId: tenantId,
          level: 'info',
          message: `Migrating folder: ${mapping.sourceFolderName} -> ${mapping.destFolderName}`,
        },
      });

      await prisma.folderMapping.update({
        where: { id: mapping.id },
        data: { status: 'running' },
      });

      await destination.createFolder(mapping.destFolderName);

      let checkpoint = await prisma.migrationCheckpoint.findUnique({
        where: {
          migrationId_folderName: { migrationId, folderName: mapping.sourceFolderName },
        },
      });

      let pageToken: string | undefined = checkpoint?.lastProcessedUid || undefined;
      let hasMore = true;
      let folderMigratedCount = checkpoint?.processedCount || 0;

      while (hasMore) {
        if (isShuttingDown) return;

        const currentMigration = await prisma.migration.findFirst({
          where: { id: migrationId, organizationId: tenantId },
        });

        if (!currentMigration) return;

        if (currentMigration.status === 'paused') {
          await prisma.migrationLog.create({
            data: { migrationId, organizationId: tenantId, level: 'info', message: 'Migration paused by user.' },
          });
          while (true) {
            await sleep(1000);
            if (isShuttingDown) return;
            const statusCheck = await prisma.migration.findFirst({
              where: { id: migrationId, organizationId: tenantId },
            });
            if (!statusCheck || statusCheck.status === 'cancelled') return;
            if (statusCheck.status === 'running') break;
          }
        }

        if (currentMigration.status === 'cancelled') {
          await prisma.migrationLog.create({
            data: { migrationId, organizationId: tenantId, level: 'info', message: 'Migration cancelled by user.' },
          });
          return;
        }

        const batch = await source.listMessages(mapping.sourceFolderName, {
          pageToken,
          batchSize: 50,
        });

        for (const msg of batch.messages) {
          const sizeBytes = msg.rawMime?.length || 0;
          const idempotencyKey = generateIdempotencyKey(
            migrationId,
            mapping.sourceFolderName,
            msg.sourceId,
            msg.internetMessageId,
            sizeBytes,
            msg.receivedAt
          );

          const alreadyMigrated = await prisma.migratedItem.findUnique({
            where: { idempotencyKey },
          });

          if (alreadyMigrated) {
            continue;
          }

          const flags: string[] = [];
          if (msg.isRead) flags.push('\\Seen');
          if (msg.isFlagged) flags.push('\\Flagged');
          if (msg.isDraft) flags.push('\\Draft');
          if (msg.isSpam) flags.push('\\Junk');
          if (msg.isTrash) flags.push('\\Deleted');

          const result = await destination.importMessage(msg, mapping.destFolderName, flags);

          if (result.success) {
            try {
              await prisma.migratedItem.create({
                data: {
                  migrationId,
                  organizationId: tenantId,
                  idempotencyKey,
                  sourceItemId: msg.sourceId,
                  folderName: mapping.sourceFolderName,
                },
              });
            } catch (itemErr: any) {
              if (itemErr?.code !== 'P2002') {
                throw itemErr;
              }
            }

            folderMigratedCount++;
            globalMigratedCount++;

            if (globalMigratedCount % 5 === 0 || globalMigratedCount === totalMessages) {
              await prisma.migration.update({
                where: { id: migrationId },
                data: {
                  migratedMessages: globalMigratedCount,
                  migratedSizeBytes: { increment: BigInt(sizeBytes) },
                },
              });

              await prisma.folderMapping.update({
                where: { id: mapping.id },
                data: { migratedMessages: folderMigratedCount },
              });
            }

            const elapsed = (Date.now() - startTime) / 1000 / 3600;
            const speed = elapsed > 0 ? Math.round(globalMigratedCount / elapsed) : 0;
            const remainingMins = speed > 0 ? Math.round(((totalMessages - globalMigratedCount) / speed) * 60) : 0;

            if (io) {
              const progressPayload = {
                migrationId,
                migratedMessages: globalMigratedCount,
                totalMessages,
                percentage: totalMessages > 0 ? Math.round((globalMigratedCount / totalMessages) * 100) : 0,
                currentFolder: mapping.sourceFolderName,
                speed,
                estimatedMinutesRemaining: Math.max(0, remainingMins),
              };

              io.to(`migration:${tenantId}:${migrationId}`).emit('migration:progress', progressPayload);
              io.to(`org:${tenantId}`).emit('migration:progress', progressPayload);
            }
          } else {
            await prisma.migrationError.create({
              data: {
                migrationId,
                organizationId: tenantId,
                messageId: msg.sourceId,
                folderName: mapping.sourceFolderName,
                errorMessage: serializeError(result.error || 'Import failed'),
              },
            });

            await prisma.migration.update({
              where: { id: migrationId },
              data: { failedMessages: { increment: 1 } },
            });
          }
        }

        pageToken = batch.nextPageToken;
        hasMore = batch.hasMore;

        await prisma.migrationCheckpoint.upsert({
          where: {
            migrationId_folderName: { migrationId, folderName: mapping.sourceFolderName },
          },
          update: {
            lastProcessedUid: pageToken,
            processedCount: folderMigratedCount,
            updatedAt: new Date(),
          },
          create: {
            migrationId,
            organizationId: tenantId,
            folderName: mapping.sourceFolderName,
            lastProcessedUid: pageToken,
            processedCount: folderMigratedCount,
            updatedAt: new Date(),
          },
        });
      }

      await prisma.folderMapping.update({
        where: { id: mapping.id },
        data: { status: 'completed' },
      });
    }

    const errorCount = await prisma.migrationError.count({ where: { migrationId, organizationId: tenantId } });
    const finalStatus = errorCount > 0 ? 'completed_with_errors' : 'completed';

    await prisma.migration.update({
      where: { id: migrationId },
      data: {
        status: finalStatus,
        completedAt: new Date(),
      },
    });

    await prisma.migrationLog.create({
      data: {
        migrationId,
        organizationId: tenantId,
        level: 'info',
        message: `Migration completed: status is '${finalStatus}'.`,
      },
    });

    if (io) {
      const completedPayload = {
        migrationId,
        totalMigrated: globalMigratedCount,
        totalFailed: errorCount,
      };

      io.to(`migration:${tenantId}:${migrationId}`).emit('migration:completed', completedPayload);
      io.to(`org:${tenantId}`).emit('migration:completed', completedPayload);
    }
  } catch (error: any) {
    const errorMsg = serializeError(error);
    logger.error('[Worker] Fatal error during migration:', { error: errorMsg });

    await prisma.migration.update({
      where: { id: migrationId },
      data: { status: 'failed', completedAt: new Date() },
    });

    await prisma.migrationLog.create({
      data: {
        migrationId,
        organizationId: organizationId || 'unknown',
        level: 'error',
        message: `Migration failed: ${errorMsg}`,
      },
    });

    if (io && organizationId) {
      io.to(`org:${organizationId}`).emit('migration:error', {
        migrationId,
        error: errorMsg,
      });
    }
  } finally {
    if (source) {
      await source.disconnect();
    }
    if (destination) {
      await destination.disconnect();
    }
  }
}
