import { Router, Request, Response } from "express";
import { supabase } from "../config/supabase";
import { authenticate, resolveBrand } from "../middleware/auth";
import { ApiError } from "../middleware/error-handler";
import { decryptSecret } from "../lib/crypto";
import {
  getModelForProvider,
  loadKeyedProviders,
  queryLLM,
} from "../services/llm/llm-router";
import {
  generateSuggestions,
  type QueryFn,
} from "../services/discovery/prompt-suggester";

const router = Router();
router.use(authenticate, resolveBrand);

/**
 * GET /api/v1/prompts/suggestions?status=suggested
 */
router.get("/", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;
  const status =
    typeof req.query.status === "string" ? req.query.status : "suggested";

  const { data, error } = await supabase
    .from("prompt_suggestions")
    .select("*")
    .eq("brand_id", brand_id)
    .eq("status", status)
    .order("created_at", { ascending: false });

  if (error) throw new ApiError(500, "DB_ERROR", "Failed to fetch suggestions");

  res.json({ data: data ?? [] });
});

/**
 * POST /api/v1/prompts/suggestions/generate
 * Generates suggestions with the account's first BYO key (falls back to
 * templates when no key is set). Upserts by (brand, text) so dismissed
 * suggestions never resurface.
 */
router.post("/generate", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;
  const { account_id } = req.user!;

  const [{ data: brand }, { data: competitors }, keyed] = await Promise.all([
    supabase
      .from("brands")
      .select("brand_name, industry")
      .eq("id", brand_id)
      .single(),
    supabase.from("competitors").select("name").eq("brand_id", brand_id),
    loadKeyedProviders(account_id),
  ]);

  if (!brand) throw new ApiError(404, "NOT_FOUND", "Brand not found");

  const seed = {
    brandName: brand.brand_name,
    industry: brand.industry,
    competitorNames: (competitors ?? []).map((c) => c.name),
  };

  // Use the account's first keyed provider for LLM generation, if any.
  let queryFn: QueryFn | undefined;
  const [provider] = [...keyed];
  const model = provider ? getModelForProvider(provider) : null;
  if (provider && model) {
    const { data: keyRow } = await supabase
      .from("provider_keys")
      .select("ciphertext, iv, auth_tag")
      .eq("account_id", account_id)
      .eq("provider", provider)
      .single();
    if (keyRow) {
      const apiKey = decryptSecret({
        ciphertext: keyRow.ciphertext,
        iv: keyRow.iv,
        authTag: keyRow.auth_tag,
      });
      queryFn = (prompt) => queryLLM(model, prompt, apiKey).then((r) => r.raw);
    }
  }

  const suggestions = await generateSuggestions(seed, queryFn);

  if (suggestions.length > 0) {
    await supabase.from("prompt_suggestions").upsert(
      suggestions.map((s) => ({
        brand_id,
        text: s.text,
        query_type: s.queryType,
        source: s.source,
        status: "suggested",
      })),
      { onConflict: "brand_id,text", ignoreDuplicates: true },
    );
  }

  const { data } = await supabase
    .from("prompt_suggestions")
    .select("*")
    .eq("brand_id", brand_id)
    .eq("status", "suggested")
    .order("created_at", { ascending: false });

  req.log.info(
    {
      event: "suggestions.generated",
      count: suggestions.length,
      used_llm: Boolean(queryFn),
    },
    "prompt suggestions generated",
  );

  res.json({ data: data ?? [] });
});

/**
 * POST /api/v1/prompts/suggestions/:id/add
 * Turns a suggestion into a tracked prompt and marks it added.
 */
router.post("/:id/add", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;
  const id = String(req.params.id);

  const { data: suggestion } = await supabase
    .from("prompt_suggestions")
    .select("*")
    .eq("id", id)
    .eq("brand_id", brand_id)
    .single();

  if (!suggestion) throw new ApiError(404, "NOT_FOUND", "Suggestion not found");

  const { data: prompt, error } = await supabase
    .from("prompts")
    .insert({
      brand_id,
      text: suggestion.text,
      query_type: suggestion.query_type,
    })
    .select()
    .single();

  if (error || !prompt)
    throw new ApiError(500, "DB_ERROR", "Failed to add prompt");

  await supabase
    .from("prompt_suggestions")
    .update({ status: "added" })
    .eq("id", id);

  req.log.info(
    { event: "suggestions.added", prompt_id: prompt.id },
    "suggestion added",
  );

  res.status(201).json({ data: { prompt } });
});

/**
 * POST /api/v1/prompts/suggestions/:id/dismiss
 */
router.post("/:id/dismiss", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;
  const id = String(req.params.id);

  const { error } = await supabase
    .from("prompt_suggestions")
    .update({ status: "dismissed" })
    .eq("id", id)
    .eq("brand_id", brand_id);

  if (error) throw new ApiError(404, "NOT_FOUND", "Suggestion not found");

  res.json({ data: { message: "Suggestion dismissed" } });
});

export default router;
