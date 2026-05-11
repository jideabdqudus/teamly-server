import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticate } from '../middleware/auth';
import { ApiError } from '../middleware/error-handler';

const router = Router();
router.use(authenticate);

/**
 * GET /api/v1/me
 * Returns the authenticated user's profile and org.
 */
router.get('/', async (req: Request, res: Response) => {
  const { user_id, org_id } = req.user!;

  const [profileResult, orgResult, alertRulesResult, authUserResult] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user_id).single(),
    supabase.from('organizations').select('*').eq('id', org_id).single(),
    supabase.from('alert_rules').select('*').eq('org_id', org_id),
    supabase.auth.admin.getUserById(user_id),
  ]);

  res.json({
    data: {
      user: {
        id: user_id,
        email: authUserResult.data.user?.email ?? '',
        full_name: profileResult.data?.full_name ?? '',
        avatar_url: profileResult.data?.avatar_url ?? null,
      },
      org: orgResult.data,
      alert_rules: alertRulesResult.data ?? [],
    },
  });
});

/**
 * PATCH /api/v1/me/org
 * Update org settings — brand_name and/or enabled_models.
 * Used by onboarding (steps 1 & 4) and the settings page.
 */
router.patch('/org', async (req: Request, res: Response) => {
  const { org_id } = req.user!;
  const { brand_name, enabled_models } = req.body as {
    brand_name?: string;
    enabled_models?: string[];
  };

  const updates: Record<string, unknown> = {};
  if (brand_name !== undefined) updates.brand_name = brand_name;
  if (enabled_models !== undefined) updates.enabled_models = enabled_models;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: { code: 'NO_UPDATES', message: 'No fields provided to update.' } });
    return;
  }

  const { data, error } = await supabase
    .from('organizations')
    .update(updates)
    .eq('id', org_id)
    .select()
    .single();

  if (error) throw new ApiError(500, 'DB_ERROR', error.message);
  res.json({ data });
});

export default router;
