import { Router, Request, Response } from "express";
import { z } from "zod";
import { supabase } from "../config/supabase";
import { authenticate, resolveBrand } from "../middleware/auth";
import { ApiError } from "../middleware/error-handler";
import { classifyQueryType } from "../services/analysis/query-classifier";

const router = Router();
router.use(authenticate, resolveBrand);

const createPromptSchema = z.object({
  text: z.string().min(5, "Prompt must be at least 5 characters").max(500),
  country: z.string().default("United States"),
  country_code: z.string().default("US"),
  language: z.string().default("English"),
  query_type: z.enum(["brand", "generic", "competitor"]).optional(),
  tag_ids: z.array(z.string().uuid()).optional(),
});

const updatePromptSchema = createPromptSchema.partial().extend({
  active: z.boolean().optional(),
});

async function syncPromptTags(
  promptId: string,
  tagIds: string[],
): Promise<void> {
  await supabase.from("prompt_tags").delete().eq("prompt_id", promptId);
  if (tagIds.length > 0) {
    await supabase
      .from("prompt_tags")
      .insert(tagIds.map((tag_id) => ({ prompt_id: promptId, tag_id })));
  }
}

async function loadPromptTags(
  promptId: string,
): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase
    .from("prompt_tags")
    .select("tags(id, name)")
    .eq("prompt_id", promptId);
  return (data ?? [])
    .map((row) => row.tags as unknown as { id: string; name: string } | null)
    .filter((t): t is { id: string; name: string } => t !== null);
}

/**
 * GET /api/v1/prompts
 * List prompts for the brand with latest visibility metrics, query_type, and tags.
 */
router.get("/", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;

  const { data: prompts, error } = await supabase
    .from("prompts")
    .select("*")
    .eq("brand_id", brand_id)
    .order("created_at", { ascending: false });

  if (error) throw new ApiError(500, "DB_ERROR", "Failed to fetch prompts");

  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const promptIds = (prompts ?? []).map((p) => p.id);

  const [visResult, tagResult] = await Promise.all([
    supabase
      .from("prompt_visibility_daily")
      .select("*")
      .eq("brand_id", brand_id)
      .gte("date", thirtyDaysAgo)
      .lte("date", today),
    promptIds.length > 0
      ? supabase
          .from("prompt_tags")
          .select("prompt_id, tags(id, name)")
          .in("prompt_id", promptIds)
      : Promise.resolve({ data: [] as { prompt_id: string; tags: unknown }[] }),
  ]);

  // Latest metrics per prompt.
  const metricsByPrompt = new Map<string, NonNullable<typeof visResult.data>>();
  visResult.data?.forEach((m) => {
    const existing = metricsByPrompt.get(m.prompt_id) ?? [];
    metricsByPrompt.set(m.prompt_id, [...existing, m]);
  });

  // Tags per prompt.
  const tagsByPrompt = new Map<string, { id: string; name: string }[]>();
  (tagResult.data ?? []).forEach((row) => {
    const tag = row.tags as unknown as { id: string; name: string } | null;
    if (!tag) return;
    const existing = tagsByPrompt.get(row.prompt_id) ?? [];
    tagsByPrompt.set(row.prompt_id, [...existing, tag]);
  });

  const enriched = (prompts ?? []).map((p) => {
    const metrics = metricsByPrompt.get(p.id) ?? [];
    const latest = metrics.sort((a, b) => b.date.localeCompare(a.date))[0];
    const prev = metrics[1];

    return {
      ...p,
      tags: tagsByPrompt.get(p.id) ?? [],
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
 * Creates a prompt, auto-classifying its query_type unless overridden.
 */
router.post("/", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;

  const body = createPromptSchema.safeParse(req.body);
  if (!body.success) {
    throw new ApiError(400, "VALIDATION_ERROR", body.error.errors[0].message);
  }

  const { tag_ids, query_type, ...fields } = body.data;

  let finalType = query_type;
  if (!finalType) {
    const [{ data: brand }, { data: competitors }] = await Promise.all([
      supabase.from("brands").select("brand_name").eq("id", brand_id).single(),
      supabase.from("competitors").select("name").eq("brand_id", brand_id),
    ]);
    finalType = classifyQueryType(
      fields.text,
      brand?.brand_name ?? "",
      (competitors ?? []).map((c) => c.name),
    );
  }

  const { data, error } = await supabase
    .from("prompts")
    .insert({ brand_id, ...fields, query_type: finalType })
    .select()
    .single();

  if (error || !data)
    throw new ApiError(500, "DB_ERROR", "Failed to create prompt");

  if (tag_ids && tag_ids.length > 0) await syncPromptTags(data.id, tag_ids);

  req.log.info(
    { event: "prompts.created", prompt_id: data.id, query_type: finalType },
    "prompt created",
  );

  res
    .status(201)
    .json({ data: { ...data, tags: await loadPromptTags(data.id) } });
});

/**
 * PATCH /api/v1/prompts/:id
 * Updates prompt fields (incl. query_type) and/or its tag set.
 */
router.patch("/:id", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;
  const id = String(req.params.id);

  const body = updatePromptSchema.safeParse(req.body);
  if (!body.success) {
    throw new ApiError(400, "VALIDATION_ERROR", body.error.errors[0].message);
  }

  const { tag_ids, ...fields } = body.data;

  let prompt;
  if (Object.keys(fields).length > 0) {
    const { data, error } = await supabase
      .from("prompts")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("brand_id", brand_id)
      .select()
      .single();
    if (error || !data)
      throw new ApiError(404, "NOT_FOUND", "Prompt not found");
    prompt = data;
  } else {
    const { data, error } = await supabase
      .from("prompts")
      .select("*")
      .eq("id", id)
      .eq("brand_id", brand_id)
      .single();
    if (error || !data)
      throw new ApiError(404, "NOT_FOUND", "Prompt not found");
    prompt = data;
  }

  if (tag_ids !== undefined) await syncPromptTags(id, tag_ids);

  req.log.info({ event: "prompts.updated", prompt_id: id }, "prompt updated");

  res.json({ data: { ...prompt, tags: await loadPromptTags(id) } });
});

/**
 * DELETE /api/v1/prompts/:id
 */
router.delete("/:id", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;
  const id = String(req.params.id);

  const { error } = await supabase
    .from("prompts")
    .delete()
    .eq("id", id)
    .eq("brand_id", brand_id);

  if (error) throw new ApiError(404, "NOT_FOUND", "Prompt not found");

  req.log.info({ event: "prompts.deleted", prompt_id: id }, "prompt deleted");

  res.json({ data: { message: "Prompt deleted" } });
});

export default router;
