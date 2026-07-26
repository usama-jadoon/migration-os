export interface ConnectorCredentials {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  tls?: boolean;
  client_id?: string;
  client_secret?: string;
  access_token?: string;
  refresh_token?: string;
  email?: string;
}

export interface MigrationFolder {
  name: string;
  path: string;
  messageCount: number;
}

export interface UniversalMessageAttachment {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  data: Buffer;
}

export interface UniversalMessage {
  sourceId: string;
  internetMessageId?: string;
  subject: string;
  from: { name: string; email: string };
  to: Array<{ name: string; email: string }>;
  cc: Array<{ name: string; email: string }>;
  bcc: Array<{ name: string; email: string }>;
  sentAt: Date;
  receivedAt?: Date;
  textBody?: string;
  htmlBody?: string;
  attachments: Array<UniversalMessageAttachment>;
  folderPath: string;
  labels: string[];
  isRead: boolean;
  isFlagged: boolean;
  isDraft: boolean;
  isSpam: boolean;
  isTrash: boolean;
  rawMime?: Buffer;
}

export interface MessageBatch {
  messages: UniversalMessage[];
  nextPageToken?: string;
  hasMore: boolean;
}

export interface ImportResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface MigrationConnector {
  authenticate(): Promise<void>;
  testConnection(): Promise<boolean>;
  listFolders(): Promise<MigrationFolder[]>;
  createFolder(folderPath: string): Promise<string>; // Accepts path, returns destination path/id
  listMessages(folderPath: string, options?: { pageToken?: string; batchSize?: number }): Promise<MessageBatch>;
  importMessage(message: UniversalMessage, folderPath: string, flags?: string[]): Promise<ImportResult>;
  getTotalMessageCount(): Promise<number>;
  disconnect(): Promise<void>;
}