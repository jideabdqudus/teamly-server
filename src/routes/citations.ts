import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticate } from '../middleware/auth';
import { ApiError } from '../middleware/error-handler';

const router = Router();
router.use(authenticate);

/**
 * GET /api/v1/citations
 * Returns citations with domain grouping and new-source detection.
 */
router.get('/', async (req: Request, res: Response) => {
  const { org_id } = req.user!;
  const { page = '1', limit = '20', domain } = req.query;

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(100, Math.max(1, Number(limit)));
  const offset = (pageNum - 1) * limitNum;

  // "New" = first seen in the last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from('citations')
    .select(`
      id, url, domain, title, model, prompt_id,
      first_seen_at, last_seen_at, created_at,
      prompts!inner(text)
    `, { count: 'exact' })
    .eq('org_id', org_id)
    .order('last_seen_at', { ascending: false })
    .range(offset, offset + limitNum - 1);

  if (domain) query = query.eq('domain', domain as string);

  const { data, error, count } = await query;

  if (error) throw new ApiError(500, 'DB_ERROR', 'Failed to fetch citations');

  const enriched = (data ?? []).map((c) => ({
    ...c,
    is_new: c.first_seen_at >= sevenDaysAgo,
  }));

  res.json({
    data: enriched,
    meta: {
      page: pageNum,
      limit: limitNum,
      total: count ?? 0,
      pages: Math.ceil((count ?? 0) / limitNum),
    },
  });
});

export default router;
