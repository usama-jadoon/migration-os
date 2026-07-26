import { EventEmitter } from 'events';
import { Queue as BullQueue, Worker as BullWorker, Job as BullJob } from 'bullmq';
import Redis from 'ioredis';
import { getEnvConfig } from '../config/env.config';
import { logger } from '../utils/logger';

export interface Job {
  id: string;
  data: any;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  handler?: (job: Job) => Promise<void>;
}

export interface IMigrationQueue extends EventEmitter {
  addJob(id: string, data: any, handler?: (job: Job) => Promise<void>): Promise<Job>;
  pauseJob(id: string): Promise<void>;
  resumeJob(id: string): Promise<void>;
  cancelJob(id: string): Promise<void>;
  isPaused(id: string): boolean;
  isCancelled(id: string): boolean;
  getProvider(): 'memory' | 'redis';
  close(): Promise<void>;
}

export class JobQueue extends EventEmitter implements IMigrationQueue {
  private queue: Job[] = [];
  private activeJobs: Map<string, Job> = new Map();
  private maxConcurrent: number = 3;

  constructor() {
    super();
  }

  getProvider(): 'memory' | 'redis' {
    return 'memory';
  }

  async close(): Promise<void> {
    this.queue = [];
    this.activeJobs.clear();
    this.removeAllListeners();
  }

  async addJob(id: string, data: any, handler?: (job: Job) => Promise<void>) {
    const job: Job = {
      id,
      data,
      status: 'pending',
      handler,
    };
    this.queue.push(job);
    this.emit('added', job);
    this.processQueue();
    return job;
  }

  async pauseJob(id: string) {
    const job = this.queue.find((j) => j.id === id) || this.activeJobs.get(id);
    if (job) {
      job.status = 'paused';
      this.emit('paused', job);
    }
  }

  async resumeJob(id: string) {
    const job = this.queue.find((j) => j.id === id) || this.activeJobs.get(id);
    if (job && job.status === 'paused') {
      job.status = 'pending';
      this.emit('resumed', job);
      this.processQueue();
    }
  }

  async cancelJob(id: string) {
    const job = this.queue.find((j) => j.id === id) || this.activeJobs.get(id);
    if (job) {
      job.status = 'cancelled';
      this.emit('cancelled', job);
    }
  }

  isPaused(id: string): boolean {
    const job = this.queue.find((j) => j.id === id) || this.activeJobs.get(id);
    return job ? job.status === 'paused' : false;
  }

  isCancelled(id: string): boolean {
    const job = this.queue.find((j) => j.id === id) || this.activeJobs.get(id);
    return job ? job.status === 'cancelled' : false;
  }

  private async processQueue() {
    if (this.activeJobs.size >= this.maxConcurrent) {
      return;
    }

    const nextJobIndex = this.queue.findIndex((j) => j.status === 'pending');
    if (nextJobIndex === -1) {
      return;
    }

    const job = this.queue[nextJobIndex];
    this.queue.splice(nextJobIndex, 1);
    this.activeJobs.set(job.id, job);
    job.status = 'running';
    this.emit('started', job);

    try {
      if (job.handler) {
        await job.handler(job);
      } else {
        for (let i = 0; i < 10; i++) {
          const currentStatus = job.status as string;
          if (currentStatus === 'cancelled') {
            break;
          }
          if (currentStatus === 'paused') {
            this.activeJobs.delete(job.id);
            this.queue.push(job);
            this.processQueue();
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      if ((job.status as string) === 'running') {
        job.status = 'completed';
        this.emit('completed', job);
      }
    } catch (error) {
      job.status = 'failed';
      this.emit('failed', job, error);
    } finally {
      this.activeJobs.delete(job.id);
      this.processQueue();
    }
  }
}

export class RedisMigrationQueue extends EventEmitter implements IMigrationQueue {
  private bullQueue: BullQueue;
  private bullWorker: BullWorker | null = null;
  private connection: Redis;
  private jobStatuses: Map<string, 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'> = new Map();
  private handlers: Map<string, (job: Job) => Promise<void>> = new Map();

  constructor(redisUrl: string = 'redis://localhost:6379') {
    super();
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.bullQueue = new BullQueue('migration-jobs', {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: false,
        removeOnFail: false,
      },
    });

    const env = getEnvConfig();
    this.bullWorker = new BullWorker(
      'migration-jobs',
      async (bullJob: BullJob) => {
        const id = bullJob.id || bullJob.data.id;
        this.jobStatuses.set(id, 'running');
        const handler = this.handlers.get(id);

        const jobWrapper: Job = {
          id,
          data: bullJob.data,
          status: 'running',
          handler,
        };

        if (handler) {
          await handler(jobWrapper);
        }
        this.jobStatuses.set(id, 'completed');
      },
      {
        connection: this.connection,
        concurrency: env.WORKER_CONCURRENCY,
      }
    );

    this.bullWorker.on('failed', (job, err) => {
      const id = job?.id || 'unknown';
      this.jobStatuses.set(id, 'failed');
      logger.error(`[RedisQueue] Job failed (Dead-letter queued)`, { jobId: id, error: err.message });
      this.emit('failed', { id, data: job?.data }, err);
    });

    this.bullWorker.on('completed', (job) => {
      const id = job?.id || 'unknown';
      this.emit('completed', { id, data: job?.data });
    });
  }

  getProvider(): 'memory' | 'redis' {
    return 'redis';
  }

  async addJob(id: string, data: any, handler?: (job: Job) => Promise<void>): Promise<Job> {
    if (handler) {
      this.handlers.set(id, handler);
    }
    this.jobStatuses.set(id, 'pending');

    await this.bullQueue.add('migration-run', { id, ...data }, { jobId: id });

    const job: Job = { id, data, status: 'pending', handler };
    this.emit('added', job);
    return job;
  }

  async pauseJob(id: string): Promise<void> {
    this.jobStatuses.set(id, 'paused');
    try {
      await this.bullQueue.pause();
    } catch (err: any) {
      logger.warn(`[RedisQueue] Pause failed for ${id}:`, { error: err.message });
    }
    this.emit('paused', { id, status: 'paused' });
  }

  async resumeJob(id: string): Promise<void> {
    this.jobStatuses.set(id, 'pending');
    try {
      await this.bullQueue.resume();
    } catch (err: any) {
      logger.warn(`[RedisQueue] Resume failed for ${id}:`, { error: err.message });
    }
    this.emit('resumed', { id, status: 'pending' });
  }

  async cancelJob(id: string): Promise<void> {
    this.jobStatuses.set(id, 'cancelled');
    const job = await this.bullQueue.getJob(id);
    if (job) {
      await job.remove();
    }
    this.emit('cancelled', { id, status: 'cancelled' });
  }

  isPaused(id: string): boolean {
    return this.jobStatuses.get(id) === 'paused';
  }

  isCancelled(id: string): boolean {
    return this.jobStatuses.get(id) === 'cancelled';
  }

  async close(): Promise<void> {
    if (this.bullWorker) {
      await this.bullWorker.close();
    }
    await this.bullQueue.close();
    await this.connection.quit();
    this.removeAllListeners();
  }
}

export function createMigrationQueue(): IMigrationQueue {
  const env = getEnvConfig();
  if (env.QUEUE_PROVIDER === 'redis') {
    logger.info('[QueueFactory] Instantiating RedisMigrationQueue', { redisUrl: env.REDIS_URL });
    return new RedisMigrationQueue(env.REDIS_URL);
  }
  logger.info('[QueueFactory] Instantiating MemoryMigrationQueue (JobQueue)');
  return new JobQueue();
}

export const migrationQueue: IMigrationQueue = createMigrationQueue();