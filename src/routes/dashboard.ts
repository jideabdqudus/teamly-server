import { Router, Request, Response } from "express";
import { supabase } from "../config/supabase";
import { authenticate } from "../middleware/auth";
import { ApiError } from "../middleware/error-handler";

const router = Router();
router.use(authenticate);

/**
 * GET /api/v1/dashboard
 * Returns composite dashboard data for the overview page.
 */
router.get("/", async (req: Request, res: Response) => {
  const { org_id } = req.user!;
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
      .eq("org_id", org_id)
      .gte("date", fromDate)
      .order("date", { ascending: true }),

    // Prompts (for top prompts section)
    supabase
      .from("prompts")
      .select("id, text, active")
      .eq("org_id", org_id)
      .eq("active", true)
      .limit(5),

    // Recent citations
    supabase
      .from("citations")
      .select("id, url, domain, title, model, first_seen_at, last_seen_at")
      .eq("org_id", org_id)
      .order("last_seen_at", { ascending: false })
      .limit(5),

    // Unread alerts
    supabase
      .from("alert_history")
      .select("*")
      .eq("org_id", org_id)
      .eq("read", false)
      .order("created_at", { ascending: false })
      .limit(10),

    // Per-prompt visibility (for top prompts)
    supabase
      .from("prompt_visibility_daily")
      .select("prompt_id, score, date")
      .eq("org_id", org_id)
      .gte("date", fromDate)
      .order("date", { ascending: false }),
  ]);

  const visibility = visibilityResult.data ?? [];
  const latest = visibility[visibility.length - 1];
  const prev = visibility[visibility.length - 2];

  const visibilityScore = latest?.score ?? 0;
  const visibilityChange = latest && prev ? latest.score - prev.score : null;

  // Build per-model breakdown from latest score
  const modelBreakdown = latest?.model_scores ?? {};

  // Top prompts with their latest scores
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
      visibility: {
        score: visibilityScore,
        change: visibilityChange,
        trend: visibility.map((v) => ({ date: v.date, score: v.score })),
        model_breakdown: modelBreakdown,
      },
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
  const { org_id } = req.user!;
  const days = Number(req.query.days ?? 30);
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const { data, error } = await supabase
    .from("visibility_daily")
    .select("*")
    .eq("org_id", org_id)
    .gte("date", fromDate)
    .order("date", { ascending: true });

  if (error)
    throw new ApiError(500, "DB_ERROR", "Failed to fetch visibility data");

  res.json({ data: data ?? [] });
});

export default router;
