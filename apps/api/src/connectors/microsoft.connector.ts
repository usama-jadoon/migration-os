import { Client } from '@microsoft/microsoft-graph-client';
import { MigrationConnector, MigrationFolder, MessageBatch, UniversalMessage, ImportResult } from '../types/connector.interface';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';

export class MicrosoftConnector implements MigrationConnector {
  private client: Client | null = null;
  private config: any;

  constructor(config: any) {
    if (typeof config === 'string') {
      try {
        this.config = JSON.parse(config);
      } catch {
        this.config = {};
      }
    } else {
      this.config = config || {};
    }
  }

  async authenticate(): Promise<void> {
    const { access_token } = this.config;

    this.client = Client.init({
      authProvider: (done: any) => {
        done(null, access_token || '');
      },
      customFetch: fetch as any,
    } as any);
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.authenticate();
      await withRetry(
        async () => {
          await this.client!.api('/me').get();
        },
        3,
        200
      );
      return true;
    } catch (err: any) {
      logger.error('[MicrosoftConnector] Test connection failed:', { error: err.message });
      return false;
    }
  }

  async listFolders(): Promise<MigrationFolder[]> {
    if (!this.client) await this.authenticate();

    const foldersRes = await withRetry(
      async () => {
        return await this.client!.api('/me/mailFolders').top(100).get();
      },
      3,
      200
    );

    const folders = foldersRes.value || [];

    return folders.map((f: any) => ({
      name: this.mapFolderToStandardName(f.displayName || f.id),
      path: f.id,
      messageCount: f.totalItemCount || 0,
    }));
  }

  async listMessages(
    folderPath: string,
    options?: { pageToken?: string; batchSize?: number; query?: string }
  ): Promise<MessageBatch> {
    if (!this.client) await this.authenticate();

    const batchSize = options?.batchSize || 50;
    const skip = options?.pageToken ? Number(options.pageToken) : 0;

    let apiRequestBuilder = this.client!.api(`/me/mailFolders/${folderPath}/messages`)
      .top(batchSize)
      .skip(skip);

    if (options?.query) {
      apiRequestBuilder = apiRequestBuilder.filter(options.query);
    }

    const res = await withRetry(
      async () => {
        return await apiRequestBuilder.get();
      },
      3,
      200
    );

    const graphMsgs = res.value || [];
    const messages: UniversalMessage[] = [];

    for (const msg of graphMsgs) {
      let rawMime: Buffer;
      try {
        const rawRes = await withRetry(
          async () => {
            return await this.client!.api(`/me/messages/${msg.id}/$value`).get();
          },
          3,
          200
        );

        if (Buffer.isBuffer(rawRes)) {
          rawMime = rawRes;
        } else if (typeof rawRes === 'string') {
          rawMime = Buffer.from(rawRes, 'utf-8');
        } else {
          rawMime = Buffer.from(msg.body?.content || '', 'utf-8');
        }
      } catch {
        rawMime = Buffer.from(msg.body?.content || '', 'utf-8');
      }

      messages.push({
        sourceId: msg.id,
        internetMessageId: msg.internetMessageId || msg.id,
        subject: msg.subject || 'No Subject',
        from: {
          name: msg.from?.emailAddress?.name || '',
          email: msg.from?.emailAddress?.address || '',
        },
        to: (msg.toRecipients || []).map((r: any) => ({
          name: r.emailAddress?.name || '',
          email: r.emailAddress?.address || '',
        })),
        cc: (msg.ccRecipients || []).map((r: any) => ({
          name: r.emailAddress?.name || '',
          email: r.emailAddress?.address || '',
        })),
        bcc: (msg.bccRecipients || []).map((r: any) => ({
          name: r.emailAddress?.name || '',
          email: r.emailAddress?.address || '',
        })),
        sentAt: msg.sentDateTime ? new Date(msg.sentDateTime) : new Date(),
        receivedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date(),
        folderPath,
        labels: [],
        isRead: msg.isRead || false,
        isFlagged: msg.importance === 'high' || msg.flag?.flagStatus === 'flagged',
        isDraft: msg.isDraft || false,
        isSpam: false,
        isTrash: false,
        attachments: [],
        rawMime,
      });
    }

    const hasMore = graphMsgs.length === batchSize;
    return {
      messages,
      nextPageToken: hasMore ? (skip + batchSize).toString() : undefined,
      hasMore,
    };
  }

  async createFolder(folderPath: string): Promise<string> {
    if (!this.client) await this.authenticate();

    try {
      const res = await withRetry(
        async () => {
          return await this.client!.api('/me/mailFolders').post({
            displayName: folderPath,
          });
        },
        3,
        200
      );
      return res.id || folderPath;
    } catch (err: any) {
      if (err.statusCode === 409 || err.message?.includes('exists')) {
        return folderPath;
      }
      throw err;
    }
  }

  async importMessage(message: UniversalMessage, folderPath: string): Promise<ImportResult> {
    if (!this.client) await this.authenticate();

    try {
      const bodyContent = message.rawMime ? message.rawMime.toString('utf-8') : message.subject;

      const res = await withRetry(
        async () => {
          return await this.client!.api(`/me/mailFolders/${folderPath}/messages`).post({
            subject: message.subject,
            body: {
              contentType: 'html',
              content: bodyContent,
            },
            from: {
              emailAddress: {
                name: message.from.name,
                address: message.from.email,
              },
            },
            toRecipients: message.to.map((t) => ({
              emailAddress: {
                name: t.name,
                address: t.email,
              },
            })),
            ccRecipients: message.cc.map((t) => ({
              emailAddress: {
                name: t.name,
                address: t.email,
              },
            })),
            bccRecipients: message.bcc.map((t) => ({
              emailAddress: {
                name: t.name,
                address: t.email,
              },
            })),
            isRead: message.isRead,
            importance: message.isFlagged ? 'high' : 'normal',
          });
        },
        3,
        200
      );

      return { success: true, messageId: res.id || 'unknown' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async getTotalMessageCount(): Promise<number> {
    const folders = await this.listFolders();
    return folders.reduce((sum, f) => sum + f.messageCount, 0);
  }

  async disconnect(): Promise<void> {
    this.client = null;
  }

  private mapFolderToStandardName(displayName: string): string {
    switch (displayName.toLowerCase()) {
      case 'inbox':
        return 'INBOX';
      case 'sent items':
      case 'sent':
        return 'Sent Items';
      case 'deleted items':
      case 'trash':
        return 'Trash';
      case 'junk email':
      case 'spam':
        return 'Junk Email';
      case 'drafts':
        return 'Drafts';
      default:
        return displayName;
    }
  }
}