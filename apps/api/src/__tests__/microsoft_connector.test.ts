import request from 'supertest';
import express from 'express';
import { MicrosoftConnector } from '../connectors/microsoft.connector';
import { authRoutes } from '../routes/auth';
import { prisma } from '../utils/db';

jest.mock('@microsoft/microsoft-graph-client', () => {
  const mockApi = jest.fn().mockImplementation((path: string) => {
    return {
      top: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      filter: jest.fn().mockReturnThis(),
      get: jest.fn().mockImplementation(() => {
        if (path === '/me') {
          return Promise.resolve({ displayName: 'Test MS User', mail: 'msuser@outlook.com' });
        }
        if (path === '/me/mailFolders') {
          return Promise.resolve({
            value: [
              { id: 'folder_inbox', displayName: 'Inbox', totalItemCount: 15 },
              { id: 'folder_sent', displayName: 'Sent Items', totalItemCount: 5 },
              { id: 'folder_custom', displayName: 'Archive 2026', totalItemCount: 8 },
            ],
          });
        }
        if (path.includes('/messages/msg_ms_001/$value')) {
          return Promise.resolve(Buffer.from('Subject: MS Graph Raw MIME\r\n\r\nHello Microsoft'));
        }
        if (path.includes('/messages')) {
          return Promise.resolve({
            value: [
              {
                id: 'msg_ms_001',
                internetMessageId: 'msg_ms_001@outlook.com',
                subject: 'MS Graph Test Message',
                from: { emailAddress: { name: 'Sender MS', address: 'sender@outlook.com' } },
                toRecipients: [{ emailAddress: { name: 'Dest MS', address: 'dest@outlook.com' } }],
                sentDateTime: '2026-07-27T10:00:00Z',
                receivedDateTime: '2026-07-27T10:00:00Z',
                isRead: true,
                importance: 'high',
                body: { content: 'MS Graph Test Body' },
              },
            ],
          });
        }
        return Promise.resolve({});
      }),
      post: jest.fn().mockImplementation((data: any) => {
        if (path === '/me/mailFolders') {
          return Promise.resolve({ id: 'folder_new_ms', displayName: data.displayName });
        }
        return Promise.resolve({ id: 'imported_ms_msg_777' });
      }),
    };
  });

  return {
    Client: {
      init: jest.fn().mockImplementation(() => ({
        api: mockApi,
      })),
    },
  };
});

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

describe('Microsoft 365 / Graph Connector Suite', () => {
  let userToken: string;

  beforeAll(async () => {
    process.env.MICROSOFT_CLIENT_ID = 'test-ms-client-id';
    process.env.MICROSOFT_CLIENT_SECRET = 'test-ms-client-secret';

    await prisma.session.deleteMany();
    await prisma.organizationMembership.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();

    const signupRes = await request(app)
      .post('/api/auth/signup')
      .send({
        email: 'ms-user@example.com',
        password: 'Password123!',
        name: 'MS User',
      });

    userToken = signupRes.body.token;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Microsoft 365 OAuth 2.0 Route Endpoints', () => {
    it('should generate a Microsoft OAuth 2.0 authorization URL', async () => {
      const res = await request(app)
        .get('/api/auth/microsoft/url')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.url).toContain('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    });

    it('should handle Microsoft OAuth token exchange validation', async () => {
      // Mock global fetch for token exchange call
      const globalFetch = global.fetch;
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'mock-ms-access-token',
          refresh_token: 'mock-ms-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

      const res = await request(app)
        .post('/api/auth/microsoft/token')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ code: 'valid-ms-auth-code' });

      expect(res.status).toBe(200);
      expect(res.body.access_token).toBe('mock-ms-access-token');

      (global as any).fetch = globalFetch;
    });
  });

  describe('MicrosoftConnector Graph Mailbox Operations', () => {
    let connector: MicrosoftConnector;

    beforeEach(() => {
      connector = new MicrosoftConnector({
        access_token: 'mock-ms-access-token',
        refresh_token: 'mock-ms-refresh-token',
      });
    });

    afterEach(async () => {
      await connector.disconnect();
    });

    it('should test connection successfully', async () => {
      const isConnected = await connector.testConnection();
      expect(isConnected).toBe(true);
    });

    it('should list folders and map Microsoft Graph folder names', async () => {
      const folders = await connector.listFolders();
      expect(folders.length).toBe(3);
      expect(folders[0].name).toBe('INBOX');
      expect(folders[1].name).toBe('Sent Items');
      expect(folders[2].name).toBe('Archive 2026');
    });

    it('should list messages with raw RFC822 MIME decoding and importance flags', async () => {
      const batch = await connector.listMessages('folder_inbox', { batchSize: 50 });
      expect(batch.messages.length).toBe(1);

      const msg = batch.messages[0];
      expect(msg.subject).toBe('MS Graph Test Message');
      expect(msg.isRead).toBe(true);
      expect(msg.isFlagged).toBe(true); // High importance
      expect(msg.rawMime).toBeDefined();
    });

    it('should create new Graph mail folder', async () => {
      const folderId = await connector.createFolder('Projects/Migration');
      expect(folderId).toBe('folder_new_ms');
    });

    it('should import message into Microsoft Graph folder', async () => {
      const result = await connector.importMessage(
        {
          sourceId: 'src_ms_100',
          internetMessageId: 'msg_100@outlook.com',
          subject: 'Import MS Test',
          from: { name: 'Sender', email: 'src@outlook.com' },
          to: [{ name: 'Dest', email: 'dst@outlook.com' }],
          cc: [],
          bcc: [],
          sentAt: new Date(),
          receivedAt: new Date(),
          folderPath: 'folder_inbox',
          labels: [],
          isRead: true,
          isFlagged: false,
          isDraft: false,
          isSpam: false,
          isTrash: false,
          attachments: [],
          rawMime: Buffer.from('Subject: Import MS Test\r\n\r\nHello Graph'),
        },
        'folder_inbox'
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('imported_ms_msg_777');
    });

    it('should calculate total message count across folders', async () => {
      const count = await connector.getTotalMessageCount();
      expect(count).toBe(28); // 15 + 5 + 8
    });
  });
});
