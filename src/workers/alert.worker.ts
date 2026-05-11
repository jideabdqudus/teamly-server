import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { childLogger } from '../config/logger';
import { AlertJob } from '../types';

const log = childLogger({ worker: 'alert' });

// Stub worker — alert evaluation and email delivery deferred to Phase 4
export function createAlertWorker(): Worker {
  return new Worker<AlertJob>(
    'alert',
    async (job: Job<AlertJob>) => {
      const { scan_id, org_id } = job.data;
      log.info({ job_id: job.id, scan_id, org_id }, 'alert evaluation stub (deferred)');
      // Phase 4: Implement alert rule evaluation and Resend email delivery here
    },
    {
      connection: redis,
      concurrency: 5,
    },
  );
}
