import { Router, Request, Response } from "express";
import { supabase } from "../config/supabase";
import { authenticate, resolveBrand } from "../middleware/auth";
import { ApiError } from "../middleware/error-handler";
import { computeDelta } from "../lib/trend";

const router = Router();
router.use(authenticate, resolveBrand);

/**
 * GET /api/v1/dashboard
 * Returns composite dashboard data for the overview page.
 */
router.get("/", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;
  const days = Number(req.query.days ?? 30);
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const [
    visibilityResult,
    promptsResult,
    citationsResult,
    alertsResult,
    promptVisResult,
  ] = await Promise.all([
    // Visibility trend
    supabase
      .from("visibility_daily")
      .select("*")
      .eq("brand_id", brand_id)
      .gte("date", fromDate)
      .order("date", { ascending: true }),

    // Prompts (for top prompts section)
    supabase
      .from("prompts")
      .select("id, text, active")
      .eq("brand_id", brand_id)
      .eq("active", true)
      .limit(5),

    // Recent citations
    supabase
      .from("citations")
      .select("id, url, domain, title, model, first_seen_at, last_seen_at")
      .eq("brand_id", brand_id)
      .order("last_seen_at", { ascending: false })
      .limit(5),

    // Unread alerts
    supabase
      .from("alert_history")
      .select("*")
      .eq("brand_id", brand_id)
      .eq("read", false)
      .order("created_at", { ascending: false })
      .limit(10),

    // Per-prompt visibility (for top prompts)
    supabase
      .from("prompt_visibility_daily")
      .select("prompt_id, score, date")
      .eq("brand_id", brand_id)
      .gte("date", fromDate)
      .order("date", { ascending: false }),
  ]);

  const visibility = visibilityResult.data ?? [];
  const latest = visibility[visibility.length - 1];

  // Build one daily series per headline KPI, then a period-over-period delta.
  // computeDelta drops null points, so no pre-filtering here.
  const series = (map: (v: (typeof visibility)[number]) => number | null) =>
    visibility.map((v) => ({ date: v.date as string, value: map(v) }));

  const metrics = {
    visibility_score: computeDelta(series((v) => v.score ?? 0)),
    mention_rate: computeDelta(
      series((v) =>
        v.total_responses > 0
          ? Math.round((v.total_mentions / v.total_responses) * 100)
          : 0,
      ),
    ),
    brand_sov: computeDelta(series((v) => v.brand_sov ?? 0)),
    // Position is only meaningful when the brand was mentioned — skip null days.
    avg_position: computeDelta(
      series((v) => (v.avg_position != null ? Number(v.avg_position) : null)),
    ),
    total_citations: computeDelta(series((v) => v.total_citations ?? 0)),
    // Sentiment is null on days with no brand mentions — skip those.
    sentiment: computeDelta(
      series((v) => (v.sentiment_score != null ? v.sentiment_score : null)),
    ),
  };

  // Per-model breakdown from the latest snapshot.
  const modelBreakdown = latest?.model_scores ?? {};

  // Top prompts with their latest scores.
  const promptScoreMap = new Map<string, number>();
  (promptVisResult.data ?? []).forEach((pv) => {
    if (!promptScoreMap.has(pv.prompt_id)) {
      promptScoreMap.set(pv.prompt_id, pv.score);
    }
  });

  const topPrompts = (promptsResult.data ?? []).map((p) => ({
    id: p.id,
    text: p.text,
    score: promptScoreMap.get(p.id) ?? 0,
  }));

  res.json({
    data: {
      metrics,
      model_breakdown: modelBreakdown,
      top_prompts: topPrompts,
      recent_citations: citationsResult.data ?? [],
      alerts: alertsResult.data ?? [],
    },
  });
});

/**
 * GET /api/v1/visibility
 * Visibility history with configurable window.
 */
router.get("/visibility", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;
  const days = Number(req.query.days ?? 30);
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const { data, error } = await supabase
    .from("visibility_daily")
    .select("*")
    .eq("brand_id", brand_id)
    .gte("date", fromDate)
    .order("date", { ascending: true });

  if (error)
    throw new ApiError(500, "DB_ERROR", "Failed to fetch visibility data");

  res.json({ data: data ?? [] });
});

export default router;
