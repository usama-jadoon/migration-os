import request from 'supertest';
import express from 'express';
import { google } from 'googleapis';
import { GoogleConnector } from '../connectors/google.connector';
import { authRoutes } from '../routes/auth';
import { prisma } from '../utils/db';

jest.mock('googleapis', () => {
  const mockOAuth2 = jest.fn().mockImplementation(() => ({
    setCredentials: jest.fn(),
    generateAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?mock=true'),
    getToken: jest.fn().mockResolvedValue({
      tokens: {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expiry_date: 1700000000000,
        token_type: 'Bearer',
      },
    }),
  }));

  const mockGmail = jest.fn().mockImplementation(() => ({
    users: {
      getProfile: jest.fn().mockResolvedValue({ data: { messagesTotal: 42, emailAddress: 'user@gmail.com' } }),
      labels: {
        list: jest.fn().mockResolvedValue({
          data: {
            labels: [
              { id: 'INBOX', name: 'INBOX' },
              { id: 'SENT', name: 'SENT' },
              { id: 'Label_123', name: 'Sales/2026' },
            ],
          },
        }),
        get: jest.fn().mockImplementation(({ id }: any) =>
          Promise.resolve({
            data: { id, name: id, messagesTotal: id === 'INBOX' ? 25 : 10 },
          })
        ),
        create: jest.fn().mockResolvedValue({ data: { id: 'Label_New' } }),
      },
      messages: {
        list: jest.fn().mockResolvedValue({
          data: {
            messages: [{ id: 'msg_001' }, { id: 'msg_002' }],
            nextPageToken: 'next_page_token_123',
          },
        }),
        get: jest.fn().mockResolvedValue({
          data: {
            id: 'msg_001',
            labelIds: ['INBOX', 'UNREAD', 'STARRED'],
            raw: Buffer.from(
              'Subject: Google Test Message\r\nFrom: sender@gmail.com\r\nTo: dest@gmail.com\r\nDate: Mon, 27 Jul 2026 12:00:00 GMT\r\n\r\nTest Body Content'
            ).toString('base64url'),
          },
        }),
        insert: jest.fn().mockResolvedValue({ data: { id: 'imported_msg_999' } }),
      },
    },
  }));

  return {
    google: {
      auth: {
        OAuth2: mockOAuth2,
      },
      gmail: mockGmail,
    },
  };
});

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

describe('Google Workspace Connector & OAuth Suite', () => {
  let userToken: string;
  let orgId: string;

  beforeAll(async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';

    await prisma.session.deleteMany();
    await prisma.organizationMembership.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();

    const signupRes = await request(app)
      .post('/api/auth/signup')
      .send({
        email: 'google-user@example.com',
        password: 'Password123!',
        name: 'Google User',
      });

    userToken = signupRes.body.token;
    orgId = signupRes.body.organization.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Google OAuth 2.0 Route Endpoints', () => {
    it('should generate a Google OAuth 2.0 authorization URL', async () => {
      const res = await request(app)
        .get('/api/auth/google/url')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    });

    it('should exchange authorization code for OAuth tokens', async () => {
      const res = await request(app)
        .post('/api/auth/google/token')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ code: 'valid-google-auth-code' });

      expect(res.status).toBe(200);
      expect(res.body.access_token).toBe('mock-access-token');
      expect(res.body.refresh_token).toBe('mock-refresh-token');
    });
  });

  describe('GoogleConnector Mailbox Operations', () => {
    let connector: GoogleConnector;

    beforeEach(() => {
      connector = new GoogleConnector({
        client_id: 'test-google-client-id',
        client_secret: 'test-google-client-secret',
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
      });
    });

    afterEach(async () => {
      await connector.disconnect();
    });

    it('should test connection successfully', async () => {
      const isConnected = await connector.testConnection();
      expect(isConnected).toBe(true);
    });

    it('should list folders and map system/custom labels', async () => {
      const folders = await connector.listFolders();
      expect(folders.length).toBe(3);
      expect(folders[0].name).toBe('INBOX');
      expect(folders[1].name).toBe('Sent Items');
      expect(folders[2].name).toBe('Sales/2026');
    });

    it('should list messages with raw RFC822 MIME decoding and flags', async () => {
      const batch = await connector.listMessages('INBOX', { batchSize: 10, query: 'after:2026/01/01' });
      expect(batch.messages.length).toBe(2);
      expect(batch.hasMore).toBe(true);
      expect(batch.nextPageToken).toBe('next_page_token_123');

      const msg = batch.messages[0];
      expect(msg.subject).toBe('Google Test Message');
      expect(msg.isRead).toBe(false); // UNREAD label present
      expect(msg.isFlagged).toBe(true); // STARRED label present
      expect(msg.rawMime).toBeDefined();
    });

    it('should create new folder label', async () => {
      const labelId = await connector.createFolder('Custom/Label');
      expect(labelId).toBe('Label_New');
    });

    it('should import message as raw RFC822 MIME with target labels', async () => {
      const result = await connector.importMessage(
        {
          sourceId: 'src_100',
          internetMessageId: 'msg_100@google.com',
          subject: 'Import Test',
          from: { name: 'Sender', email: 'src@google.com' },
          to: [{ name: 'Dest', email: 'dst@google.com' }],
          cc: [],
          bcc: [],
          sentAt: new Date(),
          receivedAt: new Date(),
          folderPath: 'INBOX',
          labels: ['INBOX'],
          isRead: false,
          isFlagged: true,
          isDraft: false,
          isSpam: false,
          isTrash: false,
          attachments: [],
          rawMime: Buffer.from('Subject: Import Test\r\n\r\nHello Google'),
        },
        'INBOX'
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('imported_msg_999');
    });

    it('should get total message count from profile', async () => {
      const count = await connector.getTotalMessageCount();
      expect(count).toBe(42);
    });
  });
});
