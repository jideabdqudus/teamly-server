import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../config/supabase';
import { authenticate } from '../middleware/auth';
import { ApiError } from '../middleware/error-handler';
import { canAddPrompt } from '../lib/plan-limits';

const router = Router();
router.use(authenticate);

const createPromptSchema = z.object({
  text: z.string().min(5, 'Prompt must be at least 5 characters').max(500),
  country: z.string().default('United States'),
  country_code: z.string().default('US'),
  language: z.string().default('English'),
});

const updatePromptSchema = createPromptSchema.partial().extend({
  active: z.boolean().optional(),
});

/**
 * GET /api/v1/prompts
 * List prompts for the org, joined with latest visibility metrics.
 */
router.get('/', async (req: Request, res: Response) => {
  const { org_id } = req.user!;

  const { data: prompts, error } = await supabase
    .from('prompts')
    .select('*')
    .eq('org_id', org_id)
    .order('created_at', { ascending: false });

  if (error) throw new ApiError(500, 'DB_ERROR', 'Failed to fetch prompts');

  // Get latest visibility metrics for each prompt
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const { data: visMetrics } = await supabase
    .from('prompt_visibility_daily')
    .select('*')
    .eq('org_id', org_id)
    .gte('date', thirtyDaysAgo)
    .lte('date', today);

  // Map latest metric per prompt
  const metricsByPrompt = new Map<string, typeof visMetrics>();
  visMetrics?.forEach((m) => {
    const existing = metricsByPrompt.get(m.prompt_id) ?? [];
    metricsByPrompt.set(m.prompt_id, [...existing, m]);
  });

  const enriched = (prompts ?? []).map((p) => {
    const metrics = metricsByPrompt.get(p.id) ?? [];
    const latest = metrics.sort((a, b) => b.date.localeCompare(a.date))[0];
    const prev = metrics[1];

    return {
      ...p,
      visibility: latest?.score ?? 0,
      visibilityChange: latest && prev ? latest.score - prev.score : null,
      mentions: latest?.mentions ?? 0,
      responses: latest?.responses ?? 0,
      citations: latest?.citations ?? 0,
      citationsChange: null,
      position: latest?.avg_position ? Math.round(latest.avg_position) : null,
    };
  });

  res.json({ data: enriched });
});

/**
 * POST /api/v1/prompts
 */
router.post('/', async (req: Request, res: Response) => {
  const { org_id, plan_tier } = req.user!;

  const body = createPromptSchema.safeParse(req.body);
  if (!body.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', body.error.errors[0].message);
  }

  // Enforce plan limit
  const { count } = await supabase
    .from('prompts')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', org_id);

  if (!canAddPrompt(plan_tier, count ?? 0)) {
    throw new ApiError(403, 'PLAN_LIMIT', `Your ${plan_tier} plan allows a limited number of prompts. Please upgrade to add more.`);
  }

  const { data, error } = await supabase
    .from('prompts')
    .insert({ org_id, ...body.data })
    .select()
    .single();

  if (error || !data) throw new ApiError(500, 'DB_ERROR', 'Failed to create prompt');

  req.log.info({ event: 'prompts.created', prompt_id: data.id }, 'prompt created');

  res.status(201).json({ data });
});

/**
 * PATCH /api/v1/prompts/:id
 */
router.patch('/:id', async (req: Request, res: Response) => {
  const { org_id } = req.user!;
  const { id } = req.params;

  const body = updatePromptSchema.safeParse(req.body);
  if (!body.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', body.error.errors[0].message);
  }

  const { data, error } = await supabase
    .from('prompts')
    .update({ ...body.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', org_id)
    .select()
    .single();

  if (error || !data) throw new ApiError(404, 'NOT_FOUND', 'Prompt not found');

  req.log.info({ event: 'prompts.updated', prompt_id: data.id }, 'prompt updated');

  res.json({ data });
});

/**
 * DELETE /api/v1/prompts/:id
 */
router.delete('/:id', async (req: Request, res: Response) => {
  const { org_id } = req.user!;
  const { id } = req.params;

  const { error } = await supabase
    .from('prompts')
    .delete()
    .eq('id', id)
    .eq('org_id', org_id);

  if (error) throw new ApiError(404, 'NOT_FOUND', 'Prompt not found');

  req.log.info({ event: 'prompts.deleted', prompt_id: id }, 'prompt deleted');

  res.json({ data: { message: 'Prompt deleted' } });
});

export default router;
