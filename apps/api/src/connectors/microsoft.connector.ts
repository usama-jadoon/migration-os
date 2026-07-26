import { Client } from '@microsoft/microsoft-graph-client';
import { MigrationConnector, MigrationFolder, MessageBatch, UniversalMessage, ImportResult } from '../types/connector.interface';

const fetchImpl = typeof fetch !== 'undefined' ? fetch : require('node-fetch');

export class MicrosoftConnector implements MigrationConnector {
  private client: Client | null = null;
  private config: any;

  constructor(config: any) {
    this.config = typeof config === 'string' ? JSON.parse(config) : (config || {});
  }

  async authenticate(): Promise<void> {
    const { access_token } = this.config;
    
    this.client = Client.init({
      authProvider: (done: any) => {
        done(null, access_token || '');
      },
      customFetch: fetch as any
    } as any);
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.authenticate();
      await this.client!.api('/me').get();
      return true;
    } catch (err) {
      console.error('Microsoft test connection failed:', err);
      return false;
    }
  }

  async listFolders(): Promise<MigrationFolder[]> {
    if (!this.client) await this.authenticate();
    
    const foldersRes = await this.client!.api('/me/mailFolders').top(100).get();
    const folders = foldersRes.value || [];
    
    return folders.map((f: any) => ({
      name: f.displayName || f.id,
      path: f.id,
      messageCount: f.totalItemCount || 0
    }));
  }

  async listMessages(folderPath: string, options?: { pageToken?: string; batchSize?: number }): Promise<MessageBatch> {
    if (!this.client) await this.authenticate();
    
    const batchSize = options?.batchSize || 50;
    const skip = options?.pageToken ? Number(options.pageToken) : 0;
    
    const res = await this.client!.api(`/me/mailFolders/${folderPath}/messages`)
      .top(batchSize)
      .skip(skip)
      .get();
      
    const graphMsgs = res.value || [];
    const messages: UniversalMessage[] = graphMsgs.map((msg: any) => ({
      sourceId: msg.id,
      internetMessageId: msg.internetMessageId || undefined,
      subject: msg.subject || '',
      from: {
        name: msg.from?.emailAddress?.name || '',
        email: msg.from?.emailAddress?.address || ''
      },
      to: (msg.toRecipients || []).map((r: any) => ({
        name: r.emailAddress?.name || '',
        email: r.emailAddress?.address || ''
      })),
      cc: (msg.ccRecipients || []).map((r: any) => ({
        name: r.emailAddress?.name || '',
        email: r.emailAddress?.address || ''
      })),
      bcc: (msg.bccRecipients || []).map((r: any) => ({
        name: r.emailAddress?.name || '',
        email: r.emailAddress?.address || ''
      })),
      sentAt: msg.sentDateTime ? new Date(msg.sentDateTime) : new Date(),
      receivedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date(),
      folderPath,
      labels: [],
      isRead: msg.isRead || false,
      isFlagged: msg.importance === 'high',
      isDraft: msg.isDraft || false,
      isSpam: false,
      isTrash: false,
      attachments: [],
      rawMime: Buffer.from(msg.body?.content || '')
    }));
    
    const hasMore = graphMsgs.length === batchSize;
    return {
      messages,
      nextPageToken: hasMore ? (skip + batchSize).toString() : undefined,
      hasMore
    };
  }

  async createFolder(folderPath: string): Promise<string> {
    if (!this.client) await this.authenticate();
    
    try {
      const res = await this.client!.api('/me/mailFolders').post({
        displayName: folderPath
      });
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
      
      const res = await this.client!.api(`/me/mailFolders/${folderPath}/messages`).post({
        subject: message.subject,
        body: {
          contentType: 'html',
          content: bodyContent
        },
        from: {
          emailAddress: {
            name: message.from.name,
            address: message.from.email
          }
        },
        toRecipients: message.to.map(t => ({
          emailAddress: {
            name: t.name,
            address: t.email
          }
        })),
        ccRecipients: message.cc.map(t => ({
          emailAddress: {
            name: t.name,
            address: t.email
          }
        })),
        bccRecipients: message.bcc.map(t => ({
          emailAddress: {
            name: t.name,
            address: t.email
          }
        })),
        isRead: message.isRead
      });
      
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
}