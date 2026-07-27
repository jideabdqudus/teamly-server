import { Router, Request, Response } from "express";
import { z } from "zod";
import { supabase } from "../config/supabase";
import { authenticate } from "../middleware/auth";
import { ApiError } from "../middleware/error-handler";

const router = Router();
router.use(authenticate);

const createBrandSchema = z.object({
  brand_name: z.string().min(1).max(100),
  domain: z.string().optional(),
  industry: z.string().optional(),
});

const updateBrandSchema = createBrandSchema.partial();

/**
 * GET /api/v1/brands
 * List all brands for the caller's account.
 */
router.get("/", async (req: Request, res: Response) => {
  const { account_id } = req.user!;

  const { data, error } = await supabase
    .from("brands")
    .select("*")
    .eq("account_id", account_id)
    .order("created_at", { ascending: true });

  if (error) throw new ApiError(500, "DB_ERROR", "Failed to fetch brands");

  res.json({ data: data ?? [] });
});

/**
 * POST /api/v1/brands
 * Create a new brand under the caller's account.
 */
router.post("/", async (req: Request, res: Response) => {
  const { account_id } = req.user!;

  const body = createBrandSchema.safeParse(req.body);
  if (!body.success) {
    throw new ApiError(400, "VALIDATION_ERROR", body.error.errors[0].message);
  }

  const { brand_name, domain, industry } = body.data;

  const { data, error } = await supabase
    .from("brands")
    .insert({
      account_id,
      name: brand_name,
      brand_name,
      domain,
      industry,
    })
    .select()
    .single();

  if (error || !data) throw new ApiError(500, "DB_ERROR", "Failed to create brand");

  req.log.info({ event: "brands.created", brand_id: data.id }, "brand created");

  res.status(201).json({ data });
});

/**
 * PATCH /api/v1/brands/:id
 * Update brand settings (brand_name / domain / industry / enabled_models).
 */
router.patch("/:id", async (req: Request, res: Response) => {
  const { account_id } = req.user!;
  const { id } = req.params;

  const body = updateBrandSchema.safeParse(req.body);
  if (!body.success) {
    throw new ApiError(400, "VALIDATION_ERROR", body.error.errors[0].message);
  }

  const updates: Record<string, unknown> = { ...body.data, updated_at: new Date().toISOString() };
  // Keep the display name in sync with brand_name when it changes.
  if (body.data.brand_name !== undefined) updates.name = body.data.brand_name;

  const { data, error } = await supabase
    .from("brands")
    .update(updates)
    .eq("id", id)
    .eq("account_id", account_id)
    .select()
    .single();

  if (error || !data) throw new ApiError(404, "NOT_FOUND", "Brand not found");

  req.log.info({ event: "brands.updated", brand_id: data.id }, "brand updated");

  res.json({ data });
});

/**
 * DELETE /api/v1/brands/:id
 * Delete a brand and all its data. Refuses to delete the account's last brand.
 */
router.delete("/:id", async (req: Request, res: Response) => {
  const { account_id } = req.user!;
  const { id } = req.params;

  const { count } = await supabase
    .from("brands")
    .select("*", { count: "exact", head: true })
    .eq("account_id", account_id);

  if ((count ?? 0) <= 1) {
    throw new ApiError(400, "LAST_BRAND", "You must keep at least one brand.");
  }

  const { error } = await supabase
    .from("brands")
    .delete()
    .eq("id", id)
    .eq("account_id", account_id);

  if (error) throw new ApiError(404, "NOT_FOUND", "Brand not found");

  req.log.info({ event: "brands.deleted", brand_id: id }, "brand deleted");

  res.json({ data: { message: "Brand deleted" } });
});

export default router;
