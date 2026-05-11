import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../config/supabase';
import { authenticate } from '../middleware/auth';
import { ApiError } from '../middleware/error-handler';
import { canAddCompetitor } from '../lib/plan-limits';

const router = Router();
router.use(authenticate);

const createCompetitorSchema = z.object({
  name: z.string().min(1).max(100),
  domain: z.string().optional(),
});

/**
 * GET /api/v1/competitors
 * Returns competitors with SOV and mention counts.
 */
router.get('/', async (req: Request, res: Response) => {
  const { org_id } = req.user!;

  const { data: competitors, error } = await supabase
    .from('competitors')
    .select('*')
    .eq('org_id', org_id)
    .order('created_at', { ascending: false });

  if (error) throw new ApiError(500, 'DB_ERROR', 'Failed to fetch competitors');

  // Get mention counts from the last 30 days of responses
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: mentions } = await supabase
    .from('mentions')
    .select('name, type, response_id, position')
    .eq('org_id', org_id)
    .gte('created_at', thirtyDaysAgo);

  const totalMentions = mentions?.length ?? 0;

  const brandMentions = mentions?.filter((m) => m.type === 'brand').length ?? 0;

  const enriched = (competitors ?? []).map((c) => {
    const competitorMentions = mentions?.filter(
      (m) => m.type === 'competitor' && m.name.toLowerCase() === c.name.toLowerCase()
    ) ?? [];

    const mentionCount = competitorMentions.length;
    const sov = totalMentions > 0 ? Math.round((mentionCount / totalMentions) * 100) : 0;
    const brandSov = totalMentions > 0 ? Math.round((brandMentions / totalMentions) * 100) : 0;

    const positions = competitorMentions.map((m) => m.position).filter(Boolean) as number[];
    const avgPosition = positions.length > 0
      ? Math.round(positions.reduce((a, b) => a + b, 0) / positions.length)
      : null;

    return {
      ...c,
      mentions: mentionCount,
      shareOfVoice: sov,
      sovChange: null,
      overtookBrand: sov > brandSov && brandSov > 0,
      avgPosition,
      positionChange: null,
    };
  });

  res.json({ data: enriched });
});

/**
 * POST /api/v1/competitors
 */
router.post('/', async (req: Request, res: Response) => {
  const { org_id, plan_tier } = req.user!;

  const body = createCompetitorSchema.safeParse(req.body);
  if (!body.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', body.error.errors[0].message);
  }

  const { count } = await supabase
    .from('competitors')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', org_id);

  if (!canAddCompetitor(plan_tier, count ?? 0)) {
    throw new ApiError(403, 'PLAN_LIMIT', `Your ${plan_tier} plan allows a limited number of competitors. Please upgrade to add more.`);
  }

  const { data, error } = await supabase
    .from('competitors')
    .insert({ org_id, ...body.data })
    .select()
    .single();

  if (error || !data) throw new ApiError(500, 'DB_ERROR', 'Failed to add competitor');

  req.log.info({ event: 'competitors.created', competitor_id: data.id }, 'competitor added');

  res.status(201).json({ data });
});

/**
 * DELETE /api/v1/competitors/:id
 */
router.delete('/:id', async (req: Request, res: Response) => {
  const { org_id } = req.user!;
  const { id } = req.params;

  const { error } = await supabase
    .from('competitors')
    .delete()
    .eq('id', id)
    .eq('org_id', org_id);

  if (error) throw new ApiError(404, 'NOT_FOUND', 'Competitor not found');

  req.log.info({ event: 'competitors.deleted', competitor_id: id }, 'competitor removed');

  res.json({ data: { message: 'Competitor removed' } });
});

export default router;
