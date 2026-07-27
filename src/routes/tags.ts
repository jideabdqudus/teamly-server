import { Router, Request, Response } from "express";
import { z } from "zod";
import { supabase } from "../config/supabase";
import { authenticate, resolveBrand } from "../middleware/auth";
import { ApiError } from "../middleware/error-handler";

const router = Router();
router.use(authenticate, resolveBrand);

/**
 * GET /api/v1/tags
 * Brand tags with how many prompts carry each.
 */
router.get("/", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;

  const { data: tags, error } = await supabase
    .from("tags")
    .select("id, name, created_at")
    .eq("brand_id", brand_id)
    .order("name", { ascending: true });

  if (error) throw new ApiError(500, "DB_ERROR", "Failed to fetch tags");

  const tagIds = (tags ?? []).map((t) => t.id);
  const { data: links } =
    tagIds.length > 0
      ? await supabase.from("prompt_tags").select("tag_id").in("tag_id", tagIds)
      : { data: [] as { tag_id: string }[] };

  const countByTag = new Map<string, number>();
  (links ?? []).forEach((l) =>
    countByTag.set(l.tag_id, (countByTag.get(l.tag_id) ?? 0) + 1),
  );

  res.json({
    data: (tags ?? []).map((t) => ({
      ...t,
      prompt_count: countByTag.get(t.id) ?? 0,
    })),
  });
});

/**
 * POST /api/v1/tags
 * Create a tag (idempotent per brand — returns the existing one if the name is taken).
 */
router.post("/", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;

  const body = z
    .object({ name: z.string().min(1).max(40) })
    .safeParse(req.body);
  if (!body.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "A tag name is required");
  }

  const name = body.data.name.trim();

  const { data, error } = await supabase
    .from("tags")
    .upsert({ brand_id, name }, { onConflict: "brand_id,name" })
    .select("id, name, created_at")
    .single();

  if (error || !data)
    throw new ApiError(500, "DB_ERROR", "Failed to create tag");

  req.log.info({ event: "tags.created", tag_id: data.id }, "tag created");

  res.status(201).json({ data: { ...data, prompt_count: 0 } });
});

/**
 * DELETE /api/v1/tags/:id
 * Removes a tag and unlinks it from every prompt (cascade).
 */
router.delete("/:id", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;
  const { id } = req.params;

  const { error } = await supabase
    .from("tags")
    .delete()
    .eq("id", id)
    .eq("brand_id", brand_id);

  if (error) throw new ApiError(404, "NOT_FOUND", "Tag not found");

  req.log.info({ event: "tags.deleted", tag_id: id }, "tag deleted");

  res.json({ data: { message: "Tag deleted" } });
});

export default router;
