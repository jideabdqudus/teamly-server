import { Router, Request, Response } from "express";
import { supabase } from "../config/supabase";
import { authenticate, resolveBrand } from "../middleware/auth";
import { computeDelta } from "../lib/trend";

const router = Router();
router.use(authenticate, resolveBrand);

type SentimentLabel = "positive" | "neutral" | "negative";

/**
 * GET /api/v1/sentiment?days=30
 * Brand sentiment: daily aggregate + trend, per-model averages, label
 * distribution, and the most-negative recent responses ("needs attention").
 */
router.get("/", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;
  const days = Number(req.query.days ?? 30);
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const fromDateStr = fromDate.toISOString().split("T")[0];

  const [dailyResult, responsesResult] = await Promise.all([
    supabase
      .from("visibility_daily")
      .select("date, sentiment_score")
      .eq("brand_id", brand_id)
      .gte("date", fromDateStr)
      .order("date", { ascending: true }),

    supabase
      .from("responses")
      .select(
        "id, model, brand_sentiment, brand_sentiment_score, snippet, prompts!inner(text)",
      )
      .eq("brand_id", brand_id)
      .eq("brand_mentioned", true)
      .gte("queried_at", fromDate.toISOString())
      .order("queried_at", { ascending: false }),
  ]);

  // Daily aggregate + period-over-period delta (computeDelta drops null days).
  const { value, change, change_pct, trend } = computeDelta(
    (dailyResult.data ?? []).map((d) => ({
      date: d.date as string,
      value: d.sentiment_score,
    })),
  );

  const responses = responsesResult.data ?? [];

  // Per-model average score.
  const modelAgg = new Map<string, { sum: number; count: number }>();
  const distribution = { positive: 0, neutral: 0, negative: 0 };

  for (const r of responses) {
    const label = r.brand_sentiment as SentimentLabel | null;
    if (label && label in distribution) distribution[label]++;

    if (typeof r.brand_sentiment_score === "number") {
      const agg = modelAgg.get(r.model) ?? { sum: 0, count: 0 };
      agg.sum += r.brand_sentiment_score;
      agg.count++;
      modelAgg.set(r.model, agg);
    }
  }

  const by_model: Record<string, number> = {};
  for (const [model, { sum, count }] of modelAgg) {
    by_model[model] = Math.round(sum / count);
  }

  // "Needs attention" — most-negative responses first.
  const recent_negative = responses
    .filter((r) => (r.brand_sentiment_score ?? 100) <= 40)
    .sort(
      (a, b) => (a.brand_sentiment_score ?? 0) - (b.brand_sentiment_score ?? 0),
    )
    .slice(0, 10)
    .map((r) => ({
      response_id: r.id,
      model: r.model,
      score: r.brand_sentiment_score,
      snippet: r.snippet ?? "",
      prompt_text:
        (r.prompts as unknown as { text?: string } | null)?.text ?? "",
    }));

  res.json({
    data: {
      score: value,
      change,
      change_pct,
      trend,
      by_model,
      distribution,
      recent_negative,
    },
  });
});

export default router;
