import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
});

export async function checkDbHealth(): Promise<{ healthy: boolean; provider: string; error?: string }> {
  const provider = process.env.DATABASE_PROVIDER || 'sqlite';
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { healthy: true, provider };
  } catch (err: any) {
    logger.error('Database health check failed', { error: err.message });
    return { healthy: false, provider, error: err.message };
  }
}
