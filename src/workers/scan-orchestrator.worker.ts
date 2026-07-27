import { Worker, Job } from "bullmq";
import { redis } from "../config/redis";
import { supabase } from "../config/supabase";
import { childLogger } from "../config/logger";
import { llmQueryQueue, scanOrchestrateQueue } from "../queues";
import { ScanOrchestrateJob, ModelName } from "../types";
import {
  isModelRunnable,
  loadKeyedProviders,
} from "../services/llm/llm-router";

const log = childLogger({ worker: "scan-orchestrator" });

export function createScanOrchestratorWorker(): Worker {
  return new Worker<ScanOrchestrateJob>(
    "scan-orchestrate",
    async (job: Job<ScanOrchestrateJob>) => {
      const { triggered_by, prompt_ids, model_ids, account_id } = job.data;
      const brand_id = job.data.brand_id;

      log.info(
        { job_id: job.id, brand_id, triggered_by },
        "scan orchestrate start",
      );

      // Daily cron: no brand_id → iterate every brand and fan out one scan each.
      if (triggered_by === "cron" && !brand_id) {
        const { data: brands } = await supabase
          .from("brands")
          .select("id, account_id");

        for (const brand of brands ?? []) {
          const { data: newScan } = await supabase
            .from("scans")
            .insert({
              brand_id: brand.id,
              triggered_by: "cron",
              status: "pending",
            })
            .select()
            .single();

          if (newScan) {
            await scanOrchestrateQueue.add("orchestrate", {
              brand_id: brand.id,
              account_id: brand.account_id,
              scan_id: newScan.id,
              triggered_by: "cron",
            });
          }
        }
        return;
      }

      const scan_id = job.data.scan_id!;

      // Brand supplies the brand name; the account supplies enabled_models + keys.
      const [{ data: brand }, { data: account }, keyedProviders] =
        await Promise.all([
          supabase
            .from("brands")
            .select("brand_name")
            .eq("id", brand_id)
            .single(),
          supabase
            .from("accounts")
            .select("enabled_models")
            .eq("id", account_id)
            .single(),
          loadKeyedProviders(account_id!),
        ]);

      if (!brand) throw new Error(`Brand ${brand_id} not found`);
      if (!account) throw new Error(`Account ${account_id} not found`);

      // Determine which prompts to query
      let promptsQuery = supabase
        .from("prompts")
        .select("id, text")
        .eq("brand_id", brand_id)
        .eq("active", true);

      if (prompt_ids && prompt_ids.length > 0) {
        promptsQuery = promptsQuery.in("id", prompt_ids);
      }

      const { data: prompts } = await promptsQuery;
      if (!prompts || prompts.length === 0) {
        log.warn(
          { scan_id, brand_id },
          "no active prompts for brand — scan completed empty",
        );
        await supabase
          .from("scans")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", scan_id);
        return;
      }

      // Models to scan = requested/enabled ∩ providers the account has a key for.
      const candidateModels =
        model_ids && model_ids.length > 0
          ? (model_ids as ModelName[])
          : (account.enabled_models as ModelName[]);

      const modelsToUse = candidateModels.filter((m) =>
        isModelRunnable(m, keyedProviders),
      );

      if (modelsToUse.length === 0) {
        log.warn(
          { scan_id, brand_id, account_id },
          "no enabled model has a provider key — scan completed empty",
        );
        await supabase
          .from("scans")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", scan_id);
        return;
      }

      const totalTasks = prompts.length * modelsToUse.length;

      // Update scan to running
      await supabase
        .from("scans")
        .update({
          status: "running",
          total_tasks: totalTasks,
          started_at: new Date().toISOString(),
        })
        .eq("id", scan_id);

      // Enqueue one LLM query job per (prompt × model)
      const jobs = prompts.flatMap((p) =>
        modelsToUse.map((model) => ({
          name: "query",
          data: {
            scan_id,
            brand_id: brand_id!,
            account_id: account_id!,
            prompt_id: p.id,
            model,
            prompt_text: p.text,
            brand_name: brand.brand_name,
          },
        })),
      );

      await llmQueryQueue.addBulk(jobs);
      log.info(
        { scan_id, brand_id, total_tasks: totalTasks, models: modelsToUse },
        "llm query jobs enqueued",
      );
    },
    {
      connection: redis,
      concurrency: 5,
    },
  );
}
