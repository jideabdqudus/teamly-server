import { Queue } from 'bullmq';
import { redis } from '../config/redis';
import {
  ScanOrchestrateJob,
  LLMQueryJob,
  AnalysisJob,
  ScoringJob,
  AlertJob,
} from '../types';

const connection = redis;

export const scanOrchestrateQueue = new Queue<ScanOrchestrateJob>('scan-orchestrate', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
});

export const llmQueryQueue = new Queue<LLMQueryJob>('llm-query', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 },
  },
});

export const analysisQueue = new Queue<AnalysisJob>('analysis', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

export const scoringQueue = new Queue<ScoringJob>('scoring', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  },
});

export const alertQueue = new Queue<AlertJob>('alert', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  },
});

// Register daily cron scan
export async function registerDailyCron(): Promise<void> {
  await scanOrchestrateQueue.add(
    'daily-cron',
    { triggered_by: 'cron', org_id: '' }, // org_id empty = iterate all orgs
    {
      repeat: { pattern: '0 6 * * *' }, // 6:00 AM UTC daily
      jobId: 'daily-cron', // Prevent duplicates
    },
  );
  console.log('✅ Daily cron scan registered (6:00 AM UTC)');
}
