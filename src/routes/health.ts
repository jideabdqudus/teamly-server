import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { redis } from '../config/redis';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const checks = {
    status: 'ok' as 'ok' | 'degraded',
    redis: 'unknown' as 'connected' | 'error',
    supabase: 'unknown' as 'connected' | 'error',
    timestamp: new Date().toISOString(),
  };

  // Check Redis
  try {
    await redis.ping();
    checks.redis = 'connected';
  } catch {
    checks.redis = 'error';
    checks.status = 'degraded';
  }

  // Check Supabase
  try {
    const { error } = await supabase.from('organizations').select('id').limit(1);
    checks.supabase = error ? 'error' : 'connected';
    if (error) checks.status = 'degraded';
  } catch {
    checks.supabase = 'error';
    checks.status = 'degraded';
  }

  res.status(checks.status === 'ok' ? 200 : 503).json({ data: checks });
});

export default router;
