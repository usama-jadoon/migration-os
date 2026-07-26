import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { encrypt, decrypt } from '../utils/crypto';
import { proposeMappings } from '../utils/mapping';
import { connectorFactory } from '../utils/connector.factory';
import { migrationQueue } from '../queues/migration.queue';

import { CreateMigrationSchema, CredentialsUpdateSchema, TestConnectionSchema, MappingsUpdateSchema } from './validation';

const prisma = new PrismaClient();

export const migrationRoutes = Router();

/**
 * Sanitizes migration data to strip raw encrypted credentials and serialize BigInts.
 */
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

// Create new migration
migrationRoutes.post('/', async (req, res) => {
  try {
    const validated = CreateMigrationSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({ error: 'Invalid migration data', details: validated.error.issues });
    }

    const { sourceProvider, sourceEmail, destProvider, destEmail } = validated.data;
    const migration = await prisma.migration.create({
      data: {
        sourceProvider: sourceProvider || 'imap',
        sourceEmail: sourceEmail || '',
        destProvider: destProvider || 'imap',
        destEmail: destEmail || '',
        status: 'draft',
      },
    });
    res.json(sanitizeMigration(migration));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// List all migrations
migrationRoutes.get('/', async (req, res) => {
  try {
    const migrations = await prisma.migration.findMany({
      orderBy: { createdAt: 'desc' },
      include: { folders: true },
    });
    res.json(migrations.map(sanitizeMigration));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get single migration
migrationRoutes.get('/:id', async (req, res) => {
  try {
    const migration = await prisma.migration.findUnique({
      where: { id: req.params.id },
      include: { folderMappings: true, errors: true, logs: true },
    });
    if (!migration) {
      return res.status(404).json({ error: 'Migration not found' });
    }
    res.json(sanitizeMigration(migration));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update credentials securely (encrypted)
migrationRoutes.post('/:id/credentials', async (req, res) => {
  try {
    const validated = CredentialsUpdateSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({ error: 'Invalid credential schema', details: validated.error.issues });
    }

    const { sourceCredentials, destCredentials } = validated.data;

    const encryptedSource = sourceCredentials ? encrypt(JSON.stringify(sourceCredentials)) : null;
    const encryptedDest = destCredentials ? encrypt(JSON.stringify(destCredentials)) : null;

    const migration = await prisma.migration.update({
      where: { id: req.params.id },
      data: {
        ...(encryptedSource ? { sourceCredentials: encryptedSource } : {}),
        ...(encryptedDest ? { destCredentials: encryptedDest } : {}),
        status: 'validating',
      },
    });

    // Create Audit Log
    await prisma.auditLog.create({
      data: {
        action: 'update_credentials',
        details: JSON.stringify({ migrationId: migration.id }),
      }
    });

    res.json({ status: 'success', message: 'Credentials updated and encrypted successfully.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Test Connection for source and destination providers
migrationRoutes.post('/:id/test-connection', async (req, res) => {
  try {
    const validated = TestConnectionSchema.safeParse(req.query);
    if (!validated.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: validated.error.issues });
    }
    const { type } = validated.data;

    const migration = await prisma.migration.findUnique({
      where: { id: req.params.id },
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

    // Create Migration Event
    await prisma.migrationEvent.create({
      data: {
        migrationId: migration.id,
        eventType: 'connection_test',
        description: `Tested connection for ${type} provider (${provider}): ${success ? 'SUCCESS' : 'FAILED'}`,
      }
    });

    if (success) {
      res.json({ status: 'success', message: 'Connection test passed.' });
    } else {
      res.status(400).json({ status: 'error', message: 'Connection test failed. Check settings and credentials.' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Discover folders and propose mappings
migrationRoutes.post('/:id/discover-folders', async (req, res) => {
  try {
    const migration = await prisma.migration.findUnique({
      where: { id: req.params.id },
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

    // Save folder mappings in FolderMapping table (clearing old mappings first)
    await prisma.folderMapping.deleteMany({
      where: { migrationId: migration.id }
    });

    for (const prop of proposals) {
      await prisma.folderMapping.create({
        data: {
          migrationId: migration.id,
          sourceFolderName: prop.sourceFolderName,
          destFolderName: prop.destFolderName,
          enabled: prop.enabled,
        }
      });
    }

    // Update status to 'ready'
    await prisma.migration.update({
      where: { id: migration.id },
      data: { status: 'ready' }
    });

    res.json(proposals);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get saved folder mappings
migrationRoutes.get('/:id/mappings', async (req, res) => {
  try {
    const mappings = await prisma.folderMapping.findMany({
      where: { migrationId: req.params.id }
    });
    res.json(mappings);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update mappings (e.g. enable/disable or change custom dest name)
migrationRoutes.post('/:id/mappings', async (req, res) => {
  try {
    const validated = MappingsUpdateSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({ error: 'Invalid mappings update schema', details: validated.error.issues });
    }
    const { mappings } = validated.data;


    for (const map of mappings) {
      await prisma.folderMapping.update({
        where: { id: map.id },
        data: {
          enabled: map.enabled !== undefined ? map.enabled : true,
          destFolderName: map.destFolderName,
        }
      });
    }

    res.json({ status: 'success', message: 'Mappings updated successfully.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Start migration (transition checking + enqueueing)
migrationRoutes.post('/:id/start', async (req, res) => {
  try {
    const migration = await prisma.migration.findUnique({
      where: { id: req.params.id },
    });

    if (!migration) {
      return res.status(404).json({ error: 'Migration not found' });
    }

    // Transition Validation
    const allowed = ['ready', 'paused', 'failed', 'draft'];
    if (!allowed.includes(migration.status)) {
      return res.status(400).json({ error: `Cannot start migration from status '${migration.status}'.` });
    }

    const updated = await prisma.migration.update({
      where: { id: req.params.id },
      data: { status: 'queued', startedAt: new Date() },
    });

    // Add to in-memory queue
    await migrationQueue.addJob(updated.id, updated);

    // Create Audit Log
    await prisma.auditLog.create({
      data: {
        action: 'start_migration',
        details: JSON.stringify({ migrationId: migration.id }),
      }
    });

    res.json({ status: 'queued', migrationId: updated.id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Pause migration
migrationRoutes.post('/:id/pause', async (req, res) => {
  try {
    const migration = await prisma.migration.findUnique({
      where: { id: req.params.id },
    });

    if (!migration || migration.status !== 'running') {
      return res.status(400).json({ error: 'Migration must be running to pause it.' });
    }

    const updated = await prisma.migration.update({
      where: { id: req.params.id },
      data: { status: 'paused' },
    });
    
    await migrationQueue.pauseJob(updated.id);

    // Create Audit Log
    await prisma.auditLog.create({
      data: {
        action: 'pause_migration',
        details: JSON.stringify({ migrationId: migration.id }),
      }
    });

    res.json({ status: 'paused', migrationId: updated.id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Resume migration
migrationRoutes.post('/:id/resume', async (req, res) => {
  try {
    const migration = await prisma.migration.findUnique({
      where: { id: req.params.id },
    });

    if (!migration || migration.status !== 'paused') {
      return res.status(400).json({ error: 'Migration must be paused to resume it.' });
    }

    const updated = await prisma.migration.update({
      where: { id: req.params.id },
      data: { status: 'running' },
    });

    await migrationQueue.resumeJob(updated.id);

    // Create Audit Log
    await prisma.auditLog.create({
      data: {
        action: 'resume_migration',
        details: JSON.stringify({ migrationId: migration.id }),
      }
    });

    res.json({ status: 'resumed', migrationId: updated.id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel migration
migrationRoutes.post('/:id/cancel', async (req, res) => {
  try {
    const migration = await prisma.migration.findUnique({
      where: { id: req.params.id },
    });

    if (!migration || (migration.status !== 'running' && migration.status !== 'paused' && migration.status !== 'queued')) {
      return res.status(400).json({ error: 'Migration must be queued, running, or paused to cancel.' });
    }

    const updated = await prisma.migration.update({
      where: { id: req.params.id },
      data: { status: 'cancelled', completedAt: new Date() },
    });

    await migrationQueue.cancelJob(updated.id);

    // Create Audit Log
    await prisma.auditLog.create({
      data: {
        action: 'cancel_migration',
        details: JSON.stringify({ migrationId: migration.id }),
      }
    });

    res.json({ status: 'cancelled', migrationId: updated.id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get migration errors
migrationRoutes.get('/:id/errors', async (req, res) => {
  try {
    const errors = await prisma.migrationError.findMany({
      where: { migrationId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(errors);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get migration report
migrationRoutes.get('/:id/report', async (req, res) => {
  try {
    const migration = await prisma.migration.findUnique({
      where: { id: req.params.id },
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
    res.status(500).json({ error: error.message });
  }
});