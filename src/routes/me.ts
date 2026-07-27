import { Router, Request, Response } from "express";
import { z } from "zod";
import { supabase } from "../config/supabase";
import { authenticate } from "../middleware/auth";
import { ApiError } from "../middleware/error-handler";
import {
  isModelRunnable,
  loadKeyedProviders,
} from "../services/llm/llm-router";
import type { ModelName } from "../types";

const router = Router();
router.use(authenticate);

/**
 * GET /api/v1/me
 * Returns the authenticated user's profile, account, and the account's brands.
 */
router.get("/", async (req: Request, res: Response) => {
  const { user_id, account_id } = req.user!;

  const [profileResult, accountResult, brandsResult, authUserResult] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", user_id).single(),
      supabase.from("accounts").select("*").eq("id", account_id).single(),
      supabase
        .from("brands")
        .select("*")
        .eq("account_id", account_id)
        .order("created_at", { ascending: true }),
      supabase.auth.admin.getUserById(user_id),
    ]);

  res.json({
    data: {
      user: {
        id: user_id,
        email: authUserResult.data.user?.email ?? "",
        full_name: profileResult.data?.full_name ?? "",
        avatar_url: profileResult.data?.avatar_url ?? null,
      },
      account: accountResult.data,
      brands: brandsResult.data ?? [],
    },
  });
});

const updateAccountSchema = z.object({
  name: z.string().min(1).optional(),
  enabled_models: z.array(z.string()).optional(),
});

/**
 * PATCH /api/v1/me/account
 * Update account-level settings — display name and/or enabled_models.
 * A model may only be enabled if the account has a validated key for its provider.
 */
router.patch("/account", async (req: Request, res: Response) => {
  const { account_id } = req.user!;

  const body = updateAccountSchema.safeParse(req.body);
  if (!body.success) {
    throw new ApiError(400, "VALIDATION_ERROR", body.error.errors[0].message);
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.data.name !== undefined) updates.name = body.data.name;

  if (body.data.enabled_models !== undefined) {
    const keyed = await loadKeyedProviders(account_id);
    const missing = (body.data.enabled_models as ModelName[]).filter(
      (m) => !isModelRunnable(m, keyed),
    );
    if (missing.length > 0) {
      throw new ApiError(
        400,
        "MODEL_WITHOUT_KEY",
        `Connect a key before enabling: ${missing.join(", ")}`,
      );
    }
    updates.enabled_models = body.data.enabled_models;
  }

  const { data, error } = await supabase
    .from("accounts")
    .update(updates)
    .eq("id", account_id)
    .select()
    .single();

  if (error) throw new ApiError(500, "DB_ERROR", error.message);

  res.json({ data });
});

export default router;
