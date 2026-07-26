import { ImapFlow } from 'imapflow';
import { MigrationConnector, MigrationFolder, MessageBatch, UniversalMessage, ImportResult } from '../types/connector.interface';
import { withRetry } from '../utils/retry';

export class ImapConnector implements MigrationConnector {
  private client: ImapFlow | null = null;
  private config: any;

  constructor(config: any) {
    this.config = typeof config === 'string' ? JSON.parse(config) : (config || {});
  }

  async authenticate(): Promise<void> {
    const { host, port, username, password, tls } = this.config;
    
    try {
      await withRetry(async () => {
        this.client = new ImapFlow({
          host: host || 'localhost',
          port: Number(port) || 993,
          secure: tls !== false,
          auth: {
            user: username || '',
            pass: password || ''
          },
          logger: false
        });

        this.client.on('error', (err) => {
          console.error('[IMAP Connector] ImapFlow client connection error:', err.message);
        });

        await this.client.connect();
      }, 3, 1000);
    } catch (err: any) {
      this.client = null;
      throw new Error(`IMAP authentication failed: ${err.message}`);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.authenticate();
      await this.disconnect();
      return true;
    } catch (err) {
      console.error('[IMAP Connector] Connection test failed:', err);
      return false;
    }
  }

  async listFolders(): Promise<MigrationFolder[]> {
    if (!this.client) await this.authenticate();
    const client = this.client!;

    const folders = await client.list();
    const result: MigrationFolder[] = [];
    
    for (const folder of folders) {
      try {
        const status = await client.status(folder.path, { messages: true });
        result.push({
          name: folder.name,
          path: folder.path,
          messageCount: status.messages || 0
        });
      } catch {
        result.push({
          name: folder.name,
          path: folder.path,
          messageCount: 0
        });
      }
    }
    return result;
  }

  async listMessages(folderPath: string, options?: { pageToken?: string; batchSize?: number }): Promise<MessageBatch> {
    if (!this.client) await this.authenticate();
    const client = this.client!;

    const batchSize = options?.batchSize || 50;
    const startIdx = options?.pageToken ? Number(options.pageToken) : 1;

    const lock = await client.getMailboxLock(folderPath);
    try {
      const mailbox = await client.mailboxOpen(folderPath);
      const total = mailbox.exists || 0;

      if (total === 0 || startIdx > total) {
        return { messages: [], hasMore: false };
      }

      const endIdx = Math.min(startIdx + batchSize - 1, total);
      const messages: UniversalMessage[] = [];
      const range = `${startIdx}:${endIdx}`;

      // Fetch sequence
      for await (const msg of client.fetch(range, { uid: true, envelope: true, source: true, flags: true, internalDate: true })) {
        messages.push({
          sourceId: msg.uid.toString(),
          internetMessageId: msg.envelope?.messageId || undefined,
          subject: msg.envelope?.subject || '',
          from: {
            name: msg.envelope?.from?.[0]?.name || '',
            email: msg.envelope?.from?.[0]?.address || ''
          },
          to: (msg.envelope?.to || []).map(t => ({ name: t.name || '', email: t.address || '' })),
          cc: (msg.envelope?.cc || []).map(t => ({ name: t.name || '', email: t.address || '' })),
          bcc: (msg.envelope?.bcc || []).map(t => ({ name: t.name || '', email: t.address || '' })),
          sentAt: msg.envelope?.date ? new Date(msg.envelope.date) : new Date(),
          receivedAt: msg.internalDate ? new Date(msg.internalDate) : (msg.envelope?.date ? new Date(msg.envelope.date) : new Date()),
          folderPath,
          labels: [],
          isRead: msg.flags ? msg.flags.has('\\Seen') : false,
          isFlagged: msg.flags?.has('\\Flagged') || false,
          isDraft: msg.flags?.has('\\Draft') || false,
          isSpam: msg.flags?.has('\\Junk') || false,
          isTrash: msg.flags?.has('\\Deleted') || false,
          attachments: [],
          rawMime: msg.source
        });
      }

      const hasMore = endIdx < total;
      return {
        messages,
        nextPageToken: hasMore ? (endIdx + 1).toString() : undefined,
        hasMore
      };
    } finally {
      lock.release();
    }
  }

  async createFolder(folderPath: string): Promise<string> {
    if (!this.client) await this.authenticate();
    const client = this.client!;
    try {
      await client.mailboxCreate(folderPath);
    } catch (err: any) {
      if (!err.message.includes('ALREADYEXISTS')) {
        throw err;
      }
    }
    return folderPath;
  }

  async importMessage(message: UniversalMessage, folderPath: string, flags?: string[]): Promise<ImportResult> {
    if (!this.client) await this.authenticate();
    const client = this.client!;

    if (!message.rawMime) {
      return { success: false, error: 'rawMime content is missing' };
    }

    try {
      const res = await withRetry(async () => {
        return await client.append(folderPath, message.rawMime!, flags || []);
      }, 3, 1000);

      const uid = res && typeof res === 'object' && 'uid' in res && res.uid ? res.uid.toString() : 'unknown-uid';
      return { success: true, messageId: uid };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async getTotalMessageCount(): Promise<number> {
    const folders = await this.listFolders();
    return folders.reduce((sum, f) => sum + f.messageCount, 0);
  }

  async getTotalSizeBytes(): Promise<number> {
    return 0;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.logout();
      } catch (err) {
        console.error('[IMAP Connector] Error during logout:', err);
      } finally {
        this.client = null;
      }
    }
  }
}