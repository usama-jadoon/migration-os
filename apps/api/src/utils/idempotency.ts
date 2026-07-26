import crypto from 'crypto';

/**
 * Deterministically generates an idempotency key for an email message.
 */
export function generateIdempotencyKey(
  migrationId: string,
  folderName: string,
  sourceItemId: string,
  internetMessageId?: string,
  messageSize?: number,
  receivedDate?: Date
): string {
  const hash = crypto.createHash('sha256');
  hash.update(migrationId);
  hash.update(folderName);
  hash.update(sourceItemId);
  
  if (internetMessageId) {
    hash.update(internetMessageId);
  }
  if (messageSize) {
    hash.update(messageSize.toString());
  }
  if (receivedDate) {
    const time = receivedDate instanceof Date ? receivedDate.getTime() : new Date(receivedDate).getTime();
    hash.update(time.toString());
  }
  
  return hash.digest('hex');
}
