import crypto from 'crypto';

/**
 * Derives a 32-byte key from the ENCRYPTION_KEY environment variable.
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not configured');
  }
  // SHA-256 guarantees a 32-byte (256-bit) buffer regardless of key length
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encrypts cleartext using AES-256-GCM.
 * Returns a serialized format: ivHex:authTagHex:encryptedHex
 */
export function encrypt(text: string): string {
  if (!text) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // GCM standard IV size is 12 bytes
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a serialized AES-256-GCM payload.
 * Throws an error if formatting is invalid or payload has been tampered with.
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) return '';
  const key = getEncryptionKey();
  const parts = encryptedText.split(':');
  
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');

  if (iv.length !== 12 || authTag.length !== 16) {
    throw new Error('Invalid key, IV, or auth tag lengths');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    return decrypted.toString('utf8');
  } catch (err: any) {
    throw new Error('Failed to decrypt: Data tampering or incorrect key detected');
  }
}

/**
 * Redacts sensitive fields from objects.
 */
export function redactSensitive(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(redactSensitive);
  }

  const redacted: any = {};
  const sensitiveKeys = [
    'password', 'pass', 'access_token', 'accessToken', 'refresh_token', 
    'refreshToken', 'client_secret', 'clientSecret', 'credentials', 'key', 'secret'
  ];

  for (const key of Object.keys(obj)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = redactSensitive(obj[key]);
    }
  }

  return redacted;
}

/**
 * Safe error message serializer that redacts potential secrets.
 */
export function serializeError(error: any): string {
  if (!error) return 'Unknown error';
  
  let message = error.message || String(error);
  
  // Basic pattern checks to redact credentials from raw error text
  message = message.replace(/(password|pass|secret|token|key)=[^\s&]+/gi, '$1=[REDACTED]');
  message = message.replace(/bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED]');
  
  return message;
}
