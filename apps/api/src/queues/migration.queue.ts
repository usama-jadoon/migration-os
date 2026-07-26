import { EventEmitter } from 'events';

export interface Job {
  id: string;
  data: any;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  handler?: (job: Job) => Promise<void>;
}

export class JobQueue extends EventEmitter {
  private queue: Job[] = [];
  private activeJobs: Map<string, Job> = new Map();
  private maxConcurrent: number = 3;

  constructor() {
    super();
  }

  async addJob(id: string, data: any, handler?: (job: Job) => Promise<void>) {
    const job: Job = {
      id,
      data,
      status: 'pending',
      handler
    };
    this.queue.push(job);
    this.emit('added', job);
    this.processQueue();
    return job;
  }

  async pauseJob(id: string) {
    const job = this.queue.find(j => j.id === id) || this.activeJobs.get(id);
    if (job) {
      job.status = 'paused';
      this.emit('paused', job);
    }
  }

  async resumeJob(id: string) {
    const job = this.queue.find(j => j.id === id) || this.activeJobs.get(id);
    if (job && job.status === 'paused') {
      job.status = 'pending';
      this.emit('resumed', job);
      this.processQueue();
    }
  }

  async cancelJob(id: string) {
    const job = this.queue.find(j => j.id === id) || this.activeJobs.get(id);
    if (job) {
      job.status = 'cancelled';
      this.emit('cancelled', job);
    }
  }

  isPaused(id: string): boolean {
    const job = this.queue.find(j => j.id === id) || this.activeJobs.get(id);
    return job ? job.status === 'paused' : false;
  }

  isCancelled(id: string): boolean {
    const job = this.queue.find(j => j.id === id) || this.activeJobs.get(id);
    return job ? job.status === 'cancelled' : false;
  }

  private async processQueue() {
    if (this.activeJobs.size >= this.maxConcurrent) {
      return;
    }

    const nextJobIndex = this.queue.findIndex(j => j.status === 'pending');
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
        // Default simulator
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
          await new Promise(resolve => setTimeout(resolve, 1000));
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

export const migrationQueue = new JobQueue();