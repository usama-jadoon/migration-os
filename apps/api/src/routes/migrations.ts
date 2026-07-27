import { Router, Response } from 'express';
import { prisma } from '../utils/db';
import { encrypt, decrypt } from '../utils/crypto';
import { proposeMappings } from '../utils/mapping';
import { connectorFactory } from '../utils/connector.factory';
import { migrationQueue } from '../queues/migration.queue';
import { authenticateSession, requireRole, AuthenticatedRequest } from '../middleware/auth.middleware';
import { CreateMigrationSchema, CredentialsUpdateSchema, TestConnectionSchema, MappingsUpdateSchema } from './validation';
import { billingService } from '../services/billing.service';
import { logger } from '../utils/logger';

export const migrationRoutes = Router();

// Enforce authentication on all migration routes
migrationRoutes.use(authenticateSession);

function sanitizeMigration(m: any) {
  if (!m) return null;
  const sanitized = { ...m };
  delete sanitized.sourceCredentials;
  delete sanitized.destCredentials;
  if (sanitized.totalSizeBytes !== undefined && sanitized.totalSizeBytes !== null) {
    sanitized.totalSizeBytes = sanitized.totalSizeBytes.toString();
  }
  if (sanitized.migratedSizeBytes !== undefined && sanitized.migratedSizeBytes !== null) {
    sanitized.migratedSizeBytes = sanitized.migratedSizeBytes.toString();
  }
  return sanitized;
}

// Create new migration (Operator, Admin, Owner)
migrationRoutes.post('/', requireRole(['owner', 'admin', 'operator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validated = CreateMigrationSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({ error: 'Invalid migration data', details: validated.error.issues });
    }

    // Check billing quota limits before creating new migration mailbox
    const billingCheck = await billingService.checkMigrationLimit(req.organizationId!);
    if (!billingCheck.allowed) {
      return res.status(402).json({ error: 'Payment Required', message: billingCheck.reason });
    }

    const { sourceProvider, sourceEmail, destProvider, destEmail } = validated.data;
    const migration = await prisma.migration.create({
      data: {
        organizationId: req.organizationId!,
        createdByUserId: req.user!.id,
        sourceProvider: sourceProvider || 'imap',
        sourceEmail: sourceEmail || '',
        destProvider: destProvider || 'imap',
        destEmail: destEmail || '',
        status: 'draft',
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: req.organizationId,
        userId: req.user!.id,
        action: 'create_migration',
        details: JSON.stringify({ migrationId: migration.id, sourceEmail, destEmail }),
        ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
      },
    });

    res.json(sanitizeMigration(migration));
  } catch (error: any) {
    logger.error('[MigrationRoute] Create error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// List all migrations for active organization
migrationRoutes.get('/', requireRole(['owner', 'admin', 'operator', 'viewer']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const migrations = await prisma.migration.findMany({
      where: { organizationId: req.organizationId! },
      orderBy: { createdAt: 'desc' },
      include: { folders: true },
    });
    res.json(migrations.map(sanitizeMigration));
  } catch (error: any) {
    logger.error('[MigrationRoute] List error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get single migration (Tenant-scoped IDOR prevention)
migrationRoutes.get('/:id', requireRole(['owner', 'admin', 'operator', 'viewer']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const migration = await prisma.migration.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId!,
      },
      include: { folderMappings: true, errors: true, logs: true },
    });

    if (!migration) {
      return res.status(404).json({ error: 'Migration not found' });
    }
    res.json(sanitizeMigration(migration));
  } catch (error: any) {
    logger.error('[MigrationRoute] Get error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Update credentials securely (Admin, Owner, Operator)
migrationRoutes.post('/:id/credentials', requireRole(['owner', 'admin', 'operator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validated = CredentialsUpdateSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({ error: 'Invalid credential schema', details: validated.error.issues });
    }

    const migration = await prisma.migration.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId!,
      },
    });

    if (!migration) {
      return res.status(404).json({ error: 'Migration not found' });
    }

    const { sourceCredentials, destCredentials } = validated.data;
    const encryptedSource = sourceCredentials ? encrypt(JSON.stringify(sourceCredentials)) : null;
    const encryptedDest = destCredentials ? encrypt(JSON.stringify(destCredentials)) : null;

    const updated = await prisma.migration.update({
      where: { id: migration.id },
      data: {
        ...(encryptedSource ? { sourceCredentials: encryptedSource } : {}),
        ...(encryptedDest ? { destCredentials: encryptedDest } : {}),
        status: 'validating',
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: req.organizationId,
        userId: req.user!.id,
        action: 'update_credentials',
        details: JSON.stringify({ migrationId: updated.id }),
        ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
      },
    });

    res.json({ status: 'success', message: 'Credentials updated and encrypted successfully.' });
  } catch (error: any) {
    logger.error('[MigrationRoute] Credentials update error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Test Connection for source and destination providers
migrationRoutes.post('/:id/test-connection', requireRole(['owner', 'admin', 'operator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validated = TestConnectionSchema.safeParse(req.query);
    if (!validated.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: validated.error.issues });
    }
    const { type } = validated.data;

    const migration = await prisma.migration.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId!,
      },
    });

    if (!migration) {
      return res.status(404).json({ error: 'Migration not found' });
    }

    const credsEncrypted = type === 'dest' ? migration.destCredentials : migration.sourceCredentials;
    const provider = type === 'dest' ? migration.destProvider : migration.sourceProvider;

    if (!credsEncrypted) {
      return res.status(400).json({ error: `Credentials for ${type} have not been provided.` });
    }

    const decrypted = decrypt(credsEncrypted);
    const connector = connectorFactory.create(provider, decrypted);
    const success = await connector.testConnection();

    await prisma.migrationEvent.create({
      data: {
        migrationId: migration.id,
        organizationId: req.organizationId!,
        eventType: 'connection_test',
        description: `Tested connection for ${type} provider (${provider}): ${success ? 'SUCCESS' : 'FAILED'}`,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: req.organizationId,
        userId: req.user!.id,
        action: 'test_connection',
        details: JSON.stringify({ migrationId: migration.id, type, provider, success }),
        ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
      },
    });

    if (success) {
      res.json({ status: 'success', message: 'Connection test passed.' });
    } else {
      res.status(400).json({ status: 'error', message: 'Connection test failed. Check settings and credentials.' });
    }
  } catch (error: any) {
    logger.error('[MigrationRoute] Test connection error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Discover folders and propose mappings
migrationRoutes.post('/:id/discover-folders', requireRole(['owner', 'admin', 'operator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const migration = await prisma.migration.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId!,
      },
    });

    if (!migration) {
      return res.status(404).json({ error: 'Migration not found' });
    }

    if (!migration.sourceCredentials) {
      return res.status(400).json({ error: 'Source credentials missing' });
    }

    const sourceCredsDecrypted = decrypt(migration.sourceCredentials);
    const sourceConnector = connectorFactory.create(migration.sourceProvider, sourceCredsDecrypted);

    await sourceConnector.authenticate();
    const sourceFolders = await sourceConnector.listFolders();
    await sourceConnector.disconnect();

    const proposals = proposeMappings(sourceFolders, migration.sourceProvider, migration.destProvider);

    await prisma.folderMapping.deleteMany({
      where: { migrationId: migration.id, organizationId: req.organizationId! },
    });

    for (const prop of proposals) {
      await prisma.folderMapping.create({
        data: {
          migrationId: migration.id,
          organizationId: req.organizationId!,
          sourceFolderName: prop.sourceFolderName,
          destFolderName: prop.destFolderName,
          enabled: prop.enabled,
        },
      });
    }

    await prisma.migration.update({
      where: { id: migration.id },
      data: { status: 'ready' },
    });

    res.json(proposals);
  } catch (error: any) {
    logger.error('[MigrationRoute] Discover folders error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get saved folder mappings
migrationRoutes.get('/:id/mappings', requireRole(['owner', 'admin', 'operator', 'viewer']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const migration = await prisma.migration.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId!,
      },
    });

    if (!migration) {
      return res.status(404).json({ error: 'Migration not found' });
    }

    const mappings = await prisma.folderMapping.findMany({
      where: { migrationId: migration.id, organizationId: req.organizationId! },
    });
    res.json(mappings);
  } catch (error: any) {
    logger.error('[MigrationRoute] Get mappings error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Update mappings
migrationRoutes.post('/:id/mappings', requireRole(['owner', 'admin', 'operator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validated = MappingsUpdateSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({ error: 'Invalid mappings update schema', details: validated.error.issues });
    }

    const migration = await prisma.migration.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId!,
      },
    });

    if (!migration) {
      return res.status(404).json({ error: 'Migration not found' });
    }

    const { mappings } = validated.data;
    for (const map of mappings) {
      await prisma.folderMapping.updateMany({
        where: {
          id: map.id,
          migrationId: migration.id,
          organizationId: req.organizationId!,
        },
        data: {
          enabled: map.enabled !== undefined ? map.enabled : true,
          destFolderName: map.destFolderName,
        },
      });
    }

    res.json({ status: 'success', message: 'Mappings updated successfully.' });
  } catch (error: any) {
    logger.error('[MigrationRoute] Update mappings error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Start migration
migrationRoutes.post('/:id/start', requireRole(['owner', 'admin', 'operator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const migration = await prisma.migration.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId!,
      },
    });

    if (!migration) {
      return res.status(404).json({ error: 'Migration not found' });
    }

    const allowed = ['ready', 'paused', 'failed', 'draft'];
    if (!allowed.includes(migration.status)) {
      return res.status(400).json({ error: `Cannot start migration from status '${migration.status}'.` });
    }

    // Check concurrency limits before starting worker job
    const billingCheck = await billingService.checkMigrationLimit(req.organizationId!);
    if (!billingCheck.allowed) {
      return res.status(402).json({ error: 'Payment Required', message: billingCheck.reason });
    }

    const updated = await prisma.migration.update({
      where: { id: migration.id },
      data: { status: 'queued', startedAt: new Date() },
    });

    await migrationQueue.addJob(updated.id, { ...updated, organizationId: req.organizationId! });

    await prisma.auditLog.create({
      data: {
        organizationId: req.organizationId,
        userId: req.user!.id,
        action: 'start_migration',
        details: JSON.stringify({ migrationId: migration.id }),
        ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
      },
    });

    res.json({ status: 'queued', migrationId: updated.id });
  } catch (error: any) {
    logger.error('[MigrationRoute] Start error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Pause migration
migrationRoutes.post('/:id/pause', requireRole(['owner', 'admin', 'operator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const migration = await prisma.migration.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId!,
      },
    });

    if (!migration || migration.status !== 'running') {
      return res.status(400).json({ error: 'Migration must be running to pause it.' });
    }

    const updated = await prisma.migration.update({
      where: { id: migration.id },
      data: { status: 'paused' },
    });

    await migrationQueue.pauseJob(updated.id);

    await prisma.auditLog.create({
      data: {
        organizationId: req.organizationId,
        userId: req.user!.id,
        action: 'pause_migration',
        details: JSON.stringify({ migrationId: migration.id }),
        ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
      },
    });

    res.json({ status: 'paused', migrationId: updated.id });
  } catch (error: any) {
    logger.error('[MigrationRoute] Pause error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Resume migration
migrationRoutes.post('/:id/resume', requireRole(['owner', 'admin', 'operator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const migration = await prisma.migration.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId!,
      },
    });

    if (!migration || migration.status !== 'paused') {
      return res.status(400).json({ error: 'Migration must be paused to resume it.' });
    }

    const updated = await prisma.migration.update({
      where: { id: migration.id },
      data: { status: 'running' },
    });

    await migrationQueue.resumeJob(updated.id);

    await prisma.auditLog.create({
      data: {
        organizationId: req.organizationId,
        userId: req.user!.id,
        action: 'resume_migration',
        details: JSON.stringify({ migrationId: migration.id }),
        ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
      },
    });

    res.json({ status: 'resumed', migrationId: updated.id });
  } catch (error: any) {
    logger.error('[MigrationRoute] Resume error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Cancel migration
migrationRoutes.post('/:id/cancel', requireRole(['owner', 'admin', 'operator']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const migration = await prisma.migration.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId!,
      },
    });

    if (!migration || (migration.status !== 'running' && migration.status !== 'paused' && migration.status !== 'queued')) {
      return res.status(400).json({ error: 'Migration must be queued, running, or paused to cancel.' });
    }

    const updated = await prisma.migration.update({
      where: { id: migration.id },
      data: { status: 'cancelled', completedAt: new Date() },
    });

    await migrationQueue.cancelJob(updated.id);

    await prisma.auditLog.create({
      data: {
        organizationId: req.organizationId,
        userId: req.user!.id,
        action: 'cancel_migration',
        details: JSON.stringify({ migrationId: migration.id }),
        ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
      },
    });

    res.json({ status: 'cancelled', migrationId: updated.id });
  } catch (error: any) {
    logger.error('[MigrationRoute] Cancel error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Delete migration (Admin, Owner only)
migrationRoutes.delete('/:id', requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const migration = await prisma.migration.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId!,
      },
    });

    if (!migration) {
      return res.status(404).json({ error: 'Migration not found' });
    }

    await prisma.migration.delete({ where: { id: migration.id } });

    await prisma.auditLog.create({
      data: {
        organizationId: req.organizationId,
        userId: req.user!.id,
        action: 'delete_migration',
        details: JSON.stringify({ migrationId: migration.id }),
        ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
      },
    });

    res.json({ status: 'success', message: 'Migration deleted successfully.' });
  } catch (error: any) {
    logger.error('[MigrationRoute] Delete error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get migration errors
migrationRoutes.get('/:id/errors', requireRole(['owner', 'admin', 'operator', 'viewer']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const migration = await prisma.migration.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId!,
      },
    });

    if (!migration) {
      return res.status(404).json({ error: 'Migration not found' });
    }

    const errors = await prisma.migrationError.findMany({
      where: { migrationId: migration.id, organizationId: req.organizationId! },
      orderBy: { createdAt: 'desc' },
    });
    res.json(errors);
  } catch (error: any) {
    logger.error('[MigrationRoute] Get errors error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get migration report
migrationRoutes.get('/:id/report', requireRole(['owner', 'admin', 'operator', 'viewer']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const migration = await prisma.migration.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId!,
      },
      include: { folderMappings: true, errors: true },
    });

    if (!migration) {
      return res.status(404).json({ error: 'Migration not found' });
    }

    res.json({
      id: migration.id,
      status: migration.status,
      totalMessages: migration.totalMessages,
      migratedMessages: migration.migratedMessages,
      failedMessages: migration.failedMessages,
      totalSizeBytes: migration.totalSizeBytes.toString(),
      migratedSizeBytes: migration.migratedSizeBytes.toString(),
      duration: migration.startedAt && migration.completedAt
        ? migration.completedAt.getTime() - migration.startedAt.getTime()
        : null,
      folderMappings: migration.folderMappings,
      errorCount: migration.errors.length,
    });
  } catch (error: any) {
    logger.error('[MigrationRoute] Get report error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});