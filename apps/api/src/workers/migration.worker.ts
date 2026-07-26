import { migrationQueue } from '../queues/migration.queue';
import { decrypt, serializeError } from '../utils/crypto';
import { generateIdempotencyKey } from '../utils/idempotency';
import { connectorFactory } from '../utils/connector.factory';
import { MigrationConnector } from '../types/connector.interface';
import { PrismaClient } from '@prisma/client';
import { io } from '../index';

const prisma = new PrismaClient();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Register event listeners
migrationQueue.on('added', (job) => {
  console.log(`[Queue] Job ${job.id} queued.`);
});

migrationQueue.on('started', (job) => {
  console.log(`[Worker] Starting migration job ${job.id}`);
  runMigration(job.id);
});

migrationQueue.on('paused', (job) => {
  console.log(`[Worker] Paused migration job ${job.id}`);
  io.emit('migration:paused', { migrationId: job.id });
});

migrationQueue.on('resumed', (job) => {
  console.log(`[Worker] Resumed migration job ${job.id}`);
  io.emit('migration:resumed', { migrationId: job.id });
});

migrationQueue.on('cancelled', (job) => {
  console.log(`[Worker] Cancelled migration job ${job.id}`);
  io.emit('migration:cancelled', { migrationId: job.id });
});

export async function runMigration(migrationId: string) {
  let source: MigrationConnector | null = null;
  let destination: MigrationConnector | null = null;
  const startTime = Date.now();

  try {
    // 1. Load migration
    let migration = await prisma.migration.findUnique({
      where: { id: migrationId }
    });

    if (!migration) {
      console.error(`[Worker] Migration ${migrationId} not found.`);
      return;
    }

    // 2. Validate state
    if (migration.status !== 'queued' && migration.status !== 'running') {
      console.warn(`[Worker] Migration ${migrationId} in unexpected status '${migration.status}'. Aborting.`);
      return;
    }

    // Update status to running
    migration = await prisma.migration.update({
      where: { id: migrationId },
      data: { status: 'running' }
    });

    await prisma.migrationLog.create({
      data: { migrationId, level: 'info', message: 'Decrypted credentials and connecting to endpoints...' }
    });

    // 3. Decrypt credentials & factory instantiations
    const decryptedSourceCreds = migration.sourceCredentials ? decrypt(migration.sourceCredentials) : null;
    const decryptedDestCreds = migration.destCredentials ? decrypt(migration.destCredentials) : null;

    source = connectorFactory.create(migration.sourceProvider, decryptedSourceCreds);
    destination = connectorFactory.create(migration.destProvider, decryptedDestCreds);

    // 4. Authenticate connectors
    await source.authenticate();
    await destination.authenticate();

    // 5. Discover or load folders & proposal mapping
    let folderMappings = await prisma.folderMapping.findMany({
      where: { migrationId }
    });

    if (folderMappings.length === 0) {
      // First discovery
      const folders = await source.listFolders();
      for (const folder of folders) {
        await destination.createFolder(folder.path);
        await prisma.folderMapping.create({
          data: {
            migrationId,
            sourceFolderName: folder.path,
            destFolderName: folder.path,
            enabled: true,
            totalMessages: folder.messageCount,
          }
        });
      }
      folderMappings = await prisma.folderMapping.findMany({
        where: { migrationId }
      });
    }

    // Filter to only enabled mappings
    const activeMappings = folderMappings.filter(m => m.enabled);

    // 6. Calculate real totals
    const totalMessages = activeMappings.reduce((sum, m) => sum + m.totalMessages, 0);
    await prisma.migration.update({
      where: { id: migrationId },
      data: { totalMessages }
    });

    await prisma.migrationLog.create({
      data: { migrationId, level: 'info', message: `Beginning migration of ${activeMappings.length} mapped folders (${totalMessages} total messages).` }
    });

    let globalMigratedCount = migration.migratedMessages;

    // 7. Migrate messages folder by folder
    for (const mapping of activeMappings) {
      // Skip completed folders
      if (mapping.status === 'completed') {
        console.log(`[Worker] Folder ${mapping.sourceFolderName} already completed. Skipping.`);
        continue;
      }

      await prisma.migrationLog.create({
        data: { migrationId, level: 'info', message: `Migrating folder: ${mapping.sourceFolderName} -> ${mapping.destFolderName}` }
      });

      // Update folder status
      await prisma.folderMapping.update({
        where: { id: mapping.id },
        data: { status: 'running' }
      });

      // Create destination folder on destination if missing
      await destination.createFolder(mapping.destFolderName);

      // Checkpoint resume load
      let checkpoint = await prisma.migrationCheckpoint.findUnique({
        where: {
          migrationId_folderName: { migrationId, folderName: mapping.sourceFolderName }
        }
      });

      let pageToken: string | undefined = checkpoint?.lastProcessedUid || undefined;
      let hasMore = true;
      let folderMigratedCount = checkpoint?.processedCount || 0;

      while (hasMore) {
        // Yield check: read current migration status from the DB to detect Pause/Cancel
        const currentMigration = await prisma.migration.findUnique({
          where: { id: migrationId }
        });

        if (!currentMigration) return;

        if (currentMigration.status === 'paused') {
          await prisma.migrationLog.create({
            data: { migrationId, level: 'info', message: 'Migration paused by user.' }
          });
          // Spin-wait until resumed or cancelled
          while (true) {
            await sleep(1000);
            const statusCheck = await prisma.migration.findUnique({
              where: { id: migrationId }
            });
            if (!statusCheck || statusCheck.status === 'cancelled') return;
            if (statusCheck.status === 'running') break;
          }
        }

        if (currentMigration.status === 'cancelled') {
          await prisma.migrationLog.create({
            data: { migrationId, level: 'info', message: 'Migration cancelled by user.' }
          });
          return;
        }

        // Fetch messages batch
        const batch = await source.listMessages(mapping.sourceFolderName, {
          pageToken,
          batchSize: 50
        });

        for (const msg of batch.messages) {
          // Generate idempotency key for duplicate checks
          const sizeBytes = msg.rawMime?.length || 0;
          const idempotencyKey = generateIdempotencyKey(
            migrationId,
            mapping.sourceFolderName,
            msg.sourceId,
            msg.internetMessageId,
            sizeBytes,
            msg.receivedAt
          );

          // Check if already migrated
          const alreadyMigrated = await prisma.migratedItem.findUnique({
            where: { idempotencyKey }
          });

          if (alreadyMigrated) {
            continue; // Skip without duplicating
          }

          // Map IMAP flags from UniversalMessage parameters
          const flags: string[] = [];
          if (msg.isRead) flags.push('\\Seen'); // Note: For IMAP, read is usually represented by \Seen. if it's NOT read it lacks \Seen. However UniversalMessage handles it via isRead.
          if (msg.isFlagged) flags.push('\\Flagged');
          if (msg.isDraft) flags.push('\\Draft');
          if (msg.isSpam) flags.push('\\Junk'); // Different servers handle spam flags differently, let's omit or map to Junk
          if (msg.isTrash) flags.push('\\Deleted');

          // Import message to destination
          const result = await destination.importMessage(msg, mapping.destFolderName, flags);

          if (result.success) {
            // Save migrated item log
            try {
              await prisma.migratedItem.create({
                data: {
                  migrationId,
                  idempotencyKey,
                  sourceItemId: msg.sourceId,
                  folderName: mapping.sourceFolderName
                }
              });
            } catch (itemErr: any) {
              if (itemErr?.code !== 'P2002') {
                throw itemErr;
              }
            }

            folderMigratedCount++;
            globalMigratedCount++;

            // Throttled updates to DB to avoid lock bottlenecking
            if (globalMigratedCount % 5 === 0 || globalMigratedCount === totalMessages) {
              await prisma.migration.update({
                where: { id: migrationId },
                data: {
                  migratedMessages: globalMigratedCount,
                  migratedSizeBytes: { increment: BigInt(sizeBytes) }
                }
              });

              await prisma.folderMapping.update({
                where: { id: mapping.id },
                data: { migratedMessages: folderMigratedCount }
              });
            }

            // Emit live progress update
            const elapsed = (Date.now() - startTime) / 1000 / 3600;
            const speed = elapsed > 0 ? Math.round(globalMigratedCount / elapsed) : 0;
            const remainingMins = speed > 0 ? Math.round(((totalMessages - globalMigratedCount) / speed) * 60) : 0;

            io.emit('migration:progress', {
              migrationId,
              migratedMessages: globalMigratedCount,
              totalMessages,
              percentage: totalMessages > 0 ? Math.round((globalMigratedCount / totalMessages) * 100) : 0,
              currentFolder: mapping.sourceFolderName,
              speed,
              estimatedMinutesRemaining: Math.max(0, remainingMins)
            });
          } else {
            // Log folder errors but continue
            await prisma.migrationError.create({
              data: {
                migrationId,
                messageId: msg.sourceId,
                folderName: mapping.sourceFolderName,
                errorMessage: serializeError(result.error || 'Import failed')
              }
            });

            await prisma.migration.update({
              where: { id: migrationId },
              data: { failedMessages: { increment: 1 } }
            });
          }
        }

        pageToken = batch.nextPageToken;
        hasMore = batch.hasMore;

        // Persist database checkpoint after each batch
        await prisma.migrationCheckpoint.upsert({
          where: {
            migrationId_folderName: { migrationId, folderName: mapping.sourceFolderName }
          },
          update: {
            lastProcessedUid: pageToken,
            processedCount: folderMigratedCount,
            updatedAt: new Date()
          },
          create: {
            migrationId,
            folderName: mapping.sourceFolderName,
            lastProcessedUid: pageToken,
            processedCount: folderMigratedCount,
            updatedAt: new Date()
          }
        });
      }

      // Mark folder mapping completed
      await prisma.folderMapping.update({
        where: { id: mapping.id },
        data: { status: 'completed' }
      });
    }

    // 8. Mark completed
    const errorCount = await prisma.migrationError.count({ where: { migrationId } });
    const finalStatus = errorCount > 0 ? 'completed_with_errors' : 'completed';

    await prisma.migration.update({
      where: { id: migrationId },
      data: {
        status: finalStatus,
        completedAt: new Date()
      }
    });

    await prisma.migrationLog.create({
      data: { migrationId, level: 'info', message: `Migration completed: status is '${finalStatus}'.` }
    });

    io.emit('migration:completed', {
      migrationId,
      totalMigrated: globalMigratedCount,
      totalFailed: errorCount
    });

  } catch (error: any) {
    const errorMsg = serializeError(error);
    console.error('[Worker] Fatal error during migration:', errorMsg);

    await prisma.migration.update({
      where: { id: migrationId },
      data: { status: 'failed', completedAt: new Date() }
    });

    await prisma.migrationLog.create({
      data: { migrationId, level: 'error', message: `Migration failed: ${errorMsg}` }
    });

    io.emit('migration:error', {
      migrationId,
      error: errorMsg
    });
  } finally {
    // 9. Clean disconnect in all scenarios
    if (source) {
      await source.disconnect();
    }
    if (destination) {
      await destination.disconnect();
    }
  }
}
