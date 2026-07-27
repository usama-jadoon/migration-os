import { google } from 'googleapis';
import { MigrationConnector, MigrationFolder, MessageBatch, UniversalMessage, ImportResult } from '../types/connector.interface';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';

export class GoogleConnector implements MigrationConnector {
  private oauth2Client: any = null;
  private gmail: any = null;
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
    const { client_id, client_secret, access_token, refresh_token } = this.config;
    const clientId = client_id || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = client_secret || process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth/google/callback';

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    oauth2Client.setCredentials({
      access_token,
      refresh_token,
    });

    this.oauth2Client = oauth2Client;
    this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.authenticate();
      await withRetry(
        async () => {
          await this.gmail.users.getProfile({ userId: 'me' });
        },
        3,
        200
      );
      return true;
    } catch (err: any) {
      logger.error('[GoogleConnector] Test connection failed:', { error: err.message });
      return false;
    }
  }

  async listFolders(): Promise<MigrationFolder[]> {
    if (!this.gmail) await this.authenticate();

    const res = await withRetry(
      async () => {
        return await this.gmail.users.labels.list({ userId: 'me' });
      },
      3,
      200
    );

    const labels = res.data.labels || [];
    const folders: MigrationFolder[] = [];

    for (const label of labels) {
      if (label.id) {
        try {
          const detail = await withRetry(
            async () => {
              return await this.gmail.users.labels.get({ userId: 'me', id: label.id });
            },
            3,
            200
          );

          const folderName = this.mapLabelToFolderName(label.name || label.id, label.id);
          folders.push({
            name: folderName,
            path: label.id,
            messageCount: detail.data.messagesTotal || 0,
          });
        } catch {
          const folderName = this.mapLabelToFolderName(label.name || label.id, label.id);
          folders.push({
            name: folderName,
            path: label.id,
            messageCount: 0,
          });
        }
      }
    }
    return folders;
  }

  async listMessages(
    folderPath: string,
    options?: { pageToken?: string; batchSize?: number; query?: string }
  ): Promise<MessageBatch> {
    if (!this.gmail) await this.authenticate();
    const batchSize = options?.batchSize || 50;

    const queryParts: string[] = [];
    if (options?.query) {
      queryParts.push(options.query);
    }

    const listRes = await withRetry(
      async () => {
        return await this.gmail.users.messages.list({
          userId: 'me',
          labelIds: [folderPath],
          maxResults: batchSize,
          pageToken: options?.pageToken,
          q: queryParts.length > 0 ? queryParts.join(' ') : undefined,
        });
      },
      3,
      200
    );

    const gmailMsgs = listRes.data.messages || [];
    const messages: UniversalMessage[] = [];

    for (const item of gmailMsgs) {
      if (item.id) {
        try {
          const detail = await withRetry(
            async () => {
              return await this.gmail.users.messages.get({
                userId: 'me',
                id: item.id,
                format: 'raw',
              });
            },
            3,
            200
          );

          const rawBase64 = detail.data.raw || '';
          const rawMime = Buffer.from(rawBase64, 'base64url');
          const rawText = rawMime.toString('utf-8');

          const subjectMatch = rawText.match(/^Subject:\s*(.*)$/im);
          const fromMatch = rawText.match(/^From:\s*(.*)$/im);
          const toMatch = rawText.match(/^To:\s*(.*)$/im);
          const dateMatch = rawText.match(/^Date:\s*(.*)$/im);

          const labelIds: string[] = detail.data.labelIds || [];
          const isRead = !labelIds.includes('UNREAD');
          const isFlagged = labelIds.includes('STARRED');
          const isDraft = labelIds.includes('DRAFT');
          const isSpam = labelIds.includes('SPAM');
          const isTrash = labelIds.includes('TRASH');

          const messageDate = dateMatch ? new Date(dateMatch[1].trim()) : new Date();

          messages.push({
            sourceId: item.id,
            internetMessageId: detail.data.id || item.id,
            subject: subjectMatch ? subjectMatch[1].trim() : 'No Subject',
            from: { name: '', email: fromMatch ? fromMatch[1].trim() : '' },
            to: toMatch ? [{ name: '', email: toMatch[1].trim() }] : [],
            cc: [],
            bcc: [],
            sentAt: isNaN(messageDate.getTime()) ? new Date() : messageDate,
            receivedAt: isNaN(messageDate.getTime()) ? new Date() : messageDate,
            folderPath,
            labels: labelIds,
            isRead,
            isFlagged,
            isDraft,
            isSpam,
            isTrash,
            attachments: [],
            rawMime,
          });
        } catch (err: any) {
          logger.error(`[GoogleConnector] Failed to fetch message ${item.id}:`, { error: err.message });
        }
      }
    }

    return {
      messages,
      nextPageToken: listRes.data.nextPageToken || undefined,
      hasMore: !!listRes.data.nextPageToken,
    };
  }

  async createFolder(folderPath: string): Promise<string> {
    if (!this.gmail) await this.authenticate();
    try {
      const res = await withRetry(
        async () => {
          return await this.gmail.users.labels.create({
            userId: 'me',
            requestBody: {
              name: folderPath,
              labelListVisibility: 'labelShow',
              messageListVisibility: 'show',
            },
          });
        },
        3,
        200
      );
      return res.data.id || folderPath;
    } catch (err: any) {
      if (err.code === 409 || err.status === 409) {
        return folderPath;
      }
      throw err;
    }
  }

  async importMessage(message: UniversalMessage, folderPath: string): Promise<ImportResult> {
    if (!this.gmail) await this.authenticate();
    if (!message.rawMime) {
      return { success: false, error: 'rawMime content is missing' };
    }

    try {
      const base64url = message.rawMime
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const labelIds: string[] = [folderPath];
      if (!message.isRead) labelIds.push('UNREAD');
      if (message.isFlagged) labelIds.push('STARRED');
      if (message.isDraft) labelIds.push('DRAFT');

      const res = await withRetry(
        async () => {
          return await this.gmail.users.messages.insert({
            userId: 'me',
            requestBody: {
              labelIds,
            },
            media: {
              mimeType: 'message/rfc822',
              body: base64url,
            },
          });
        },
        3,
        200
      );

      return { success: true, messageId: res.data.id || 'unknown' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async getTotalMessageCount(): Promise<number> {
    if (!this.gmail) await this.authenticate();
    const profile = await withRetry(
      async () => {
        return await this.gmail.users.getProfile({ userId: 'me' });
      },
      3,
      200
    );
    return profile.data.messagesTotal || 0;
  }

  async disconnect(): Promise<void> {
    this.oauth2Client = null;
    this.gmail = null;
  }

  private mapLabelToFolderName(labelName: string, labelId: string): string {
    switch (labelId.toUpperCase()) {
      case 'INBOX':
        return 'INBOX';
      case 'SENT':
        return 'Sent Items';
      case 'TRASH':
        return 'Trash';
      case 'SPAM':
        return 'Junk Email';
      case 'DRAFT':
        return 'Drafts';
      default:
        return labelName;
    }
  }
}