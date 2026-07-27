import { Router, Request, Response } from "express";
import { supabase } from "../config/supabase";
import { authenticate, resolveBrand } from "../middleware/auth";
import { ApiError } from "../middleware/error-handler";

const router = Router();
router.use(authenticate, resolveBrand);

/**
 * GET /api/v1/responses
 * List LLM responses with optional filtering.
 */
router.get("/", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;
  const { promptId, model, page = "1", limit = "20" } = req.query;

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(100, Math.max(1, Number(limit)));
  const offset = (pageNum - 1) * limitNum;

  let query = supabase
    .from("responses")
    .select(
      `
      id, scan_id, prompt_id, model, status,
      snippet, brand_mentioned, mention_position, brand_sentiment,
      queried_at, created_at,
      prompts!inner(text)
    `,
      { count: "exact" },
    )
    .eq("brand_id", brand_id)
    .order("queried_at", { ascending: false })
    .range(offset, offset + limitNum - 1);

  if (promptId) query = query.eq("prompt_id", promptId as string);
  if (model) query = query.eq("model", model as string);

  const { data, error, count } = await query;

  if (error) throw new ApiError(500, "DB_ERROR", "Failed to fetch responses");

  res.json({
    data: data ?? [],
    meta: {
      page: pageNum,
      limit: limitNum,
      total: count ?? 0,
      pages: Math.ceil((count ?? 0) / limitNum),
    },
  });
});

/**
 * GET /api/v1/responses/:id
 * Get full response details including raw response text.
 */
router.get("/:id", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;
  const { id } = req.params;

  const { data, error } = await supabase
    .from("responses")
    .select(
      `
      *,
      prompts!inner(text),
      mentions(id, name, type, position),
      citations(id, url, domain, title)
    `,
    )
    .eq("id", id)
    .eq("brand_id", brand_id)
    .single();

  if (error || !data)
    throw new ApiError(404, "NOT_FOUND", "Response not found");

  res.json({ data });
});

export default router;
