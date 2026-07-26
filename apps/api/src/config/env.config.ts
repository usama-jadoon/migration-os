import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_PROVIDER: z.enum(['sqlite', 'postgresql']).default('sqlite'),
  DATABASE_URL: z.string().default('file:./migrationos.db'),
  QUEUE_PROVIDER: z.enum(['memory', 'redis']).default('memory'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  ENCRYPTION_KEY: z.string().default('generate-32-char-key-here'),
  WORKER_CONCURRENCY: z.coerce.number().min(1).max(20).default(1),
});

export type EnvConfig = z.infer<typeof envSchema>;

let validatedEnv: EnvConfig | null = null;

export function getEnvConfig(): EnvConfig {
  if (!validatedEnv) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      console.error('[EnvConfig] Invalid environment variables:', result.error.format());
      throw new Error(`Environment validation failed: ${result.error.message}`);
    }
    validatedEnv = result.data;
  }
  return validatedEnv;
}

export function resetEnvConfigForTesting(): void {
  validatedEnv = null;
}
