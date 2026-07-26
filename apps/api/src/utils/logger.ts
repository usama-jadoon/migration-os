import { redactSensitive, serializeError } from './crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function currentMinLogLevel(): LogLevel {
  const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
  return LOG_LEVELS[envLevel] !== undefined ? envLevel : 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentMinLogLevel()];
}

export function logEvent(level: LogLevel, message: string, meta?: Record<string, any>): void {
  if (!shouldLog(level)) return;

  const timestamp = new Date().toISOString();
  const sanitizedMeta = meta ? JSON.parse(JSON.stringify(meta, redactReplacer)) : undefined;
  const sanitizedMsg = typeof message === 'string' ? redactSensitive(message) : message;

  const entry = {
    timestamp,
    level,
    message: sanitizedMsg,
    ...(sanitizedMeta && Object.keys(sanitizedMeta).length > 0 ? { meta: sanitizedMeta } : {}),
  };

  const output = JSON.stringify(entry);

  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

function redactReplacer(key: string, value: any): any {
  const sensitiveKeys = ['password', 'token', 'secret', 'credentials', 'authorization', 'access_token'];
  if (sensitiveKeys.includes(key.toLowerCase())) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') {
    return redactSensitive(value);
  }
  if (value instanceof Error) {
    return serializeError(value);
  }
  return value;
}

export const logger = {
  debug: (msg: string, meta?: Record<string, any>) => logEvent('debug', msg, meta),
  info: (msg: string, meta?: Record<string, any>) => logEvent('info', msg, meta),
  warn: (msg: string, meta?: Record<string, any>) => logEvent('warn', msg, meta),
  error: (msg: string, meta?: Record<string, any>) => logEvent('error', msg, meta),
};
