import { Router, Request, Response } from "express";
import { z } from "zod";
import { supabase } from "../config/supabase";
import { authenticate, resolveBrand } from "../middleware/auth";
import { ApiError } from "../middleware/error-handler";

const router = Router();
router.use(authenticate, resolveBrand);

/**
 * GET /api/v1/alerts
 * Returns alert history for the org.
 */
router.get("/", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;
  const { unread } = req.query;

  let query = supabase
    .from("alert_history")
    .select("*")
    .eq("brand_id", brand_id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (unread === "true") query = query.eq("read", false);

  const { data, error } = await query;
  if (error) throw new ApiError(500, "DB_ERROR", "Failed to fetch alerts");

  res.json({ data: data ?? [] });
});

/**
 * PATCH /api/v1/alerts/:id/read
 * Mark an alert as read.
 */
router.patch("/:id/read", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;
  const { id } = req.params;

  const { error } = await supabase
    .from("alert_history")
    .update({ read: true })
    .eq("id", id)
    .eq("brand_id", brand_id);

  if (error) throw new ApiError(404, "NOT_FOUND", "Alert not found");

  req.log.info({ event: "alerts.read", alert_id: id }, "alert marked read");

  res.json({ data: { message: "Alert marked as read" } });
});

/**
 * GET /api/v1/alerts/rules
 * List alert rules for the org.
 */
router.get("/rules", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;

  const { data, error } = await supabase
    .from("alert_rules")
    .select("*")
    .eq("brand_id", brand_id);

  if (error) throw new ApiError(500, "DB_ERROR", "Failed to fetch alert rules");

  res.json({ data: data ?? [] });
});

/**
 * PUT /api/v1/alerts/rules/:id
 * Update (or create) an alert rule.
 */
router.put("/rules/:id", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;
  const { id } = req.params;

  const body = z
    .object({
      enabled: z.boolean().optional(),
      threshold: z.number().optional(),
    })
    .safeParse(req.body);

  if (!body.success) {
    throw new ApiError(400, "VALIDATION_ERROR", body.error.errors[0].message);
  }

  const { data, error } = await supabase
    .from("alert_rules")
    .update({ ...body.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("brand_id", brand_id)
    .select()
    .single();

  if (error || !data)
    throw new ApiError(404, "NOT_FOUND", "Alert rule not found");

  req.log.info(
    { event: "alerts.rule_updated", rule_id: data.id },
    "alert rule updated",
  );

  res.json({ data });
});

export default router;
