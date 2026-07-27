import { runMigration } from '../workers/migration.worker';
import { PrismaClient } from '@prisma/client';
import { connectorFactory } from '../utils/connector.factory';
import { generateIdempotencyKey } from '../utils/idempotency';

jest.mock('../utils/connector.factory', () => {
  return {
    connectorFactory: {
      create: jest.fn(),
    },
  };
});

describe('Worker E2E Integration Tests with Database & Connector Mocks', () => {
  let prismaTest: PrismaClient;
  let testMigrationId: string;
  let testOrgId: string;

  beforeAll(async () => {
    jest.setTimeout(30000);
    process.env.ENCRYPTION_KEY = 'super-secret-key-32-chars-long-x';
    prismaTest = new PrismaClient();
  });

  afterAll(async () => {
    await prismaTest.$disconnect();
  });

  beforeEach(async () => {
    await prismaTest.session.deleteMany({});
    await prismaTest.migratedItem.deleteMany({});
    await prismaTest.migrationCheckpoint.deleteMany({});
    await prismaTest.folderMapping.deleteMany({});
    await prismaTest.mailboxMapping.deleteMany({});
    await prismaTest.migrationFolder.deleteMany({});
    await prismaTest.migrationError.deleteMany({});
    await prismaTest.migrationLog.deleteMany({});
    await prismaTest.migrationEvent.deleteMany({});
    await prismaTest.auditLog.deleteMany({});
    await prismaTest.migration.deleteMany({});
    await prismaTest.providerConnection.deleteMany({});
    await prismaTest.organizationMembership.deleteMany({});
    await prismaTest.organization.deleteMany({});
    await prismaTest.user.deleteMany({});

    const org = await prismaTest.organization.create({
      data: {
        name: 'Integration Test Org',
        slug: `test-org-${Date.now()}`,
      },
    });
    testOrgId = org.id;

    const migration = await prismaTest.migration.create({
      data: {
        organizationId: testOrgId,
        sourceProvider: 'imap',
        sourceEmail: 'test-source@example.com',
        sourceCredentials: 'encrypted-secret-payload',
        destProvider: 'imap',
        destEmail: 'test-dest@example.com',
        destCredentials: 'encrypted-secret-payload',
        status: 'ready',
        totalMessages: 0,
      },
    });

    testMigrationId = migration.id;
  });

  test('Worker successfully processes new folders, prevents duplicates, saves checkpoints, and disconnects', async () => {
    const mockDisconnectSource = jest.fn().mockResolvedValue(undefined);
    const mockDisconnectDest = jest.fn().mockResolvedValue(undefined);

    const mockSourceConnector = {
      authenticate: jest.fn().mockResolvedValue(undefined),
      listFolders: jest.fn().mockResolvedValue([{ name: 'INBOX', path: 'INBOX', messageCount: 2 }]),
      listMessages: jest.fn().mockResolvedValue({
        messages: [
          {
            sourceId: '100',
            internetMessageId: 'msg-1@id.com',
            subject: 'Email 1',
            from: { name: 'Sender', email: 'sender@test.com' },
            to: [],
            cc: [],
            bcc: [],
            sentAt: new Date(),
            receivedAt: new Date(),
            folderPath: 'INBOX',
            labels: [],
            isRead: true,
            isFlagged: false,
            isDraft: false,
            isSpam: false,
            isTrash: false,
            attachments: [],
            rawMime: Buffer.from('Subject: Email 1\n\nBody 1'),
          },
          {
            sourceId: '101',
            internetMessageId: 'msg-2@id.com',
            subject: 'Email 2',
            from: { name: 'Sender', email: 'sender@test.com' },
            to: [],
            cc: [],
            bcc: [],
            sentAt: new Date(),
            receivedAt: new Date(),
            folderPath: 'INBOX',
            labels: [],
            isRead: true,
            isFlagged: false,
            isDraft: false,
            isSpam: false,
            isTrash: false,
            attachments: [],
            rawMime: Buffer.from('Subject: Email 2\n\nBody 2'),
          },
        ],
        nextPageToken: undefined,
        hasMore: false,
      }),
      disconnect: mockDisconnectSource,
    };

    const mockDestConnector = {
      authenticate: jest.fn().mockResolvedValue(undefined),
      createFolder: jest.fn().mockResolvedValue('INBOX'),
      importMessage: jest.fn().mockResolvedValue({ success: true, messageId: 'dest-100' }),
      disconnect: mockDisconnectDest,
    };

    let callCount = 0;
    (connectorFactory.create as jest.Mock).mockImplementation((provider: string) => {
      callCount++;
      return provider === 'imap' && callCount % 2 === 1 ? mockSourceConnector : mockDestConnector;
    });

    const { encrypt } = require('../utils/crypto');
    const validEncrypted = encrypt(JSON.stringify({ host: 'localhost', port: 993 }));

    await prismaTest.migration.update({
      where: { id: testMigrationId },
      data: {
        sourceCredentials: validEncrypted,
        destCredentials: validEncrypted,
        status: 'queued',
      },
    });

    const { runMigration: run } = require('../workers/migration.worker');
    await run(testMigrationId, testOrgId);

    const migration = await prismaTest.migration.findUnique({
      where: { id: testMigrationId },
    });

    expect(migration!.status).toBe('completed');
    expect(migration!.migratedMessages).toBe(2);
    expect(migration!.failedMessages).toBe(0);

    const mappings = await prismaTest.folderMapping.findMany({
      where: { migrationId: testMigrationId },
    });
    expect(mappings.length).toBe(1);
    expect(mappings[0].status).toBe('completed');

    const items = await prismaTest.migratedItem.findMany({
      where: { migrationId: testMigrationId },
    });
    expect(items.length).toBe(2);

    const checkpoint = await prismaTest.migrationCheckpoint.findUnique({
      where: {
        migrationId_folderName: { migrationId: testMigrationId, folderName: 'INBOX' },
      },
    });
    expect(checkpoint).toBeDefined();

    expect(mockDisconnectSource).toHaveBeenCalled();
    expect(mockDisconnectDest).toHaveBeenCalled();
  });

  test('Worker resumes from checkpoint and avoids duplicate imports', async () => {
    const { encrypt } = require('../utils/crypto');
    const validEncrypted = encrypt(JSON.stringify({ host: 'localhost', port: 993 }));

    await prismaTest.folderMapping.create({
      data: {
        migrationId: testMigrationId,
        organizationId: testOrgId,
        sourceFolderName: 'INBOX',
        destFolderName: 'INBOX',
        enabled: true,
        totalMessages: 3,
        status: 'running',
        migratedMessages: 1,
      },
    });

    await prismaTest.migrationCheckpoint.create({
      data: {
        migrationId: testMigrationId,
        organizationId: testOrgId,
        folderName: 'INBOX',
        lastProcessedUid: '100',
        processedCount: 1,
      },
    });

    const size = Buffer.from('Subject: Email 1\n\nBody 1').length;
    const date = new Date('2026-07-27T00:00:00.000Z');
    const idempotencyKey = generateIdempotencyKey(
      testMigrationId,
      'INBOX',
      '100',
      'msg-1@id.com',
      size,
      date
    );

    await prismaTest.migratedItem.create({
      data: {
        migrationId: testMigrationId,
        organizationId: testOrgId,
        idempotencyKey,
        sourceItemId: '100',
        folderName: 'INBOX',
      },
    });

    const mockDisconnectSource = jest.fn().mockResolvedValue(undefined);
    const mockDisconnectDest = jest.fn().mockResolvedValue(undefined);

    const mockSourceConnector = {
      authenticate: jest.fn().mockResolvedValue(undefined),
      listFolders: jest.fn().mockResolvedValue([{ name: 'INBOX', path: 'INBOX', messageCount: 3 }]),
      listMessages: jest.fn().mockResolvedValue({
        messages: [
          {
            sourceId: '100',
            internetMessageId: 'msg-1@id.com',
            subject: 'Email 1',
            from: { name: 'Sender', email: 'sender@test.com' },
            to: [],
            cc: [],
            bcc: [],
            sentAt: date,
            receivedAt: date,
            folderPath: 'INBOX',
            labels: [],
            isRead: true,
            isFlagged: false,
            isDraft: false,
            isSpam: false,
            isTrash: false,
            attachments: [],
            rawMime: Buffer.from('Subject: Email 1\n\nBody 1'),
          },
          {
            sourceId: '101',
            internetMessageId: 'msg-2@id.com',
            subject: 'Email 2',
            from: { name: 'Sender', email: 'sender@test.com' },
            to: [],
            cc: [],
            bcc: [],
            sentAt: date,
            receivedAt: date,
            folderPath: 'INBOX',
            labels: [],
            isRead: true,
            isFlagged: false,
            isDraft: false,
            isSpam: false,
            isTrash: false,
            attachments: [],
            rawMime: Buffer.from('Subject: Email 2\n\nBody 2'),
          },
          {
            sourceId: '102',
            internetMessageId: 'msg-3@id.com',
            subject: 'Email 3',
            from: { name: 'Sender', email: 'sender@test.com' },
            to: [],
            cc: [],
            bcc: [],
            sentAt: date,
            receivedAt: date,
            folderPath: 'INBOX',
            labels: [],
            isRead: true,
            isFlagged: false,
            isDraft: false,
            isSpam: false,
            isTrash: false,
            attachments: [],
            rawMime: Buffer.from('Subject: Email 3\n\nBody 3'),
          },
        ],
        nextPageToken: undefined,
        hasMore: false,
      }),
      disconnect: mockDisconnectSource,
    };

    const mockDestConnector = {
      authenticate: jest.fn().mockResolvedValue(undefined),
      createFolder: jest.fn().mockResolvedValue('INBOX'),
      importMessage: jest.fn().mockResolvedValue({ success: true, messageId: 'dest-import' }),
      disconnect: mockDisconnectDest,
    };

    let callCountResume = 0;
    (connectorFactory.create as jest.Mock).mockImplementation((provider: string) => {
      callCountResume++;
      return provider === 'imap' && callCountResume % 2 === 1 ? mockSourceConnector : mockDestConnector;
    });

    await prismaTest.migration.update({
      where: { id: testMigrationId },
      data: {
        sourceCredentials: validEncrypted,
        destCredentials: validEncrypted,
        status: 'queued',
        migratedMessages: 1,
      },
    });

    const { runMigration: run } = require('../workers/migration.worker');
    await run(testMigrationId, testOrgId);

    const migration = await prismaTest.migration.findUnique({
      where: { id: testMigrationId },
    });

    expect(migration!.status).toBe('completed');
    expect(migration!.migratedMessages).toBe(3);
    expect(mockDestConnector.importMessage).toHaveBeenCalledTimes(2);
  });

  test('Worker transitions migration to failed state upon auth exception', async () => {
    const { encrypt } = require('../utils/crypto');
    const validEncrypted = encrypt(JSON.stringify({ host: 'localhost', port: 993 }));

    const mockSourceConnector = {
      authenticate: jest.fn().mockRejectedValue(new Error('IMAP connection timed out')),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };

    (connectorFactory.create as jest.Mock).mockImplementation(() => mockSourceConnector);

    await prismaTest.migration.update({
      where: { id: testMigrationId },
      data: {
        sourceCredentials: validEncrypted,
        destCredentials: validEncrypted,
        status: 'queued',
      },
    });

    const { runMigration: run } = require('../workers/migration.worker');
    await run(testMigrationId, testOrgId);

    const migration = await prismaTest.migration.findUnique({
      where: { id: testMigrationId },
    });

    expect(migration!.status).toBe('failed');

    const logs = await prismaTest.migrationLog.findMany({
      where: { migrationId: testMigrationId, level: 'error' },
    });
    expect(logs.length).toBe(1);
    expect(logs[0].message).toContain('IMAP connection timed out');
  });
});
