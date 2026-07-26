import { google } from 'googleapis';
import { MigrationConnector, MigrationFolder, MessageBatch, UniversalMessage, ImportResult } from '../types/connector.interface';

export class GoogleConnector implements MigrationConnector {
  private oauth2Client: any = null;
  private gmail: any = null;
  private config: any;

  constructor(config: any) {
    this.config = typeof config === 'string' ? JSON.parse(config) : (config || {});
  }

  async authenticate(): Promise<void> {
    const { client_id, client_secret, access_token, refresh_token } = this.config;
    const oauth2Client = new google.auth.OAuth2(
      client_id || process.env.GOOGLE_CLIENT_ID,
      client_secret || process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token,
      refresh_token
    });

    this.oauth2Client = oauth2Client;
    this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.authenticate();
      await this.gmail.users.getProfile({ userId: 'me' });
      return true;
    } catch (err) {
      console.error('Google test connection failed:', err);
      return false;
    }
  }

  async listFolders(): Promise<MigrationFolder[]> {
    if (!this.gmail) await this.authenticate();
    const res = await this.gmail.users.labels.list({ userId: 'me' });
    const labels = res.data.labels || [];
    const folders: MigrationFolder[] = [];

    for (const label of labels) {
      if (label.id) {
        try {
          const detail = await this.gmail.users.labels.get({ userId: 'me', id: label.id });
          folders.push({
            name: label.name || label.id,
            path: label.id,
            messageCount: detail.data.messagesTotal || 0
          });
        } catch {
          folders.push({
            name: label.name || label.id,
            path: label.id,
            messageCount: 0
          });
        }
      }
    }
    return folders;
  }

  async listMessages(folderPath: string, options?: { pageToken?: string; batchSize?: number }): Promise<MessageBatch> {
    if (!this.gmail) await this.authenticate();
    const batchSize = options?.batchSize || 50;

    const listRes = await this.gmail.users.messages.list({
      userId: 'me',
      labelIds: [folderPath],
      maxResults: batchSize,
      pageToken: options?.pageToken
    });

    const gmailMsgs = listRes.data.messages || [];
    const messages: UniversalMessage[] = [];

    for (const item of gmailMsgs) {
      if (item.id) {
        try {
          const detail = await this.gmail.users.messages.get({
            userId: 'me',
            id: item.id,
            format: 'raw'
          });

          const rawBase64 = detail.data.raw || '';
          const rawMime = Buffer.from(rawBase64, 'base64');
          const rawText = rawMime.toString('utf-8');
          const subjectMatch = rawText.match(/^Subject:\s*(.*)$/im);
          const fromMatch = rawText.match(/^From:\s*(.*)$/im);
          const toMatch = rawText.match(/^To:\s*(.*)$/im);

          messages.push({
            sourceId: item.id,
            internetMessageId: item.id,
            subject: subjectMatch ? subjectMatch[1].trim() : 'No Subject',
            from: { name: '', email: fromMatch ? fromMatch[1].trim() : '' },
            to: toMatch ? [{ name: '', email: toMatch[1].trim() }] : [],
            cc: [],
            bcc: [],
            sentAt: new Date(),
            receivedAt: new Date(),
            folderPath,
            labels: [folderPath],
            isRead: true,
            isFlagged: false,
            isDraft: false,
            isSpam: false,
            isTrash: false,
            attachments: [],
            rawMime
          });
        } catch (err) {
          console.error(`Failed to fetch message ${item.id}:`, err);
        }
      }
    }

    return {
      messages,
      nextPageToken: listRes.data.nextPageToken || undefined,
      hasMore: !!listRes.data.nextPageToken
    };
  }

  async createFolder(folderPath: string): Promise<string> {
    if (!this.gmail) await this.authenticate();
    try {
      const res = await this.gmail.users.labels.create({
        userId: 'me',
        requestBody: {
          name: folderPath,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show'
        }
      });
      return res.data.id || folderPath;
    } catch (err: any) {
      if (err.code === 409) {
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

      const res = await this.gmail.users.messages.insert({
        userId: 'me',
        requestBody: {
          labelIds: [folderPath]
        },
        media: {
          mimeType: 'message/rfc822',
          body: base64url
        }
      });

      return { success: true, messageId: res.data.id || 'unknown' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async getTotalMessageCount(): Promise<number> {
    if (!this.gmail) await this.authenticate();
    const profile = await this.gmail.users.getProfile({ userId: 'me' });
    return profile.data.messagesTotal || 0;
  }

  async disconnect(): Promise<void> {
    this.oauth2Client = null;
    this.gmail = null;
  }
}