import { Worker, Job } from "bullmq";
import { redis } from "../config/redis";
import { supabase } from "../config/supabase";
import { childLogger } from "../config/logger";
import { alertQueue } from "../queues";
import { ScoringJob } from "../types";
import { calculateVisibilityScore } from "../services/scoring/visibility-score";
import { calculateSOV } from "../services/scoring/sov-calculator";

const log = childLogger({ worker: "scoring" });

export function createScoringWorker(): Worker {
  return new Worker<ScoringJob>(
    "scoring",
    async (job: Job<ScoringJob>) => {
      const { scan_id, brand_id } = job.data;
      const today = new Date().toISOString().split("T")[0];

      log.info({ job_id: job.id, scan_id, brand_id }, "scoring start");

      // Load all responses for this scan
      const { data: responses } = await supabase
        .from("responses")
        .select("id, prompt_id, model, brand_mentioned, brand_sentiment_score")
        .eq("scan_id", scan_id)
        .eq("status", "success");

      if (!responses || responses.length === 0) {
        log.warn(
          { scan_id, brand_id },
          "no successful responses for scan — scoring skipped",
        );
        return;
      }

      // Calculate visibility scores
      const scores = calculateVisibilityScore(
        responses as Parameters<typeof calculateVisibilityScore>[0],
      );

      // Write per-prompt visibility
      for (const ps of scores.by_prompt) {
        const { data: citations } = await supabase
          .from("citations")
          .select("id", { count: "exact" })
          .eq("brand_id", brand_id)
          .eq("prompt_id", ps.prompt_id)
          .gte(
            "last_seen_at",
            new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          );

        await supabase.from("prompt_visibility_daily").upsert(
          {
            brand_id,
            prompt_id: ps.prompt_id,
            date: today,
            score: ps.score,
            mentions: ps.mentions,
            responses: ps.responses,
            citations: citations?.length ?? 0,
          },
          { onConflict: "brand_id,prompt_id,date" },
        );
      }

      const { data: mentions } = await supabase
        .from("mentions")
        .select("name, type, position")
        .eq("brand_id", brand_id)
        .in(
          "response_id",
          responses.map((r) => r.id),
        );

      const sovResults = calculateSOV(
        (mentions ?? []) as Parameters<typeof calculateSOV>[0],
      );
      const brandEntry = sovResults.find((s) => s.type === "brand");

      const sentimentScores = (responses ?? [])
        .filter(
          (r) =>
            r.brand_mentioned && typeof r.brand_sentiment_score === "number",
        )
        .map((r) => r.brand_sentiment_score as number);
      const sentimentScore =
        sentimentScores.length > 0
          ? Math.round(
              sentimentScores.reduce((a, b) => a + b, 0) /
                sentimentScores.length,
            )
          : null;

      const totalCitations = await supabase
        .from("citations")
        .select("*", { count: "exact", head: true })
        .eq("brand_id", brand_id);

      await supabase.from("visibility_daily").upsert(
        {
          brand_id,
          scan_id,
          date: today,
          score: scores.score,
          total_responses: scores.total_responses,
          total_mentions: scores.total_mentions,
          total_citations: totalCitations.count ?? 0,
          brand_sov: brandEntry?.shareOfVoice ?? 0,
          avg_position: brandEntry?.avgPosition ?? null,
          sentiment_score: sentimentScore,
          model_scores: scores.by_model,
        },
        { onConflict: "brand_id,date" },
      );

      const { data: competitors } = await supabase
        .from("competitors")
        .select("id, name")
        .eq("brand_id", brand_id);

      if (competitors && competitors.length > 0) {
        const sovByName = new Map(
          sovResults
            .filter((s) => s.type === "competitor")
            .map((s) => [s.name, s]),
        );
        const competitorRows = competitors.map((c) => {
          const entry = sovByName.get(c.name.toLowerCase());
          return {
            brand_id,
            competitor_id: c.id,
            date: today,
            share_of_voice: entry?.shareOfVoice ?? 0,
            mentions: entry?.mentions ?? 0,
            avg_position: entry?.avgPosition ?? null,
          };
        });
        await supabase
          .from("competitor_visibility_daily")
          .upsert(competitorRows, {
            onConflict: "brand_id,competitor_id,date",
          });
      }

      log.info(
        {
          scan_id,
          brand_id,
          score: scores.score,
          total_responses: scores.total_responses,
          total_mentions: scores.total_mentions,
          sov_entries: sovResults.length,
        },
        "scoring complete",
      );

      // Trigger alert evaluation
      await alertQueue.add("evaluate", { scan_id, brand_id });
    },
    {
      connection: redis,
      concurrency: 1,
    },
  );
}
