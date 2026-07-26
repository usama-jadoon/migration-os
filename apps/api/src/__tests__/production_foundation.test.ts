import { getEnvConfig, resetEnvConfigForTesting } from '../config/env.config';
import { logger } from '../utils/logger';
import { checkDbHealth } from '../utils/db';
import { createMigrationQueue } from '../queues/migration.queue';

describe('Production Foundation Suite', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    resetEnvConfigForTesting();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Environment Validation (env.config.ts)', () => {
    it('should load default SQLite and memory queue config', () => {
      const config = getEnvConfig();
      expect(config.DATABASE_PROVIDER).toBe('sqlite');
      expect(config.QUEUE_PROVIDER).toBe('memory');
      expect(config.PORT).toBe(4000);
      expect(config.WORKER_CONCURRENCY).toBe(1);
    });

    it('should parse custom environment variables correctly', () => {
      process.env.DATABASE_PROVIDER = 'postgresql';
      process.env.QUEUE_PROVIDER = 'redis';
      process.env.REDIS_URL = 'redis://127.0.0.1:6379';
      process.env.WORKER_CONCURRENCY = '5';

      const config = getEnvConfig();
      expect(config.DATABASE_PROVIDER).toBe('postgresql');
      expect(config.QUEUE_PROVIDER).toBe('redis');
      expect(config.REDIS_URL).toBe('redis://127.0.0.1:6379');
      expect(config.WORKER_CONCURRENCY).toBe(5);
    });
  });

  describe('Structured Logger (logger.ts)', () => {
    it('should log without crashing and redact sensitive keys', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      logger.info('User authenticated', { password: 'superSecret123', email: 'test@example.com' });
      expect(consoleSpy).toHaveBeenCalled();
      const loggedJson = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(loggedJson.meta.password).toBe('[REDACTED]');
      expect(loggedJson.meta.email).toBe('test@example.com');
      consoleSpy.mockRestore();
    });
  });

  describe('Database Health Check (db.ts)', () => {
    it('should check database health cleanly', async () => {
      const health = await checkDbHealth();
      expect(health).toHaveProperty('healthy');
      expect(health).toHaveProperty('provider');
      expect(health.healthy).toBe(true);
    });
  });

  describe('Queue Adapter Factory (migration.queue.ts)', () => {
    it('should instantiate MemoryMigrationQueue by default', () => {
      const queue = createMigrationQueue();
      expect(queue.getProvider()).toBe('memory');
    });

    it('should instantiate RedisMigrationQueue when QUEUE_PROVIDER=redis', () => {
      process.env.QUEUE_PROVIDER = 'redis';
      resetEnvConfigForTesting();
      const queue = createMigrationQueue();
      expect(queue.getProvider()).toBe('redis');
      queue.close();
    });
  });
});
