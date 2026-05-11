import IORedis from 'ioredis';
import { env } from './env';
import { childLogger } from './logger';

const log = childLogger({ component: 'redis' });

export const redis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: false,
});

redis.on('connect', () => log.info('redis connected'));
redis.on('error', (err) => {
  const isRefused = 'code' in err && (err as { code?: string }).code === 'ECONNREFUSED';
  log.error(
    {
      err,
      hint: isRefused
        ? 'start Redis locally or set REDIS_URL to a running instance — required for BullMQ'
        : undefined,
    },
    'redis error',
  );
});
