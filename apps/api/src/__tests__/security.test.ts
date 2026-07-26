import { encrypt, decrypt, redactSensitive, serializeError } from '../utils/crypto';
import { generateIdempotencyKey } from '../utils/idempotency';
import { proposeMappings } from '../utils/mapping';
import { withRetry } from '../utils/retry';

describe('Security & Crypto Utilities', () => {
  const originalKey = process.env.ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = 'super-secret-key-32-chars-long-x';
  });

  afterAll(() => {
    process.env.ENCRYPTION_KEY = originalKey;
  });

  test('Encryption & Decryption returns original value', () => {
    const secret = 'imap-password-123';
    const encrypted = encrypt(secret);
    
    expect(encrypted).not.toBe(secret);
    expect(encrypted.split(':').length).toBe(3); // iv:tag:content

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(secret);
  });

  test('Rejects tampered payloads', () => {
    const encrypted = encrypt('my-secret');
    const [iv, tag, ciphertext] = encrypted.split(':');
    
    // Corrupt ciphertext slightly
    const corruptedCiphertext = ciphertext.substring(0, ciphertext.length - 2) + '00';
    const tampered = `${iv}:${tag}:${corruptedCiphertext}`;

    expect(() => decrypt(tampered)).toThrow('Failed to decrypt');
  });

  test('Redacts sensitive credential fields', () => {
    const config = {
      host: 'imap.test.com',
      port: 993,
      password: 'mypassword',
      access_token: 'token123',
      auth: {
        pass: 'pass123',
        username: 'user@test.com'
      }
    };

    const redacted = redactSensitive(config);
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.access_token).toBe('[REDACTED]');
    expect(redacted.auth.pass).toBe('[REDACTED]');
    expect(redacted.auth.username).toBe('user@test.com');
    expect(redacted.host).toBe('imap.test.com');
  });

  test('Redacts sensitive values from raw error strings', () => {
    const errorMsg1 = 'Failed to connect to host=imap.gmail.com password=secret123';
    const errorMsg2 = 'Authorization header Bearer ya29.abcdefg failed';

    expect(serializeError(errorMsg1)).toContain('password=[REDACTED]');
    expect(serializeError(errorMsg2)).toContain('Bearer [REDACTED]');
  });
});

describe('Folder Mapping Proposing Utility', () => {
  test('Correctly maps nested folder delimiters', () => {
    const sourceFolders = [
      { name: 'Inbox', path: 'Inbox', messageCount: 10 },
      { name: 'Sub.Folder', path: 'Custom.Sub.Folder', messageCount: 5 }
    ];

    const proposals = proposeMappings(sourceFolders, 'imap', 'google');
    // Delimiter for IMAP is "." and Gmail is "/"
    expect(proposals[0].destFolderName).toBe('INBOX');
    expect(proposals[1].destFolderName).toBe('Custom/Sub/Folder');
  });

  test('Maps standard system mailboxes', () => {
    const sourceFolders = [
      { name: 'Sent Items', path: 'Sent Items', messageCount: 0 },
      { name: 'Deleted Items', path: 'Deleted Items', messageCount: 0 },
      { name: 'Junk Email', path: 'Junk Email', messageCount: 0 }
    ];

    const proposals = proposeMappings(sourceFolders, 'imap', 'google');
    expect(proposals[0].destFolderName).toBe('Sent');
    expect(proposals[1].destFolderName).toBe('Trash');
    expect(proposals[2].destFolderName).toBe('Spam');
  });
});

describe('Idempotency Key Generator', () => {
  test('Generates identical keys for same attributes', () => {
    const date = new Date('2026-07-27T00:00:00.000Z');
    const key1 = generateIdempotencyKey('mig-1', 'Inbox', 'uid-123', 'id-1', 1024, date);
    const key2 = generateIdempotencyKey('mig-1', 'Inbox', 'uid-123', 'id-1', 1024, date);
    
    expect(key1).toBe(key2);
  });

  test('Generates different keys for different attributes', () => {
    const date = new Date('2026-07-27T00:00:00.000Z');
    const key1 = generateIdempotencyKey('mig-1', 'Inbox', 'uid-123', 'id-1', 1024, date);
    const key2 = generateIdempotencyKey('mig-1', 'Inbox', 'uid-456', 'id-1', 1024, date);
    
    expect(key1).not.toBe(key2);
  });
});

describe('Retry Wrapper', () => {
  test('Successfully resolves immediately if no failure occurs', async () => {
    const mockFn = jest.fn().mockResolvedValue('success');
    const result = await withRetry(mockFn, 3, 10);

    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  test('Retries transient errors and succeeds', async () => {
    let callCount = 0;
    const mockFn = jest.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 2) {
        throw new Error('Transient network error');
      }
      return 'success';
    });

    const result = await withRetry(mockFn, 3, 10);
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  test('Aborts retry immediately on permanent auth errors', async () => {
    const mockFn = jest.fn().mockRejectedValue(new Error('Authentication failed'));
    
    await expect(withRetry(mockFn, 3, 10)).rejects.toThrow('Authentication failed');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });
});

describe('Connector Factory', () => {
  const { connectorFactory } = require('../utils/connector.factory');

  test('Creates ImapConnector instance with parsed config', () => {
    const connector = connectorFactory.create('imap', JSON.stringify({ host: 'imap.example.com' }));
    expect(connector).toBeDefined();
  });

  test('Handles invalid JSON credentials gracefully', () => {
    expect(() => connectorFactory.create('imap', '{ invalid-json')).toThrow('Failed to parse credentials configuration: Invalid JSON structure');
  });

  test('Throws error for unsupported provider', () => {
    expect(() => connectorFactory.create('invalid-provider', null)).toThrow('Unsupported provider: invalid-provider');
  });
});
